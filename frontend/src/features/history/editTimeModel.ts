// The pure model behind "Edit time" on a past dose (SPEC §4's "a dose
// remembered after midnight is corrected from history instead", and §9's
// "corrections are new rows referencing the original").
//
// PURITY RULE — the same one `logAtTimeModel.ts` states, and for the same
// reason. Everything here is a pure function of its arguments: no React, no
// `now()` read (every function that needs the current instant takes
// `now: Date`), no locale lookup, and no scheduling semantics of its own. The
// question "does this edit move anything?" is answered by `nextDueAt` in
// `@/engine`, never by arithmetic written here.
//
// THE PRODUCT RULE THIS FILE ENCODES. Editing a past dose's time changes that
// entry and nothing else — UNLESS the dose is the last one on a `fromLastDose`
// course, in which case it is the chain's anchor (SPEC §3b: "the next due time
// is `lastGivenAt + intervalHours`") and the chain follows it. Two mechanisms
// hold that up together:
//
//   1. `boundsForEdit` pens the edited time between its neighbouring live
//      `given` doses, so a dose can never be dragged past the one after it.
//      An edit therefore cannot CHANGE which dose is newest, which is exactly
//      what `anchorFor` selects on — so a non-last dose is structurally
//      incapable of shifting the chain, rather than merely unlikely to.
//   2. `consequenceFor` states the outcome before it is committed, computed by
//      diffing the engine's own `nextDueAt` across the hypothetical write.
//      Preview and reality are the same function, so they cannot drift.
//
// TIME ARITHMETIC. Every offset and every stepper move is ELAPSED
// MILLISECONDS off an existing instant, never a wall-clock reconstruction —
// `occurrences.ts` and `logAtTimeModel.ts` both state the rule, and it matters
// here for the same DST reason: "30 minutes earlier" means 30 real minutes.
// The one wall-clock construction is the fallback floor, local midnight of the
// course's `startDate` via `parseLocalDay`.
import type { Course, DoseEvent } from "@/domain";
import { parseLocalDay } from "@/domain";
import { nextDueAt } from "@/engine";

const MS_PER_MIN = 60_000;

/**
 * The relative-offset chip row, in minutes against the dose's ORIGINAL time —
 * not against `now`, which is what the Today sheet's chips measure from. A
 * dose being corrected days later has no useful relationship to the current
 * clock; "half an hour earlier than I recorded" is the actual thought.
 */
export const OFFSET_CHOICES_MIN = [-60, -30, 0, 30, 60] as const;

/** The `− 5 min` / `+ 5 min` stepper's granularity. Matches SPEC §6.1a's picker. */
export const STEP_MIN = 5;

/**
 * The clear space kept between the edited dose and each neighbour.
 *
 * One minute, because that is the resolution the app displays and reasons in:
 * `formatHHMM` renders whole minutes, and history's own "late" test
 * (`logModel.ts#buildDoseEntry`) ignores anything under 60_000 ms. Two doses
 * sharing a displayed minute would make "which of these is the last one?" a
 * question the screen cannot answer, while the engine answers it anyway from
 * sub-minute components the user never sees.
 */
const MIN_GAP_MS = MS_PER_MIN;

export interface EditBounds {
  /** Earliest instant this dose may be moved to, inclusive. */
  floor: Date;
  /** Latest instant this dose may be moved to, inclusive. */
  ceiling: Date;
  /**
   * The live `given` dose immediately before this one, or `null` when this is
   * the course's first. What the helper line names — and the reason `floor` is
   * where it is. NOT equal to `floor`: the floor stands a minute clear of it
   * (see `MIN_GAP_MS`), and the helper must quote the neighbour's real time
   * rather than the boundary derived from it.
   */
  previousAt: Date | null;
  /**
   * The live `given` dose immediately after this one, or `null` when this IS
   * the last dose on its course — the one case where confirming shifts a
   * `fromLastDose` chain, and the case in which `ceiling` is `now`.
   */
  nextAt: Date | null;
}

