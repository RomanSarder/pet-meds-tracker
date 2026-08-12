// Slice 5's view model: `TodaySnapshot` in, `TodayView` out.
//
// PURITY RULE. Everything here is a pure function of (snapshot, now, tr, opts).
// No React, no clock reads, no locale lookup of its own — the translator is
// injected (I18N-DESIGN.md §5) — and, the load-bearing one, no scheduling
// semantics: dose states come from `getDoseState`, counters from
// `summariseDay`, future occurrences from `getOccurrences`/`nextDueAt`, and
// the interval-schedule wording from `describeSchedule` rendered through
// `@/i18n/schedule`. SPEC §10: slice 5 consumes the engine and must not
// reimplement it. If a rule below looks like it could be derived from `dueAt`
// and `now`, that is exactly the derivation this file is forbidden to make.
//
// WORDING RULE (SPEC §10a). No user-facing literal appears in this file; every
// composed string resolves through `i18n/catalogue/today.ts`. Clock times stay
// 24-hour via `formatHHMM` and are never localized; dates go through
// `tr.fmt.weekdayDayMonth`; every count goes through `f.plural` inside the
// catalogue entry, never by appending a letter here.
import type { Course, IsoDateTime, Medication, Pet } from "@/domain";
import {
  addLocalDays,
  differenceInLocalDays,
  formatHHMM,
  localDayKey,
} from "@/domain";
import type { DoseState, Occurrence } from "@/engine";
import {
  courseProgress,
  describeSchedule,
  getDoseState,
  getOccurrences,
  nextDueAt,
  summariseDay,
} from "@/engine";
import type { Translator } from "@/i18n";
import { renderCourseProgress, renderSchedule } from "@/i18n/schedule";
import type {
  ComingUp,
  DayProgressView,
  TodayDose,
  TodayPetGroup,
  TodaySnapshot,
  TodayView,
} from "./types";

/**
 * States that keep a dose in the card body.
 *
 * `capped` (SPEC §3b-i) belongs here unconditionally, not behind a
 * kind/kind-of-upcoming check the way `upcoming` is below it: a capped
 * occurrence is still outstanding — its ghost **Give anyway** action can
 * still resolve it — the same reasoning `engine/state.ts`'s `summariseDay`
 * already states for why `capped` joins `due`/`later` in `remaining` rather
 * than being dropped. Leaving it out of this set is what silently deleted
 * every capped row from Today before this fix: `isPendingDose` and
 * `RESOLVED_STATES` both missed it, so the row fell into neither `pending`
 * nor `resolved` and never rendered at all — not merely unstyled.
 */
const PENDING_STATES: ReadonlySet<DoseState> = new Set<DoseState>([
  "overdue",
  "due",
  "later",
  "notStarted",
  "capped",
]);

/** States that move a dose into the `X of Y today` counter. */
const RESOLVED_STATES: ReadonlySet<DoseState> = new Set<DoseState>([
  "given",
  "skipped",
]);

/**
 * Whether a dose belongs in the card body's pending list.
 *
 * `PENDING_STATES` applies uniformly to every course kind. `upcoming` is
 * folded in on top of it, but restricted to `fromLastDose` occurrences —
 * SPEC §3b: an anchored interval chain's next dose must be reachable, and
 * giveable early, from the moment the chain re-anchors, even when the
 * computed due instant lands on a later local day than "today"
 * (`occurrences.ts`'s `fromLastDoseOccurrences` now emits it for every day
 * from the anchor's own day through the due day, so its state can compute
 * as `upcoming` on the days before the due day arrives).
 *
 * CRITICAL SCOPE GUARD: a `fixedTimes` occurrence's `dueAt` is always inside
 * the very day `fixedTimesOccurrences` built it for (`atLocalTime(day, t)`),
 * so `upcoming` structurally cannot arise for one while `day` is the real
 * "today" `TodayPage` always queries — the `occ.kind` check below is
 * belt-and-braces, not a live branch today, so a later regression cannot
 * silently flood the dashboard with tomorrow's (or later) fixed-time doses.
 */
function isPendingDose(dose: TodayDose): boolean {
  if (PENDING_STATES.has(dose.state)) return true;
  return dose.state === "upcoming" && dose.occurrence.kind === "fromLastDose";
}

/** The separator every composed clause on this screen is joined with. */
const SEPARATOR = " · ";

/** How far ahead the "coming up" row looks (COMMON §6 item 11). */
const COMING_UP_DAYS = 7;

