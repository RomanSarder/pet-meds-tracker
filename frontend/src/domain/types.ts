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

/**
 * SPEC §6.4: the log shows "every course lifecycle change (started, paused,
 * resumed, stopped, schedule or dose edited)". None of those write a
 * `DoseEvent`, and `Course` alone cannot reconstruct them — `updatedAt` and
 * `resumedAt` only ever remember the LATEST transition, so a second
 * pause/resume cycle erases the first, and an edit's before-value (needed for
 * §6.4's "Interval changed · every 12h to 2× daily") is stored nowhere at all.
 *
 * Hence this append-only ledger, written ONLY from inside `createCourse`,
 * `setCourseStatus` and `updateCourse`. There is deliberately no public
 * create/update/delete method for it: like `DoseEvent` and `StockAdjustment`,
 * append-only is enforced by the shape of `Repo`, not by discipline.
 */
export type CourseEventKind =
  | "started"
  | "paused"
  | "resumed"
  | "stopped"
  | "finished"
  | "edited";

/**
 * The course fields §6.4's detail lines compare across a change. Only the
 * fields a detail line can render — `notes` and `instructions` are excluded,
 * since editing them is not a lifecycle change and records no event.
 */
export interface CourseSnapshot {
  schedule: Schedule;
  doseAmount: number;
  doseUnit: string;
  startDate: LocalDate;
  endDate: LocalDate | null;
}

export interface CourseEvent extends Timestamped {
  id: string;
  courseId: string;
  kind: CourseEventKind;
  /** When the change happened. The ordering and day-grouping key for §6.4. */
  at: IsoDateTime;
  /**
   * W9 sync (design §D3): a Lamport counter (meta key `courseEventSeq`), NOT
   * a per-device row count. Every write takes `seq = ++courseEventSeq`;
   * `applyRemoteChanges` jumps the counter to `max(local, max seq among
   * applied rows)`, so a device's later writes always sort after everything
   * it has seen. Ordering is `(at asc, seq asc, id asc)` — `at` stays
   * primary (§6.4 day grouping, W6's event-log tests); `seq` only replaces
   * the random-UUID tie-break `id` used to be.
   */
  seq: number;
  /** SPEC §5: who did it; never null. Stamped by the repo from `currentActorId()`. */
  actorId: string;
  /** The course as it was before the change. `null` only for `started`. */
  before: CourseSnapshot | null;
  /** The course as it is after the change. Never null. */
  after: CourseSnapshot;
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
  /**
   * Prior ids this SAME account has been known by — always ids a device once
   * locally minted for "self" before it learned this account's canonical
   * server id (see `reconcileSelfId` on `Repo`), never anyone else's.
   * `displayNameFor` matches an `actorId` against a user's `id` OR any of
   * these, so a dose/course/stock event already stamped with a stale id
   * (locally, or already pushed to the server before the mismatch was
   * fixed) still resolves to the right name — the ledger rows that carry
   * the stale id are append-only and are never rewritten in place.
   * Optional so every pre-existing `User` literal across the app and its
   * tests still type-checks; absent means "no aliases", same as `[]`.
   */
  aliasIds?: string[];
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
  /** W9 sync (design §D3): the Lamport counter `CourseEvent.seq` is allocated from. Written by the v4 migration. */
  courseEventSeq: number;
  /** W9 sync (design §D4): opaque pull-side watermark; null until the first successful sync. */
  syncCursor: string | null;
  /** W9 sync (design §D4): when the push side last succeeded; null until the first successful sync. */
  lastPushedAt: IsoDateTime | null;
  /**
   * Ids from the self user's `aliasIds` that have already been disclosed to
   * the server via `POST /household/me/aliases` — the local record of what
   * does NOT need re-sending. `null`/absent means none yet. See
   * `features/household/selfIdentity.ts`'s `reconcileSelfIdentity`, the sole
   * writer: it diffs the self user's current `aliasIds` against this list on
   * every app-shell navigation and posts only what is missing, so a failed
   * (offline) attempt is retried on the next one rather than lost.
   */
  selfAliasIdsPushed: string[] | null;
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
  /** Optional so a v2 backup (which predates the ledger) still imports. */
  courseEvents?: CourseEvent[];
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
