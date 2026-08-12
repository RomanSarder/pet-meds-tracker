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
  intervalGraceMinutes,
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
 * — SPEC §3c: a schedule edit is forward-only, so a slot's daysOfWeek/
 * everyNDays checks must run against the version that GOVERNED that SLOT
 * (the schedule in effect at its own due instant, from `scheduleTimelineFor`
 * — see `fixedTimesOccurrences`, which calls this once per candidate slot,
 * not once for the whole day), not whatever the live `course.schedule`
 * happens to be today.
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
 * Numeric `(at asc, seq asc, id asc)` comparator for `Array#sort` — same
 * ledger order as `compareCourseEventsAsc`'s single-pair boolean form
 * (kept separate rather than reused, since `firstCourseEventAfter`'s
 * running-earliest scan and `Array#sort` want different shapes).
 */
function courseEventOrder(a: CourseEvent, b: CourseEvent): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The earliest of this course's CourseEvents with `at` strictly after `t`,
 * or `null` when none exists — i.e. `t` is at or after the course's last
 * recorded change. Ties broken `(at asc, seq asc, id asc)`, matching §6.4's
 * log order.
 *
 * Deliberately walks EVERY `CourseEventKind` ("started", "edited", "paused",
 * "resumed", "stopped", "finished"), not just "edited" — every kind carries
 * a full `before`/`after` `CourseSnapshot` (schedule included), so a
 * `paused`/`resumed`/`stopped`/`finished` event pins the schedule timeline
 * exactly as validly as an `edited` one, even though it doesn't itself
 * change `schedule`. Filtering to `"edited"` only would make this function
 * blind to any status-change event sitting between two real edits.
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
 * One fold step: pairs `times[i]` with `newTimes[i]` by ARRAY INDEX — never
 * by sorting, never by matching values. INVARIANT: `times` is never
 * re-sorted, in this step or across the fold that chains these steps
 * together. (Contrast `nextDueAt`, which sorts a *copy* of
 * `course.schedule.times` purely to walk candidates chronologically — that
 * sorted copy must never leak into this positional pairing, or slot i would
 * stop meaning "the same slot before and after the edit".)
 *
 * Slot i moves to `newTimes[i]` unless it is PINNED, and a slot is pinned
 * only when both halves hold: its old time had already arrived at the moment
 * of this transition, AND a live dose is already logged against it
 * (`hasLoggedDose`). A slot-count change pairs to the shorter array, then a
 * surplus NEW slot appears once due, and a surplus OLD slot survives the
 * transition only while it is pinned by the same two-part test.
 *
 * The `hasLoggedDose` half is what keeps an edit VISIBLE on the day it is
 * made. SPEC §3c's forward-only rule exists so that editing a schedule can
 * never orphan a dose someone already logged — the occurrence key a stored
 * DoseEvent points at has to keep being generated, or the row it belongs to
 * silently disappears. Time alone is a much wider test than that goal needs:
 * it also froze every UNTOUCHED past slot, so a carer who moved this
 * morning's 08:00 dose to 09:00 at lunchtime saw Today keep saying 08:00
 * with no explanation, while the dose amount they changed in the same save
 * updated immediately (occurrences read `doseAmount` live). That mixed
 * reading is what "my course edit isn't reflected on Today" actually was.
 * An unlogged past slot has no history to protect, so it now follows the
 * edit like every other slot.
 */
