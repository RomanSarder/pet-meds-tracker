// The IndexedDB schema (SPEC §8) and the one place `openDB` is called.
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Course, DoseEvent, Household, JoinCode, Medication, Pet, StockAdjustment, User } from "@/domain";
import { DEFAULT_SELF_DISPLAY_NAME, newId, now } from "@/domain";

export const DB_NAME = "petmeds";
export const DB_VERSION = 2;

/**
 * `by_nameLower` must be a real stored field, and the frozen `Medication`
 * type has no such property — so internally every medication row carries one
 * extra column. It is stripped on every read path by `toMedication()` in
 * `idbRepo.ts`; nothing outside this file and `idbRepo.ts` should ever see it.
 */
export type StoredMedication = Medication & { nameLower: string };

/** `meta` rows: one `{ key, value }` record per `MetaShape` key. */
export interface MetaRecord {
  key: string;
  value: unknown;
}

export interface PetMedsDB extends DBSchema {
  pets: {
    key: string;
    value: Pet;
    indexes: { by_name: string };
  };
  medications: {
    key: string;
    value: StoredMedication;
    indexes: { by_nameLower: string };
  };
  courses: {
    key: string;
    value: Course;
    indexes: { by_petId: string; by_medicationId: string; by_status: string };
  };
  doseEvents: {
    key: string;
    value: DoseEvent;
    indexes: {
      by_courseId: string;
      by_occurrenceKey: string;
      // Created per SPEC's schema table, but nothing queries `by_givenAt` or
      // `by_courseId_givenAt` yet — `listDoseEvents` filters/sorts on
      // `loggedAt` (memoryRepo's rule; see idbRepo.ts), not `givenAt`. Kept
      // for a future "range by when it was actually taken" query.
      by_givenAt: string;
      by_courseId_givenAt: [string, string];
    };
  };
  stockAdjustments: {
    key: string;
    value: StockAdjustment;
    indexes: { by_medicationId: string; by_createdAt: string };
  };
  meta: {
    key: string;
    value: MetaRecord;
  };
  households: {
    key: string;
    value: Household;
  };
  users: {
    key: string;
    value: User;
    indexes: { by_householdId: string };
  };
  joinCodes: {
    key: string;
    value: JoinCode;
    indexes: { by_householdId: string; by_code: string };
  };
}

export function openPetMedsDb(dbName: string = DB_NAME): Promise<IDBPDatabase<PetMedsDB>> {
  return openDB<PetMedsDB>(dbName, DB_VERSION, {
    async upgrade(database, oldVersion, _newVersion, transaction) {
      switch (oldVersion) {
        case 0: {
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
          // A fresh, empty household starts empty — no fixture seeding, only
          // the meta defaults so `getMeta` answers match `createMemoryRepo({...empty})`.
          meta.put({ key: "schemaVersion", value: 1 });
          meta.put({ key: "tintCursor", value: 0 });
          meta.put({ key: "lastSweepDay", value: null });
        }
        // falls through
        case 1: {
          // v2 (SPEC §2/§5): households, users and join codes. No index on
          // `isSelf`, `usedBy`, `revokedAt` or `deletedAt` — IndexedDB cannot
          // index a boolean and silently skips records with a null key.
          database.createObjectStore("households", { keyPath: "id" });

          const users = database.createObjectStore("users", { keyPath: "id" });
          users.createIndex("by_householdId", "householdId");

          const joinCodes = database.createObjectStore("joinCodes", { keyPath: "id" });
          joinCodes.createIndex("by_householdId", "householdId");
          joinCodes.createIndex("by_code", "code");

          const metaStore = transaction.objectStore("meta");
          const householdIdRecord = await metaStore.get("householdId");
          const selfUserIdRecord = await metaStore.get("selfUserId");
          let householdId = householdIdRecord?.value as string | null | undefined;
          let selfUserId = selfUserIdRecord?.value as string | null | undefined;

          if (!householdId || !selfUserId) {
            householdId = newId();
            selfUserId = newId();
            const ts = now().toISOString();

            await transaction.objectStore("households").put({
              id: householdId,
              name: null,
              createdAt: ts,
              updatedAt: ts,
              deletedAt: null,
            });

            await transaction.objectStore("users").put({
              id: selfUserId,
              householdId,
              email: null,
              displayName: DEFAULT_SELF_DISPLAY_NAME,
              tint: 1,
              isSelf: true,
              joinedAt: ts,
              createdAt: ts,
              updatedAt: ts,
              deletedAt: null,
            });

            await metaStore.put({ key: "householdId", value: householdId });
            await metaStore.put({ key: "selfUserId", value: selfUserId });
          }

          // Backfill, never drop (SPEC §1: "Nothing is ever auto-deleted.").
          // Every pre-existing row survives with every original field intact.
          let petsCursor = await transaction.objectStore("pets").openCursor();
          while (petsCursor) {
            if (!petsCursor.value.householdId) {
              await petsCursor.update({ ...petsCursor.value, householdId });
            }
            petsCursor = await petsCursor.continue();
          }

          let doseEventsCursor = await transaction.objectStore("doseEvents").openCursor();
          while (doseEventsCursor) {
            if (!doseEventsCursor.value.actorId) {
              await doseEventsCursor.update({ ...doseEventsCursor.value, actorId: selfUserId });
            }
            doseEventsCursor = await doseEventsCursor.continue();
          }

          let stockCursor = await transaction.objectStore("stockAdjustments").openCursor();
          while (stockCursor) {
            if (!stockCursor.value.actorId) {
              await stockCursor.update({ ...stockCursor.value, actorId: selfUserId });
            }
            stockCursor = await stockCursor.continue();
          }

          await metaStore.put({ key: "schemaVersion", value: 2 });
        }
      }
    },
  });
}
