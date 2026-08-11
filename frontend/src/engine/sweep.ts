// The daily sweep (SPEC §4, §3c) — read-only candidate finders. The engine
// never writes DoseEvents or mutates Course.status; the caller (W1's
// recordMissed / finishCourse) acts on what these return.
import type { Course, CourseEvent, DoseEvent, LocalDate } from "@/domain";
import {
  addLocalDays,
  atLocalTime,
  differenceInLocalDays,
  localDayKey,
  MISSED_AFTER_HOURS,
} from "@/domain";
import type { EngineContext, Occurrence } from "./engine.types";
import { anchorFor, fromLastDoseDueAt, getOccurrences, inWindow } from "./occurrences";

const MAX_LOOKAHEAD_DAYS = 366;
const DEFAULT_LOOKBACK_DAYS = 7;

/** The first due instant strictly after `after` for this one course, or `null`. */
export function nextDueAt(
  course: Course,
  events: DoseEvent[],
  courseEvents: CourseEvent[],
  after: Date,
): Date | null {
  if (course.deletedAt !== null || course.status !== "active") return null;

  if (course.schedule.kind === "fixedTimes") {
    // Applies the IDENTICAL forward-only per-slot rule as `getOccurrences`
    // (SPEC §3c) by literally calling it, rather than re-deriving the
    // schedule-timeline logic here — this is what keeps the corrected-time
    // sheet's "next dose stays at HH:MM" preview
    // (features/today/logAtTimeModel.ts) from ever drifting off the real
    // grid on a schedule-edit transition day.
    const ctx: EngineContext = { courses: [course], events, courseEvents };
    let day: LocalDate = localDayKey(after);
    for (let i = 0; i < MAX_LOOKAHEAD_DAYS; i++) {
      if (course.endDate !== null && differenceInLocalDays(day, course.endDate) > 0) break;
      for (const occ of getOccurrences(day, ctx)) {
        if (occ.dueAt !== null && occ.dueAt.getTime() > after.getTime()) return occ.dueAt;
      }
      day = addLocalDays(day, 1);
    }
    return null;
  }

  const schedule = course.schedule;
  const anchor = anchorFor(course, events);
  if (anchor !== null) {
    // An overdue chain has no *future* due instant — nothing after it is
    // scheduled. `fromLastDoseDueAt` folds in SPEC §3b-i's optional cap the
    // same way `occurrences.ts#fromLastDoseOccurrences` does, so a capped
    // course's "next due" (e.g. the history detail line's "next due HH:MM")
    // never disagrees with what Today would actually show.
    const candidate = fromLastDoseDueAt(course, schedule, anchor, events);
    const day = localDayKey(candidate);
    if (candidate.getTime() > after.getTime() && inWindow(day, course)) return candidate;
    return null;
  }

  if (schedule.anchorTime) {
    const anchorTime = schedule.anchorTime;
    let day: LocalDate = localDayKey(after);
    for (let i = 0; i < MAX_LOOKAHEAD_DAYS; i++) {
      if (course.endDate !== null && differenceInLocalDays(day, course.endDate) > 0) break;
      if (inWindow(day, course)) {
        const candidate = atLocalTime(day, anchorTime);
        if (candidate.getTime() > after.getTime()) return candidate;
      }
      day = addLocalDays(day, 1);
    }
  }
  return null;
}

/**
 * SPEC §4 sweep candidates: `fixedTimes` occurrences more than 12h past due
 * with no live event. Interval (`fromLastDose`) courses are never swept — a
 * chain can be late but cannot be "missed", since nothing after it is
 * scheduled. Returns candidates only; the engine writes nothing.
 */
export function findMissedOccurrences(
  ctx: EngineContext,
  now: Date,
  opts?: { lookbackDays?: number },
): Occurrence[] {
  // Clamp to 0: a negative lookback would put startDay in the future, so the
  // walk below would head away from nowDay and its `day === nowDay` guard
  // would never fire — an unbounded forward walk that never reaches nowDay.
  const lookbackDays = Math.max(0, opts?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS);
  const nowDay = localDayKey(now);
  const startDay = addLocalDays(nowDay, -lookbackDays);
  const missedAfterMs = MISSED_AFTER_HOURS * 3_600_000;
  const results: Occurrence[] = [];

  let day = startDay;
  for (;;) {
    for (const occ of getOccurrences(day, ctx)) {
      if (
        occ.kind === "fixedTimes" &&
        occ.event === null &&
        occ.dueAt !== null &&
        now.getTime() > occ.dueAt.getTime() + missedAfterMs
      ) {
        results.push(occ);
      }
    }
    if (day === nowDay) break;
    day = addLocalDays(day, 1);
  }

  return results.sort((a, b) => (a.dueAt as Date).getTime() - (b.dueAt as Date).getTime());
}

/** Ids of active courses whose `endDate` is fully in the past (SPEC §3c). */
export function findCoursesToFinish(ctx: EngineContext, now: Date): string[] {
  const nowDay = localDayKey(now);
  const ids: string[] = [];
  for (const course of ctx.courses) {
    if (course.deletedAt !== null) continue;
    if (course.status !== "active") continue;
    if (course.endDate === null) continue;
    if (differenceInLocalDays(nowDay, course.endDate) > 0) ids.push(course.id);
  }
  return ids;
}