export function greetingFor(now: Date, tr: Translator): string {
  const hour = now.getHours();
  if (hour < 12) return tr.t("today.greeting.morning");
  if (hour < 18) return tr.t("today.greeting.afternoon");
  return tr.t("today.greeting.evening");
}

/**
 * Whether this dose has a scheduled clock time at all.
 *
 * Decided from the `DoseState`, never from `dueAt`. The engine's `notStarted`
 * covers any occurrence whose canonical key is `occurrenceKeyFor(courseId,
 * null)` — and such an occurrence can still carry a non-null `dueAt` when its
 * course has an `anchorTime` seeding the first dose (SPEC §3b). Inferring
 * "not started" from `dueAt === null` would silently miss exactly those.
 */
function isDated(dose: TodayDose): boolean {
  return dose.state !== "notStarted";
}

/**
 * Whether a dose counts toward TODAY specifically — `isDated` minus
 * `upcoming`.
 *
 * `upcoming` is dated (it has a real `dueAt`) but, by construction, is due on
 * a LATER local day than the one being viewed — it is only in `pending` at
 * all so an anchored `fromLastDose` chain's next dose is reachable and
 * giveable early (SPEC §3b). Counting it as "today" would claim a dose is
 * scheduled today that is not: `Y` in the `X of Y today` counter would read
 * one too high, and a pet whose only pending row is this early one would
 * never register as `done` for today even though nothing is actually due.
 */
function isDueToday(dose: TodayDose): boolean {
  return isDated(dose) && dose.state !== "upcoming";
}

/**
 * Inverse of `occurrenceKeyFor`: the key is the canonical record of what an
 * occurrence was scheduled for, so it — not `dueAt` — is what a write must
 * echo back. Reconstructing `scheduledFor` from `dueAt` disagrees with the key
 * for an anchored `notStarted` occurrence, and that mismatch would break both
 * the optimistic flip and `recordMissed`'s idempotence.
 */
export function scheduledForOf(occurrence: Occurrence): IsoDateTime | null {
  const separator = occurrence.key.indexOf("|");
  if (separator === -1) return null;
  const scheduledFor = occurrence.key.slice(separator + 1);
  return scheduledFor === "-" ? null : scheduledFor;
}

/** Ascending by due instant; a dose with no scheduled time sorts last. */
function byDueAt(a: TodayDose, b: TodayDose): number {
  const aDated = isDated(a);
  const bDated = isDated(b);
  if (aDated !== bDated) return aDated ? -1 : 1;
  const at = a.occurrence.dueAt;
  const bt = b.occurrence.dueAt;
  if (at === null && bt === null) return 0;
  if (at === null) return 1;
  if (bt === null) return -1;
  return at.getTime() - bt.getTime();
}

function detailFor(
  occ: Occurrence,
  course: Course,
  day: string,
  time: string | null,
  tr: Translator,
): string {
  const parts = [
    // A clock time when there is one — never localized (SPEC §10a).
    time ?? tr.t("today.notStarted"),
    // A `fromLastDose` occurrence whose computed due instant crosses onto a
    // LATER local day than the one being viewed (`occurrences.ts` now emits
    // it starting the anchor's own day, so it stays actionable — and
    // giveable early — before the interval elapses) must not read as due at
    // that bare clock time TODAY. `whenLabel` — the same "today"/"tomorrow"/
    // "in N days" word `comingUpFor` below already uses — says which day it
    // actually belongs to, reusing existing copy rather than inventing new.
    occ.kind === "fromLastDose" && occ.dueAt !== null && localDayKey(occ.dueAt) !== day
      ? whenLabel(differenceInLocalDays(localDayKey(occ.dueAt), day), tr)
      : "",
    // Instructions are user-entered DATA: interpolated verbatim.
    course.instructions ?? "",
    // SPEC §3b: an interval course's detail line must carry the "from last
    // dose" phrase. The engine names the segment; `renderSchedule` is the only
    // place that phrase is worded, in either language.
    occ.kind === "fixedTimes"
      ? renderCourseProgress(courseProgress(course, day), tr)
      : renderSchedule(describeSchedule(course.schedule), tr),
  ];
  return parts.filter((p) => p.length > 0).join(SEPARATOR);
}

/**
 * What the row reports as this dose's clock time.
 *
 * SPEC §4: a `given` dose presents with "time logged", so once a dose is
 * resolved the time shown is the instant it was actually given, not the one it
 * was scheduled for — a dose due at 07:00 and given at 07:12 reads "07:12".
 * Every other state shows the scheduled due time, and `notStarted` has none.
 */
