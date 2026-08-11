// Occurrence generation (SPEC §3) — the calendar/log join that produces one
// Occurrence per scheduled dose for a given local day. Generation is a pure
// function of the calendar for `fixedTimes` (missing a dose never shifts a
// later one) and of elapsed milliseconds since the anchor for `fromLastDose`
// (SPEC §3d). Neither kind consults `now` — the caller derives state later.
import type { Course, CourseEvent, DoseEvent, IsoWeekday, LocalDate, LocalTime, Schedule } from "@/domain";
import {
  addLocalDays,
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
 *
 * `schedule` is passed in explicitly rather than read off `course.schedule`
 * — SPEC §3c: a schedule edit is forward-only, so `day`'s daysOfWeek/
 * everyNDays checks must run against the version that GOVERNED `day` (the
 * schedule in effect at its start, from `scheduleTimelineFor`), not
 * whatever the live `course.schedule` happens to be today.
 */
export function fixedTimesDayEligible(day: LocalDate, course: Course, schedule: Schedule): boolean {
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

function compareCourseEventsAsc(a: CourseEvent, b: CourseEvent): boolean {
  if (a.at !== b.at) return a.at < b.at;
  if (a.seq !== b.seq) return a.seq < b.seq;
  return a.id < b.id;
}

/**
 * The earliest of this course's CourseEvents with `at` strictly after `t`,
 * or `null` when none exists — i.e. `t` is at or after the course's last
 * recorded change. Ties broken `(at asc, seq asc, id asc)`, matching §6.4's
 * log order.
 */
function firstCourseEventAfter(
  course: Course,
  courseEvents: CourseEvent[],
  t: Date,
): CourseEvent | null {
  let earliest: CourseEvent | null = null;
  const tMs = t.getTime();
  for (const event of courseEvents) {
    if (event.courseId !== course.id) continue;
    if (new Date(event.at).getTime() <= tMs) continue;
    if (earliest === null || compareCourseEventsAsc(event, earliest)) earliest = event;
  }
  return earliest;
}

/**
 * The schedule `course` had in effect at instant `t` (SPEC §3c), reconstructed
 * from its CourseEvent ledger rather than read live off `course.schedule` —
 * this is what makes an edit forward-only: a day whose occurrences fall
 * before the edit keeps projecting on the version that was live at the
 * time, while a day at or after it sees the new one.
 *
 * The event with the earliest `at` strictly after `t` pins the answer: its
 * `before` snapshot is the schedule still in effect at `t` (a `started`
 * event's `before` is null by construction — there is no earlier version,
 * so its `after` schedule is used instead). When no event lies after `t`,
 * `t` is at or after the course's last recorded change, so the live
 * `course.schedule` is the answer.
 *
 * Not exported from `engine/index.ts` — exercised indirectly through
 * `getOccurrences`.
 */
function scheduleTimelineFor(course: Course, courseEvents: CourseEvent[]): (t: Date) => Schedule {
  return (t: Date): Schedule => {
    const pinning = firstCourseEventAfter(course, courseEvents, t);
    if (pinning === null) return course.schedule;
    return pinning.before !== null ? pinning.before.schedule : pinning.after.schedule;
  };
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

function buildFixedTimesOccurrence(
  day: LocalDate,
  course: Course,
  t: LocalTime,
  events: DoseEvent[],
): Occurrence {
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
}

/**
 * Pairs `oldTimes[i]` with `newTimes[i]` by ARRAY INDEX — never by sorting,
 * never by matching values. INVARIANT: `times` is never re-sorted here.
 * (Contrast `nextDueAt`, which sorts a *copy* of `course.schedule.times`
 * purely to walk candidates chronologically — that sorted copy must never
 * leak into this positional pairing, or slot i would stop meaning "the same
 * slot before and after the edit".)
 *
 * Slot i keeps `oldTimes[i]` while that time had not yet arrived at the
 * moment of the edit; it moves to `newTimes[i]` once it had (SPEC §3c: an
 * occurrence is generated from the schedule in effect at its OWN due
 * instant, not the day's). A slot-count change pairs to the shorter array,
 * then a surplus NEW slot appears once due, and a surplus OLD slot keeps
 * firing until the edit.
 */
function pairFixedTimesAcrossEdit(
  day: LocalDate,
  course: Course,
  events: DoseEvent[],
  oldTimes: LocalTime[],
  newTimes: LocalTime[],
  changedAt: Date,
): Occurrence[] {
  const pairedLength = Math.min(oldTimes.length, newTimes.length);
  const occurrences: Occurrence[] = [];

  for (let i = 0; i < pairedLength; i++) {
    const oldDueAt = atLocalTime(day, oldTimes[i]);
    const t = oldDueAt.getTime() >= changedAt.getTime() ? newTimes[i] : oldTimes[i];
    occurrences.push(buildFixedTimesOccurrence(day, course, t, events));
  }
  for (let i = pairedLength; i < newTimes.length; i++) {
    if (atLocalTime(day, newTimes[i]).getTime() >= changedAt.getTime()) {
      occurrences.push(buildFixedTimesOccurrence(day, course, newTimes[i], events));
    }
  }
  for (let i = pairedLength; i < oldTimes.length; i++) {
    if (atLocalTime(day, oldTimes[i]).getTime() < changedAt.getTime()) {
      occurrences.push(buildFixedTimesOccurrence(day, course, oldTimes[i], events));
    }
  }

  return occurrences;
}

function fixedTimesOccurrences(
  day: LocalDate,
  course: Course,
  events: DoseEvent[],
  courseEvents: CourseEvent[],
): Occurrence[] {
  const liveSchedule = course.schedule;
  if (liveSchedule.kind !== "fixedTimes") return [];
  if (!isGenerable(course)) return [];

  const dayStart = atLocalTime(day, "00:00");
  const nextDayStart = atLocalTime(addLocalDays(day, 1), "00:00");

  // The schedule governing `day` is the version in effect at its start
  // (SPEC §3c) — not the live `course.schedule`, which may already be a
  // later edit that has not reached `day` yet.
  const scheduleAt = scheduleTimelineFor(course, courseEvents);
  const oldSchedule = scheduleAt(dayStart);
  const pinning = firstCourseEventAfter(course, courseEvents, dayStart);
  // Only an edit that lands WITHIN `day` produces a split; one on a later
  // day leaves the whole of `day` on `oldSchedule`.
  const changedAt =
    pinning !== null && new Date(pinning.at).getTime() < nextDayStart.getTime()
      ? new Date(pinning.at)
      : null;
  const newSchedule = changedAt !== null && pinning !== null ? pinning.after.schedule : oldSchedule;

  if (oldSchedule.kind !== "fixedTimes" || newSchedule.kind !== "fixedTimes") {
    // Defensive: this feature only ever shifts fixedTimes clock times, so a
    // recorded edit changing `kind` is not expected. If it ever happened,
    // there is no meaningful per-slot pairing — fall back to the live grid.
    if (!fixedTimesDayEligible(day, course, liveSchedule)) return [];
    return liveSchedule.times.map((t) => buildFixedTimesOccurrence(day, course, t, events));
  }

  if (!fixedTimesDayEligible(day, course, oldSchedule)) return [];

  if (changedAt === null) {
    return oldSchedule.times.map((t) => buildFixedTimesOccurrence(day, course, t, events));
  }

  return pairFixedTimesAcrossEdit(day, course, events, oldSchedule.times, newSchedule.times, changedAt);
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
      occurrences.push(...fixedTimesOccurrences(date, course, ctx.events, ctx.courseEvents));
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
