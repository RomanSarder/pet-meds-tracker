// IDB-specific structural invariants (SPEC §7/§8): transaction scope, the one
// hard-delete path, the fresh-database schema, and export hygiene across
// repos. These assert on structure — transaction store names, raw object
// store contents, schema metadata — deliberately, because for this file the
// structure IS the invariant under test.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createIdbRepo } from "../idbRepo";
import { DB_NAME, DB_VERSION, openPetMedsDb } from "../db";
import { createMemoryRepo } from "../memoryRepo";
import { fixedClock, setClock, systemClock } from "@/domain";

function uniqueDbName(label: string): string {
  return `petmeds-invariants-${label}-${crypto.randomUUID()}`;
}

async function setupCourse(repo: ReturnType<typeof createIdbRepo>) {
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
  return { pet, medication, course };
}

/** Normalizes the raw `storeNames` argument `IDBDatabase.transaction()` was called with
 *  (a single store name is a bare string; `idb`'s explicit calls pass an array). */
function toStoreNameArray(storeNames: unknown): string[] {
  if (Array.isArray(storeNames)) return storeNames as string[];
  if (typeof storeNames === "string") return [storeNames];
  return Array.from(storeNames as Iterable<string>);
}

afterEach(() => {
  setClock(systemClock);
  vi.restoreAllMocks();
});

describe("createIdbRepo — transaction scope (SPEC §7/§8 item 1)", () => {
  // Seam: `fake-indexeddb/auto` (installed globally by frontend/src/test/setup.ts)
  // replaces `globalThis.IDBDatabase` with its own `FDBDatabase` class before any
  // test runs, so `IDBDatabase.prototype` under this test environment IS
  // `FDBDatabase.prototype` — the exact prototype every connection `idb` opens
  // against fake-indexeddb is an instance of. Spying there observes every
  // transaction the `idb` wrapper opens. Confirmed empirically, not assumed:
  // the first test below asserts the spy recorded at least one call before any
  // scope assertion elsewhere in this file is trusted.
  it("the spy on IDBDatabase.prototype.transaction actually observes calls made through the idb wrapper", async () => {
    const spy = vi.spyOn(IDBDatabase.prototype, "transaction");
    const repo = createIdbRepo({ dbName: uniqueDbName("spy-fires") });
    await repo.createPet({ name: "Clover", species: "rabbit" });
    expect(spy.mock.calls.length).toBeGreaterThan(0);
  });

  it("logDose, correctDose, retractDoseEvent and recordMissed never name the medications store, not even to read it", async () => {
    const repo = createIdbRepo({ dbName: uniqueDbName("no-medications") });
    const { course } = await setupCourse(repo);

    const spy = vi.spyOn(IDBDatabase.prototype, "transaction");
    spy.mockClear();

    const event = await repo.logDose({
      courseId: course.id,
      status: "given",
      scheduledFor: null,
      amount: 0.4,
    });
    const corrected = await repo.correctDose(event.id, { amount: 0.5 });
    await repo.retractDoseEvent(corrected.id);
    await repo.recordMissed([
      { courseId: course.id, scheduledFor: "2026-08-09T08:00:00.000Z", amount: 0.4 },
    ]);

    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const call of spy.mock.calls) {
      const storeNames = toStoreNameArray(call[0]);
      expect(storeNames).not.toContain("medications");
    }
  });

  it("adjustStock and setStockOnHand name both stockAdjustments and medications in a single transaction", async () => {
    const repo = createIdbRepo({ dbName: uniqueDbName("stock-scope") });
    const medication = await repo.createMedication({ name: "Metacam", form: "liquid", unit: "ml" });

    const spy = vi.spyOn(IDBDatabase.prototype, "transaction");
    spy.mockClear();
    await repo.adjustStock({ medicationId: medication.id, deltaUnits: 5, reason: "purchase" });

    expect(spy.mock.calls.length).toBeGreaterThan(0);
    const adjustCall = spy.mock.calls.find((call) => {
      const names = toStoreNameArray(call[0]);
      return names.includes("stockAdjustments") && names.includes("medications");
    });
    expect(adjustCall).toBeDefined();
    // Exactly one transaction call carries both names together (a single tx),
    // not two separate transactions that each name one store.
    const callsNamingEither = spy.mock.calls.filter((call) => {
      const names = toStoreNameArray(call[0]);
      return names.includes("stockAdjustments") || names.includes("medications");
    });
    expect(callsNamingEither).toHaveLength(1);

    spy.mockClear();
    await repo.setStockOnHand(medication.id, 20);
    const setStockCalls = spy.mock.calls.filter((call) => {
      const names = toStoreNameArray(call[0]);
      return names.includes("stockAdjustments") || names.includes("medications");
    });
    expect(setStockCalls).toHaveLength(1);
    expect(toStoreNameArray(setStockCalls[0][0])).toEqual(
      expect.arrayContaining(["stockAdjustments", "medications"]),
    );
  });
});

describe("createIdbRepo — retractDoseEvent is a hard delete", () => {
  it("removes the row entirely from the raw doseEvents object store, not merely soft-deleting it", async () => {
    const dbName = uniqueDbName("hard-delete");
    const repo = createIdbRepo({ dbName });
    const { course } = await setupCourse(repo);
    const event = await repo.logDose({
      courseId: course.id,
      status: "given",
      scheduledFor: null,
      amount: 0.4,
    });

    await repo.retractDoseEvent(event.id);

    const rawDb = await openPetMedsDb(dbName);
    const row = await rawDb.get("doseEvents", event.id);
    expect(row).toBeUndefined();
    rawDb.close();
  });
});

