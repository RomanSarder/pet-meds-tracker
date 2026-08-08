// The IndexedDB schema (SPEC §8) and the one place `openDB` is called.
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Course, DoseEvent, Medication, Pet, StockAdjustment } from "@/domain";

export const DB_NAME = "petmeds";
export const DB_VERSION = 1;

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
}

export function openPetMedsDb(dbName: string = DB_NAME): Promise<IDBPDatabase<PetMedsDB>> {
  return openDB<PetMedsDB>(dbName, DB_VERSION, {
    upgrade(database, oldVersion) {
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
          break;
        }
        // no v2 yet; future migrations append their own case and fall through
      }
    },
  });
}
