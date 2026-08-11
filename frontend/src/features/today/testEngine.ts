// A TEST DOUBLE for `@/engine`, used only by slice 5's own test files.
//
// WHY THIS EXISTS. The Today screen consumes the engine; it does not own it.
// W2 (slice 3) owns the real bodies, and on this branch every occurrence /
// dose-state function in `@/engine` is still a typed stub that returns
// `"upcoming"`, `[]` or zeroes. Testing this screen against those stubs would
// assert nothing: no card would ever render. So the tests `vi.mock("@/engine")`
// with the object below and drive it from data the test itself supplies.
//
// WHAT IT DELIBERATELY DOES NOT DO. It contains no scheduling arithmetic: no
// grace windows, no `daysOfWeek`, no interval chains, no clock comparisons. It
// is a lookup table. States come from `stateByKey`, which the test sets; the
// only rule it applies is the one the optimistic-update path must be able to
// observe — an occurrence carrying a live `given`/`skipped` DoseEvent reads
// back as `given`/`skipped`. Production code under `features/today/` imports
// `@/engine` and nothing here.
//
// When W2's real engine lands, tests can drop the `vi.mock` and this file with
// it; nothing in the shipped screen references it.
import type { Course, CourseEvent, DoseEvent, IsoDateTime, LocalDate } from "@/domain";
import { occurrenceKeyFor } from "@/domain";
import type { DoseState, EngineContext, Occurrence } from "@/engine";

interface EngineStore {
  /** What `getOccurrences(day, ctx)` returns, per local day. */
  occurrencesByDay: Map<LocalDate, Occurrence[]>;
  /** What `getDoseState` returns for an occurrence with no live event. */
  stateByKey: Map<string, DoseState>;
  /** Fallback state for a key absent from `stateByKey`. */
  defaultState: DoseState;
  /** What `findMissedOccurrences` returns. */
  missed: Occurrence[];
  /** What `findCoursesToFinish` returns. */
  coursesToFinish: string[];
  /** What `nextDueAt` returns. */
  nextDue: Date | null;
}

export const engineStore: EngineStore = {
  occurrencesByDay: new Map(),
  stateByKey: new Map(),
  defaultState: "later",
  missed: [],
  coursesToFinish: [],
  nextDue: null,
};

export function resetEngineStore(): void {
  engineStore.occurrencesByDay = new Map();
  engineStore.stateByKey = new Map();
  engineStore.defaultState = "later";
  engineStore.missed = [];
  engineStore.coursesToFinish = [];
  engineStore.nextDue = null;
}

/** Registers `occs` as the engine's answer for `day`, and returns them. */
export function setOccurrences(day: LocalDate, occs: Occurrence[]): Occurrence[] {
  engineStore.occurrencesByDay.set(day, occs);
  return occs;
}

export function setState(key: string, state: DoseState): void {
  engineStore.stateByKey.set(key, state);
}

/**
 * Builds an `Occurrence` for a course. `scheduledFor` doubles as `dueAt`, so
 * the key and the due instant can never disagree — the same relationship the
 * real engine maintains for `fixedTimes`.
 */
export function makeOccurrence(
  course: Course,
  opts: {
    day: LocalDate;
    scheduledFor: IsoDateTime | null;
    event?: DoseEvent | null;
    graceMinutes?: number;
  },
): Occurrence {
  return {
    key: occurrenceKeyFor(course.id, opts.scheduledFor),
    courseId: course.id,
    petId: course.petId,
    medicationId: course.medicationId,
    kind: course.schedule.kind,
    day: opts.day,
    dueAt: opts.scheduledFor === null ? null : new Date(opts.scheduledFor),
    graceMinutes: opts.graceMinutes ?? (course.schedule.kind === "fixedTimes" ? 60 : 90),
    doseAmount: course.doseAmount,
    doseUnit: course.doseUnit,
    instructions: course.instructions,
    event: opts.event ?? null,
  };
}

function doseState(occurrence: Occurrence): DoseState {
  const event = occurrence.event;
  if (event && event.deletedAt === null) {
    if (event.status === "given") return "given";
    if (event.status === "skipped") return "skipped";
    // A `missed` event resolves the occurrence without it being pending;
    // `upcoming` is the engine's "not shown on the dashboard" state.
    return "upcoming";
  }
  return engineStore.stateByKey.get(occurrence.key) ?? engineStore.defaultState;
}

const PENDING: ReadonlySet<DoseState> = new Set<DoseState>(["overdue", "due", "later"]);

export const engineDouble = {
  getOccurrences(date: LocalDate, _ctx: EngineContext): Occurrence[] {
    void _ctx;
    return engineStore.occurrencesByDay.get(date) ?? [];
  },

  getDoseState(occurrence: Occurrence, _now: Date): DoseState {
    void _now;
    return doseState(occurrence);
  },

  nextDueAt(
    _course: Course,
    _events: DoseEvent[],
    _courseEvents: CourseEvent[],
    _after: Date,
  ): Date | null {
    void _course;
    void _events;
    void _courseEvents;
    void _after;
    return engineStore.nextDue;
  },

  findMissedOccurrences(_ctx: EngineContext, _now: Date): Occurrence[] {
    void _ctx;
    void _now;
    return engineStore.missed;
  },

  findCoursesToFinish(_ctx: EngineContext, _now: Date): string[] {
    void _ctx;
    void _now;
    return engineStore.coursesToFinish;
  },

  summariseDay(
    occs: Occurrence[],
    _now: Date,
  ): { remaining: number; overdue: number; earliestOverdue: Occurrence | null } {
    void _now;
    const states = occs.map((o) => [o, doseState(o)] as const);
    const remaining = states.filter(([, s]) => PENDING.has(s)).length;
    const overdueOccs = states
      .filter(([, s]) => s === "overdue")
      .map(([o]) => o)
      .sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0));
    return {
      remaining,
      overdue: overdueOccs.length,
      earliestOverdue: overdueOccs[0] ?? null,
    };
  },
};
