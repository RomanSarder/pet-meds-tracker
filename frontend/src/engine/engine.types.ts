// Engine types — reproduced verbatim from the W0 foundations brief §4. The
// engine itself (frontend/src/engine/index.ts) is a typed stub on this
// branch; W2 (slice 3) writes the real function bodies against these same
// types, so the shapes here are load-bearing for four other branches.
import type { Course, CourseEvent, DoseEvent, LocalDate, Schedule } from "@/domain";

/** Seven states (SPEC §4 + brief §7 item 3's `notStarted`). */
export type DoseState =
  | "given"
  | "skipped"
  | "overdue"
  | "due"
  | "later"
  | "upcoming"
  | "notStarted";

export interface Occurrence {
  /** `${courseId}|${scheduledFor ?? "-"}` — built by `occurrenceKeyFor` in `@/domain`. */
  key: string;
  courseId: string;
  petId: string;
  medicationId: string;
  kind: Schedule["kind"];
  /** The local day it was SCHEDULED FOR (SPEC §3d) — not the day it was logged. */
  day: LocalDate;
  /** null only for a fromLastDose course with no given event yet. */
  dueAt: Date | null;
  /** 60 for fixedTimes, 90 for fromLastDose. */
  graceMinutes: number;
  doseAmount: number;
  doseUnit: string;
  instructions: string | null;
  /** The live DoseEvent resolving this occurrence, if any. */
  event: DoseEvent | null;
}

export interface EngineContext {
  courses: Course[];
  events: DoseEvent[];
  /**
   * SPEC §3c / §6.4: the full CourseEvent ledger, REQUIRED (not optional).
   * `getOccurrences`/`nextDueAt` read it to reconstruct the schedule that
   * was in effect at a given instant, so a `fixedTimes` schedule edit is
   * forward-only — past days keep projecting on the old grid instead of
   * orphaning already-logged doses or flooding the missed sweep with
   * phantom rows. Required rather than optional on purpose: an optional
   * field would silently restore that bug at any construction site that
   * forgot it, where a required one turns `npm run typecheck` into the
   * completeness proof.
   */
  courseEvents: CourseEvent[];
}

/**
 * One clause of a schedule description (I18N-DESIGN.md §3.1). The engine emits
 * these instead of prose; `i18n/schedule.ts#renderSchedule` turns them into
 * localized text. Clock times travel as the literal `"HH:MM"` the user
 * entered — they are never localized (SPEC §10a).
 */
export type ScheduleSegment =
  | { kind: "everyHours"; hours: number }
  | { kind: "fromLastDose" }
  | { kind: "firstDose"; time: string } // "08:00" — a clock time, never localized
  | { kind: "weekly" }
  | { kind: "weekday"; isoWeekday: number } // 1 = Mon … 7 = Sun
  | { kind: "weekdays"; isoWeekdays: number[] }
  | { kind: "everyNDays"; days: number }
  | { kind: "timesPerDay"; times: number } // 1 → "once daily", N → "N× daily"
  | { kind: "times"; times: string[] }; // clock times, never localized

/** Segments in render order; the renderer joins them with " · ". */
export interface ScheduleDescription {
  segments: ScheduleSegment[];
}

/** Where a course stands on a given day (I18N-DESIGN.md §3.2). */
export type CourseProgress =
  | { kind: "ongoing" }
  | { kind: "dayOfTotal"; day: number; total: number };
