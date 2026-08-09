// The strongest guard in the wave: proves `createMemoryRepo` and
// `createIdbRepo` agree on every invariant in SPEC §2/§7/§8/§11, table-driven
// across both implementations. W3 and W4 keep developing against
// `memoryRepo`; this is what lets them trust that `idbRepo` matches it.
//
// Every entry seeds an EMPTY household (memoryRepo with empty arrays, idbRepo
// with a fresh, uniquely-named database) so both start from an identical,
// empty state — the fixture seed would otherwise make `tintCursor` and row
// counts differ legitimately between the two.
import { describe, expect, it, afterEach } from "vitest";
import type { Repo } from "@/data";
import { createIdbRepo, createMemoryRepo, DuplicateDoseError } from "@/data";
import type { HouseholdBackup, JoinCode, Medication, MetaShape, User } from "@/domain";
import {
  displayNameFor,
  fixedClock,
  GRACE_FIXED_MIN,
  GRACE_INTERVAL_MIN,
  isJoinCodeUsable,
  JOIN_CODE_TTL_MS,
  localDayKey,
  occurrenceKeyFor,
  RETRACT_GRACE_MS,
  setClock,
  systemClock,
  UNDO_WINDOW_MS,
} from "@/domain";

afterEach(() => {
  setClock(systemClock);
});

function emptyMemoryRepo(): Repo {
  return createMemoryRepo({
    pets: [],
    medications: [],
    courses: [],
    doseEvents: [],
    stockAdjustments: [],
  });
}

function idbFactory(): Repo {
  return createIdbRepo({ dbName: `petmeds-contract-${crypto.randomUUID()}` });
}

const implementations: Array<[string, () => Repo]> = [
  ["memoryRepo", emptyMemoryRepo],
  ["idbRepo", idbFactory],
];

/** Creates a pet + medication + course on an empty repo, returning their ids. */
async function setupCourse(repo: Repo): Promise<{ petId: string; medicationId: string; courseId: string }> {
  const pet = await repo.createPet({ name: "Clover", species: "rabbit" });
  const medication = await repo.createMedication({ name: "Metacam", form: "liquid", unit: "ml" });
  const course = await repo.createCourse({
    petId: pet.id,
    medicationId: medication.id,
    doseAmount: 0.4,
    doseUnit: "ml",
    instructions: null,
    schedule: { kind: "fixedTimes", times: ["08:00"] },
    startDate: "2026-08-01",
    endDate: null,
    notes: null,
  });
  return { petId: pet.id, medicationId: medication.id, courseId: course.id };
}

/** Same as `setupCourse` but `fromLastDose` — for dedup-guard cases keyed on `scheduledFor: null`. */
async function setupIntervalCourse(
  repo: Repo,
): Promise<{ petId: string; medicationId: string; courseId: string }> {
  const pet = await repo.createPet({ name: "Nugget", species: "guinea_pig" });
  const medication = await repo.createMedication({ name: "Metoclopramide", form: "liquid", unit: "ml" });
  const course = await repo.createCourse({
    petId: pet.id,
    medicationId: medication.id,
    doseAmount: 0.5,
    doseUnit: "ml",
    instructions: null,
    schedule: { kind: "fromLastDose", intervalHours: 8 },
    startDate: "2026-08-01",
    endDate: null,
    notes: null,
  });
  return { petId: pet.id, medicationId: medication.id, courseId: course.id };
}

function emptyBackup(overrides: Partial<HouseholdBackup> = {}): HouseholdBackup {
  return {
    schemaVersion: 1,
    exportedAt: "2026-08-08T07:00:00.000Z",
    pets: [],
    medications: [],
    courses: [],
    doseEvents: [],
    stockAdjustments: [],
    ...overrides,
  };
}

/**
 * Creates 4 pets, then merges in a backup holding 2 further pets exported
 * from a fresh repo of the same kind — the exact sequence that decouples
 * `tintCursor` from `pets.length` (merge inserts unseen rows without
 * touching the cursor). Returns the repo after the merge.
 */
async function fourPetsPlusMergedTwo(makeRepo: () => Repo): Promise<Repo> {
  const repo = makeRepo();
  for (let i = 0; i < 4; i++) {
    await repo.createPet({ name: `Pet ${i}`, species: "cat" });
  }
  const source = makeRepo();
  await source.createPet({ name: "Extra 1", species: "dog" });
  await source.createPet({ name: "Extra 2", species: "dog" });
  const backup = await source.exportHousehold();
  await repo.importHousehold(backup, "merge");
  return repo;
}

