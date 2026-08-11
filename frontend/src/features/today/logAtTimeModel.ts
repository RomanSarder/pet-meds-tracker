// The pure model behind SPEC §6.1a "Log at a different time".
//
// PURITY RULE — the same one `todayModel.ts` states. Everything here is a pure
// function of its arguments. No React, no `now()` read (every function that
// needs the current instant takes `now: Date`), no locale lookup, and no
// scheduling semantics of its own: the chain-shift answer comes from
// `nextDueAt` in `@/engine`, never from arithmetic written here. SPEC §10 —
// slice 5 consumes the engine and must not reimplement it.
//
// WORDING RULE. Nothing in this file is user-facing text. It returns instants,
// durations in minutes and discriminators; the sheet resolves every one of them
// through the catalogue.
//
// TIME ARITHMETIC — the load-bearing part, carried across from the dialog this
// sheet replaces. The upstream design mock keeps the chosen time as
// minutes-since-midnight; that representation does not survive the port,
// because on a DST-shift day "midnight + N minutes" and "N minutes ago" are
// different quantities. So the chosen time is always a `Date`, and the only
// integer anywhere is a DURATION in minutes. Two kinds of instant, two
// constructions, exactly as the repo already draws the line:
//
//   - The floor is a WALL-CLOCK instant: local midnight today, via
//     `startOfLocalDay`, which goes through the `new Date(y, m, d)`
//     constructor. `LogAtTimeDialog.tsx` made the same point about
//     `atLocalTime` — that constructor is what makes SPEC §3d's "on DST
//     shifts, `fixedTimes` keeps the wall-clock time" true for free. It is the
//     only way midnight is computed in this file; no boundary is ever built by
//     hand, and nothing here parses a string into an instant (the old dialog's
//     `atLocalTime`/`parseHHMM` path is gone — there is no time field to parse).
//
//   - Every offset and every stepper move is ELAPSED MILLISECONDS off an
//     existing instant — `now − minutes * 60_000` — never a wall-clock
//     reconstruction. `occurrences.ts` states the same rule for `fromLastDose`
//     ("elapsed-millisecond arithmetic, never wall-clock reconstruction"), and
//     for the same reason: "30 minutes ago" means 30 real minutes, including on
//     the day the clocks move.
//
// The two meet only at the clamp, which compares instants — so on the
// spring-forward day the window [midnight, now] is genuinely one hour shorter
// in elapsed time than the wall clock suggests, and the clamp is what keeps
// every offset inside it.
import type { Course, CourseEvent, DoseEvent } from "@/domain";
import { occurrenceKeyFor, parseLocalDay, startOfLocalDay } from "@/domain";
import type { Occurrence } from "@/engine";
import { nextDueAt } from "@/engine";

/** The relative-offset chip row (SPEC §6.1a): *Just now*, *15 min*, *30 min*, *1 h*, *2 h*. */
export const OFFSET_CHOICES_MIN = [0, 15, 30, 60, 120] as const;

/** Selected when the sheet opens (SPEC §6.1a: "the default is 30 minutes ago"). */
export const DEFAULT_OFFSET_MIN = 30;

/** The `− 5 min` / `+ 5 min` stepper's granularity. */
export const STEP_MIN = 5;

/**
 * SPEC §6.1a's "day-check warning more than 12 h before the scheduled time".
 *
 * Module-local ON PURPOSE. This is NOT `MISSED_AFTER_HOURS` from
 * `domain/constants.ts`: that one is the sweep's "a fixedTimes occurrence more
 * than 12 hours past due is written as `missed`" threshold (SPEC §4), measured
 * forward from the due time over the whole log. This one is measured backward
 * from the due time over a single sheet interaction, and asks a different
 * question — "did you mean yesterday?". They happen to share the number 12;
 * reusing the constant would couple two unrelated product rules so that
 * retuning either silently moves the other.
 */
export const DAY_CHECK_HOURS = 12;

const MS_PER_MIN = 60_000;
const MS_PER_HOUR = 3_600_000;

