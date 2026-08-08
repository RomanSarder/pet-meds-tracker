// The scheduling engine. On this branch (W0), `describeSchedule` and
// `courseProgress` are fully implemented — they are pure formatting with no
// occurrence-generation semantics. Every other function is a typed stub:
// signature-correct, side-effect-free, and marked
// `// W2 (slice 3) owns the real implementation` so nobody mistakes a stub
// for finished work.
//
// PURITY RULE: the engine never calls `now()` / `new Date()` with no
// argument — every function that needs the current time takes `now: Date`
// as an explicit parameter, and every function here was checked against
// that rule before this file was returned as done.
import type { Course, LocalDate, Schedule } from "@/domain";
import { atLocalTime, differenceInLocalDays, GRACE_FIXED_MIN, occurrenceKeyFor } from "@/domain";
import type { DoseState, EngineContext, Occurrence } from "./engine.types";

export type { DoseState, Occurrence, EngineContext } from "./engine.types";

const ISO_WEEKDAY_NAMES: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  7: "Sun",
};

/** Fully implemented — pure formatting, no scheduling semantics. */
export function describeSchedule(s: Schedule): string {
  if (s.kind === "fixedTimes") {
    const parts = [`At ${s.times.join(", ")}`];
    if (s.daysOfWeek && s.daysOfWeek.length > 0) {
      parts.push(`on ${s.daysOfWeek.map((d) => ISO_WEEKDAY_NAMES[d]).join(", ")}`);
    }
    if (s.everyNDays && s.everyNDays > 1) {
      parts.push(`every ${s.everyNDays} days`);
    }
    return parts.join(", ");
  }
  // fromLastDose — SPEC §3b: every rendered detail line for this kind must
  // carry the literal phrase "from last dose".
  const anchor = s.anchorTime ? `, first dose ${s.anchorTime}` : "";
  return `Every ${s.intervalHours} hours from last dose${anchor}`;
}

/**
 * Fully implemented — pure formatting.
 *
 * Convention chosen (brief §7 item 8 does not apply here: this function's
 * signature carries no `DoseEvent[]`, so the "events logged today + 1 if a
 * live occurrence is due today" count cannot be computed from `Course` and
 * `LocalDate` alone). `fixedTimes` courses use SPEC's "day 3 of 7" style,
 * computed from `startDate`/`endDate`. `fromLastDose` courses get a
 * sensible non-numeric string instead of a fabricated count.
 */
export function courseProgress(c: Course, day: LocalDate): string {
  if (c.schedule.kind === "fromLastDose") {
    return "Ongoing — from last dose";
  }
  const dayIndex = differenceInLocalDays(day, c.startDate) + 1;
  if (c.endDate) {
    const total = differenceInLocalDays(c.endDate, c.startDate) + 1;
    return `Day ${dayIndex} of ${total}`;
  }
  return `Day ${dayIndex}`;
}

/**
 * Naive `fixedTimes`-only stub: one occurrence per configured time per
 * active `fixedTimes` course, ignoring `daysOfWeek`/`everyNDays` filtering
 * and generating nothing for `fromLastDose` courses.
 */
export function getOccurrences(date: LocalDate, ctx: EngineContext): Occurrence[] {
  // W2 (slice 3) owns the real implementation
  const occurrences: Occurrence[] = [];
  for (const course of ctx.courses) {
    if (course.status !== "active" || course.schedule.kind !== "fixedTimes") continue;
    for (const time of course.schedule.times) {
      const dueAt = atLocalTime(date, time);
      const scheduledFor = dueAt.toISOString();
      const key = occurrenceKeyFor(course.id, scheduledFor);
      const event = ctx.events.find((e) => e.occurrenceKey === key && e.deletedAt === null) ?? null;
      occurrences.push({
        key,
        courseId: course.id,
        petId: course.petId,
        medicationId: course.medicationId,
        kind: "fixedTimes",
        day: date,
        dueAt,
        graceMinutes: GRACE_FIXED_MIN,
        doseAmount: course.doseAmount,
        doseUnit: course.doseUnit,
        instructions: course.instructions,
        event,
      });
    }
  }
  return occurrences;
}

export function getDoseState(occurrence: Occurrence, now: Date): DoseState {
  // W2 (slice 3) owns the real implementation
  void occurrence;
  void now;
  return "upcoming";
}

export function nextDueAt(
  course: Course,
  events: EngineContext["events"],
  after: Date,
): Date | null {
  // W2 (slice 3) owns the real implementation
  void course;
  void events;
  void after;
  return null;
}

export function findMissedOccurrences(
  ctx: EngineContext,
  now: Date,
  opts?: { lookbackDays?: number },
): Occurrence[] {
  // W2 (slice 3) owns the real implementation
  void ctx;
  void now;
  void opts;
  return [];
}

export function findCoursesToFinish(ctx: EngineContext, now: Date): string[] {
  // W2 (slice 3) owns the real implementation
  void ctx;
  void now;
  return [];
}

export function summariseDay(
  occs: Occurrence[],
  now: Date,
): { remaining: number; overdue: number; earliestOverdue: Occurrence | null } {
  // W2 (slice 3) owns the real implementation
  void occs;
  void now;
  return { remaining: 0, overdue: 0, earliestOverdue: null };
}
