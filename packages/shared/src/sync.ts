// SPEC §9 / W9-DESIGN §D5 — the sync wire contract. Both the Fastify backend and
// the (frozen-to-this-branch) frontend `sync/mapping.ts` compile domain <-> DTO
// against these types.
//
// TYPES ONLY — see household.ts's note at the top of this package: `exports`
// points runtime consumers at `./dist/index.js`, which vitest/vite never build,
// so nothing here may be a value (no enums, no consts, no functions).
//
// Deliberately no `householdId` field anywhere in this file's OWN types.
// `household_id` is always stamped from the caller's session (W9-DESIGN §D5)
// and never read from the request body — leaving it out of the wire shape
// makes that a type-level fact rather than a discipline every call site has
// to remember. `SyncPayload.users` below is the one exception, and it is an
// import, not a type defined here: `MemberDto` (from `./household`) already
// carries `householdId` for `GET /household`'s consumers, and reusing it
// keeps one shape for "a household member as seen by another member" rather
// than two that could drift. That field is populated by the SERVER on the
// way OUT (`GET /sync/pull`) and never read from a request body — see
// `backend/src/sync/index.ts`'s `pullRoster`.

import type { MemberDto } from "./household";

export type IsoDateTime = string;
/** Calendar day, "YYYY-MM-DD" — NOT an instant. */
export type LocalDate = string;
/** "HH:MM" wall clock. */
export type LocalTime = string;
/** ISO numbering, 1 = Monday. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
/** Same 1-4 palette as pets and household members. */
export type Tint = 1 | 2 | 3 | 4;

export type SpeciesDto = "rabbit" | "guinea_pig" | "cat" | "dog" | "other";
export type MedicationFormDto = "liquid" | "tablet" | "capsule" | "topical" | "injection" | "other";
export type CourseStatusDto = "active" | "paused" | "finished" | "stopped";
export type DoseEventStatusDto = "given" | "skipped" | "missed";
export type StockReasonDto = "purchase" | "correction" | "waste";
export type CourseEventKindDto = "started" | "paused" | "resumed" | "stopped" | "finished" | "edited";

/** SPEC §3a/§3b, mirrored from `domain/types.ts` `Schedule`. */
export type ScheduleDto =
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

/** Mirrors `domain/types.ts` `CourseSnapshot` — the fields a §6.4 detail line compares. */
export interface CourseSnapshotDto {
  schedule: ScheduleDto;
  doseAmount: number;
  doseUnit: string;
  startDate: LocalDate;
  endDate: LocalDate | null;
}

/** Mutable — LWW on `updatedAt` (W9-DESIGN §D2). */
export interface PetDto {
  id: string;
  name: string;
  species: SpeciesDto;
  birthdate: LocalDate | null;
  weightGrams: number | null;
  tint: Tint;
  archived: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  deletedAt: IsoDateTime | null;
}

/** Mutable — LWW on `updatedAt` (W9-DESIGN §D2). */
export interface MedicationDto {
  id: string;
  name: string;
  strength: string | null;
  form: MedicationFormDto;
  unit: string;
  packSize: number | null;
  stockUnits: number | null;
  lowThreshold: number | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  deletedAt: IsoDateTime | null;
}

/** Mutable — LWW on `updatedAt` (W9-DESIGN §D2). `status`/`resumedAt` ride along under LWW. */
export interface CourseDto {
  id: string;
  petId: string;
  medicationId: string;
  doseAmount: number;
  doseUnit: string;
  instructions: string | null;
  schedule: ScheduleDto;
  startDate: LocalDate;
  endDate: LocalDate | null;
  status: CourseStatusDto;
  notes: string | null;
  resumedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  deletedAt: IsoDateTime | null;
}

/** Append-only ledger — insert-if-absent, never overwritten (W9-DESIGN §D2). */
export interface DoseEventDto {
  id: string;
  courseId: string;
  scheduledFor: IsoDateTime | null;
  status: DoseEventStatusDto;
  loggedAt: IsoDateTime;
  givenAt: IsoDateTime;
  amount: number;
  note: string | null;
  occurrenceKey: string;
  supersedesId: string | null;
  actorId: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  deletedAt: IsoDateTime | null;
}

/** Append-only ledger — insert-if-absent, never overwritten (W9-DESIGN §D2). */
export interface StockAdjustmentDto {
  id: string;
  medicationId: string;
  deltaUnits: number;
  reason: StockReasonDto;
  note: string | null;
  actorId: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  deletedAt: IsoDateTime | null;
}

/**
 * Append-only ledger — insert-if-absent, never overwritten (W9-DESIGN §D2).
 * `seq` is the W9-DESIGN §D3 Lamport ordering key; `at` stays the primary sort.
 */
export interface CourseEventDto {
  id: string;
  courseId: string;
  kind: CourseEventKindDto;
  at: IsoDateTime;
  actorId: string;
  before: CourseSnapshotDto | null;
  after: CourseSnapshotDto;
  seq: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  deletedAt: IsoDateTime | null;
}

/** One optional array per sync table — absent/empty means "nothing of that kind in this batch". */
export interface SyncPayload {
  pets?: PetDto[];
  medications?: MedicationDto[];
  courses?: CourseDto[];
  doseEvents?: DoseEventDto[];
  stockAdjustments?: StockAdjustmentDto[];
  courseEvents?: CourseEventDto[];
  /**
   * The caller's household roster (every other member), attached only to
   * `/sync/pull` responses. Unlike the six arrays above, this is never a
   * `SyncPushBody` field the client fills in — the server is the sole writer
   * — and it is not incrementally cursored: every pull carries the CURRENT
   * full list rather than a delta, since household member counts are small.
   * See `backend/src/sync/index.ts`'s `pullRoster` for why `users` is not a
   * `SYNC_TABLES` entry like the six tables above.
   */
  users?: MemberDto[];
}

/** `POST /sync/push` request body. */
export interface SyncPushBody {
  changes: SyncPayload;
}

/** `POST /sync/push` response. */
export interface SyncPushResult {
  /** Count of rows actually written — excludes stale LWW losers and ledger ids already held. */
  accepted: number;
  cursor: string;
}

/** `GET /sync/pull` response. */
export interface SyncPullResult {
  changes: SyncPayload;
  cursor: string;
  /** True when at least one table truncated at the page limit; call again with `cursor`. */
  hasMore: boolean;
}