/**
 * SPEC §4, "scope of a corrected `givenAt`: the current day only" — `givenAt`
 * is constrained to `[00:00 today, now]`. There is no date field and no
 * Today/Yesterday toggle; a dose remembered after midnight is corrected from
 * history instead.
 *
 * Both ends are fresh `Date`s: `now` belongs to the caller and is never
 * aliased into a value the sheet might hold across a re-render.
 */
export function boundsFor(now: Date): { floor: Date; ceiling: Date } {
  return { floor: startOfLocalDay(now), ceiling: new Date(now.getTime()) };
}

function clamp(candidate: number, now: Date): Date {
  const { floor, ceiling } = boundsFor(now);
  if (candidate < floor.getTime()) return floor;
  if (candidate > ceiling.getTime()) return ceiling;
  return new Date(candidate);
}

/** `minutes` ago, clamped into `[midnight today, now]`. `0` is *Just now*. */
export function atOffset(minutes: number, now: Date): Date {
  return clamp(now.getTime() - minutes * MS_PER_MIN, now);
}

/** One stepper press: `current ± deltaMin`, clamped into `[midnight today, now]`. */
export function stepBy(current: Date, deltaMin: number, now: Date): Date {
  return clamp(current.getTime() + deltaMin * MS_PER_MIN, now);
}

/**
 * The "At its scheduled time" row's value (SPEC §6.1a) — the occurrence's due
 * instant, by value and DELIBERATELY UNCLAMPED.
 *
 * Returning a future `dueAt` untouched is product-approved: §6.1a says the
 * headline "turns berry if the value is in the future" and the footer is
 * "disabled for a future time". Clamping here would make both of those
 * behaviours unreachable. `canConfirm` is the single gate that upholds SPEC
 * §12's "the corrected-time picker cannot produce a `givenAt` in the future or
 * before 00:00 today" — this function is a value, not a gate.
 *
 * `null` in two cases:
 *   - `dueAt === null`: an unanchored `fromLastDose` chain with no
 *     `anchorTime` has no scheduled time to offer.
 *   - `dueAt` before midnight of the occurrence's own local day: a
 *     cross-midnight occurrence, which SPEC §4 pushes to history rather than
 *     this sheet. `occurrence.day` is "the local day it was SCHEDULED FOR", so
 *     for any row this sheet can be opened from it is today, and
 *     `parseLocalDay(occurrence.day)` is the same instant `boundsFor(now).floor`
 *     returns — which is why the signature needs no `now` to make the check.
 */
export function scheduledChoice(occurrence: Occurrence): Date | null {
  const dueAt = occurrence.dueAt;
  if (dueAt === null) return null;
  if (dueAt.getTime() < parseLocalDay(occurrence.day).getTime()) return null;
  return new Date(dueAt.getTime());
}

export function canStepEarlier(current: Date, now: Date): boolean {
  return current.getTime() > boundsFor(now).floor.getTime();
}

export function canStepLater(current: Date, now: Date): boolean {
  return current.getTime() < now.getTime();
}

/**
 * `candidate` sits before today's floor — i.e. it belongs to a day this sheet
 * cannot log into (SPEC §4, "the current day only").
 *
 * Exists because the floor MOVES while the sheet is open: a sheet left up
 * across local midnight sees `boundsFor(now).floor` advance a whole day while
 * `chosen` — and the occurrence's own `dueAt` — stay where they were. The view
 * needs to detect exactly that, and detecting it by comparing instants in the
 * view would put scheduling arithmetic back into the component. Note this is
 * NOT the negation of `canConfirm`: a FUTURE value is un-confirmable but not
 * below the floor, and the sheet treats those two cases differently (the
 * future one is offered with a berry headline; this one is withdrawn).
 */
export function isBelowFloor(candidate: Date, now: Date): boolean {
  return candidate.getTime() < boundsFor(now).floor.getTime();
}

/** SPEC §12's invariant, as one predicate: `00:00 today <= chosen <= now`. */
export function canConfirm(chosen: Date, now: Date): boolean {
  const { floor, ceiling } = boundsFor(now);
  const t = chosen.getTime();
  return t >= floor.getTime() && t <= ceiling.getTime();
}

/**
 * The `today · <N> ago` clause beside the headline. Floors to whole minutes —
 * a partial minute is never rounded up into one — and never goes negative: a
 * future `chosen` reads as `{0, 0}`, since "in −5 minutes" is not a thing the
 * sheet says (the berry headline and the disabled footer carry that instead).
 */
