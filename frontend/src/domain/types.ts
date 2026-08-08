// Domain types for Pet Meds (SPEC.md §2, §3, §8). This is the contract every
// other branch of the W0 wave imports — signatures here are load-bearing.
import type { PetTint } from "@/components/ds";

/** UTC instant, e.g. "2026-08-08T07:00:00.000Z". */
export type IsoDateTime = string;
/** Calendar day, "YYYY-MM-DD" — NOT an instant. */
export type LocalDate = string;
/** "HH:MM" wall clock. */
export type LocalTime = string;
/** ISO numbering, 1 = Monday (NOT JS `Date#getDay()`, which is 0 = Sunday). */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Timestamped {
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  deletedAt: IsoDateTime | null;
}

export type Species = "rabbit" | "guinea_pig" | "cat" | "dog" | "other";
export type MedicationForm =
  | "liquid"
  | "tablet"
  | "capsule"
  | "topical"
  | "injection"
  | "other";
export type CourseStatus = "active" | "paused" | "finished" | "stopped";
export type DoseEventStatus = "given" | "skipped" | "missed";
export type StockReason = "purchase" | "correction" | "waste";

export interface Pet extends Timestamped {
  id: string;
  name: string;
  species: Species;
  birthdate: LocalDate | null;
  weightGrams: number | null;
  /** Assigned on create, round-robin, immutable. Imported from the DS — never redeclared. */
  tint: PetTint;
  archived: boolean;
}

export interface Medication extends Timestamped {
  id: string;
  name: string;
  strength: string | null;
  form: MedicationForm;
  unit: string;
  packSize: number | null;
  /** Cache of Σ StockAdjustment.deltaUnits; null = not set. Written only by adjustStock/setStockOnHand. */
  stockUnits: number | null;
  lowThreshold: number | null;
}

/** SPEC §3a/§3b — the discriminated union driving all scheduling logic. */
export type Schedule =
  | {
      kind: "fixedTimes";
      times: LocalTime[];
      daysOfWeek?: IsoWeekday[];
      everyNDays?: number;
    }
  | {
      kind: "fromLastDose";
      intervalHours: number;
      anchorTime?: LocalTime;
    };

export interface Course extends Timestamped {
  id: string;
  petId: string;
  medicationId: string;
  doseAmount: number;
  doseUnit: string;
  instructions: string | null;
  schedule: Schedule;
  startDate: LocalDate;
  endDate: LocalDate | null;
  status: CourseStatus;
  notes: string | null;
  /**
   * §3c: resuming a `fromLastDose` course restarts the chain from the resume
   * moment. §2's model has nowhere to record that moment, so it lives here.
   */
  resumedAt: IsoDateTime | null;
}

export interface DoseEvent extends Timestamped {
  id: string;
  courseId: string;
  scheduledFor: IsoDateTime | null;
  status: DoseEventStatus;
  loggedAt: IsoDateTime;
  givenAt: IsoDateTime;
  amount: number;
  note: string | null;
  /** `${courseId}|${scheduledFor ?? "-"}` — indexed by the data worker; makes the missed-dose sweep idempotent. */
  occurrenceKey: string;
  /** §8: corrections are new rows referencing the original — never mutate in place. */
  supersedesId: string | null;
}

export interface StockAdjustment extends Timestamped {
  id: string;
  medicationId: string;
  deltaUnits: number;
  reason: StockReason;
  note: string | null;
}

export interface MetaShape {
  schemaVersion: number;
  tintCursor: number;
  lastSweepDay: LocalDate | null;
}

export interface HouseholdBackup {
  schemaVersion: number;
  exportedAt: IsoDateTime;
  pets: Pet[];
  medications: Medication[];
  courses: Course[];
  doseEvents: DoseEvent[];
  stockAdjustments: StockAdjustment[];
}

export interface ImportReport {
  mode: "replace" | "merge";
  pets: number;
  medications: number;
  courses: number;
  doseEvents: number;
  stockAdjustments: number;
  skipped: number;
}
