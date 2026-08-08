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
import { createIdbRepo, createMemoryRepo } from "@/data";
import type { HouseholdBackup, Medication, MetaShape } from "@/domain";
import {
  fixedClock,
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

describe.each(implementations)("Repo contract — %s", (_name, makeRepo) => {
  // --- 1. logging any number of doses leaves stockUnits unchanged --------

  it("logging any number of doses leaves stockUnits unchanged (SPEC §11 case 6)", async () => {
    const repo = makeRepo();
    const { medicationId, courseId } = await setupCourse(repo);
    await repo.adjustStock({ medicationId, deltaUnits: 10, reason: "purchase" });
    const before = await repo.getMedication(medicationId);

    for (let i = 0; i < 4; i++) {
      await repo.logDose({ courseId, status: "given", scheduledFor: null, amount: 0.4 });
    }

    const after = await repo.getMedication(medicationId);
    expect(after?.stockUnits).toBe(before?.stockUnits);
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

    expect(await repo.getMeta("schemaVersion")).toBe(1);
    expect(await repo.getMeta("tintCursor")).toBe(0);
    expect(await repo.getMeta("lastSweepDay")).toBeNull();

    // A key outside MetaShape's three fields has never been written.
    expect(await repo.getMeta("bogusKey" as keyof MetaShape)).toBeNull();

    await repo.setMeta("lastSweepDay", "2026-08-08");
    expect(await repo.getMeta("lastSweepDay")).toBe("2026-08-08");
  });
});