function timeFor(occ: Occurrence, state: DoseState): string | null {
  // Keyed off the state, not off `dueAt` — an anchored `notStarted`
  // occurrence carries a `dueAt` it must not advertise as a due time.
  if (state === "notStarted") return null;
  const scheduled = occ.dueAt === null ? null : formatHHMM(occ.dueAt);
  if (!RESOLVED_STATES.has(state)) return scheduled;
  const event = occ.event;
  if (event && event.deletedAt === null) {
    return formatHHMM(new Date(event.givenAt));
  }
  return scheduled;
}

function toDose(
  occ: Occurrence,
  course: Course,
  medication: Medication,
  snapshot: TodaySnapshot,
  now: Date,
  tr: Translator,
): TodayDose {
  const state = getDoseState(occ, now);
  const time = timeFor(occ, state);
  return {
    key: occ.key,
    occurrence: occ,
    state,
    courseId: occ.courseId,
    petId: occ.petId,
    // Medication name, dose amount and unit are all DATA (SPEC §10a): the
    // amount keeps the decimal separator it was entered with, and the unit is
    // never translated.
    title: `${medication.name} ${occ.doseAmount} ${occ.doseUnit}`,
    medicationName: medication.name,
    detail: detailFor(occ, course, snapshot.day, time, tr),
    time,
    // Filled in by `attachCourseCounts` once every dose is built — a single
    // occurrence cannot know its course's day total in isolation.
    courseCount: null,
    // SPEC §3b-i: `state` already IS the capped condition
    // (`maxPerDay !== undefined && givenToday >= maxPerDay`, decided by
    // `getDoseState` — never re-derived here, per this file's PURITY RULE).
    // `occ.maxPerDay` is guaranteed set whenever `state === "capped"`
    // (`engine/state.ts`'s own precondition for that state), so the guard
    // below is belt-and-braces typing, not a live fallback.
    cap:
      state === "capped" && occ.maxPerDay !== undefined
        ? { given: occ.givenToday ?? 0, max: occ.maxPerDay }
        : null,
  };
}

/**
 * The row pill's per-course `N of M doses` (SPEC §4). Mutates `doses` in
 * place and returns it, purely as a bookkeeping convenience for its one
 * caller (`buildTodayView`) — every `TodayDose` in the array is already a
 * fresh object `toDose` built for this render, never a cached/shared one, so
 * there is nothing else this could alias.
 *
 * `total` per course is "resolved ∪ (pending ∩ isDueToday)" — the SAME test
 * `groupFor`'s own `Y` uses for the pet card counter, so a `fromLastDose`
 * course's total is exactly what is rendered today, never a schedule-derived
 * guess (SPEC's denominator rule). `given` counts only `state === "given"`,
 * never `skipped` — SPEC §4's rationale is literally "how many times have I
 * given Metacam", not "how many are resolved".
 */
function attachCourseCounts(doses: TodayDose[]): TodayDose[] {
  const totals = new Map<string, { given: number; total: number }>();
  for (const d of doses) {
    const counted = RESOLVED_STATES.has(d.state) || (isPendingDose(d) && isDueToday(d));
    if (!counted) continue;
    const entry = totals.get(d.courseId) ?? { given: 0, total: 0 };
    entry.total += 1;
    if (d.state === "given") entry.given += 1;
    totals.set(d.courseId, entry);
  }
  for (const d of doses) {
    const entry = totals.get(d.courseId);
    d.courseCount = entry && entry.total > 0 ? entry : null;
  }
  return doses;
}

function statusFor(
  pending: TodayDose[],
  resolved: TodayDose[],
  earliestOverdue: TodayDose | null,
  next: Date | null,
  now: Date,
  tr: Translator,
): string {
  if (earliestOverdue !== null && earliestOverdue.time !== null) {
    return tr.t("today.status.overdueSince", { time: earliestOverdue.time });
  }
  // `formatNextDose` (below), not the bare `today.status.nextAt` this used
  // to call: `next` can now be an anchored `fromLastDose` chain's next dose
  // reachable a day or more early (SPEC §3b), and a bare "Next at 07:50"
  // reads as due TODAY at that clock time regardless of which day `next`
  // actually falls on. `formatNextDose` already carries the "tomorrow"/date
  // qualifier `emptyDetailFor` below relies on for the exact same reason —
  // reused rather than re-worded, so the two only ever say this one way.
  if (next !== null) return formatNextDose(next, now, tr);
  if (pending.length > 0) return tr.t("today.notStarted");
  if (resolved.length > 0) {
    // Last by scheduled due time; the time it reports is the logged one.
    const last = resolved[resolved.length - 1];
    const time = last.time;
    return time === null
      ? tr.t("today.status.allDone", { medicationName: last.medicationName })
      : tr.t("today.status.allDoneAt", {
          medicationName: last.medicationName,
          time,
        });
  }
  return tr.t("today.status.nothingScheduled");
}