function isSuperseded(eventId: string, events: DoseEvent[]): boolean {
  return events.some((e) => e.deletedAt === null && e.supersedesId === eventId);
}

/**
 * The live `given` events of one course, oldest first — the same set
 * `anchorFor` in `@/engine` scans, ordered.
 *
 * `given` ONLY, deliberately. A `skipped` or `missed` row never anchors a
 * chain (SPEC §3b), so it is not a boundary an edit has to respect; penning a
 * dose behind one would be an arbitrary restriction with no scheduling
 * meaning behind it.
 *
 * Ties on `givenAt` are broken by `id` so the ordering is total and stable —
 * two doses recorded in the same millisecond must still have a definite
 * "previous" and "next", or the bounds would flicker between renders.
 */
export function liveGivenEvents(courseId: string, events: DoseEvent[]): DoseEvent[] {
  return events
    .filter(
      (e) =>
        e.courseId === courseId &&
        e.status === "given" &&
        e.deletedAt === null &&
        !isSuperseded(e.id, events),
    )
    .sort((a, b) => {
      if (a.givenAt !== b.givenAt) return a.givenAt < b.givenAt ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/**
 * How far this dose may move: strictly between the doses either side of it,
 * and never into the future.
 *
 * With no dose before it, the floor is local midnight of the course's
 * `startDate` — a dose given before its own course began is not a correction,
 * it is a different course. With no dose after it, the ceiling is `now`
 * (SPEC §12: a `givenAt` is never in the future), and this is the last dose,
 * so confirming here is the one edit that can move a `fromLastDose` chain.
 *
 * BOTH ENDS ARE THEN WIDENED TO INCLUDE THE DOSE'S OWN CURRENT TIME. A row
 * whose stored `givenAt` already sits outside the computed window — a chain
 * whose neighbour was itself corrected, an imported backup, a dose logged
 * before its course's `startDate` — must still open on its own value rather
 * than being silently relocated by the act of looking at it.
 */
export function boundsForEdit(
  event: DoseEvent,
  events: DoseEvent[],
  course: Course,
  now: Date,
): EditBounds {
  const ordered = liveGivenEvents(course.id, events);
  const index = ordered.findIndex((e) => e.id === event.id);
  const previous = index > 0 ? ordered[index - 1] : null;
  const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;

  const originalMs = new Date(event.givenAt).getTime();
  const floorMs =
    previous !== null
      ? new Date(previous.givenAt).getTime() + MIN_GAP_MS
      : parseLocalDay(course.startDate).getTime();
  const ceilingMs =
    next !== null ? new Date(next.givenAt).getTime() - MIN_GAP_MS : now.getTime();

  return {
    floor: new Date(Math.min(floorMs, originalMs)),
    ceiling: new Date(Math.max(ceilingMs, originalMs)),
    previousAt: previous !== null ? new Date(previous.givenAt) : null,
    nextAt: next !== null ? new Date(next.givenAt) : null,
  };
}

export function clampToBounds(candidate: Date, bounds: EditBounds): Date {
  const t = candidate.getTime();
  if (t < bounds.floor.getTime()) return new Date(bounds.floor.getTime());
  if (t > bounds.ceiling.getTime()) return new Date(bounds.ceiling.getTime());
  return new Date(t);
}

/** One offset chip: the original time shifted by `deltaMin`, clamped. `0` is *Original*. */
export function atDelta(event: DoseEvent, deltaMin: number, bounds: EditBounds): Date {
  return clampToBounds(new Date(new Date(event.givenAt).getTime() + deltaMin * MS_PER_MIN), bounds);
}

/** One stepper press: `current ± deltaMin`, clamped. */
export function stepBy(current: Date, deltaMin: number, bounds: EditBounds): Date {
  return clampToBounds(new Date(current.getTime() + deltaMin * MS_PER_MIN), bounds);
}

export function canStepEarlier(current: Date, bounds: EditBounds): boolean {
  return current.getTime() > bounds.floor.getTime();
}

export function canStepLater(current: Date, bounds: EditBounds): boolean {
  return current.getTime() < bounds.ceiling.getTime();
}

/**
 * Whether confirming would actually write anything. Whole minutes, because
 * that is the only resolution the sheet lets the user see or express — a
 * sub-minute difference carried over from the original `givenAt`'s seconds is
 * not an edit the user made.
 */
export function hasChange(chosen: Date, event: DoseEvent): boolean {
  const originalMs = new Date(event.givenAt).getTime();
  return Math.abs(chosen.getTime() - originalMs) >= MS_PER_MIN;
}

/** Never reaches the log; only `nextDueAt` ever sees it. */
const SYNTHETIC_EVENT_ID = "edit-dose-time-hypothetical";

/**
 * The correction row `correctDose` WOULD write, so `nextDueAt` can answer what
 * the chain does afterwards.
 *
 * Carries `supersedesId: event.id`, which is the load-bearing field: that is
 * how `anchorFor` learns to ignore the original row and read this one instead.
 * Everything else is copied from the original, exactly as `correctDose` does
 * in both repo implementations — a partial event would silently become wrong
 * the day the engine reads one more field.
 */
function correctedEvent(event: DoseEvent, chosen: Date): DoseEvent {
  const iso = chosen.toISOString();
  return {
    ...event,
    id: SYNTHETIC_EVENT_ID,
    givenAt: iso,
    loggedAt: iso,
    supersedesId: event.id,
    createdAt: iso,
    updatedAt: iso,
    deletedAt: null,
  };
}

/**
 * What the entered time does to the schedule, stated before committing.
 *
 *   `unchanged` — nothing else moves. Every `fixedTimes` dose (SPEC §3a:
 *                 "missing a dose does not shift later doses" — the grid is
 *                 generated from the calendar, so no logged time can move it),
 *                 and any `fromLastDose` dose that is not the chain's anchor.
 *   `moves`     — the last dose on a `fromLastDose` course: the chain counts
 *                 from it, so the next due instant follows the entered time.
 *                 `deltaMin` is the signed shift against where the chain sits
 *                 now; `0` is the "nothing to compare against" sentinel, the
 *                 same one `logAtTimeModel.ts#consequenceFor` uses.
 *
 * Both branches are diffed at the SAME reference instant, one tick before the
 * earlier of the old and new times. `nextDueAt` only returns a candidate
 * strictly after the instant it is passed, so a reference later than either
 * would report `null` for an overdue chain that plainly has a next dose — and
 * a reference that differed between the two calls would manufacture a
 * difference that the edit did not cause.
 */
export function consequenceFor(args: {
  course: Course;
  events: DoseEvent[];
  event: DoseEvent;
  chosen: Date;
}): { kind: "unchanged" } | { kind: "moves"; next: Date; deltaMin: number } {
  const { course, events, event, chosen } = args;

  // Answered structurally rather than by diffing: a fixedTimes grid is a
  // function of the calendar alone, so `nextDueAt` returns the same instant
  // either side of this write by construction.
  if (course.schedule.kind === "fixedTimes") return { kind: "unchanged" };

  const reference = new Date(Math.min(chosen.getTime(), new Date(event.givenAt).getTime()) - 1);
  const before = nextDueAt(course, events, reference);
  const after = nextDueAt(course, [...events, correctedEvent(event, chosen)], reference);

  if (after === null) return { kind: "unchanged" };
  if (before !== null && before.getTime() === after.getTime()) return { kind: "unchanged" };

  const deltaMin =
    before === null ? 0 : Math.round((after.getTime() - before.getTime()) / MS_PER_MIN);
  return { kind: "moves", next: after, deltaMin };
}
