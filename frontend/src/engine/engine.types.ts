// Engine types — reproduced verbatim from the W0 foundations brief §4. The
// engine itself (frontend/src/engine/index.ts) is a typed stub on this
// branch; W2 (slice 3) writes the real function bodies against these same
// types, so the shapes here are load-bearing for four other branches.
import type { Course, DoseEvent, LocalDate, Schedule } from "@/domain";

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
}
