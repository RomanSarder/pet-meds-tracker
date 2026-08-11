import { GRACE_INTERVAL_CAP_MIN } from "./constants";

/**
 * The cross-occurrence grace window for a `fromLastDose` course, in minutes:
 * half the dose interval, capped at `GRACE_INTERVAL_CAP_MIN`.
 *
 * Why half: the early-give confirm is only reachable while a dose is not yet
 * due, i.e. up to `DUE_PRE_WINDOW_MIN` before `dueAt` — a window of
 * `intervalHours * 60 - DUE_PRE_WINDOW_MIN` minutes after the previous dose.
 * A flat 90-minute grace window made that confirm fire on EVERY early give
 * for a 2h course, because 90 (the old flat grace) equals 120 - 30 (that
 * course's entire not-yet-due window) exactly — there was no early give that
 * didn't collide. Halving the interval keeps the grace window strictly
 * smaller than the not-yet-due window for every interval this app offers
 * (`INTERVAL_CHOICES`, `@/features/courses/scheduleChoice`), so a short
 * interval still has real room for a give that just logs, uninterrupted.
 *
 * The cap is what keeps 4h-and-up intervals byte-identical to the old flat
 * 90: half of 4h (120min) already exceeds the cap, so every offered interval
 * from 4h up lands on the same 90 minutes the flat constant always gave it.
 * Only 2h (half = 60) is actually reduced.
 */
export function intervalGraceMinutes(intervalHours: number): number {
  return Math.min(intervalHours * 30, GRACE_INTERVAL_CAP_MIN);
}