function groupFor(
  pet: Pet,
  doses: TodayDose[],
  keepResolved: ReadonlySet<string> | undefined,
  now: Date,
  tr: Translator,
): TodayPetGroup {
  const pending = doses.filter(isPendingDose).sort(byDueAt);
  const resolved = doses
    .filter((d) => RESOLVED_STATES.has(d.state))
    .sort(byDueAt);

  const body = keepResolved
    ? [...pending, ...resolved.filter((d) => keepResolved.has(d.key))].sort(
        byDueAt,
      )
    : [...pending];

  // `Y` excludes `notStarted` AND `upcoming` (`isDueToday`, not `isDated`):
  // for an interval course the day's total is not knowable in advance
  // (COMMON §6 item 8), and an `upcoming` row's dose is not due today at all
  // — it is only in `pending` so it stays reachable and giveable early
  // (SPEC §3b). Counting it would read "1 of 1 today" for a dose actually
  // due tomorrow.
  const countedPending = pending.filter(isDueToday).length;
  const total = resolved.length + countedPending;

  const overdueDoses = pending.filter((d) => d.state === "overdue");
  const next = pending.find((d) => isDated(d) && d.occurrence.dueAt !== null)
    ?.occurrence.dueAt;

  return {
    pet,
    pending,
    resolved,
    body,
    counterLabel:
      total === 0 ? "" : tr.t("today.counter", { done: resolved.length, total }),
    status: statusFor(pending, resolved, overdueDoses[0] ?? null, next ?? null, now, tr),
    hasOverdue: overdueDoses.length > 0,
    // Not simply `pending.length === 0`: a pending row that is purely an
    // early-reachable `upcoming` dose (SPEC §3b) is not something left to do
    // TODAY, so it must not keep a pet permanently out of the `done` rank —
    // `every` is vacuously true on an empty array, so this still covers the
    // ordinary "nothing pending at all" case exactly as before.
    done: pending.every((d) => d.state === "upcoming"),
    nextDueAt: next ?? null,
  };
}

/** Ordering rank: overdue pets, then pets with something pending, then done. */
function rankOf(group: TodayPetGroup): number {
  if (group.hasOverdue) return 0;
  return group.done ? 2 : 1;
}

function earliestOverdueAt(group: TodayPetGroup): number {
  const first = group.pending.find(
    (d) => d.state === "overdue" && d.occurrence.dueAt !== null,
  );
  return first?.occurrence.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
}

function compareGroups(a: TodayPetGroup, b: TodayPetGroup): number {
  const rank = rankOf(a) - rankOf(b);
  if (rank !== 0) return rank;
  if (rankOf(a) === 0) {
    const diff = earliestOverdueAt(a) - earliestOverdueAt(b);
    if (diff !== 0) return diff;
  } else if (rankOf(a) === 1) {
    const at = a.nextDueAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const bt = b.nextDueAt?.getTime() ?? Number.POSITIVE_INFINITY;
    if (at !== bt) return at - bt;
  }
  return a.pet.name.localeCompare(b.pet.name);
}

function formatNextDose(due: Date, now: Date, tr: Translator): string {
  const today = localDayKey(now);
  const dueDay = localDayKey(due);
  // `formatHHMM` throughout: SPEC §10a keeps clock times 24-hour and
  // unlocalized in both languages.
  const time = formatHHMM(due);
  if (dueDay === today) return tr.t("today.nextDose.today", { time });
  if (dueDay === addLocalDays(today, 1)) {
    return tr.t("today.nextDose.tomorrow", { time });
  }
  // The weekday/month names come from `Intl.DateTimeFormat` via the
  // formatters, never from a table in this file.
  return tr.t("today.nextDose.onDate", { date: tr.fmt.weekdayDayMonth(due), time });
}

