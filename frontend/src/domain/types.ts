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
  /** SPEC §2/§5: everything belongs to one household. Stamped by the repo, never by a caller. */
  householdId: string;
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
  /** SPEC §2: userId who logged it; never null. Stamped by the repo from `currentActorId()`. */
  actorId: string;
}

export interface StockAdjustment extends Timestamped {
  id: string;
  medicationId: string;
  deltaUnits: number;
  reason: StockReason;
  note: string | null;
  /** SPEC §2. Stamped by the repo from `currentActorId()`. */
  actorId: string;
}

/** SPEC §2 Household. `name` is optional; the UI renders "Home" when it is null. */
export interface Household extends Timestamped {
  id: string;
  name: string | null;
}

/**
 * SPEC §2 User.
 *
 * `email` is `string | null` rather than §2's bare `string`: the address comes from the
 * magic-link auth layer (§5), which does not exist until slice 8, so the stub local user and
 * every fixture carry `null`. SPEC §5 and §12 forbid rendering an address anywhere, so nothing
 * in the app may read this field for display — attribution goes through `displayNameFor`.
 */
export interface User extends Timestamped {
  id: string;
  householdId: string;
  email: string | null;
  /** SPEC §5: 1–24 characters, required, need not be unique. */
  displayName: string;
  /** Same 1–4 palette as pets, assigned on join. */
  tint: PetTint;
  /** SPEC §2: local flag, exactly one per device. Never indexed — IndexedDB cannot index booleans. */
  isSelf: boolean;
  joinedAt: IsoDateTime;
}

/** SPEC §2/§5: six uppercase chars excluding O/0/I/1, 24 h, single use, one live per household. */
export interface JoinCode extends Timestamped {
  id: string;
  householdId: string;
  code: string;
  createdBy: string;
  expiresAt: IsoDateTime;
  usedBy: string | null;
  revokedAt: IsoDateTime | null;
}

export interface MetaShape {
  schemaVersion: number;
  tintCursor: number;
  lastSweepDay: LocalDate | null;
  /** id of the `User` row with `isSelf: true`. Written by the v2 migration; never null in practice. */
  selfUserId: string | null;
  /** id of the local `Household`. Written by the v2 migration; never null in practice. */
  householdId: string | null;
}

export interface HouseholdBackup {
  schemaVersion: number;
  exportedAt: IsoDateTime;
  households?: Household[];
  users?: User[];
  pets: Pet[];
  medications: Medication[];
  courses: Course[];
  doseEvents: DoseEvent[];
  stockAdjustments: StockAdjustment[];
  meta?: Pick<MetaShape, "tintCursor" | "lastSweepDay">;
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
