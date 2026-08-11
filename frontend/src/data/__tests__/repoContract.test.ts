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
import { createIdbRepo, createMemoryRepo, DuplicateDoseError, TooSoonSinceLastDoseError } from "@/data";
import type {
  CourseEvent,
  CourseSnapshot,
  DoseEvent,
  HouseholdBackup,
  JoinCode,
  Medication,
  MetaShape,
  StockAdjustment,
  User,
} from "@/domain";
import {
  displayNameFor,
  EARLY_GIVE_FLOOR_MIN,
  fixedClock,
  GRACE_FIXED_MIN,
  GRACE_INTERVAL_CAP_MIN,
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
    // free of an incidental collision with the dedup guard. `scheduledFor`
    // is each iteration's own clock reading, not `null`: the same-occurrence
    // guard now keys on `scheduledFor` unconditionally including `null`, so
    // four `null` events on one course would collide with EACH OTHER
    // regardless of spacing.
    let t = new Date("2026-08-08T07:00:00.000Z");
    for (let i = 0; i < 4; i++) {
      setClock(fixedClock(t.toISOString()));
      await repo.logDose({ courseId, status: "given", scheduledFor: t.toISOString(), amount: 0.4 });
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

  it("export -> importHousehold(replace) into a second, ALREADY-RECONCILED-to-the-same-account repo -> export produces a byte-identical JSON string", async () => {
    setClock(fixedClock("2026-08-08T07:00:00.000Z"));
    // A2: "restore my own backup on a different device" — realistically,
    // BOTH devices are already signed into the same account and have
    // already run `reconcileSelfId` to the same canonical id (`router.ts`'s
    // `beforeLoad` runs it before Settings, the only caller of "replace",
    // is ever reachable). Simulated here explicitly rather than starting
    // both repos from independent random self ids, which `importHousehold`
    // no longer treats as "the same person" — see the dedicated
    // cross-account test just below for that boundary.
    const SAME_ACCOUNT_ID = "d0000000-0000-4000-8000-0000000000aa";
    const repo1 = makeRepo();
    await repo1.reconcileSelfId(SAME_ACCOUNT_ID);
    const { medicationId, courseId } = await setupCourse(repo1);
    await repo1.adjustStock({ medicationId, deltaUnits: 10, reason: "purchase" });
    const dose = await repo1.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.4 });
    await repo1.correctDose(dose.id, { amount: 0.5 });
    const extraPet = await repo1.createPet({ name: "Nugget", species: "guinea_pig" });
    await repo1.softDeletePet(extraPet.id);

    const backup1 = await repo1.exportHousehold();

    const repo2 = makeRepo();
    await repo2.reconcileSelfId(SAME_ACCOUNT_ID);
    await repo2.importHousehold(backup1, "replace");
    const backup2 = await repo2.exportHousehold();

    expect(JSON.stringify(backup2)).toBe(JSON.stringify(backup1));
  });

  // --- 8b. A2: importing a DIFFERENT account's backup must not change this
  // device's own actor identity ---------------------------------------------

  it("importHousehold(replace) with a DIFFERENT account's backup keeps this device's own self id — does not adopt the backup author's identity", async () => {
    setClock(fixedClock("2026-08-08T07:00:00.000Z"));
    const author = makeRepo();
    const { courseId } = await setupCourse(author);
    await author.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.4 });
    const authorSelf = await author.getCurrentUser();
    const backup = await author.exportHousehold();

    const importer = makeRepo();
    const importerSelfBefore = await importer.getCurrentUser();
    expect(importerSelfBefore.id).not.toBe(authorSelf.id);

    await importer.importHousehold(backup, "replace");

    // The importer's OWN identity survived, unchanged — it did not become
    // the backup author.
    const importerSelfAfter = await importer.getCurrentUser();
    expect(importerSelfAfter.id).toBe(importerSelfBefore.id);
    expect(await importer.currentActorId()).toBe(importerSelfBefore.id);

    // The backup author's own row was imported as a normal (non-self)
    // member instead — their data (the dose event) is not lost, just not
    // claimed as this device's own.
    const allUsers = await importer.listUsers({ includeRemoved: true });
    const authorRow = allUsers.find((u) => u.id === authorSelf.id);
    expect(authorRow).toBeDefined();
    expect(authorRow?.isSelf).toBe(false);
    const importedDose = (await importer.listDoseEvents({})).find((e) => e.actorId === authorSelf.id);
    expect(importedDose).toBeDefined();
  });

  it("importHousehold(merge) imports the backup author as a NORMAL member — never as a second isSelf row", async () => {
    setClock(fixedClock("2026-08-08T07:00:00.000Z"));
    const author = makeRepo();
    const { courseId } = await setupCourse(author);
    await author.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.4 });
    const authorSelf = await author.getCurrentUser();
    const backup = await author.exportHousehold();
    // The backup legitimately flags its own author as self — that is what
    // "self" means from the exporting device's point of view.
    expect(backup.users?.find((u) => u.id === authorSelf.id)?.isSelf).toBe(true);

    const importer = makeRepo();
    const importerSelfBefore = await importer.getCurrentUser();
    expect(importerSelfBefore.id).not.toBe(authorSelf.id);

    await importer.importHousehold(backup, "merge");

    // `isSelf` is DEVICE-LOCAL. Merge used to carry the author's flag in
    // verbatim, leaving two self rows — which `sync/mirrorMembers` then
    // skipped forever (its `local.isSelf` guard), so the author's later
    // renames and their disclosed `aliasIds` never reached this device and
    // every dose they logged under a pre-reconcile id stayed "Someone" here.
    const allUsers = await importer.listUsers({ includeRemoved: true });
    expect(allUsers.filter((u) => u.isSelf).map((u) => u.id)).toEqual([importerSelfBefore.id]);
    expect(allUsers.find((u) => u.id === authorSelf.id)?.isSelf).toBe(false);

    // This device's own identity is untouched, and the author's data still
    // arrived — the row is demoted, never dropped.
    expect(await importer.currentActorId()).toBe(importerSelfBefore.id);
    expect((await importer.listDoseEvents({})).some((e) => e.actorId === authorSelf.id)).toBe(true);
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

    expect(await repo.getMeta("schemaVersion")).toBe(4);
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

    // F6: the core invariant the whole early-give design rests on, and the
    // one no test asserted before this fix (`allowWithinGrace` never
    // appeared in any test file). MUTATION THIS CATCHES: moving the
    // `allowWithinGrace` bypass above the exact-`scheduledFor` check would
    // make a confirmed early give able to double-log the IDENTICAL
    // occurrence — this fails on exactly that reordering, whatever shape the
    // guard's internals take.
    it("the same-occurrence hard block survives allowWithinGrace: true — a confirmed early give can never double-log the IDENTICAL occurrence", async () => {
      const repo = makeRepo();
      const { courseId } = await setupCourse(repo); // fixedTimes
      const scheduledFor = "2026-08-08T07:00:00.000Z";
      const t0 = "2026-08-08T07:00:00.000Z";

      setClock(fixedClock(t0));
      await repo.logDose({ courseId, status: "given", scheduledFor, amount: 0.4 });

      // Well past BOTH the floor and the grace window before retrying — so a
      // same-occurrence guard that (incorrectly) deferred to
      // `allowWithinGrace` would have NOTHING left to catch this on, and the
      // write would silently succeed instead of merely throwing a
      // different error. That is the unambiguous failure mode this isolates.
      setClock(
        fixedClock(new Date(new Date(t0).getTime() + (GRACE_FIXED_MIN + 1) * 60_000).toISOString()),
      );
      await expect(
        repo.logDose({ courseId, status: "given", scheduledFor, amount: 0.4, allowWithinGrace: true }),
      ).rejects.toBeInstanceOf(DuplicateDoseError);

      expect(await repo.listDoseEvents({ courseId })).toHaveLength(1);
    });

    // Same invariant, `fromLastDose` side: a DIFFERENT, non-null
    // `scheduledFor` collision within the grace window IS bypassable (that
    // is the feature), but the identical `scheduledFor` never is, confirmed
    // or not.
    it("fromLastDose: allowWithinGrace bypasses a DIFFERENT occurrence's grace-window collision, but never the SAME occurrence's exact match", async () => {
      const repo = makeRepo();
      const { courseId } = await setupIntervalCourse(repo); // intervalHours: 8
      const t0 = "2026-08-08T07:00:00.000Z";
      setClock(fixedClock(t0));
      const first = await repo.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.5 });

      // 30 min later — past the 10-min floor, inside the 90-min grace
      // window, and a DIFFERENT (real) scheduledFor: allowWithinGrace
      // legitimately bypasses this one.
      setClock(fixedClock(new Date(new Date(t0).getTime() + 30 * 60_000).toISOString()));
      const second = await repo.logDose({
        courseId,
        status: "given",
        scheduledFor: "2026-08-08T15:00:00.000Z",
        amount: 0.5,
        allowWithinGrace: true,
      });
      expect(second.id).not.toBe(first.id);

      // Retrying the SAME `scheduledFor` `second` just wrote, even with
      // allowWithinGrace, is the exact-match hard block — never bypassed.
      await expect(
        repo.logDose({
          courseId,
          status: "given",
          scheduledFor: "2026-08-08T15:00:00.000Z",
          amount: 0.5,
          allowWithinGrace: true,
        }),
      ).rejects.toBeInstanceOf(DuplicateDoseError);

      expect(await repo.listDoseEvents({ courseId })).toHaveLength(2);
    });

    // Latent fix: `repo.types.ts`'s `logDose` doc states the same-occurrence
    // hard block applies regardless of `allowWithinGrace` — but the guard
    // used to be conditioned on `input.scheduledFor !== null`, a silent
    // exception the doc never mentioned. `scheduledFor: null` is the "chain
    // never started" sentinel, and it is ONE occurrence like any other: two
    // logs against it are the SAME occurrence no matter the gap between
    // them, exactly like two logs against the same real `scheduledFor`
    // would be — this proves the guard now matches its own documented
    // invariant instead of quietly carving null out of it.
    it("a fromLastDose course, scheduledFor: null is the SAME occurrence every time — rejected at any gap, even past the grace window and even with allowWithinGrace", async () => {
      const repo = makeRepo();
      const { courseId } = await setupIntervalCourse(repo);
      const t0 = "2026-08-08T07:00:00.000Z";

      setClock(fixedClock(t0));
      await repo.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.5 });

      // Well past the grace window (90 min for this 8h course) — under the
      // OLD, null-guarded check this second `scheduledFor: null` log would
      // have been treated as a DIFFERENT occurrence and accepted.
      setClock(
        fixedClock(new Date(new Date(t0).getTime() + (GRACE_INTERVAL_CAP_MIN + 1) * 60_000).toISOString()),
      );
      await expect(
        repo.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.5 }),
      ).rejects.toBeInstanceOf(DuplicateDoseError);

      // Not even `allowWithinGrace` reaches it — documented to bypass only
      // the grace-window heuristic, never the same-occurrence block.
      await expect(
        repo.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.5, allowWithinGrace: true }),
      ).rejects.toBeInstanceOf(DuplicateDoseError);

      expect(await repo.listDoseEvents({ courseId })).toHaveLength(1);
    });

    // --- F1: the EARLY_GIVE_FLOOR_MIN hard floor beneath allowWithinGrace ---

    // MUTATION THIS CATCHES: deleting (or short-circuiting) the floor check
    // — without it, a confirmed early give a minute after the last dose
    // would succeed instead of being refused.
    it("a give within EARLY_GIVE_FLOOR_MIN of ANY live dose on the course is refused with TooSoonSinceLastDoseError, even with allowWithinGrace: true", async () => {
      const repo = makeRepo();
      const { courseId } = await setupIntervalCourse(repo); // intervalHours: 8, grace cap 90 min
      const t0 = "2026-08-08T07:00:00.000Z";
      setClock(fixedClock(t0));
      await repo.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.5 });

      // 1 minute later, a DIFFERENT scheduledFor (so this is not the
      // same-occurrence hard block) and well inside the 90-min grace window
      // too — the floor is what actually fires, not the (bypassable) grace
      // heuristic, and `allowWithinGrace: true` does not reach it either.
      setClock(fixedClock(new Date(new Date(t0).getTime() + 60_000).toISOString()));
      let caught: unknown;
      try {
        await repo.logDose({
          courseId,
          status: "given",
          scheduledFor: "2026-08-08T15:00:00.000Z",
          amount: 0.5,
          allowWithinGrace: true,
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(TooSoonSinceLastDoseError);
      expect((caught as TooSoonSinceLastDoseError).minutesSinceLast).toBe(1);

      expect(await repo.listDoseEvents({ courseId })).toHaveLength(1);
    });

    // The floor's own boundary: AT exactly EARLY_GIVE_FLOOR_MIN minutes, the
    // floor no longer applies and ordinary grace-window behaviour (still
    // bypassable) takes over — "at or past the floor, the confirmation
    // behaves as already built" is the product decision this pins.
    it("a give at EXACTLY EARLY_GIVE_FLOOR_MIN minutes is past the floor — grace-window rules apply instead", async () => {
      const repo = makeRepo();
      const { courseId } = await setupIntervalCourse(repo);
      const t0 = "2026-08-08T07:00:00.000Z";
      setClock(fixedClock(t0));
      await repo.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.5 });

      setClock(
        fixedClock(new Date(new Date(t0).getTime() + EARLY_GIVE_FLOOR_MIN * 60_000).toISOString()),
      );
      // Still inside the 90-min grace window, so an UNconfirmed attempt at
      // exactly the floor boundary still collides — via grace, not the
      // floor (a `DuplicateDoseError`, not a `TooSoonSinceLastDoseError`).
      await expect(
        repo.logDose({ courseId, status: "given", scheduledFor: "2026-08-08T15:00:00.000Z", amount: 0.5 }),
      ).rejects.toBeInstanceOf(DuplicateDoseError);

      // And — unlike a sub-floor gap — allowWithinGrace legitimately
      // bypasses it at exactly the floor boundary.
      const confirmed = await repo.logDose({
        courseId,
        status: "given",
        scheduledFor: "2026-08-08T15:00:00.000Z",
        amount: 0.5,
        allowWithinGrace: true,
      });
      expect(confirmed.status).toBe("given");
      expect(await repo.listDoseEvents({ courseId })).toHaveLength(2);
    });

    // The floor is unconditional across schedule kinds too (F8): a
    // fixedTimes course gets the identical protection a fromLastDose one
    // does, since the floor check does not branch on `schedule.kind`.
    it("the floor applies to fixedTimes courses too, not only fromLastDose", async () => {
      const repo = makeRepo();
      const { courseId } = await setupCourse(repo); // fixedTimes
      const t0 = "2026-08-08T07:00:00.000Z";
      setClock(fixedClock(t0));
      await repo.logDose({ courseId, status: "given", scheduledFor: "2026-08-08T08:00:00.000Z", amount: 0.4 });

      setClock(fixedClock(new Date(new Date(t0).getTime() + 5 * 60_000).toISOString()));
      await expect(
        repo.logDose({
          courseId,
          status: "given",
          scheduledFor: "2026-08-08T20:00:00.000Z",
          amount: 0.4,
          allowWithinGrace: true,
        }),
      ).rejects.toBeInstanceOf(TooSoonSinceLastDoseError);
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

  // --- Defect 1 (SPEC §3b-i): "Give anyway" past the cap must ALWAYS
  // succeed, immediately, with no confirmation able to refuse it — a
  // live-tested regression. A capped occurrence's own key is frozen (pushed
  // to 00:00 tomorrow by `fromLastDoseDueAt`), so the very next "Give
  // anyway" tap lands seconds after the capping dose: well inside BOTH the
  // `EARLY_GIVE_FLOOR_MIN` floor and the course's grace window. Before this
  // fix, `logDose` treated `overMax` as an ordinary write and both
  // course-wide guards refused it outright — reproducing exactly what the
  // live UI test found ("Already given" / "wait a little", on every path:
  // ghost Give anyway, the primary Give, and "log at a different time").
  describe("logDose overMax (SPEC §3b-i cap) — Defect 1 regression", () => {
    async function setupCappedCourse(repo: Repo): Promise<{ courseId: string }> {
      const pet = await repo.createPet({ name: "Otis", species: "cat" });
      const medication = await repo.createMedication({ name: "Meloxicam", form: "liquid", unit: "ml" });
      const course = await repo.createCourse({
        petId: pet.id,
        medicationId: medication.id,
        doseAmount: 0.4,
        doseUnit: "ml",
        instructions: null,
        // maxPerDay: 2 on a 2h interval, exactly the reported reproduction.
        schedule: { kind: "fromLastDose", intervalHours: 2, maxPerDay: 2 },
        startDate: "2026-08-01",
        endDate: null,
        notes: null,
      });
      return { courseId: course.id };
    }

    it("succeeds 30 seconds after the capping dose — inside both the floor and the grace window, where the unfixed guards refused it", async () => {
      const repo = makeRepo();
      const { courseId } = await setupCappedCourse(repo);

      // Reach the cap: two given doses, 2h apart (maxPerDay: 2).
      await repo.logDose({
        courseId,
        status: "given",
        scheduledFor: null,
        amount: 0.4,
        givenAt: "2026-08-08T18:00:00.000Z",
      });
      await repo.logDose({
        courseId,
        status: "given",
        scheduledFor: "2026-08-08T20:00:00.000Z",
        amount: 0.4,
        givenAt: "2026-08-08T20:00:00.000Z",
      });

      // The frozen, pushed-to-midnight capped occurrence's own key — what
      // `TodayPage.tsx`'s `identityOf` actually reads off the row.
      const cappedScheduledFor = "2026-08-09T00:00:00.000Z";
      // 30 seconds after the capping dose: the exact reproduction — inside
      // EARLY_GIVE_FLOOR_MIN (10 min) and the grace window alike.
      const overMaxEvent = await repo.logDose({
        courseId,
        status: "given",
        scheduledFor: cappedScheduledFor,
        amount: 0.4,
        overMax: true,
        givenAt: "2026-08-08T20:00:30.000Z",
      });

      expect(overMaxEvent.overMax).toBe(true);
      expect(overMaxEvent.status).toBe("given");
      expect(await repo.listDoseEvents({ courseId })).toHaveLength(3);
    });

    it("two carers double-tapping Give anyway on the SAME capped occurrence within the grace window still collapse to one event (SPEC §5)", async () => {
      const repo = makeRepo();
      const { courseId } = await setupCappedCourse(repo);
      const cappedScheduledFor = "2026-08-09T00:00:00.000Z";

      await repo.logDose({
        courseId,
        status: "given",
        scheduledFor: cappedScheduledFor,
        amount: 0.4,
        overMax: true,
        givenAt: "2026-08-08T20:00:30.000Z",
      });

      // A second tap, moments later, for the SAME capped row — both carers'
      // clients compute the identical (frozen) key, so this must collapse
      // exactly like any other same-occurrence duplicate, never write twice.
      await expect(
        repo.logDose({
          courseId,
          status: "given",
          scheduledFor: cappedScheduledFor,
          amount: 0.4,
          overMax: true,
          givenAt: "2026-08-08T20:00:45.000Z",
        }),
      ).rejects.toBeInstanceOf(DuplicateDoseError);

      expect(await repo.listDoseEvents({ courseId })).toHaveLength(1);
    });

    it("does not weaken SPEC §5 for a real occurrence: once the cap resets, a legitimate dose at the SAME key an earlier overMax event used is not treated as a duplicate", async () => {
      const repo = makeRepo();
      const { courseId } = await setupCappedCourse(repo);
      const key = "2026-08-09T00:00:00.000Z";

      await repo.logDose({
        courseId,
        status: "given",
        scheduledFor: key,
        amount: 0.4,
        overMax: true,
        givenAt: "2026-08-08T23:59:50.000Z",
      });

      // A full day later, the SAME `scheduledFor` is now a genuinely due,
      // non-`overMax` occurrence (the frozen key becomes real once the day
      // rolls over and the cap resets) — it must log normally, never
      // collide with yesterday's deliberate extra dose.
      const real = await repo.logDose({
        courseId,
        status: "given",
        scheduledFor: key,
        amount: 0.4,
        givenAt: "2026-08-10T00:00:05.000Z",
      });

      expect(real.overMax).toBeUndefined();
      expect(await repo.listDoseEvents({ courseId })).toHaveLength(2);
    });

    it("the early-dose floor still applies to a genuine (non-overMax) early give on this same course — the overMax bypass is not a general loosening", async () => {
      const repo = makeRepo();
      const { courseId } = await setupCappedCourse(repo);

      await repo.logDose({
        courseId,
        status: "given",
        scheduledFor: null,
        amount: 0.4,
        givenAt: "2026-08-08T18:00:00.000Z",
      });

      // One minute later, a DIFFERENT scheduledFor, no `overMax` — the floor
      // still refuses it outright, exactly as for any other course.
      await expect(
        repo.logDose({
          courseId,
          status: "given",
          scheduledFor: "2026-08-08T21:00:00.000Z",
          amount: 0.4,
          givenAt: "2026-08-08T18:01:00.000Z",
        }),
      ).rejects.toBeInstanceOf(TooSoonSinceLastDoseError);

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

  // --- 26. CourseEvent ledger (SPEC §6.4) -------------------------------------

  it("createCourse records exactly one 'started' CourseEvent, before === null, after matching the created course", async () => {
    const repo = makeRepo();
    const { courseId } = await setupCourse(repo);

    const events = await repo.listCourseEvents({ courseId });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("started");
    expect(events[0].before).toBeNull();

    const course = await repo.getCourse(courseId);
    expect(events[0].after).toEqual({
      schedule: course?.schedule,
      doseAmount: course?.doseAmount,
      doseUnit: course?.doseUnit,
      startDate: course?.startDate,
      endDate: course?.endDate,
    });
  });

  it("SPEC §12: pause -> resume -> pause again yields exactly the four events ['started','paused','resumed','paused'] in that order — a second cycle a Course-derived history (updatedAt/resumedAt only remember the latest transition) could not survive", async () => {
    // Fixed BEFORE `setupCourse` too, so the "started" event's `at` is
    // earlier than every transition below — otherwise `setupCourse` stamps
    // it with the real (later) system clock and it would sort last.
    const tStarted = new Date("2026-08-08T07:00:00.000Z");
    setClock(fixedClock(tStarted.toISOString()));
    const repo = makeRepo();
    const { courseId } = await setupCourse(repo);

    // Distinct, strictly increasing instants for each transition so ordering
    // is pinned by `at` alone — not left to depend on the `id` tie-break,
    // which is a random UUID and carries no chronological information (see
    // the "no deterministic order under a frozen clock" finding below).
    const t0 = new Date(tStarted.getTime() + 60_000);
    setClock(fixedClock(t0.toISOString()));
    await repo.setCourseStatus(courseId, "paused");

    const t1 = new Date(tStarted.getTime() + 120_000);
    setClock(fixedClock(t1.toISOString()));
    await repo.setCourseStatus(courseId, "active");

    const t2 = new Date(tStarted.getTime() + 180_000);
    setClock(fixedClock(t2.toISOString()));
    await repo.setCourseStatus(courseId, "paused");

    const events = await repo.listCourseEvents({ courseId });
    expect(events.map((e) => e.kind)).toEqual(["started", "paused", "resumed", "paused"]);
    expect(events.map((e) => e.at)).toEqual([
      tStarted.toISOString(),
      t0.toISOString(),
      t1.toISOString(),
      t2.toISOString(),
    ]);
  });

  it("a no-op setCourseStatus (setting the status a course already has) records no CourseEvent", async () => {
    const repo = makeRepo();
    const { courseId } = await setupCourse(repo);

    const before = await repo.listCourseEvents({ courseId });
    await repo.setCourseStatus(courseId, "active"); // already active — no-op
    const after = await repo.listCourseEvents({ courseId });

    expect(after).toHaveLength(before.length);
  });

  it("updateCourse changing the schedule records exactly one 'edited' event with before.schedule the old value and after.schedule the new one", async () => {
    const repo = makeRepo();
    const { courseId } = await setupCourse(repo);
    const original = await repo.getCourse(courseId);
    const newSchedule = { kind: "fixedTimes" as const, times: ["08:00", "20:00"] };

    await repo.updateCourse(courseId, { schedule: newSchedule });

    const events = await repo.listCourseEvents({ courseId });
    const edited = events.filter((e) => e.kind === "edited");
    expect(edited).toHaveLength(1);
    expect(edited[0].before?.schedule).toEqual(original?.schedule);
    expect(edited[0].after.schedule).toEqual(newSchedule);
  });

  it("updateCourse changing only notes records no CourseEvent", async () => {
    const repo = makeRepo();
    const { courseId } = await setupCourse(repo);

    const before = await repo.listCourseEvents({ courseId });
    await repo.updateCourse(courseId, { notes: "watch for drowsiness" });
    const after = await repo.listCourseEvents({ courseId });

    expect(after).toHaveLength(before.length);
  });

  it("updateCourse changing only instructions records no CourseEvent", async () => {
    const repo = makeRepo();
    const { courseId } = await setupCourse(repo);

    const before = await repo.listCourseEvents({ courseId });
    await repo.updateCourse(courseId, { instructions: "give with food" });
    const after = await repo.listCourseEvents({ courseId });

    expect(after).toHaveLength(before.length);
  });

  it("every recorded CourseEvent's actorId equals currentActorId()", async () => {
    const repo = makeRepo();
    const { courseId } = await setupCourse(repo);
    await repo.setCourseStatus(courseId, "paused");
    await repo.setCourseStatus(courseId, "active");
    await repo.updateCourse(courseId, { doseAmount: 0.8 });

    const actorId = await repo.currentActorId();
    const events = await repo.listCourseEvents({ courseId });
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.actorId).toBe(actorId);
    }
  });

  it("listCourseEvents honours courseId, courseIds, from, to, limit and newestFirst", async () => {
    const repo = makeRepo();
    const t0 = new Date("2026-08-08T07:00:00.000Z");

    setClock(fixedClock(t0.toISOString()));
    const courseA = await setupCourse(repo); // "started" at t0

    const t1 = new Date(t0.getTime() + 60_000);
    setClock(fixedClock(t1.toISOString()));
    const courseB = await setupIntervalCourse(repo); // "started" at t1

    const t2 = new Date(t0.getTime() + 120_000);
    setClock(fixedClock(t2.toISOString()));
    await repo.setCourseStatus(courseA.courseId, "paused"); // A paused at t2

    const t3 = new Date(t0.getTime() + 180_000);
    setClock(fixedClock(t3.toISOString()));
    await repo.setCourseStatus(courseA.courseId, "active"); // A resumed at t3

    const t4 = new Date(t0.getTime() + 240_000);
    setClock(fixedClock(t4.toISOString()));
    await repo.setCourseStatus(courseB.courseId, "paused"); // B paused at t4

    // courseId: only course A's own four events, in order.
    const aEvents = await repo.listCourseEvents({ courseId: courseA.courseId });
    expect(aEvents.map((e) => e.kind)).toEqual(["started", "paused", "resumed"]);

    // courseIds: the union of both courses' events.
    const bothEvents = await repo.listCourseEvents({ courseIds: [courseA.courseId, courseB.courseId] });
    expect(bothEvents).toHaveLength(5);
    expect(new Set(bothEvents.map((e) => e.courseId))).toEqual(
      new Set([courseA.courseId, courseB.courseId]),
    );

    // from/to: the window [t2, t3] holds exactly A's paused and resumed events.
    const ranged = await repo.listCourseEvents({
      courseIds: [courseA.courseId, courseB.courseId],
      from: t2.toISOString(),
      to: t3.toISOString(),
    });
    expect(ranged.map((e) => e.kind)).toEqual(["paused", "resumed"]);

    // limit: the two earliest of the five, oldest-first by default.
    const limited = await repo.listCourseEvents({
      courseIds: [courseA.courseId, courseB.courseId],
      limit: 2,
    });
    expect(limited.map((e) => e.courseId)).toEqual([courseA.courseId, courseB.courseId]);

    // newestFirst: the full five, reversed.
    const newestFirst = await repo.listCourseEvents({
      courseIds: [courseA.courseId, courseB.courseId],
      newestFirst: true,
    });
    expect(newestFirst.map((e) => e.courseId)).toEqual([
      courseB.courseId,
      courseA.courseId,
      courseA.courseId,
      courseB.courseId,
      courseA.courseId,
    ]);
    expect(newestFirst.map((e) => e.kind)).toEqual(["paused", "resumed", "paused", "started", "started"]);
  });

  it("setCourseStatus to 'stopped' records a 'stopped' event with before.endDate null and after.endDate set", async () => {
    const repo = makeRepo();
    const { courseId } = await setupCourse(repo);

    const stopped = await repo.setCourseStatus(courseId, "stopped");
    expect(stopped.endDate).not.toBeNull();

    const events = await repo.listCourseEvents({ courseId });
    const stoppedEvent = events.find((e) => e.kind === "stopped");
    expect(stoppedEvent).toBeDefined();
    expect(stoppedEvent?.before?.endDate).toBeNull();
    expect(stoppedEvent?.after.endDate).toBe(stopped.endDate);
  });

  it("exposes no CourseEvent mutator: recordCourseEvent, updateCourseEvent and deleteCourseEvent are all undefined — append-only is enforced by the Repo's shape, exactly as for DoseEvent", async () => {
    const repo = makeRepo();
    const untyped = repo as unknown as Record<string, unknown>;
    expect(untyped.recordCourseEvent).toBeUndefined();
    expect(untyped.updateCourseEvent).toBeUndefined();
    expect(untyped.deleteCourseEvent).toBeUndefined();
  });

  // --- 27. applyRemoteChanges (W9 sync design §D2/§D4) ------------------------

  describe("applyRemoteChanges", () => {
    it("mutable rows are last-write-wins on updatedAt: a stale remote write does not clobber a newer local row, and a genuinely newer one wins", async () => {
      const repo = makeRepo();
      const pet = await repo.createPet({ name: "Old Name", species: "cat" });

      const stale = { ...pet, name: "Should Not Win", updatedAt: "2020-01-01T00:00:00.000Z" };
      const staleReport = await repo.applyRemoteChanges({ pets: [stale] });
      expect(staleReport.applied.pets).toBe(0);
      expect(staleReport.ignored).toBe(1);
      expect((await repo.getPet(pet.id))?.name).toBe("Old Name");

      const newer = { ...pet, name: "New Name", updatedAt: "2030-01-01T00:00:00.000Z" };
      const newerReport = await repo.applyRemoteChanges({ pets: [newer] });
      expect(newerReport.applied.pets).toBe(1);
      expect(newerReport.ignored).toBe(0);
      expect((await repo.getPet(pet.id))?.name).toBe("New Name");
    });

    it("mutable rows tie-break on id: an exact updatedAt tie can never have incoming.id strictly greater than its own id, so it resolves to keeping the existing row", async () => {
      const repo = makeRepo();
      const pet = await repo.createPet({ name: "Original", species: "cat" });

      const tied = { ...pet, name: "Should Not Win On Tie", updatedAt: pet.updatedAt };
      const report = await repo.applyRemoteChanges({ pets: [tied] });
      expect(report.applied.pets).toBe(0);
      expect(report.ignored).toBe(1);
      expect((await repo.getPet(pet.id))?.name).toBe("Original");
    });

    it("a remote medication gains the row unchanged and is readable by name (idbRepo's internal nameLower column is transparent)", async () => {
      const repo = makeRepo();
      const ts = "2026-08-08T07:00:00.000Z";
      const remote: Medication = {
        id: crypto.randomUUID(),
        name: "Remote Med",
        strength: null,
        form: "tablet",
        unit: "tab",
        packSize: null,
        stockUnits: null,
        lowThreshold: null,
        createdAt: ts,
        updatedAt: ts,
        deletedAt: null,
      };
      const report = await repo.applyRemoteChanges({ medications: [remote] });
      expect(report.applied.medications).toBe(1);
      expect(await repo.findMedicationByName("remote med")).toMatchObject({ id: remote.id });
    });

    it("ledger rows (doseEvents/stockAdjustments/courseEvents) are insert-if-absent, land with their incoming id/createdAt/actorId intact, are never overwritten, and applying the same batch twice is idempotent", async () => {
      const repo = makeRepo();
      const { courseId, medicationId } = await setupCourse(repo);
      const REMOTE_ACTOR_ID = "z0000000-0000-4000-8000-00000000ffff";
      const remoteTs = "2020-01-01T00:00:00.000Z"; // deliberately older than anything local

      const remoteDose: DoseEvent = {
        id: crypto.randomUUID(),
        courseId,
        scheduledFor: null,
        status: "given",
        loggedAt: remoteTs,
        givenAt: remoteTs,
        amount: 0.4,
        note: null,
        occurrenceKey: occurrenceKeyFor(courseId, null),
        supersedesId: null,
        actorId: REMOTE_ACTOR_ID,
        createdAt: remoteTs,
        updatedAt: remoteTs,
        deletedAt: null,
      };
      const remoteAdjustment: StockAdjustment = {
        id: crypto.randomUUID(),
        medicationId,
        deltaUnits: 3,
        reason: "purchase",
        note: null,
        actorId: REMOTE_ACTOR_ID,
        createdAt: remoteTs,
        updatedAt: remoteTs,
        deletedAt: null,
      };
      const snapshot: CourseSnapshot = {
        schedule: { kind: "fixedTimes", times: ["08:00"] },
        doseAmount: 0.4,
        doseUnit: "ml",
        startDate: "2026-08-01",
        endDate: null,
      };
      const remoteCourseEvent: CourseEvent = {
        id: crypto.randomUUID(),
        courseId,
        kind: "paused",
        at: remoteTs,
        seq: 500,
        actorId: REMOTE_ACTOR_ID,
        before: null,
        after: snapshot,
        createdAt: remoteTs,
        updatedAt: remoteTs,
        deletedAt: null,
      };

      const changes = {
        doseEvents: [remoteDose],
        stockAdjustments: [remoteAdjustment],
        courseEvents: [remoteCourseEvent],
      };

      const first = await repo.applyRemoteChanges(changes);
      expect(first.applied).toMatchObject({ doseEvents: 1, stockAdjustments: 1, courseEvents: 1 });
      expect(first.ignored).toBe(0);

      const storedDose = (await repo.listDoseEvents({ courseId })).find((e) => e.id === remoteDose.id);
      expect(storedDose).toMatchObject({
        id: remoteDose.id,
        actorId: REMOTE_ACTOR_ID,
        createdAt: remoteTs,
        updatedAt: remoteTs,
      });
      const storedAdjustment = (await repo.listStockAdjustments(medicationId)).find(
        (a) => a.id === remoteAdjustment.id,
      );
      expect(storedAdjustment).toMatchObject({ actorId: REMOTE_ACTOR_ID, createdAt: remoteTs });
      const storedCourseEvent = (await repo.listCourseEvents({ courseId })).find(
        (e) => e.id === remoteCourseEvent.id,
      );
      expect(storedCourseEvent).toMatchObject({ actorId: REMOTE_ACTOR_ID, createdAt: remoteTs, kind: "paused" });

      // Applying the identical batch again must not double-write or change anything.
      const second = await repo.applyRemoteChanges(changes);
      expect(second.applied).toMatchObject({ doseEvents: 0, stockAdjustments: 0, courseEvents: 0 });
      expect(second.ignored).toBe(3);
      expect((await repo.listDoseEvents({ courseId })).filter((e) => e.id === remoteDose.id)).toHaveLength(1);

      // A "corrected" copy of the same ledger ids must not overwrite the original.
      const tampered = {
        doseEvents: [{ ...remoteDose, amount: 999, note: "tampered" }],
        stockAdjustments: [{ ...remoteAdjustment, deltaUnits: 999 }],
        courseEvents: [{ ...remoteCourseEvent, kind: "stopped" as const }],
      };
      const third = await repo.applyRemoteChanges(tampered);
      expect(third.applied).toMatchObject({ doseEvents: 0, stockAdjustments: 0, courseEvents: 0 });
      expect(
        (await repo.listDoseEvents({ courseId })).find((e) => e.id === remoteDose.id)?.amount,
      ).toBe(0.4);
      expect(
        (await repo.listCourseEvents({ courseId })).find((e) => e.id === remoteCourseEvent.id)?.kind,
      ).toBe("paused");
    });

    it("bumps the local courseEventSeq counter to at least the incoming seq, so the device's own next write always sorts after what it just learned", async () => {
      const repo = makeRepo();
      const { courseId } = await setupCourse(repo); // one local "started" CourseEvent, seq 1
      expect(await repo.getMeta("courseEventSeq")).toBe(1);

      const snapshot: CourseSnapshot = {
        schedule: { kind: "fixedTimes", times: ["08:00"] },
        doseAmount: 0.4,
        doseUnit: "ml",
        startDate: "2026-08-01",
        endDate: null,
      };
      const remote: CourseEvent = {
        id: crypto.randomUUID(),
        courseId,
        kind: "paused",
        at: "2026-08-08T08:00:00.000Z",
        seq: 50,
        actorId: "remote-actor",
        before: null,
        after: snapshot,
        createdAt: "2026-08-08T08:00:00.000Z",
        updatedAt: "2026-08-08T08:00:00.000Z",
        deletedAt: null,
      };
      await repo.applyRemoteChanges({ courseEvents: [remote] });
      expect(await repo.getMeta("courseEventSeq")).toBe(50);

      // The device's own next real write must land strictly after the seq it just learned.
      const resumed = await repo.setCourseStatus(courseId, "paused");
      const events = await repo.listCourseEvents({ courseId, newestFirst: true });
      const localEvent = events.find((e) => e.courseId === resumed.id && e.kind === "paused" && e.actorId !== "remote-actor");
      expect(localEvent?.seq).toBe(51);
    });
  });

  // --- 28. merge-mode importHousehold routes through applyRemoteChanges (carried item b) --

  it("importHousehold(merge) cannot overwrite an existing doseEvents/stockAdjustments/courseEvents row — carried item (b), fixed structurally via applyRemoteChanges", async () => {
    const repo = makeRepo();
    const { courseId, medicationId } = await setupCourse(repo);
    const dose = await repo.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.4 });
    const adjustment = await repo.adjustStock({ medicationId, deltaUnits: 5, reason: "purchase" });
    const [startedEvent] = await repo.listCourseEvents({ courseId });

    const tamperedDose = { ...dose, amount: 999, note: "tampered" };
    const tamperedAdjustment = { ...adjustment, deltaUnits: 999 };
    const tamperedCourseEvent = { ...startedEvent, kind: "stopped" as const };

    const report = await repo.importHousehold(
      emptyBackup({
        doseEvents: [tamperedDose],
        stockAdjustments: [tamperedAdjustment],
        courseEvents: [tamperedCourseEvent],
      }),
      "merge",
    );

    // All three ledger rows already existed by id — none of them was written.
    expect(report.doseEvents).toBe(0);
    expect(report.stockAdjustments).toBe(0);
    expect(report.skipped).toBeGreaterThanOrEqual(3);

    expect((await repo.listDoseEvents({ courseId })).find((e) => e.id === dose.id)?.amount).toBe(0.4);
    expect(
      (await repo.listStockAdjustments(medicationId)).find((a) => a.id === adjustment.id)?.deltaUnits,
    ).toBe(5);
    expect(
      (await repo.listCourseEvents({ courseId })).find((e) => e.id === startedEvent.id)?.kind,
    ).toBe("started");
  });

  // --- 29. CourseEvent ordering is deterministic for rows sharing an `at` (design §D3) --

  it("CourseEvent ordering `(at asc, seq asc, id asc)`: two rows sharing the same `at` sort by seq, not by id", async () => {
    const repo = makeRepo();
    const { courseId } = await setupCourse(repo);
    const sharedAt = "2026-08-09T10:00:00.000Z";
    const snapshot: CourseSnapshot = {
      schedule: { kind: "fixedTimes", times: ["08:00"] },
      doseAmount: 0.4,
      doseUnit: "ml",
      startDate: "2026-08-01",
      endDate: null,
    };

    // The row with the lexicographically GREATER id is deliberately given the
    // SMALLER seq, so an id-based tiebreak and a seq-based one disagree —
    // whichever order comes out proves which key is actually in force.
    const lowSeqHighId: CourseEvent = {
      id: "zzzzzzzz-0000-4000-8000-000000000001",
      courseId,
      kind: "paused",
      at: sharedAt,
      seq: 100,
      actorId: "remote-1",
      before: null,
      after: snapshot,
      createdAt: sharedAt,
      updatedAt: sharedAt,
      deletedAt: null,
    };
    const highSeqLowId: CourseEvent = {
      id: "aaaaaaaa-0000-4000-8000-000000000002",
      courseId,
      kind: "resumed",
      at: sharedAt,
      seq: 101,
      actorId: "remote-1",
      before: null,
      after: snapshot,
      createdAt: sharedAt,
      updatedAt: sharedAt,
      deletedAt: null,
    };

    await repo.applyRemoteChanges({ courseEvents: [lowSeqHighId, highSeqLowId] });

    const events = await repo.listCourseEvents({ courseId, from: sharedAt, to: sharedAt });
    expect(events.map((e) => e.id)).toEqual([lowSeqHighId.id, highSeqLowId.id]);
  });

  // --- 28. reconcileSelfId — the identity-mismatch fix ------------------------

  describe("reconcileSelfId", () => {
    const CANONICAL_ID = "c0000000-0000-4000-8000-0000000000ca";

    it("a device's self record ends up with the canonical id, not the locally-generated one", async () => {
      const repo = makeRepo();
      const localId = await repo.currentActorId();
      expect(localId).not.toBe(CANONICAL_ID);

      const result = await repo.reconcileSelfId(CANONICAL_ID);
      expect(result.changed).toBe(true);

      expect(await repo.currentActorId()).toBe(CANONICAL_ID);
      const self = await repo.getCurrentUser();
      expect(self.id).toBe(CANONICAL_ID);
      // The old id is preserved as an alias rather than discarded — it is
      // what lets already-logged events, still stamped with the old id,
      // keep resolving to this same user (see the alias-based test below
      // and `domain/identity.test.ts`).
      expect(self.aliasIds).toContain(localId);
    });

    it("a dose logged before reconciliation still resolves to the real name afterwards, via aliasIds — the existing-data remediation, applied locally", async () => {
      const repo = makeRepo();
      const { courseId } = await setupCourse(repo);
      const staleId = await repo.currentActorId();

      const dose = await repo.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.4 });
      expect(dose.actorId).toBe(staleId);

      await repo.reconcileSelfId(CANONICAL_ID);

      // The ledger row itself is untouched — append-only, never rewritten —
      // but it now resolves to the right name because the self row's
      // aliasIds picked up the id it used to be.
      const doseAfter = (await repo.listDoseEvents({ courseId })).find((e) => e.id === dose.id)!;
      expect(doseAfter.actorId).toBe(staleId);
      const users = await repo.listUsers({ includeRemoved: true });
      const canonicalUser = users.find((u) => u.id === CANONICAL_ID);
      expect(displayNameFor(staleId, users)).toBe(canonicalUser?.displayName);
    });

    it("is idempotent: calling it twice with the same canonical id changes nothing the second time", async () => {
      const repo = makeRepo();
      await repo.currentActorId();

      const first = await repo.reconcileSelfId(CANONICAL_ID);
      expect(first.changed).toBe(true);
      const selfAfterFirst = await repo.getCurrentUser();

      const second = await repo.reconcileSelfId(CANONICAL_ID);
      expect(second.changed).toBe(false);
      const selfAfterSecond = await repo.getCurrentUser();

      expect(selfAfterSecond.id).toBe(CANONICAL_ID);
      expect(selfAfterSecond.aliasIds).toEqual(selfAfterFirst.aliasIds);
      // No duplicate row was created under the old id or anywhere else.
      const users = await repo.listUsers({ includeRemoved: true });
      expect(users.filter((u) => u.isSelf)).toHaveLength(1);
    });

    it("is a no-op when the local id already equals the canonical id (e.g. every navigation after the first)", async () => {
      const repo = makeRepo();
      await repo.currentActorId();
      await repo.reconcileSelfId(CANONICAL_ID);

      const before = await repo.getCurrentUser();
      const result = await repo.reconcileSelfId(CANONICAL_ID);
      expect(result.changed).toBe(false);
      const after = await repo.getCurrentUser();
      expect(after).toEqual(before);
    });
  });
});