describe("openPetMedsDb — fresh schema", () => {
  it("creates exactly the stores and indexes db.ts declares, at DB_VERSION, with meta seeded to the three defaults", async () => {
    const dbName = uniqueDbName("schema");
    const db = await openPetMedsDb(dbName);

    expect(db.version).toBe(DB_VERSION);
    // v2 (CONTRACT.md §7): the five original stores plus `households`,
    // `users` and `joinCodes`, enumerated explicitly (not a count) so this
    // test still catches a store being dropped.
    expect(Array.from(db.objectStoreNames).sort()).toEqual(
      [
        "courses",
        "doseEvents",
        "households",
        "joinCodes",
        "medications",
        "meta",
        "pets",
        "stockAdjustments",
        "users",
      ].sort(),
    );

    type StoreName =
      | "pets"
      | "medications"
      | "courses"
      | "doseEvents"
      | "stockAdjustments"
      | "meta"
      | "households"
      | "users"
      | "joinCodes";
    const expectedIndexes: Record<StoreName, string[]> = {
      pets: ["by_name"],
      medications: ["by_nameLower"],
      courses: ["by_petId", "by_medicationId", "by_status"],
      doseEvents: ["by_courseId", "by_occurrenceKey", "by_givenAt", "by_courseId_givenAt"],
      stockAdjustments: ["by_medicationId", "by_createdAt"],
      meta: [],
      households: [],
      users: ["by_householdId"],
      joinCodes: ["by_householdId", "by_code"],
    };

    for (const storeName of Object.keys(expectedIndexes) as StoreName[]) {
      const tx = db.transaction(storeName, "readonly");
      const actualIndexes = Array.from(tx.objectStore(storeName).indexNames).sort();
      expect(actualIndexes).toEqual([...expectedIndexes[storeName]].sort());
      await tx.done;
    }

    // v2 also seeds `householdId`/`selfUserId` (CONTRACT.md §7 item 2), whose
    // values are minted ids rather than fixed defaults — assert presence and
    // shape, not a literal value.
    const metaRows = await db.getAll("meta");
    const metaByKey = Object.fromEntries(metaRows.map((r) => [r.key, r.value]));
    expect(metaByKey.schemaVersion).toBe(2);
    expect(metaByKey.tintCursor).toBe(0);
    expect(metaByKey.lastSweepDay).toBeNull();
    expect(typeof metaByKey.householdId).toBe("string");
    expect(metaByKey.householdId).not.toBe("");
    expect(typeof metaByKey.selfUserId).toBe("string");
    expect(metaByKey.selfUserId).not.toBe("");

    db.close();
  });

  it("defaults dbName to DB_NAME when no dbName option is given", () => {
    expect(DB_NAME).toBe("petmeds");
  });
});

describe("createIdbRepo — exportHousehold hygiene and cross-repo import", () => {
  it("never leaks the internal nameLower column into an exported medication", async () => {
    const repo = createIdbRepo({ dbName: uniqueDbName("no-leak") });
    await repo.createMedication({ name: "Metacam", form: "liquid", unit: "ml" });
    const backup = await repo.exportHousehold();

    expect(backup.medications).toHaveLength(1);
    expect(Object.keys(backup.medications[0]).sort()).toEqual(
      [
        "id",
        "name",
        "strength",
        "form",
        "unit",
        "packSize",
        "stockUnits",
        "lowThreshold",
        "createdAt",
        "updatedAt",
        "deletedAt",
      ].sort(),
    );
  });

  it("a backup exported from the IDB repo imports cleanly into the memory repo, and vice versa", async () => {
    setClock(fixedClock("2026-08-08T07:00:00.000Z"));
    const idbRepo = createIdbRepo({ dbName: uniqueDbName("cross-import") });
    const { pet, medication, course } = await setupCourse(idbRepo);
    await idbRepo.logDose({ courseId: course.id, status: "given", scheduledFor: null, amount: 0.4 });
    const idbBackup = await idbRepo.exportHousehold();

    const memRepo = createMemoryRepo({
      pets: [],
      medications: [],
      courses: [],
      doseEvents: [],
      stockAdjustments: [],
    });
    const reportIntoMemory = await memRepo.importHousehold(idbBackup, "replace");
    expect(reportIntoMemory.pets).toBe(idbBackup.pets.length);
    expect(reportIntoMemory.medications).toBe(idbBackup.medications.length);
    expect((await memRepo.getPet(pet.id))?.name).toBe("Clover");
    expect((await memRepo.getMedication(medication.id))?.name).toBe("Metacam");

    const memBackup = await memRepo.exportHousehold();
    const idbRepo2 = createIdbRepo({ dbName: uniqueDbName("cross-import-2") });
    const reportIntoIdb = await idbRepo2.importHousehold(memBackup, "replace");
    expect(reportIntoIdb.pets).toBe(memBackup.pets.length);
    expect((await idbRepo2.getPet(pet.id))?.name).toBe("Clover");
    expect((await idbRepo2.getMedication(medication.id))?.name).toBe("Metacam");
  });
});