export function elapsedSince(chosen: Date, now: Date): { hours: number; minutes: number } {
  const elapsedMs = Math.max(0, now.getTime() - chosen.getTime());
  const totalMinutes = Math.floor(elapsedMs / MS_PER_MIN);
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

/**
 * The helper line under the stepper — "carries the active constraint" (SPEC
 * §6.1a), so exactly one fires, in this precedence:
 *
 *   1. `futureCap`  — "A dose cannot be logged in the future."
 *   2. `dayCheck`   — the "did you mean yesterday?" warning
 *   3. `range`      — "Anything from midnight today. Earlier doses are added
 *                     from history."
 *
 * `dayCheck` needs a STRICTLY greater gap than `DAY_CHECK_HOURS`: exactly 12 h
 * before the scheduled time is not a day-check. `hours` is the gap floored to
 * whole hours, so the copy reads "more than N h" truthfully rather than
 * rounding a 12 h 40 m gap up to 13.
 */
export function helperFor(
  chosen: Date,
  scheduledAt: Date | null,
  now: Date,
):
  | { kind: "futureCap" }
  | { kind: "dayCheck"; hours: number }
  | { kind: "range" } {
  if (chosen.getTime() >= now.getTime()) return { kind: "futureCap" };
  if (scheduledAt !== null) {
    const gapMs = scheduledAt.getTime() - chosen.getTime();
    if (gapMs > DAY_CHECK_HOURS * MS_PER_HOUR) {
      return { kind: "dayCheck", hours: Math.floor(gapMs / MS_PER_HOUR) };
    }
  }
  return { kind: "range" };
}

/** Never reaches the log; only `nextDueAt` ever sees it. */
const SYNTHETIC_EVENT_ID = "log-at-time-hypothetical";
const SYNTHETIC_ACTOR_ID = "log-at-time-hypothetical-actor";

/**
 * The `given` DoseEvent the sheet WOULD write, so `nextDueAt` can answer what
 * the chain does afterwards.
 *
 * `anchorFor` is not exported and the `@/engine` barrel's export list is
 * frozen, so there is no way to ask "where would the anchor land" directly.
 * Composing the hypothetical event and asking the real `nextDueAt` is the
 * whole trick — and it means the sheet's preview and the post-write reality
 * are computed by the same function, so they cannot drift.
 *
 * `anchorFor` reads only `courseId`, `status`, `deletedAt`, `supersedesId` and
 * `givenAt`, but the event is built complete and valid anyway: a partial one
 * would silently become wrong the day the engine reads one more field.
 */
function syntheticGiven(course: Course, occurrence: Occurrence, at: Date): DoseEvent {
  const iso = at.toISOString();
  const scheduledFor = occurrence.dueAt === null ? null : occurrence.dueAt.toISOString();
  return {
    id: SYNTHETIC_EVENT_ID,
    courseId: course.id,
    scheduledFor,
    status: "given",
    loggedAt: iso,
    givenAt: iso,
    amount: course.doseAmount,
    note: null,
    occurrenceKey: occurrenceKeyFor(course.id, scheduledFor),
    supersedesId: null,
    actorId: SYNTHETIC_ACTOR_ID,
    createdAt: iso,
    updatedAt: iso,
    deletedAt: null,
  };
}

/**
 * Whole minutes late, or `null` when there is nothing to be late for.
 *
 * `null` covers "no scheduled time" AND "not actually late" — given early, or
 * given less than a whole minute past due. The view uses it as the drop signal
 * for the "Given N min late" note, and "Given 0 min late" is not a sentence
 * worth rendering, so a non-null value here always means a real, positive
 * lateness.
 *
 * MIRRORS HISTORY EXACTLY, and must keep doing so. The sheet's consequence
 * card promises `History will read "Given N min late"`, resolved through the
 * very same `history.detail.givenLate` key — so this has to agree with
 * `features/history/logModel.ts` on the SAME persisted instant, not merely be
 * defensible on its own. That file draws the line in two places, both copied
 * here: `buildDoseEntry` only calls a dose late at `diff >= 60_000`, and
 * `lateParts` then ROUNDS (`Math.round`) rather than flooring. `chosen` comes
 * off a real sub-minute clock read, so flooring here disagreed with History by
 * a whole minute whenever the leftover seconds passed 30 — the sheet promised
 * "41 min late" and History rendered "42 min".
 */
function lateMinutes(chosen: Date, dueAt: Date | null): number | null {
  if (dueAt === null) return null;
  const lateMs = chosen.getTime() - dueAt.getTime();
  if (lateMs < MS_PER_MIN) return null;
  return Math.round(lateMs / MS_PER_MIN);
}

/**
 * SPEC §6.1a's consequence block: what the entered time does to the schedule,
 * stated before committing.
 *
 *   `moves` — `fromLastDose`, and the chain actually shifts. "Next dose moves
 *             to HH:MM". `deltaMin` is the signed shift against the planned
 *             time; `0` is the "there is no planned time to compare against"
 *             sentinel (an unanchored chain being started by this very log),
 *             which §6.1a allows for — it names the delta only "when there is
 *             one". A real zero shift can never appear here, because it is
 *             routed to `stays` below.
 *   `stays` — `fixedTimes` ("missing a dose does not shift later doses",
 *             §3a), and also a `fromLastDose` chain whose anchor this log does
 *             not touch. "Next dose stays at HH:MM".
 *   `none`  — the engine has no next due instant at all.
 *
 * WHY A `fromLastDose` COURSE CAN "STAY". `anchorFor` takes the NEWEST live
 * `given` event. If the course already has one later than `chosen`, this write
 * does not become the anchor and the chain does not move — `nextDueAt` still
 * returns the truthful instant, but calling it "moves" would be a lie. Zero
 * delta is therefore reported as `stays`, which is also exactly what makes
 * SPEC §12's "at its scheduled time … stays on its planned grid" read
 * correctly: logging at the due time reproduces the planned grid instant.
 *
 * `nextDueAt` genuinely returns `null` for a paused, stopped, finished or
 * deleted course, for a `fixedTimes` course past its `endDate`, for a
 * candidate outside `[startDate, endDate]`, and for an unanchored chain with
 * no `anchorTime`. Every one of those is `none`.
 */
export function consequenceFor(args: {
  course: Course;
  events: DoseEvent[];
  courseEvents: CourseEvent[];
  occurrence: Occurrence;
  chosen: Date;
}):
  | { kind: "moves"; next: Date; deltaMin: number }
  | { kind: "stays"; next: Date; lateMin: number | null }
  | { kind: "none" } {
  const { course, events, courseEvents, occurrence, chosen } = args;
  const dueAt = occurrence.dueAt;

  if (course.schedule.kind === "fixedTimes") {
    // Anchored on `dueAt`, not on `chosen`, and computed from the REAL events:
    // a fixedTimes grid is generated from the calendar alone, so the answer
    // must be invariant under what the user picks. That invariance is the
    // whole point the "stays" wording is making — if this took `chosen`, the
    // preview would wobble as the stepper moved while claiming nothing moves.
    const next = nextDueAt(course, events, courseEvents, dueAt ?? chosen);
    if (next === null) return { kind: "none" };
    return { kind: "stays", next, lateMin: lateMinutes(chosen, dueAt) };
  }

  // `after = chosen`, NOT `now`. `nextDueAt`'s interval branch returns null
  // when the candidate is not strictly after `after`, so for an overdue chain
  // — the exact case this sheet exists to serve — `after = now` would report
  // "no next dose" for a chain that plainly has one.
  const next = nextDueAt(
    course,
    [...events, syntheticGiven(course, occurrence, chosen)],
    courseEvents,
    chosen,
  );
  if (next === null) return { kind: "none" };

  const planned =
    dueAt === null
      ? null
      : nextDueAt(
          course,
          [...events, syntheticGiven(course, occurrence, dueAt)],
          courseEvents,
          dueAt,
        );
  const deltaMin =
    planned === null ? null : Math.round((next.getTime() - planned.getTime()) / MS_PER_MIN);

  if (deltaMin === 0) return { kind: "stays", next, lateMin: lateMinutes(chosen, dueAt) };
  return { kind: "moves", next, deltaMin: deltaMin ?? 0 };
}