function emptyDetailFor(
  snapshot: TodaySnapshot,
  now: Date,
  tr: Translator,
): string | null {
  let earliest: Date | null = null;
  for (const course of snapshot.courses) {
    if (course.status !== "active") continue;
    const due = nextDueAt(course, snapshot.events, snapshot.courseEvents, now);
    if (due === null) continue;
    if (earliest === null || due.getTime() < earliest.getTime()) earliest = due;
  }
  return earliest === null ? null : formatNextDose(earliest, now, tr);
}

/**
 * Negative offsets are reachable now that an OUTSTANDING interval dose keeps
 * being emitted past its due day (SPEC §3b) — a dose due two days ago used to
 * be deleted rather than shown, so the past side of this was dead code and
 * `inDays` rendered it as "in -2 days". `comingUpFor` only ever passes
 * non-negative offsets; the dose detail line at `toDose` is what reaches
 * back.
 */
function whenLabel(offsetDays: number, tr: Translator): string {
  if (offsetDays === 0) return tr.t("today.when.today");
  if (offsetDays === 1) return tr.t("today.when.tomorrow");
  if (offsetDays === -1) return tr.t("today.when.yesterday");
  if (offsetDays < -1) return tr.t("today.when.daysAgo", { days: -offsetDays });
  return tr.t("today.when.inDays", { days: offsetDays });
}

interface ComingUpCandidate {
  offsetDays: number;
  label: string;
}

/** (a) an active course whose `endDate` lands inside the window. */
function courseEndingCandidate(
  snapshot: TodaySnapshot,
  petsById: Map<string, Pet>,
  medsById: Map<string, Medication>,
  tr: Translator,
): ComingUpCandidate | null {
  let best: ComingUpCandidate | null = null;
  for (const course of snapshot.courses) {
    if (course.status !== "active" || course.endDate === null) continue;
    const offsetDays = differenceInLocalDays(course.endDate, snapshot.day);
    if (offsetDays < 0 || offsetDays > COMING_UP_DAYS) continue;
    const pet = petsById.get(course.petId);
    const medication = medsById.get(course.medicationId);
    if (!pet || pet.archived || !medication) continue;
    if (best === null || offsetDays < best.offsetDays) {
      best = {
        offsetDays,
        // Pet and medication names are DATA: handed to the catalogue entry
        // verbatim, in whatever order that language's wording needs them.
        label: tr.t("today.comingUp.courseEnds", {
          petName: pet.name,
          medicationName: medication.name,
        }),
      };
    }
  }
  return best;
}

/**
 * (b) the next occurrence of a course scheduled on specific weekdays. The
 * weekday arithmetic is the engine's: this walks the next seven local days and
 * asks `getOccurrences` what falls on each.
 */
function weeklyTreatmentCandidate(
  snapshot: TodaySnapshot,
  coursesById: Map<string, Course>,
  petsById: Map<string, Pet>,
  medsById: Map<string, Medication>,
  tr: Translator,
): ComingUpCandidate | null {
  for (let offsetDays = 1; offsetDays <= COMING_UP_DAYS; offsetDays++) {
    const day = addLocalDays(snapshot.day, offsetDays);
    const occs = [
      ...getOccurrences(day, {
        courses: snapshot.courses,
        events: snapshot.events,
        courseEvents: snapshot.courseEvents,
      }),
    ].sort(
      (a, b) =>
        (a.dueAt?.getTime() ?? Number.POSITIVE_INFINITY) -
        (b.dueAt?.getTime() ?? Number.POSITIVE_INFINITY),
    );
    for (const occ of occs) {
      const course = coursesById.get(occ.courseId);
      if (!course || course.status !== "active") continue;
      if (course.schedule.kind !== "fixedTimes") continue;
      if (!course.schedule.daysOfWeek || course.schedule.daysOfWeek.length === 0)
        continue;
      const pet = petsById.get(occ.petId);
      const medication = medsById.get(occ.medicationId);
      if (!pet || pet.archived || !medication) continue;
      return {
        offsetDays,
        label: tr.t("today.comingUp.treatment", {
          petName: pet.name,
          medicationName: medication.name,
        }),
      };
    }
  }
  return null;
}

function comingUpFor(
  snapshot: TodaySnapshot,
  coursesById: Map<string, Course>,
  petsById: Map<string, Pet>,
  medsById: Map<string, Medication>,
  tr: Translator,
): ComingUp | null {
  const ending = courseEndingCandidate(snapshot, petsById, medsById, tr);
  const weekly = weeklyTreatmentCandidate(
    snapshot,
    coursesById,
    petsById,
    medsById,
    tr,
  );
  const chosen =
    ending === null
      ? weekly
      : weekly === null || ending.offsetDays <= weekly.offsetDays
        ? ending
        : weekly;
  if (chosen === null) return null;
  return { label: chosen.label, when: whenLabel(chosen.offsetDays, tr) };
}

