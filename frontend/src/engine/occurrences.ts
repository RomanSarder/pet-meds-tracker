// Occurrence generation (SPEC §3) — the calendar/log join that produces one
// Occurrence per scheduled dose for a given local day. Generation is a pure
// function of the calendar for `fixedTimes` (missing a dose never shifts a
// later one) and of elapsed milliseconds since the anchor for `fromLastDose`
// (SPEC §3d). Neither kind consults `now` — the caller derives state later.
import type { Course, DoseEvent, IsoWeekday, LocalDate } from "@/domain";
import {
  atLocalTime,
  differenceInLocalDays,
  GRACE_FIXED_MIN,
  GRACE_INTERVAL_MIN,
  localDayKey,
  occurrenceKeyFor,
  parseLocalDay,
} from "@/domain";
import type { EngineContext, Occurrence } from "./engine.types";

/** ISO weekday, 1 = Monday … 7 = Sunday. NOT JS `Date#getDay()` (0 = Sunday). */
export function isoWeekdayOf(day: LocalDate): IsoWeekday {
  return (((parseLocalDay(day).getDay() + 6) % 7) + 1) as IsoWeekday;
}

function isSuperseded(eventId: string, events: DoseEvent[]): boolean {
  return events.some((e) => e.deletedAt === null && e.supersedesId === eventId);
}