describe.each(implementations)("Repo contract — %s", (_name, makeRepo) => {
  // --- 1. logging any number of doses leaves stockUnits unchanged --------

  it("logging any number of doses leaves stockUnits unchanged (SPEC §11 case 6)", async () => {
    const repo = makeRepo();
    const { medicationId, courseId } = await setupCourse(repo);
    await repo.adjustStock({ medicationId, deltaUnits: 10, reason: "purchase" });
    const before = await repo.getMedication(medicationId);

    // `setupCourse` schedules `fixedTimes`, so the concurrent-log dedup guard
    // (CONTRACT.md §6) grades on GRACE_FIXED_MIN: four logs at one instant
    // are one dose repeated, not four distinct ones. Advance the injected
    // clock past the grace window between iterations so all four are
    // genuinely distinct occurrences and the guard has nothing to reject —
    // keeping this test's actual intent (stockUnits is untouched by logging)
    // free of an incidental collision with the dedup guard.
    let t = new Date("2026-08-08T07:00:00.000Z");
    for (let i = 0; i < 4; i++) {
      setClock(fixedClock(t.toISOString()));
      await repo.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.4 });
      t = new Date(t.getTime() + GRACE_FIXED_MIN * 60_000 + 60_000);
    }

    const after = await repo.getMedication(medicationId);
    expect(after?.stockUnits).toBe(before?.stockUnits);
    expect(await repo.listDoseEvents({ courseId })).toHaveLength(4);
  });

  // --- 2. logging then undoing leaves history exactly as before ----------

  it("logging then retracting a dose leaves the DoseEvent history exactly as before, and stockUnits untouched (SPEC §11 case 5)", async () => {
    setClock(fixedClock("2026-08-08T07:00:00.000Z"));
    const repo = makeRepo();
    const { medicationId, courseId } = await setupCourse(repo);
    await repo.adjustStock({ medicationId, deltaUnits: 10, reason: "purchase" });

    const stockBefore = (await repo.getMedication(medicationId))?.stockUnits;
    const snapshotBefore = await repo.listDoseEvents({});

    const event = await repo.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.4 });
    await repo.retractDoseEvent(event.id);

    const snapshotAfter = await repo.listDoseEvents({});
    const stockAfter = (await repo.getMedication(medicationId))?.stockUnits;

    expect(snapshotAfter).toEqual(snapshotBefore);
    expect(stockAfter).toBe(stockBefore);
  });

  // --- 3. retract window: inside / exact boundary / outside / superseded -

  describe("retractDoseEvent", () => {
    const t0 = "2026-08-08T07:00:00.000Z";
    const windowMs = UNDO_WINDOW_MS + RETRACT_GRACE_MS;

    it("succeeds exactly at the window boundary (elapsed === window)", async () => {
      setClock(fixedClock(t0));
      const repo = makeRepo();
      const { courseId } = await setupCourse(repo);
      const event = await repo.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.4 });

      setClock(fixedClock(new Date(new Date(t0).getTime() + windowMs).toISOString()));
      await expect(repo.retractDoseEvent(event.id)).resolves.toBeUndefined();
    });

    it("throws RetractWindowExpiredError one millisecond past the window", async () => {
      setClock(fixedClock(t0));
      const repo = makeRepo();
      const { courseId } = await setupCourse(repo);
      const event = await repo.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.4 });

      setClock(fixedClock(new Date(new Date(t0).getTime() + windowMs + 1).toISOString()));
      await expect(repo.retractDoseEvent(event.id)).rejects.toMatchObject({
        name: "RetractWindowExpiredError",
      });
    });

    it("refuses when another event supersedes the target row", async () => {
      setClock(fixedClock(t0));
      const repo = makeRepo();
      const { courseId } = await setupCourse(repo);
      const event = await repo.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.4 });
      await repo.correctDose(event.id, { amount: 0.5 });

      await expect(repo.retractDoseEvent(event.id)).rejects.toThrow();
    });
  });

  // --- 4. correctDose appends, never mutates the original -----------------

  it("correctDose appends a new row with supersedesId = originalId and leaves the original byte-identical", async () => {
    const repo = makeRepo();
    const { courseId } = await setupCourse(repo);
    const original = await repo.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.4 });

    const beforeRows = await repo.listDoseEvents({ courseId });
    const originalBefore = beforeRows.find((e) => e.id === original.id);
    const jsonBefore = JSON.stringify(originalBefore);

    const corrected = await repo.correctDose(original.id, { amount: 0.6, note: "fixed" });
    expect(corrected.id).not.toBe(original.id);
    expect(corrected.supersedesId).toBe(original.id);

    const afterRows = await repo.listDoseEvents({ courseId });
    const originalAfter = afterRows.find((e) => e.id === original.id);
    const jsonAfter = JSON.stringify(originalAfter);

    expect(jsonAfter).toBe(jsonBefore);
  });

  // --- 5. tint cursor is monotonic, not pets.length % TINT_COUNT ----------

  it("assigns tints [1,2,3,4,1] across five creates; archiving pet 2 does not reshuffle pet 5's tint", async () => {
    const repo = makeRepo();
    const created = [];
    for (let i = 0; i < 5; i++) {
      created.push(await repo.createPet({ name: `Pet ${i}`, species: "cat" }));
    }
    expect(created.map((p) => p.tint)).toEqual([1, 2, 3, 4, 1]);

    await repo.setPetArchived(created[1].id, true);

    const pet5 = await repo.getPet(created[4].id);
    expect(pet5?.tint).toBe(1);
  });

  // --- 6. adjustStock / setStockOnHand -------------------------------------

  it("adjustStock keeps stockUnits equal to the sum of ledger deltas, including a negative one", async () => {
    const repo = makeRepo();
    const medication = await repo.createMedication({ name: "Metacam", form: "liquid", unit: "ml" });

    await repo.adjustStock({ medicationId: medication.id, deltaUnits: 10, reason: "purchase" });
    await repo.adjustStock({ medicationId: medication.id, deltaUnits: -3, reason: "waste" });
    await repo.adjustStock({ medicationId: medication.id, deltaUnits: 5, reason: "purchase" });

    const ledger = await repo.listStockAdjustments(medication.id);
    const total = ledger.reduce((sum, a) => sum + a.deltaUnits, 0);
    const updated = await repo.getMedication(medication.id);
    expect(updated?.stockUnits).toBe(total);
    expect(total).toBe(12);
  });

  it("setStockOnHand appends a delta (units - currentTotal) with reason 'correction', never an absolute overwrite", async () => {
    const repo = makeRepo();
    const medication = await repo.createMedication({ name: "Metacam", form: "liquid", unit: "ml" });
    await repo.adjustStock({ medicationId: medication.id, deltaUnits: 12, reason: "purchase" });

    const adjustment = await repo.setStockOnHand(medication.id, 20);
    expect(adjustment.deltaUnits).toBe(8); // 20 - 12
    expect(adjustment.reason).toBe("correction");

    const afterFirst = await repo.getMedication(medication.id);
    expect(afterFirst?.stockUnits).toBe(20);

    // A second call to the same figure writes a 0 delta rather than duplicating the total.
    const secondAdjustment = await repo.setStockOnHand(medication.id, 20);
    expect(secondAdjustment.deltaUnits).toBe(0);

    const ledger = await repo.listStockAdjustments(medication.id);
    expect(ledger).toHaveLength(3);
    const afterSecond = await repo.getMedication(medication.id);
    expect(afterSecond?.stockUnits).toBe(20);
  });

  // --- 7. soft delete survives in a backup ---------------------------------

  it("softDeletePet removes the pet from listPets but the tombstone survives in exportHousehold", async () => {
    const repo = makeRepo();
    const pet = await repo.createPet({ name: "Clover", species: "rabbit" });
    await repo.softDeletePet(pet.id);

    const listed = await repo.listPets();
    expect(listed.find((p) => p.id === pet.id)).toBeUndefined();

    const backup = await repo.exportHousehold();
    const tombstone = backup.pets.find((p) => p.id === pet.id);
    expect(tombstone).toBeDefined();
    expect(tombstone?.deletedAt).not.toBeNull();
  });

  // --- 8. export -> import(replace) -> export is byte-identical ----------

  it("export -> importHousehold(replace) into a second empty repo -> export produces a byte-identical JSON string", async () => {
    setClock(fixedClock("2026-08-08T07:00:00.000Z"));
    const repo1 = makeRepo();
    const { medicationId, courseId } = await setupCourse(repo1);
    await repo1.adjustStock({ medicationId, deltaUnits: 10, reason: "purchase" });
    const dose = await repo1.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.4 });
    await repo1.correctDose(dose.id, { amount: 0.5 });
    const extraPet = await repo1.createPet({ name: "Nugget", species: "guinea_pig" });
    await repo1.softDeletePet(extraPet.id);

    const backup1 = await repo1.exportHousehold();

    const repo2 = makeRepo();
    await repo2.importHousehold(backup1, "replace");
    const backup2 = await repo2.exportHousehold();

    expect(JSON.stringify(backup2)).toBe(JSON.stringify(backup1));
  });

  // --- 9. merge import is last-write-wins on updatedAt --------------------

  it("importHousehold(merge) is last-write-wins on updatedAt: newer wins, older is skipped and counted", async () => {
    setClock(fixedClock("2026-08-08T07:00:00.000Z"));
    const repo = makeRepo();
    const pet = await repo.createPet({ name: "Old Name", species: "cat" });

    const olderIncoming = { ...pet, name: "Should Not Win", updatedAt: "2026-08-01T00:00:00.000Z" };
    const reportOlder = await repo.importHousehold(emptyBackup({ pets: [olderIncoming] }), "merge");
    expect(reportOlder.pets).toBe(0);
    expect(reportOlder.skipped).toBe(1);
    expect((await repo.getPet(pet.id))?.name).toBe("Old Name");

    const newerIncoming = { ...pet, name: "New Name", updatedAt: "2026-08-09T00:00:00.000Z" };
    const reportNewer = await repo.importHousehold(emptyBackup({ pets: [newerIncoming] }), "merge");
    expect(reportNewer.pets).toBe(1);
    expect(reportNewer.skipped).toBe(0);
    expect((await repo.getPet(pet.id))?.name).toBe("New Name");
  });

  // --- 10. recordMissed is idempotent via occurrenceKey -------------------

  it("recordMissed called twice for the same {courseId, scheduledFor} yields exactly one row with the canonical occurrenceKey", async () => {
    const repo = makeRepo();
    const { courseId } = await setupCourse(repo);
    const scheduledFor = "2026-08-09T08:00:00.000Z";

    await repo.recordMissed([{ courseId, scheduledFor, amount: 0.4 }]);
    await repo.recordMissed([{ courseId, scheduledFor, amount: 0.4 }]);

    const events = await repo.listDoseEvents({ courseId });
    const expectedKey = occurrenceKeyFor(courseId, scheduledFor);
    const matches = events.filter((e) => e.occurrenceKey === expectedKey);
    expect(matches).toHaveLength(1);
    expect(matches[0].occurrenceKey).toBe(expectedKey);
  });

  // --- 11. findMedicationByName: case-insensitive, trims, ignores soft-deleted --

  it("findMedicationByName is case-insensitive, trims whitespace, and ignores soft-deleted rows", async () => {
    const repo = makeRepo();
    await repo.createMedication({ name: "Metacam", form: "liquid", unit: "ml" });

    const found = await repo.findMedicationByName("  metaCAM  ");
    expect(found?.name).toBe("Metacam");

    const ts = "2026-08-08T07:00:00.000Z";
    const ghost: Medication = {
      id: crypto.randomUUID(),
      name: "Ghost",
      strength: null,
      form: "tablet",
      unit: "tab",
      packSize: null,
      stockUnits: null,
      lowThreshold: null,
      createdAt: ts,
      updatedAt: ts,
      deletedAt: ts,
    };
    await repo.importHousehold(emptyBackup({ medications: [ghost] }), "merge");

    expect(await repo.findMedicationByName("ghost")).toBeNull();
  });

  // --- 12. setCourseStatus lifecycle rules ---------------------------------

  it("setCourseStatus: paused->active sets resumedAt; active->stopped sets endDate=today; active->paused sets neither", async () => {
    const t0 = "2026-08-08T07:00:00.000Z";
    setClock(fixedClock(t0));
    const repo = makeRepo();
    const { courseId } = await setupCourse(repo);

    const paused = await repo.setCourseStatus(courseId, "paused");
    expect(paused.resumedAt).toBeNull();
    expect(paused.endDate).toBeNull();

    const resumed = await repo.setCourseStatus(courseId, "active");
    expect(resumed.resumedAt).toBe(t0);
    expect(resumed.endDate).toBeNull();

    const stopped = await repo.setCourseStatus(courseId, "stopped");
    expect(stopped.endDate).toBe(localDayKey(new Date(t0)));
  });

  // --- 13. meta defaults and round-trip ------------------------------------

  it("getMeta returns null for an unset key and the seeded defaults for a fresh empty household; setMeta round-trips", async () => {
    const repo = makeRepo();

    expect(await repo.getMeta("schemaVersion")).toBe(2);
    expect(await repo.getMeta("tintCursor")).toBe(0);
    expect(await repo.getMeta("lastSweepDay")).toBeNull();

    // A key outside MetaShape's three fields has never been written.
    expect(await repo.getMeta("bogusKey" as keyof MetaShape)).toBeNull();

    await repo.setMeta("lastSweepDay", "2026-08-08");
    expect(await repo.getMeta("lastSweepDay")).toBe("2026-08-08");
  });

  // --- 14. tintCursor transports through export/import(replace), matching merge --

  it("importHousehold(replace) restores the real tintCursor instead of re-deriving it from pets.length, matching the merge path", async () => {
    setClock(fixedClock("2026-08-08T07:00:00.000Z"));

    // Control path: merge decouples tintCursor (4) from pets.length (6);
    // the next createPet must use the real cursor, tint 1.
    const controlRepo = await fourPetsPlusMergedTwo(makeRepo);
    const controlPet = await controlRepo.createPet({ name: "Control", species: "cat" });
    expect(controlPet.tint).toBe(1);

    // Round-trip path: the identical sequence, exported and replace-imported
    // into a third fresh repo. Pre-fix, replace re-derived the cursor from
    // pets.length (6), giving tint 3 and colliding with the existing pet.
    const roundTripSource = await fourPetsPlusMergedTwo(makeRepo);
    const backup = await roundTripSource.exportHousehold();
    const roundTripRepo = makeRepo();
    await roundTripRepo.importHousehold(backup, "replace");
    const roundTripPet = await roundTripRepo.createPet({ name: "Round Trip", species: "cat" });

    expect(roundTripPet.tint).toBe(controlPet.tint);
  });

  // --- 15. currentActorId / currentHouseholdId: non-null and stable --------

  it("currentActorId and currentHouseholdId are non-empty strings, stable across a second call", async () => {
    const repo = makeRepo();
    const actorId = await repo.currentActorId();
    const householdId = await repo.currentHouseholdId();
    expect(actorId.length).toBeGreaterThan(0);
    expect(householdId.length).toBeGreaterThan(0);
    expect(await repo.currentActorId()).toBe(actorId);
    expect(await repo.currentHouseholdId()).toBe(householdId);
  });

  // --- 16. every write path stamps actorId without caller involvement ------

  it("logDose, correctDose, recordMissed, adjustStock and setStockOnHand each stamp actorId === currentActorId(), with no caller involvement", async () => {
    const repo = makeRepo();
    const { medicationId, courseId } = await setupCourse(repo);
    const actorId = await repo.currentActorId();
    expect(actorId.length).toBeGreaterThan(0);

    const dose = await repo.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.4 });
    expect(dose.actorId).toBe(actorId);

    const corrected = await repo.correctDose(dose.id, { amount: 0.5 });
    expect(corrected.actorId).toBe(actorId);

    const [missed] = await repo.recordMissed([
      { courseId, scheduledFor: "2026-08-09T08:00:00.000Z", amount: 0.4 },
    ]);
    expect(missed.actorId).toBe(actorId);

    const adjustment = await repo.adjustStock({ medicationId, deltaUnits: 10, reason: "purchase" });
    expect(adjustment.actorId).toBe(actorId);

    const setOnHand = await repo.setStockOnHand(medicationId, 20);
    expect(setOnHand.actorId).toBe(actorId);
  });

  // --- 17. no write path can ever produce a null actorId --------------------

  it("no DoseEvent or StockAdjustment row is missing, null or empty actorId after exercising every write method", async () => {
    const repo = makeRepo();
    const { medicationId, courseId } = await setupCourse(repo);
    const dose = await repo.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.4 });
    await repo.correctDose(dose.id, { amount: 0.5 });
    await repo.recordMissed([{ courseId, scheduledFor: "2026-08-09T08:00:00.000Z", amount: 0.4 }]);
    await repo.adjustStock({ medicationId, deltaUnits: 10, reason: "purchase" });
    await repo.setStockOnHand(medicationId, 20);

    const events = await repo.listDoseEvents({});
    const adjustments = await repo.listStockAdjustments();
    expect(events.length).toBeGreaterThan(0);
    expect(adjustments.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.actorId).toBeTruthy();
    }
    for (const a of adjustments) {
      expect(a.actorId).toBeTruthy();
    }
  });

  // --- 18. createPet stamps householdId, with no caller involvement --------

  it("createPet stamps householdId === currentHouseholdId(), with no caller involvement", async () => {
    const repo = makeRepo();
    const householdId = await repo.currentHouseholdId();
    const pet = await repo.createPet({ name: "Clover", species: "rabbit" });
    expect(pet.householdId).toBe(householdId);
  });

  // --- 19. concurrent-log dedup guard (SPEC §5/§12) --------------------------

  describe("logDose dedup guard", () => {
    it("a fixedTimes course: logging the identical non-null scheduledFor twice throws DuplicateDoseError, and exactly one event survives", async () => {
      const repo = makeRepo();
      const { courseId } = await setupCourse(repo);
      const scheduledFor = "2026-08-08T07:00:00.000Z";

      await repo.logDose({ courseId, status: "given", scheduledFor, amount: 0.4 });
      await expect(
        repo.logDose({ courseId, status: "given", scheduledFor, amount: 0.4 }),
      ).rejects.toBeInstanceOf(DuplicateDoseError);

      const events = await repo.listDoseEvents({ courseId });
      expect(events).toHaveLength(1);
    });

    it("the thrown DuplicateDoseError carries the surviving event's actorId/givenAt, and its message contains no '@' and no display name", async () => {
      const repo = makeRepo();
      const { courseId } = await setupCourse(repo);
      const scheduledFor = "2026-08-08T07:00:00.000Z";

      await repo.logDose({ courseId, status: "given", scheduledFor, amount: 0.4 });
      let caught: unknown;
      try {
        await repo.logDose({ courseId, status: "given", scheduledFor, amount: 0.4 });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(DuplicateDoseError);
      const dup = caught as DuplicateDoseError;

      const [survivor] = await repo.listDoseEvents({ courseId });
      expect(dup.actorId).toBe(survivor.actorId);
      expect(dup.givenAt).toBe(survivor.givenAt);
      expect(dup.message).not.toContain("@");

      const users = await repo.listUsers({ includeRemoved: true });
      const name = displayNameFor(dup.actorId, users);
      expect(dup.message).not.toContain(name);
    });

    it("a fromLastDose course, scheduledFor: null: a second log 10 minutes later is rejected; a log 91 minutes later is accepted", async () => {
      const repo = makeRepo();
      const { courseId } = await setupIntervalCourse(repo);
      const t0 = "2026-08-08T07:00:00.000Z";

      setClock(fixedClock(t0));
      await repo.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.5 });

      setClock(fixedClock(new Date(new Date(t0).getTime() + 10 * 60_000).toISOString()));
      await expect(
        repo.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.5 }),
      ).rejects.toBeInstanceOf(DuplicateDoseError);
      expect(await repo.listDoseEvents({ courseId })).toHaveLength(1);

      setClock(
        fixedClock(new Date(new Date(t0).getTime() + (GRACE_INTERVAL_MIN + 1) * 60_000).toISOString()),
      );
      await repo.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.5 });
      expect(await repo.listDoseEvents({ courseId })).toHaveLength(2);
    });

    it("correctDose still writes its superseding row and recordMissed still works — the guard applies to logDose only", async () => {
      const repo = makeRepo();
      const { courseId } = await setupCourse(repo);
      const scheduledFor = "2026-08-08T07:00:00.000Z";

      const original = await repo.logDose({ courseId, status: "given", scheduledFor, amount: 0.4 });
      // Immediately correcting the row we just logged, at the same instant,
      // must not trip the dedup guard — `correctDose` is exempt.
      const corrected = await repo.correctDose(original.id, { amount: 0.5 });
      expect(corrected.supersedesId).toBe(original.id);

      // `recordMissed` for a distinct occurrence on the same course, at the
      // same instant, must not trip the guard either — it dedupes only via
      // `occurrenceKey`.
      const [missed] = await repo.recordMissed([
        { courseId, scheduledFor: "2026-08-09T07:00:00.000Z", amount: 0.4 },
      ]);
      expect(missed.status).toBe("missed");
    });

    it("after retractDoseEvent removes the only event, the same occurrence can be logged again", async () => {
      const repo = makeRepo();
      const { courseId } = await setupCourse(repo);
      const scheduledFor = "2026-08-08T07:00:00.000Z";

      const event = await repo.logDose({ courseId, status: "given", scheduledFor, amount: 0.4 });
      await repo.retractDoseEvent(event.id);

      const relogged = await repo.logDose({ courseId, status: "given", scheduledFor, amount: 0.4 });
      expect(relogged.id).not.toBe(event.id);
      expect(await repo.listDoseEvents({ courseId })).toHaveLength(1);
    });
  });

  // --- 20. displayNameFor end to end -----------------------------------------

  it("displayNameFor resolves a real logged actor's name, a second member's name, and 'Someone' for an unknown id", async () => {
    const repo = makeRepo();
    const { courseId } = await setupCourse(repo);
    const selfId = await repo.currentActorId();
    const householdId = await repo.currentHouseholdId();
    const self = await repo.getUser(selfId);

    const marta: User = {
      id: "b0000000-0000-4000-8000-00000000c001",
      householdId,
      email: null,
      displayName: "Marta",
      tint: 2,
      isSelf: false,
      joinedAt: "2026-08-08T07:00:00.000Z",
      createdAt: "2026-08-08T07:00:00.000Z",
      updatedAt: "2026-08-08T07:00:00.000Z",
      deletedAt: null,
    };
    await repo.upsertUser(marta);

    const dose = await repo.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.4 });
    const users = await repo.listUsers({ includeRemoved: true });

    expect(displayNameFor(dose.actorId, users)).toBe(self?.displayName);
    expect(displayNameFor(marta.id, users)).toBe("Marta");
    expect(displayNameFor("not-a-real-member-id", users)).toBe("Someone");
  });

  // --- 21. a removed member's name still renders (SPEC §12) ------------------

  it("removeUser soft-deletes the member; their historical DoseEvent rows are untouched and displayNameFor still resolves their name via includeRemoved", async () => {
    const repo = makeRepo();
    const { courseId } = await setupCourse(repo);
    const selfId = await repo.currentActorId();
    const self = await repo.getUser(selfId);

    const event = await repo.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.4 });
    const jsonBefore = JSON.stringify(event);

    await repo.removeUser(selfId);

    const eventsAfter = await repo.listDoseEvents({ courseId });
    const survivingEvent = eventsAfter.find((e) => e.id === event.id);
    expect(JSON.stringify(survivingEvent)).toBe(jsonBefore);

    const visibleWithoutRemoved = await repo.listUsers({});
    expect(visibleWithoutRemoved.find((u) => u.id === selfId)).toBeUndefined();

    const usersIncludingRemoved = await repo.listUsers({ includeRemoved: true });
    expect(displayNameFor(selfId, usersIncludingRemoved)).toBe(self?.displayName);
  });

  // --- 22. renaming a member is retroactive (SPEC §12) ------------------------

  it("updateUser's displayName change is retroactive: a historical DoseEvent's resolved name changes too, proving no name was denormalised onto the event", async () => {
    const repo = makeRepo();
    const { courseId } = await setupCourse(repo);
    const selfId = await repo.currentActorId();

    const event = await repo.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.4 });

    await repo.updateUser(selfId, { displayName: "Ilya" });

    const usersAfter = await repo.listUsers({ includeRemoved: true });
    expect(displayNameFor(event.actorId, usersAfter)).toBe("Ilya");
  });

  // --- 23. join codes (SPEC §12) -----------------------------------------------

  it("issuing a second join code revokes the first; isJoinCodeUsable holds for used/revoked/expired/fresh; getJoinCodeByCode resolves by code", async () => {
    const t0 = "2026-08-08T07:00:00.000Z";
    setClock(fixedClock(t0));
    const repo = makeRepo();
    const expiresAt = new Date(new Date(t0).getTime() + JOIN_CODE_TTL_MS).toISOString();

    const first = await repo.createJoinCode({ code: "K7RMQ4", expiresAt });
    expect(isJoinCodeUsable(first, new Date(t0))).toBe(true);

    const second = await repo.createJoinCode({ code: "H8SNPQ", expiresAt });
    const firstAfterSecond = (await repo.listJoinCodes()).find((c) => c.id === first.id);
    expect(firstAfterSecond?.revokedAt).not.toBeNull();
    expect(isJoinCodeUsable(firstAfterSecond as JoinCode, new Date(t0))).toBe(false);

    expect(await repo.getJoinCodeByCode("H8SNPQ")).toMatchObject({ id: second.id });
    expect(await repo.getJoinCodeByCode("ZZZZZZ")).toBeNull();

    const used = await repo.markJoinCodeUsed(second.id, "some-member-id");
    expect(isJoinCodeUsable(used, new Date(t0))).toBe(false);

    const third = await repo.createJoinCode({ code: "L9TQWX", expiresAt });
    const revokedThird = await repo.revokeJoinCode(third.id);
    expect(isJoinCodeUsable(revokedThird, new Date(t0))).toBe(false);

    const expiredCode: JoinCode = {
      ...revokedThird,
      id: "expired-check-id",
      revokedAt: null,
      usedBy: null,
      expiresAt: "2020-01-01T00:00:00.000Z",
    };
    expect(isJoinCodeUsable(expiredCode, new Date(t0))).toBe(false);
  });

  // --- 24. export/import round-trip: households/users carried, joinCodes excluded, v1 backfill --

  it("exportHousehold carries households/users and no joinCodes; importing a v1-shaped backup backfills householdId/actorId on every row", async () => {
    const repo = makeRepo();
    const { courseId, medicationId } = await setupCourse(repo);
    await repo.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.4 });
    await repo.adjustStock({ medicationId, deltaUnits: 5, reason: "purchase" });
    await repo.createJoinCode({ code: "K7RMQ4", expiresAt: "2026-08-09T07:00:00.000Z" });

    const backup = await repo.exportHousehold();
    expect(backup.households?.length).toBeGreaterThan(0);
    expect(backup.users?.length).toBeGreaterThan(0);
    expect((backup as unknown as Record<string, unknown>).joinCodes).toBeUndefined();

    // A v1-shaped backup: no `households`/`users` keys, and rows stripped of
    // the fields v2 added, exactly what a pre-migration export looked like.
    const v1Pet = { ...backup.pets[0] } as Record<string, unknown>;
    delete v1Pet.householdId;
    const v1Event = { ...backup.doseEvents[0] } as Record<string, unknown>;
    delete v1Event.actorId;
    const v1Adjustment = { ...backup.stockAdjustments[0] } as Record<string, unknown>;
    delete v1Adjustment.actorId;

    const v1Backup = {
      schemaVersion: 1,
      exportedAt: backup.exportedAt,
      pets: [v1Pet],
      medications: [],
      courses: [],
      doseEvents: [v1Event],
      stockAdjustments: [v1Adjustment],
    } as unknown as HouseholdBackup;

    const target = makeRepo();
    await target.importHousehold(v1Backup, "replace");

    const importedPets = await target.listPets({ includeArchived: true });
    const importedEvents = await target.listDoseEvents({});
    const importedAdjustments = await target.listStockAdjustments();
    expect(importedPets.length).toBeGreaterThan(0);
    expect(importedEvents.length).toBeGreaterThan(0);
    expect(importedAdjustments.length).toBeGreaterThan(0);
    for (const p of importedPets) expect(p.householdId).toBeTruthy();
    for (const e of importedEvents) expect(e.actorId).toBeTruthy();
    for (const a of importedAdjustments) expect(a.actorId).toBeTruthy();
  });

  // --- 25. no email address appears anywhere ----------------------------------

  it("no '@' character appears anywhere in the export, in listUsers(includeRemoved), or in any DoseEvent, after a full exercise of the repo", async () => {
    const repo = makeRepo();
    const { courseId, medicationId } = await setupCourse(repo);
    await repo.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.4 });
    await repo.adjustStock({ medicationId, deltaUnits: 5, reason: "purchase" });
    await repo.createJoinCode({ code: "K7RMQ4", expiresAt: "2026-08-09T07:00:00.000Z" });

    const backup = await repo.exportHousehold();
    const users = await repo.listUsers({ includeRemoved: true });
    const events = await repo.listDoseEvents({});

    expect(JSON.stringify(backup)).not.toContain("@");
    expect(JSON.stringify(users)).not.toContain("@");
    for (const e of events) {
      expect(JSON.stringify(e)).not.toContain("@");
    }
  });
});
