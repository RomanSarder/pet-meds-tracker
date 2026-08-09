// The v1 -> v2 schema migration (CONTRACT.md §7): households, users and
// joinCodes are added, and pre-existing pets/doseEvents/stockAdjustments are
// backfilled with `householdId`/`actorId`. This test builds a genuine v1
// database with the raw `indexedDB` API — NOT `openPetMedsDb`, which would
// open straight at v2 and prove nothing about the migration path.
import { describe, expect, it } from "vitest";
import { openPetMedsDb, type MetaRecord } from "@/data/db";

/** Opens a brand-new database at version 1, with exactly today's v1 schema. */
function openV1Database(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const database = request.result;

      const pets = database.createObjectStore("pets", { keyPath: "id" });
      pets.createIndex("by_name", "name");

      const medications = database.createObjectStore("medications", { keyPath: "id" });
      medications.createIndex("by_nameLower", "nameLower");

      const courses = database.createObjectStore("courses", { keyPath: "id" });
      courses.createIndex("by_petId", "petId");
      courses.createIndex("by_medicationId", "medicationId");
      courses.createIndex("by_status", "status");

      const doseEvents = database.createObjectStore("doseEvents", { keyPath: "id" });
      doseEvents.createIndex("by_courseId", "courseId");
      doseEvents.createIndex("by_occurrenceKey", "occurrenceKey");
      doseEvents.createIndex("by_givenAt", "givenAt");
      doseEvents.createIndex("by_courseId_givenAt", ["courseId", "givenAt"]);

      const stockAdjustments = database.createObjectStore("stockAdjustments", { keyPath: "id" });
      stockAdjustments.createIndex("by_medicationId", "medicationId");
      stockAdjustments.createIndex("by_createdAt", "createdAt");

      const meta = database.createObjectStore("meta", { keyPath: "key" });
      meta.put({ key: "schemaVersion", value: 1 });
      meta.put({ key: "tintCursor", value: 0 });
      meta.put({ key: "lastSweepDay", value: null });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function putAll(database: IDBDatabase, storeName: string, rows: unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    for (const row of rows) store.put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Pre-existing (v1-shaped) fixture rows, deliberately WITHOUT the new
// `householdId`/`actorId` fields, each carrying a distinctive value in an
// existing field so survival can be asserted precisely.
const v1Pets = [
  {
    id: "pet-1",
    name: "Distinctive Pet Alpha",
    species: "rabbit",
    birthdate: "2020-01-01",
    weightGrams: 1234,
    tint: 1,
    archived: false,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    deletedAt: null,
  },
  {
    id: "pet-2",
    name: "Distinctive Pet Beta",
    species: "cat",
    birthdate: "2019-06-15",
    weightGrams: 4321,
    tint: 2,
    archived: false,
    createdAt: "2025-01-02T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
    deletedAt: null,
  },
];

const v1Medications = [
  {
    id: "med-1",
    name: "Distinctive Medication",
    strength: "10mg",
    form: "tablet",
    unit: "tablet",
    packSize: 30,
    stockUnits: 12,
    lowThreshold: 5,
    nameLower: "distinctive medication",
    createdAt: "2025-01-03T00:00:00.000Z",
    updatedAt: "2025-01-03T00:00:00.000Z",
    deletedAt: null,
  },
];

const v1Courses = [
  {
    id: "course-1",
    petId: "pet-1",
    medicationId: "med-1",
    doseAmount: 1,
    doseUnit: "tablet",
    instructions: "Distinctive instructions",
    schedule: { kind: "fixedTimes", times: ["08:00"] },
    startDate: "2025-01-01",
    endDate: null,
    status: "active",
    notes: "Distinctive course notes",
    resumedAt: null,
    createdAt: "2025-01-04T00:00:00.000Z",
    updatedAt: "2025-01-04T00:00:00.000Z",
    deletedAt: null,
  },
];

const v1DoseEvents = [
  {
    id: "dose-1",
    courseId: "course-1",
    scheduledFor: "2025-01-05T08:00:00.000Z",
    status: "given",
    loggedAt: "2025-01-05T08:01:00.000Z",
    givenAt: "2025-01-05T08:01:00.000Z",
    amount: 1,
    note: "Distinctive dose note one",
    occurrenceKey: "course-1|2025-01-05T08:00:00.000Z",
    supersedesId: null,
    createdAt: "2025-01-05T08:01:00.000Z",
    updatedAt: "2025-01-05T08:01:00.000Z",
    deletedAt: null,
  },
  {
    id: "dose-2",
    courseId: "course-1",
    scheduledFor: "2025-01-06T08:00:00.000Z",
    status: "skipped",
    loggedAt: "2025-01-06T08:05:00.000Z",
    givenAt: "2025-01-06T08:05:00.000Z",
    amount: 1,
    note: "Distinctive dose note two",
    occurrenceKey: "course-1|2025-01-06T08:00:00.000Z",
    supersedesId: null,
    createdAt: "2025-01-06T08:05:00.000Z",
    updatedAt: "2025-01-06T08:05:00.000Z",
    deletedAt: null,
  },
  {
    id: "dose-3",
    courseId: "course-1",
    scheduledFor: "2025-01-07T08:00:00.000Z",
    status: "given",
    loggedAt: "2025-01-07T08:02:00.000Z",
    givenAt: "2025-01-07T08:02:00.000Z",
    amount: 2,
    note: "Distinctive dose note three",
    occurrenceKey: "course-1|2025-01-07T08:00:00.000Z",
    supersedesId: "dose-1",
    createdAt: "2025-01-07T08:02:00.000Z",
    updatedAt: "2025-01-07T08:02:00.000Z",
    deletedAt: null,
  },
];

const v1StockAdjustments = [
  {
    id: "stock-1",
    medicationId: "med-1",
    deltaUnits: -3,
    reason: "purchase",
    note: "Distinctive stock note one",
    createdAt: "2025-01-08T00:00:00.000Z",
    updatedAt: "2025-01-08T00:00:00.000Z",
    deletedAt: null,
  },
  {
    id: "stock-2",
    medicationId: "med-1",
    deltaUnits: 30,
    reason: "correction",
    note: "Distinctive stock note two",
    createdAt: "2025-01-09T00:00:00.000Z",
    updatedAt: "2025-01-09T00:00:00.000Z",
    deletedAt: null,
  },
];

const NON_DEFAULT_TINT_CURSOR = 3;
const FIXED_LAST_SWEEP_DAY = "2026-01-15";

/** Seeds a v1 database with the fixture rows above plus non-default meta. */
async function seedV1Database(name: string): Promise<void> {
  const database = await openV1Database(name);
  await putAll(database, "pets", v1Pets);
  await putAll(database, "medications", v1Medications);
  await putAll(database, "courses", v1Courses);
  await putAll(database, "doseEvents", v1DoseEvents);
  await putAll(database, "stockAdjustments", v1StockAdjustments);
  await putAll(database, "meta", [
    { key: "tintCursor", value: NON_DEFAULT_TINT_CURSOR },
    { key: "lastSweepDay", value: FIXED_LAST_SWEEP_DAY },
  ]);
  database.close();
}

async function getMetaValue(db: Awaited<ReturnType<typeof openPetMedsDb>>, key: string): Promise<unknown> {
  const record = (await db.get("meta", key)) as MetaRecord | undefined;
  return record?.value;
}

describe("v1 -> v2 migration", () => {
  it("backfills householdId/actorId and mints one household and self user", async () => {
    const name = crypto.randomUUID();
    await seedV1Database(name);

    const db = await openPetMedsDb(name);
    try {
      expect(db.version).toBe(2);
      expect(await getMetaValue(db, "schemaVersion")).toBe(2);

      const householdId = await getMetaValue(db, "householdId");
      const selfUserId = await getMetaValue(db, "selfUserId");
      expect(typeof householdId).toBe("string");
      expect(householdId).toBeTruthy();
      expect(typeof selfUserId).toBe("string");
      expect(selfUserId).toBeTruthy();

      // Row counts unchanged — nothing was dropped.
      const migratedPets = await db.getAll("pets");
      const migratedMedications = await db.getAll("medications");
      const migratedCourses = await db.getAll("courses");
      const migratedDoseEvents = await db.getAll("doseEvents");
      const migratedStockAdjustments = await db.getAll("stockAdjustments");
      expect(migratedPets).toHaveLength(2);
      expect(migratedMedications).toHaveLength(1);
      expect(migratedCourses).toHaveLength(1);
      expect(migratedDoseEvents).toHaveLength(3);
      expect(migratedStockAdjustments).toHaveLength(2);

      // Every pet backfilled with the same householdId, equal to meta's.
      for (const pet of migratedPets) {
        expect(pet.householdId).toBeTruthy();
        expect(pet.householdId).toBe(householdId);
      }

      // Every doseEvent and stockAdjustment backfilled with actorId ===
      // meta.selfUserId — checked by iterating the full store, not sampling.
      for (const doseEvent of migratedDoseEvents) {
        expect(doseEvent.actorId).toBeTruthy();
        expect(doseEvent.actorId).toBe(selfUserId);
      }
      for (const stockAdjustment of migratedStockAdjustments) {
        expect(stockAdjustment.actorId).toBeTruthy();
        expect(stockAdjustment.actorId).toBe(selfUserId);
      }

      // Every original field survives byte-identical (minus the new field).
      for (const original of v1Pets) {
        const migrated = migratedPets.find((pet) => pet.id === original.id);
        const { householdId: _householdId, ...rest } = migrated as typeof migrated & { householdId: string };
        expect(rest).toEqual(original);
      }
      for (const original of v1Medications) {
        const migrated = migratedMedications.find((medication) => medication.id === original.id);
        expect(migrated).toEqual(original);
      }
      for (const original of v1Courses) {
        const migrated = migratedCourses.find((course) => course.id === original.id);
        expect(migrated).toEqual(original);
      }
      for (const original of v1DoseEvents) {
        const migrated = migratedDoseEvents.find((doseEvent) => doseEvent.id === original.id);
        const { actorId: _actorId, ...rest } = migrated as typeof migrated & { actorId: string };
        expect(rest).toEqual(original);
      }
      for (const original of v1StockAdjustments) {
        const migrated = migratedStockAdjustments.find((stockAdjustment) => stockAdjustment.id === original.id);
        const { actorId: _actorId, ...rest } = migrated as typeof migrated & { actorId: string };
        expect(rest).toEqual(original);
      }

      // Existing meta untouched by the migration.
      expect(await getMetaValue(db, "tintCursor")).toBe(NON_DEFAULT_TINT_CURSOR);
      expect(await getMetaValue(db, "lastSweepDay")).toBe(FIXED_LAST_SWEEP_DAY);

      // Exactly one self user, wired to the minted household, no email.
      const users = await db.getAll("users");
      expect(users).toHaveLength(1);
      expect(users[0].isSelf).toBe(true);
      expect(users[0].id).toBe(selfUserId);
      expect(users[0].householdId).toBe(householdId);
      expect(users[0].email).toBeNull();

      // Exactly one household, matching meta.
      const households = await db.getAll("households");
      expect(households).toHaveLength(1);
      expect(households[0].id).toBe(householdId);

      // No address anywhere in the migrated data.
      const everything = [...migratedPets, ...migratedDoseEvents, ...migratedStockAdjustments, ...users];
      for (const row of everything) {
        expect(JSON.stringify(row)).not.toContain("@");
      }
    } finally {
      db.close();
    }
  });

  it("does not mint a second household or user when re-opened", async () => {
    const name = crypto.randomUUID();
    await seedV1Database(name);

    const firstOpen = await openPetMedsDb(name);
    const firstHouseholdId = await getMetaValue(firstOpen, "householdId");
    const firstSelfUserId = await getMetaValue(firstOpen, "selfUserId");
    firstOpen.close();

    const secondOpen = await openPetMedsDb(name);
    try {
      expect(await getMetaValue(secondOpen, "householdId")).toBe(firstHouseholdId);
      expect(await getMetaValue(secondOpen, "selfUserId")).toBe(firstSelfUserId);

      const households = await secondOpen.getAll("households");
      const users = await secondOpen.getAll("users");
      expect(households).toHaveLength(1);
      expect(users).toHaveLength(1);
    } finally {
      secondOpen.close();
    }
  });

  it("brings a fresh database up at v2 with a self user and household", async () => {
    const name = crypto.randomUUID();
    const db = await openPetMedsDb(name);
    try {
      expect(db.version).toBe(2);
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
      expect(await getMetaValue(db, "schemaVersion")).toBe(2);

      const householdId = await getMetaValue(db, "householdId");
      const selfUserId = await getMetaValue(db, "selfUserId");
      expect(householdId).toBeTruthy();
      expect(selfUserId).toBeTruthy();

      const households = await db.getAll("households");
      const users = await db.getAll("users");
      expect(households).toHaveLength(1);
      expect(users).toHaveLength(1);
      expect(users[0].isSelf).toBe(true);
    } finally {
      db.close();
    }
  });

  it("mints a fresh household and self user when meta points at rows that don't exist", async () => {
    const name = crypto.randomUUID();
    await seedV1Database(name);

    const DANGLING_HOUSEHOLD_ID = "dangling-household-11111111-1111-1111-1111-111111111111";
    const DANGLING_SELF_USER_ID = "dangling-user-2222222222-2222-2222-2222-222222222222";
    const database = await openV1Database(name);
    await putAll(database, "meta", [
      { key: "householdId", value: DANGLING_HOUSEHOLD_ID },
      { key: "selfUserId", value: DANGLING_SELF_USER_ID },
    ]);
    database.close();

    const db = await openPetMedsDb(name);
    try {
      const householdId = await getMetaValue(db, "householdId");
      const selfUserId = await getMetaValue(db, "selfUserId");

      // The dangling ids were replaced, not trusted.
      expect(householdId).not.toBe(DANGLING_HOUSEHOLD_ID);
      expect(selfUserId).not.toBe(DANGLING_SELF_USER_ID);

      // A real household and self user now genuinely exist.
      const households = await db.getAll("households");
      const users = await db.getAll("users");
      expect(households).toHaveLength(1);
      expect(users).toHaveLength(1);
      expect(households[0].id).toBe(householdId);
      expect(users[0].id).toBe(selfUserId);
      expect(users[0].isSelf).toBe(true);

      // Every pet's householdId resolves to a row that actually exists.
      const migratedPets = await db.getAll("pets");
      expect(migratedPets).toHaveLength(2);
      for (const pet of migratedPets) {
        expect(pet.householdId).toBe(householdId);
        expect(await db.get("households", pet.householdId as string)).toBeTruthy();
      }

      // Every doseEvent/stockAdjustment actorId resolves to a row that
      // actually exists — not merely a non-empty string.
      const migratedDoseEvents = await db.getAll("doseEvents");
      const migratedStockAdjustments = await db.getAll("stockAdjustments");
      expect(migratedDoseEvents).toHaveLength(3);
      expect(migratedStockAdjustments).toHaveLength(2);
      for (const doseEvent of migratedDoseEvents) {
        expect(doseEvent.actorId).toBe(selfUserId);
        expect(await db.get("users", doseEvent.actorId as string)).toBeTruthy();
      }
      for (const stockAdjustment of migratedStockAdjustments) {
        expect(stockAdjustment.actorId).toBe(selfUserId);
        expect(await db.get("users", stockAdjustment.actorId as string)).toBeTruthy();
      }

      // No pre-existing row was dropped.
      const migratedMedications = await db.getAll("medications");
      const migratedCourses = await db.getAll("courses");
      expect(migratedMedications).toHaveLength(1);
      expect(migratedCourses).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