function compareEvents(a: DoseEvent, b: DoseEvent): number {
  if (a.loggedAt !== b.loggedAt) return a.loggedAt < b.loggedAt ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The live DoseEvent for an occurrence key: newest non-deleted,
 * non-superseded event for that key, or `null` when nothing is logged.
 */
export function liveEventFor(key: string, events: DoseEvent[]): DoseEvent | null {
  const candidates = events.filter(
    (e) => e.deletedAt === null && e.occurrenceKey === key && !isSuperseded(e.id, events),
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((newest, e) => (compareEvents(e, newest) > 0 ? e : newest));
}

/** A course generates occurrences only while it is live and active (SPEC §3c). */
export function isGenerable(course: Course): boolean {
  return course.deletedAt === null && course.status === "active";
}

/** Whether `day` falls within [startDate, endDate] (`endDate === null` ⇒ open-ended). */
export function inWindow(day: LocalDate, course: Course): boolean {
  if (differenceInLocalDays(day, course.startDate) < 0) return false;
  if (course.endDate !== null && differenceInLocalDays(day, course.endDate) > 0) return false;
  return true;
}

/**
 * Whether a `fixedTimes` course fires on `day` at all: window + daysOfWeek +
 * everyNDays. No notion of active/deleted here — callers (getOccurrences,
 * nextDueAt) check that separately, and this is the one place the
 * eligibility test is written so both stay in lockstep.
 */
export function fixedTimesDayEligible(day: LocalDate, course: Course): boolean {
  const schedule = course.schedule;
  if (schedule.kind !== "fixedTimes") return false;
  if (!inWindow(day, course)) return false;
  if (schedule.daysOfWeek && schedule.daysOfWeek.length > 0) {
    if (!schedule.daysOfWeek.includes(isoWeekdayOf(day))) return false;
  }
  if (schedule.everyNDays && schedule.everyNDays > 1) {
    if (differenceInLocalDays(day, course.startDate) % schedule.everyNDays !== 0) return false;
  }
  return true;
}

/**
 * The anchor instant for a `fromLastDose` chain: the later of the newest
 * live (non-deleted, non-superseded) `given` event's `givenAt` and
 * `course.resumedAt`, whichever exist. `null` when the chain has never
 * started (SPEC §3b) — `skipped`/`missed` events never anchor it.
 */
export function anchorFor(course: Course, events: DoseEvent[]): Date | null {
  let newestGivenAt: Date | null = null;
  for (const e of events) {
    if (e.courseId !== course.id || e.status !== "given" || e.deletedAt !== null) continue;
    if (isSuperseded(e.id, events)) continue;
    const givenAt = new Date(e.givenAt);
    if (newestGivenAt === null || givenAt.getTime() > newestGivenAt.getTime()) {
      newestGivenAt = givenAt;
    }
  }
  const resumedAt = course.resumedAt !== null ? new Date(course.resumedAt) : null;
  if (newestGivenAt === null) return resumedAt;
  if (resumedAt === null) return newestGivenAt;
  return newestGivenAt.getTime() >= resumedAt.getTime() ? newestGivenAt : resumedAt;
}

function fixedTimesOccurrences(day: LocalDate, course: Course, events: DoseEvent[]): Occurrence[] {
  const schedule = course.schedule;
  if (schedule.kind !== "fixedTimes") return [];
  if (!isGenerable(course) || !fixedTimesDayEligible(day, course)) return [];
  return schedule.times.map((t) => {
    const dueAt = atLocalTime(day, t);
    const scheduledFor = dueAt.toISOString();
    const key = occurrenceKeyFor(course.id, scheduledFor);
    return {
      key,
      courseId: course.id,
      petId: course.petId,
      medicationId: course.medicationId,
      kind: "fixedTimes",
      day,
      dueAt,
      graceMinutes: GRACE_FIXED_MIN,
      doseAmount: course.doseAmount,
      doseUnit: course.doseUnit,
      instructions: course.instructions,
      event: liveEventFor(key, events),
    };
  });
}

function fromLastDoseOccurrences(day: LocalDate, course: Course, events: DoseEvent[]): Occurrence[] {
  const schedule = course.schedule;
  if (schedule.kind !== "fromLastDose") return [];
  if (!isGenerable(course) || !inWindow(day, course)) return [];

  const anchor = anchorFor(course, events);
  if (anchor === null) {
    // Chain never started: emitted on every requested day. `event` is
    // deliberately null here even if a skip carries the `|-` key — binding
    // a one-off event to this occurrence would smear it across every day.
    const key = occurrenceKeyFor(course.id, null);
    const dueAt = schedule.anchorTime ? atLocalTime(day, schedule.anchorTime) : null;
    return [
      {
        key,
        courseId: course.id,
        petId: course.petId,
        medicationId: course.medicationId,
        kind: "fromLastDose",
        day,
        dueAt,
        graceMinutes: GRACE_INTERVAL_MIN,
        doseAmount: course.doseAmount,
        doseUnit: course.doseUnit,
        instructions: course.instructions,
        event: null,
      },
    ];
  }

  // Elapsed-millisecond arithmetic (SPEC §3d) — never wall-clock reconstruction.
  const dueAt = new Date(anchor.getTime() + schedule.intervalHours * 3_600_000);
  if (localDayKey(dueAt) !== day) return [];
  const scheduledFor = dueAt.toISOString();
  const key = occurrenceKeyFor(course.id, scheduledFor);
  return [
    {
      key,
      courseId: course.id,
      petId: course.petId,
      medicationId: course.medicationId,
      kind: "fromLastDose",
      day,
      dueAt,
      graceMinutes: GRACE_INTERVAL_MIN,
      doseAmount: course.doseAmount,
      doseUnit: course.doseUnit,
      instructions: course.instructions,
      event: liveEventFor(key, events),
    },
  ];
}

function keyOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * All occurrences scheduled for `date` across every course (SPEC §3), sorted
 * by `dueAt` ascending with `dueAt === null` last, tie-broken by `key`.
 */
export function getOccurrences(date: LocalDate, ctx: EngineContext): Occurrence[] {
  const occurrences: Occurrence[] = [];
  for (const course of ctx.courses) {
    if (course.schedule.kind === "fixedTimes") {
      occurrences.push(...fixedTimesOccurrences(date, course, ctx.events));
    } else {
      occurrences.push(...fromLastDoseOccurrences(date, course, ctx.events));
    }
  }
  return occurrences.sort((a, b) => {
    if (a.dueAt === null && b.dueAt === null) return keyOrder(a.key, b.key);
    if (a.dueAt === null) return 1;
    if (b.dueAt === null) return -1;
    const diff = a.dueAt.getTime() - b.dueAt.getTime();
    return diff !== 0 ? diff : keyOrder(a.key, b.key);
  });
}