function foldFixedTimesStep(
  day: LocalDate,
  times: LocalTime[],
  newTimes: LocalTime[],
  changedAt: Date,
  hasLoggedDose: (t: LocalTime) => boolean,
): LocalTime[] {
  const pairedLength = Math.min(times.length, newTimes.length);
  const result: LocalTime[] = [];

  const isPinned = (t: LocalTime): boolean =>
    atLocalTime(day, t).getTime() < changedAt.getTime() && hasLoggedDose(t);

  for (let i = 0; i < pairedLength; i++) {
    result.push(isPinned(times[i]) ? times[i] : newTimes[i]);
  }
  for (let i = pairedLength; i < newTimes.length; i++) {
    if (atLocalTime(day, newTimes[i]).getTime() >= changedAt.getTime()) {
      result.push(newTimes[i]);
    }
  }
  for (let i = pairedLength; i < times.length; i++) {
    if (isPinned(times[i])) {
      result.push(times[i]);
    }
  }

  // Two slots can land on the same clock time — a pinned old slot the edit
  // also happens to move another slot onto, say. They would build the
  // identical occurrence key, and the day would render the same dose twice.
  // First writer wins, so a pinned slot keeps its position in the array.
  return result.filter((t, i) => result.indexOf(t) === i);
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

  // The schedule governing `day`'s start is the version in effect there
  // (SPEC §3c) — not the live `course.schedule`, which may already be a
  // later edit that has not reached `day` yet.
  const scheduleAt = scheduleTimelineFor(course, courseEvents);
  const oldSchedule = scheduleAt(dayStart);

  // Every CourseEvent transition landing within [dayStart, nextDayStart) —
  // not just the single earliest one — must be folded in. A second same-day
  // edit's schedule would otherwise never be consulted at all. Ledger order:
  // (at asc, seq asc, id asc).
  const transitionsInDay = courseEvents
    .filter((e) => e.courseId === course.id)
    .filter((e) => {
      const at = new Date(e.at).getTime();
      return at >= dayStart.getTime() && at < nextDayStart.getTime();
    })
    .sort(courseEventOrder);

  const versions: Schedule[] = [oldSchedule, ...transitionsInDay.map((e) => e.after.schedule)];

  if (versions.some((v) => v.kind !== "fixedTimes")) {
    // Defensive: this feature only ever shifts fixedTimes clock times, so a
    // recorded edit changing `kind` is not expected. If it ever happened,
    // there is no meaningful per-slot pairing — fall back to the live grid.
    if (!fixedTimesDayEligible(day, course, liveSchedule)) return [];
    return liveSchedule.times.map((t) => buildFixedTimesOccurrence(day, course, t, events));
  }
  const fixedVersions = versions as Extract<Schedule, { kind: "fixedTimes" }>[];

  // Fold every in-day transition into the slot times one at a time,
  // threading each step's output into the next. With zero transitions this
  // is a no-op (`times` stays `oldSchedule.times`); with exactly one it is
  // exactly the old binary old/new split.
  // "Is a dose already logged against this slot?" — the pin test's second
  // half. Keyed on the occurrence key the slot WOULD build on `day`, which is
  // exactly what `buildFixedTimesOccurrence` binds its `event` with, so the
  // fold and the row it produces can never disagree about which slots carry
  // history.
  const hasLoggedDose = (t: LocalTime): boolean =>
    liveEventFor(occurrenceKeyFor(course.id, atLocalTime(day, t).toISOString()), events) !== null;

  let times: LocalTime[] = fixedVersions[0].times;
  for (let k = 0; k < transitionsInDay.length; k++) {
    times = foldFixedTimesStep(
      day,
      times,
      fixedVersions[k + 1].times,
      new Date(transitionsInDay[k].at),
      hasLoggedDose,
    );
  }

  // Eligibility (window/daysOfWeek/everyNDays) is evaluated PER SLOT, against
  // the schedule version governing that slot's own due instant — not once
  // for the whole day against `oldSchedule`. This is the same SPEC §3c
  // principle already applied to the clock time itself: a day that
  // daysOfWeek/everyNDays excludes under the version in force at the day's
  // start can still gain a slot from a later same-day edit that includes it
  // (and, symmetrically, lose one to an edit that excludes it) — each slot's
  // eligibility belongs to whichever version was actually in effect when it
  // was due, not to the day as a whole under a single version.
  const occurrences: Occurrence[] = [];
  for (const t of times) {
    const dueAt = atLocalTime(day, t);
    const governing = scheduleAt(dueAt);
    if (governing.kind !== "fixedTimes") continue; // defensive, see guard above
    // A slot that already carries a logged dose is emitted whatever the
    // day-level rules say. Otherwise an edit that narrows `daysOfWeek` or
    // `everyNDays` past today would delete the row a dose given this morning
    // is attached to, and the dose would vanish from Today with no trace —
    // the exact orphaning §3c's pinning exists to prevent, arriving through
    // the eligibility gate instead of the time grid. History first,
    // eligibility only for slots that have none.
    if (!hasLoggedDose(t) && !fixedTimesDayEligible(day, course, governing)) continue;
    occurrences.push(buildFixedTimesOccurrence(day, course, t, events));
  }
  return occurrences;
}

/** `given` (live: not deleted, not superseded) DoseEvents for one course. */
function liveGivenEventsForCourse(courseId: string, events: DoseEvent[]): DoseEvent[] {
  return events.filter(
    (e) => e.courseId === courseId && e.status === "given" && e.deletedAt === null && !isSuperseded(e.id, events),
  );
}

/** SPEC §3b-i/§3d: how many `given` events for this course fall in local calendar day `day`. */
function countGivenOnDay(courseId: string, day: LocalDate, events: DoseEvent[]): number {
  return liveGivenEventsForCourse(courseId, events).filter(
    (e) => localDayKey(new Date(e.givenAt)) === day,
  ).length;
}

