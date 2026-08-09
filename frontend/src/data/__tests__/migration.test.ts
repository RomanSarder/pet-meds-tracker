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
      // `openPetMedsDb` always brings a database up to the CURRENT
      // `DB_VERSION` in one upgrade transaction, so opening this v1 seed
      // necessarily cascades through the v2->v3 upgrade too — this test's
      // v1->v2-specific assertions below remain valid regardless.
      expect(db.version).toBe(3);
      expect(await getMetaValue(db, "schemaVersion")).toBe(3);

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

      // The v1 seed cascades through v2->v3 too: the one pre-existing course
      // gets exactly one backfilled "started" event.
      const migratedCourseEvents = await db.getAll("courseEvents");
      expect(migratedCourseEvents).toHaveLength(1);
      expect(migratedCourseEvents[0].courseId).toBe(v1Courses[0].id);
      expect(migratedCourseEvents[0].kind).toBe("started");
      expect(migratedCourseEvents[0].at).toBe(v1Courses[0].createdAt);
      expect(migratedCourseEvents[0].actorId).toBe(selfUserId);
      expect(migratedCourseEvents[0].before).toBeNull();
      expect(migratedCourseEvents[0].after).toEqual({
        schedule: v1Courses[0].schedule,
        doseAmount: v1Courses[0].doseAmount,
        doseUnit: v1Courses[0].doseUnit,
        startDate: v1Courses[0].startDate,
        endDate: v1Courses[0].endDate,
      });

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

  it("brings a fresh database up at v3 with a self user and household", async () => {
    const name = crypto.randomUUID();
    const db = await openPetMedsDb(name);
    try {
      expect(db.version).toBe(3);
      expect(Array.from(db.objectStoreNames).sort()).toEqual(
        [
          "courses",
          "courseEvents",
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
      expect(await getMetaValue(db, "schemaVersion")).toBe(3);

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

// --- v2 -> v3: the course lifecycle ledger (SPEC §6.4) ----------------------
// Same rigour as the v1 -> v2 suite above: a genuine v2 database built with
// the raw `indexedDB` API (NOT `openPetMedsDb`, which would open straight at
// v3 and prove nothing about the upgrade path), seeded with real rows in
// EVERY store, proving every row survives and every course gets exactly one
// backfilled "started" event.

/** Opens a brand-new database at version 2, with exactly today's v2 schema (pre-`courseEvents`). */
function openV2Database(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 2);
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

      database.createObjectStore("meta", { keyPath: "key" });
      database.createObjectStore("households", { keyPath: "id" });

      const users = database.createObjectStore("users", { keyPath: "id" });
      users.createIndex("by_householdId", "householdId");

      const joinCodes = database.createObjectStore("joinCodes", { keyPath: "id" });
      joinCodes.createIndex("by_householdId", "householdId");
      joinCodes.createIndex("by_code", "code");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const V2_HOUSEHOLD_ID = "v2-household-11111111-1111-1111-1111-111111111111";
const V2_SELF_USER_ID = "v2-user-22222222-2222-2222-2222-222222222222";

const v2Household = {
  id: V2_HOUSEHOLD_ID,
  name: "Distinctive Household",
  createdAt: "2025-02-01T00:00:00.000Z",
  updatedAt: "2025-02-01T00:00:00.000Z",
  deletedAt: null,
};

const v2Users = [
  {
    id: V2_SELF_USER_ID,
    householdId: V2_HOUSEHOLD_ID,
    email: null,
    displayName: "Distinctive Self",
    tint: 1,
    isSelf: true,
    joinedAt: "2025-02-01T00:00:00.000Z",
    createdAt: "2025-02-01T00:00:00.000Z",
    updatedAt: "2025-02-01T00:00:00.000Z",
    deletedAt: null,
  },
];

const v2JoinCodes = [
  {
    id: "v2-joincode-3333333-3333-3333-3333-333333333333",
    householdId: V2_HOUSEHOLD_ID,
    code: "K7RMQ4",
    createdBy: V2_SELF_USER_ID,
    expiresAt: "2025-02-02T00:00:00.000Z",
    usedBy: null,
    revokedAt: null,
    createdAt: "2025-02-01T00:00:00.000Z",
    updatedAt: "2025-02-01T00:00:00.000Z",
    deletedAt: null,
  },
];

const v2Pets = [
  {
    id: "v2-pet-1",
    name: "Distinctive V2 Pet",
    species: "cat",
    birthdate: "2021-01-01",
    weightGrams: 4200,
    tint: 1,
    archived: false,
    householdId: V2_HOUSEHOLD_ID,
    createdAt: "2025-02-01T00:00:00.000Z",
    updatedAt: "2025-02-01T00:00:00.000Z",
    deletedAt: null,
  },
];

const v2Medications = [
  {
    id: "v2-med-1",
    name: "Distinctive V2 Medication",
    strength: "20mg",
    form: "capsule",
    unit: "capsule",
    packSize: 20,
    stockUnits: 15,
    lowThreshold: 3,
    nameLower: "distinctive v2 medication",
    createdAt: "2025-02-02T00:00:00.000Z",
    updatedAt: "2025-02-02T00:00:00.000Z",
    deletedAt: null,
  },
];

// Two courses — proves the backfill is "one event PER course", not one event total.
const v2Courses = [
  {
    id: "v2-course-1",
    petId: "v2-pet-1",
    medicationId: "v2-med-1",
    doseAmount: 2,
    doseUnit: "capsule",
    instructions: "Distinctive v2 instructions one",
    schedule: { kind: "fixedTimes", times: ["09:00"] },
    startDate: "2025-02-03",
    endDate: null,
    status: "active",
    notes: "Distinctive v2 course notes one",
    resumedAt: null,
    createdAt: "2025-02-03T00:00:00.000Z",
    updatedAt: "2025-02-03T00:00:00.000Z",
    deletedAt: null,
  },
  {
    id: "v2-course-2",
    petId: "v2-pet-1",
    medicationId: "v2-med-1",
    doseAmount: 1,
    doseUnit: "capsule",
    instructions: null,
    schedule: { kind: "fromLastDose", intervalHours: 12 },
    startDate: "2025-02-04",
    endDate: "2025-02-20",
    status: "stopped",
    notes: null,
    resumedAt: null,
    createdAt: "2025-02-04T00:00:00.000Z",
    updatedAt: "2025-02-20T00:00:00.000Z",
    deletedAt: null,
  },
];

const v2DoseEvents = [
  {
    id: "v2-dose-1",
    courseId: "v2-course-1",
    scheduledFor: "2025-02-05T09:00:00.000Z",
    status: "given",
    loggedAt: "2025-02-05T09:01:00.000Z",
    givenAt: "2025-02-05T09:01:00.000Z",
    amount: 2,
    note: "Distinctive v2 dose note",
    occurrenceKey: "v2-course-1|2025-02-05T09:00:00.000Z",
    supersedesId: null,
    actorId: V2_SELF_USER_ID,
    createdAt: "2025-02-05T09:01:00.000Z",
    updatedAt: "2025-02-05T09:01:00.000Z",
    deletedAt: null,
  },
];

const v2StockAdjustments = [
  {
    id: "v2-stock-1",
    medicationId: "v2-med-1",
    deltaUnits: 20,
    reason: "purchase",
    note: "Distinctive v2 stock note",
    actorId: V2_SELF_USER_ID,
    createdAt: "2025-02-02T00:00:00.000Z",
    updatedAt: "2025-02-02T00:00:00.000Z",
    deletedAt: null,
  },
];

const V2_TINT_CURSOR = 5;
const V2_LAST_SWEEP_DAY = "2026-02-01";

async function seedV2Database(name: string): Promise<void> {
  const database = await openV2Database(name);
  await putAll(database, "pets", v2Pets);
  await putAll(database, "medications", v2Medications);
  await putAll(database, "courses", v2Courses);
  await putAll(database, "doseEvents", v2DoseEvents);
  await putAll(database, "stockAdjustments", v2StockAdjustments);
  await putAll(database, "households", [v2Household]);
  await putAll(database, "users", v2Users);
  await putAll(database, "joinCodes", v2JoinCodes);
  await putAll(database, "meta", [
    { key: "schemaVersion", value: 2 },
    { key: "tintCursor", value: V2_TINT_CURSOR },
    { key: "lastSweepDay", value: V2_LAST_SWEEP_DAY },
    { key: "householdId", value: V2_HOUSEHOLD_ID },
    { key: "selfUserId", value: V2_SELF_USER_ID },
  ]);
  database.close();
}

describe("v2 -> v3 migration", () => {
  it("backfills exactly one 'started' CourseEvent per pre-existing course, and every row in every store survives", async () => {
    const name = crypto.randomUUID();
    await seedV2Database(name);

    const db = await openPetMedsDb(name);
    try {
      expect(db.version).toBe(3);
      expect(await getMetaValue(db, "schemaVersion")).toBe(3);

      // Row counts unchanged in every pre-existing store — nothing was dropped.
      const migratedPets = await db.getAll("pets");
      const migratedMedications = await db.getAll("medications");
      const migratedCourses = await db.getAll("courses");
      const migratedDoseEvents = await db.getAll("doseEvents");
      const migratedStockAdjustments = await db.getAll("stockAdjustments");
      const migratedHouseholds = await db.getAll("households");
      const migratedUsers = await db.getAll("users");
      const migratedJoinCodes = await db.getAll("joinCodes");
      expect(migratedPets).toHaveLength(v2Pets.length);
      expect(migratedMedications).toHaveLength(v2Medications.length);
      expect(migratedCourses).toHaveLength(v2Courses.length);
      expect(migratedDoseEvents).toHaveLength(v2DoseEvents.length);
      expect(migratedStockAdjustments).toHaveLength(v2StockAdjustments.length);
      expect(migratedHouseholds).toHaveLength(1);
      expect(migratedUsers).toHaveLength(1);
      expect(migratedJoinCodes).toHaveLength(v2JoinCodes.length);

      // Every original row survives byte-identical — the v3 upgrade only
      // ever adds rows to the new `courseEvents` store.
      for (const original of v2Pets) {
        expect(migratedPets.find((p) => p.id === original.id)).toEqual(original);
      }
      for (const original of v2Medications) {
        expect(migratedMedications.find((m) => m.id === original.id)).toEqual(original);
      }
      for (const original of v2Courses) {
        expect(migratedCourses.find((c) => c.id === original.id)).toEqual(original);
      }
      for (const original of v2DoseEvents) {
        expect(migratedDoseEvents.find((e) => e.id === original.id)).toEqual(original);
      }
      for (const original of v2StockAdjustments) {
        expect(migratedStockAdjustments.find((a) => a.id === original.id)).toEqual(original);
      }
      expect(migratedHouseholds[0]).toEqual(v2Household);
      expect(migratedUsers[0]).toEqual(v2Users[0]);
      expect(migratedJoinCodes[0]).toEqual(v2JoinCodes[0]);

      // Existing meta untouched by the migration, apart from schemaVersion.
      expect(await getMetaValue(db, "tintCursor")).toBe(V2_TINT_CURSOR);
      expect(await getMetaValue(db, "lastSweepDay")).toBe(V2_LAST_SWEEP_DAY);
      expect(await getMetaValue(db, "householdId")).toBe(V2_HOUSEHOLD_ID);
      expect(await getMetaValue(db, "selfUserId")).toBe(V2_SELF_USER_ID);

      // Exactly one backfilled "started" event per pre-existing course.
      const courseEvents = await db.getAll("courseEvents");
      expect(courseEvents).toHaveLength(v2Courses.length);
      for (const course of v2Courses) {
        const matches = courseEvents.filter((e) => e.courseId === course.id);
        expect(matches).toHaveLength(1);
        const [event] = matches;
        expect(event.kind).toBe("started");
        expect(event.at).toBe(course.createdAt);
        expect(event.actorId).toBe(V2_SELF_USER_ID);
        expect(event.before).toBeNull();
        expect(event.after).toEqual({
          schedule: course.schedule,
          doseAmount: course.doseAmount,
          doseUnit: course.doseUnit,
          startDate: course.startDate,
          endDate: course.endDate,
        });
        expect(event.deletedAt).toBeNull();
        expect(typeof event.id).toBe("string");
        expect(event.id).toBeTruthy();
      }
    } finally {
      db.close();
    }
  });

  it("does not run the backfill twice when a v3 database is simply re-opened", async () => {
    const name = crypto.randomUUID();
    await seedV2Database(name);

    const firstOpen = await openPetMedsDb(name);
    firstOpen.close();

    const secondOpen = await openPetMedsDb(name);
    try {
      const courseEvents = await secondOpen.getAll("courseEvents");
      expect(courseEvents).toHaveLength(v2Courses.length);
    } finally {
      secondOpen.close();
    }
  });
});