/**
 * SPEC §6.1's day progress block: `<given> of <total> given today`, plus a
 * trailing note in precedence order (overdue, else next due time today, else
 * "all done").
 *
 * Built entirely from `groups` — i.e. from the pending/resolved lists the pet
 * cards themselves render — never from `snapshot.occurrences` directly. A
 * course can generate an occurrence for an archived pet (`isGenerable` only
 * checks the COURSE's own status, not the pet's), and `groups` already
 * excludes archived pets, so deriving from it is what keeps this block's
 * counts "derivable from what is on screen" (SPEC's denominator rule) rather
 * than silently counting a pet nobody sees a card for.
 */
function dayProgressFor(groups: TodayPetGroup[], tr: Translator): DayProgressView {
  let given = 0;
  let overdue = 0;
  let dueTodayPending = 0;
  let nextDueToday: Date | null = null;

  for (const group of groups) {
    given += group.resolved.length;
    for (const dose of group.pending) {
      if (!isDueToday(dose)) continue;
      dueTodayPending += 1;
      if (dose.state === "overdue") {
        overdue += 1;
      } else if (
        dose.occurrence.dueAt !== null &&
        (nextDueToday === null || dose.occurrence.dueAt.getTime() < nextDueToday.getTime())
      ) {
        nextDueToday = dose.occurrence.dueAt;
      }
    }
  }

  const total = given + dueTodayPending;
  const noteIsOverdue = overdue > 0;
  const note = noteIsOverdue
    ? tr.t("today.dayProgress.overdue", { overdue })
    : nextDueToday !== null
      ? tr.t("today.dayProgress.next", { time: formatHHMM(nextDueToday) })
      : tr.t("today.dayProgress.allDone");

  return {
    given,
    total,
    overdue,
    headline: tr.t("today.dayProgress.headline", { given, total }),
    note,
    noteIsOverdue,
  };
}

export function buildTodayView(
  snapshot: TodaySnapshot,
  now: Date,
  tr: Translator,
  opts?: { keepResolved?: ReadonlySet<string> },
): TodayView {
  const petsById = new Map(snapshot.pets.map((p) => [p.id, p]));
  const medsById = new Map(snapshot.medications.map((m) => [m.id, m]));
  const coursesById = new Map(snapshot.courses.map((c) => [c.id, c]));

  // An occurrence whose course or medication is missing from the snapshot
  // cannot be titled, so it is not rendered.
  const doses: TodayDose[] = [];
  for (const occ of snapshot.occurrences) {
    const course = coursesById.get(occ.courseId);
    const medication = medsById.get(occ.medicationId);
    if (!course || !medication) continue;
    doses.push(toDose(occ, course, medication, snapshot, now, tr));
  }
  attachCourseCounts(doses);

  const groups = snapshot.pets
    .filter((pet) => !pet.archived)
    .map((pet) =>
      groupFor(
        pet,
        doses.filter((d) => d.petId === pet.id),
        opts?.keepResolved,
        now,
        tr,
      ),
    )
    .sort(compareGroups);

  const summary = summariseDay(snapshot.occurrences, now);
  const earliestKey = summary.earliestOverdue?.key ?? null;
  // Looked up by key, never recomputed: the banner must log exactly the dose
  // the engine named.
  const earliest =
    earliestKey === null
      ? null
      : (doses.find((d) => d.key === earliestKey) ?? null);

  return {
    greeting: greetingFor(now, tr),
    // SPEC §6.1: the header never repeats the overdue count — that moved to
    // `dayProgress.note` below. At zero remaining the subtitle is its own
    // whole sentence, not "0 doses left today".
    subtitle:
      summary.remaining > 0
        ? tr.t("today.subtitle", { remaining: summary.remaining })
        : tr.t("today.subtitle.allDone"),
    groups,
    dayProgress: dayProgressFor(groups, tr),
    overdue: {
      count: summary.overdue,
      earliest,
      petName: earliest ? (petsById.get(earliest.petId)?.name ?? null) : null,
    },
    isEmpty: groups.every((g) => g.pending.length === 0),
    emptyDetail: emptyDetailFor(snapshot, now, tr),
    comingUp: comingUpFor(snapshot, coursesById, petsById, medsById, tr),
  };
}