/**
 * SPEC §3b-i: the effective next-due instant for a `fromLastDose` chain,
 * folding in the optional daily cap. `schedule` must be `course.schedule`
 * narrowed to `fromLastDose` by the caller.
 *
 * With no `maxPerDay`, or with the ANCHOR's own calendar day not yet at the
 * cap, this is exactly `anchor + intervalHours` (SPEC §3b, unchanged). Once
 * that day's live `given` count reaches `maxPerDay`, the course is "capped
 * for the rest of the day": the effective due instant becomes
 * `max(00:00 the day after anchor's day, anchor + intervalHours)` — never
 * EARLIER than the plain interval math, only ever later, and exported so
 * `sweep.ts#nextDueAt` folds in the identical rule rather than
 * re-deriving it.
 */
export function fromLastDoseDueAt(
  course: Course,
  schedule: Extract<Schedule, { kind: "fromLastDose" }>,
  anchor: Date,
  events: DoseEvent[],
): Date {
  const rawDueAt = new Date(anchor.getTime() + schedule.intervalHours * 3_600_000);
  if (schedule.maxPerDay === undefined) return rawDueAt;
  const anchorDay = localDayKey(anchor);
  if (countGivenOnDay(course.id, anchorDay, events) < schedule.maxPerDay) return rawDueAt;
  const nextDayStart = atLocalTime(addLocalDays(anchorDay, 1), "00:00");
  return rawDueAt.getTime() > nextDayStart.getTime() ? rawDueAt : nextDayStart;
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
        graceMinutes: intervalGraceMinutes(schedule.intervalHours),
        doseAmount: course.doseAmount,
        doseUnit: course.doseUnit,
        instructions: course.instructions,
        event: null,
      },
    ];
  }

  // Elapsed-millisecond arithmetic (SPEC §3d) — never wall-clock
  // reconstruction. `fromLastDoseDueAt` folds in the optional §3b-i cap; with
  // no `maxPerDay` set it reduces to plain `anchor + intervalHours`.
  const dueAt = fromLastDoseDueAt(course, schedule, anchor, events);
  const anchorDay = localDayKey(anchor);
  const dueDay = localDayKey(dueAt);
  // Emitted on every day from the anchor's own day through the due day —
  // not only the single day `dueAt` happens to land on. SPEC §3b: "Logging a
  // dose early or late shifts the whole chain — this is intended", which
  // requires the next dose to already be a visible, actionable row the
  // moment the chain re-anchors (`day === anchorDay`), not only once the
  // computed due instant happens to cross into the next local day (e.g. a
  // late-evening dose on a 4h+ interval). `getDoseState` still tells the
  // full story once this renders: "upcoming" while `day` precedes `dueDay`,
  // "later"/"due"/"overdue" once `day` reaches it.
  const scheduledFor = dueAt.toISOString();
  const key = occurrenceKeyFor(course.id, scheduledFor);
  const event = liveEventFor(key, events);
  if (differenceInLocalDays(day, anchorDay) < 0) return [];
  // PAST the due day, the occurrence survives only while it is still
  // OUTSTANDING. The upper bound used to be `dueDay` flat, which silently
  // deleted an interval dose that went unlogged past its own day: the chain
  // does not re-anchor without a `given` event (`anchorFor`), so `dueAt`
  // stayed put in the past and every later day generated nothing at all. The
  // course vanished from Today — no row, nothing to give, and the pet read as
  // done for the day. That is the "my pet did not reset overnight" report: an
  // 8h dose that came due at 22:00 and was not logged took the whole course
  // off the screen at midnight, with no way back short of giving a dose the
  // UI no longer offered.
  //
  // A RESOLVED one still stops at its due day. A `given` event re-anchors the
  // chain, so its key is never regenerated anyway; a `skipped` one does not
  // re-anchor (SPEC §3b), and without this guard its row would reappear every
  // day forever.
  if (differenceInLocalDays(dueDay, day) < 0 && event !== null) return [];
  // SPEC §3b-i: present only when this course's schedule actually carries a
  // cap — an absent `maxPerDay` here is what keeps `getDoseState` from ever
  // computing `capped` for an uncapped course (the unset-case no-op).
  // `givenToday` counts against THIS EMISSION's own `day` (not the anchor's
  // day) — the same occurrence key can be emitted for both the anchor's day
  // and the day its due instant lands on, and each must read its own day's
  // count: "capped" on the day the cap was reached, plain interval state
  // again once the calendar rolls over and that day's count resets to 0.
  const capFields =
    schedule.maxPerDay !== undefined
      ? { maxPerDay: schedule.maxPerDay, givenToday: countGivenOnDay(course.id, day, events) }
      : {};
  return [
    {
      key,
      courseId: course.id,
      petId: course.petId,
      medicationId: course.medicationId,
      kind: "fromLastDose",
      day,
      dueAt,
      graceMinutes: intervalGraceMinutes(schedule.intervalHours),
      doseAmount: course.doseAmount,
      doseUnit: course.doseUnit,
      instructions: course.instructions,
      // Same lookup the survival guard above already made — resolved once.
      event,
      ...capFields,
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
