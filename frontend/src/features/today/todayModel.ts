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
  TodayDose,
  TodayPetGroup,
  TodaySnapshot,
  TodayView,
} from "./types";

/** States that keep a dose in the card body. */
const PENDING_STATES: ReadonlySet<DoseState> = new Set<DoseState>([
  "overdue",
  "due",
  "later",
  "notStarted",
]);

/** States that move a dose into the `X of Y today` counter. */
const RESOLVED_STATES: ReadonlySet<DoseState> = new Set<DoseState>([
  "given",
  "skipped",
]);

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
  };
}

function statusFor(
  pending: TodayDose[],
  resolved: TodayDose[],
  earliestOverdue: TodayDose | null,
  next: Date | null,
  tr: Translator,
): string {
  if (earliestOverdue !== null && earliestOverdue.time !== null) {
    return tr.t("today.status.overdueSince", { time: earliestOverdue.time });
  }
  if (next !== null) return tr.t("today.status.nextAt", { time: formatHHMM(next) });
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
  tr: Translator,
): TodayPetGroup {
  const pending = doses.filter((d) => PENDING_STATES.has(d.state)).sort(byDueAt);
  const resolved = doses
    .filter((d) => RESOLVED_STATES.has(d.state))
    .sort(byDueAt);

  const body = keepResolved
    ? [...pending, ...resolved.filter((d) => keepResolved.has(d.key))].sort(
        byDueAt,
      )
    : [...pending];

  // `Y` excludes `notStarted`: for an interval course the day's total is not
  // knowable in advance (COMMON §6 item 8).
  const countedPending = pending.filter(isDated).length;
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
    status: statusFor(pending, resolved, overdueDoses[0] ?? null, next ?? null, tr),
    hasOverdue: overdueDoses.length > 0,
    done: pending.length === 0,
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
    const due = nextDueAt(course, snapshot.events, now);
    if (due === null) continue;
    if (earliest === null || due.getTime() < earliest.getTime()) earliest = due;
  }
  return earliest === null ? null : formatNextDose(earliest, now, tr);
}

function whenLabel(offsetDays: number, tr: Translator): string {
  if (offsetDays === 0) return tr.t("today.when.today");
  if (offsetDays === 1) return tr.t("today.when.tomorrow");
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

  const groups = snapshot.pets
    .filter((pet) => !pet.archived)
    .map((pet) =>
      groupFor(
        pet,
        doses.filter((d) => d.petId === pet.id),
        opts?.keepResolved,
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
    // SPEC §6.1 drops the second clause when M = 0. Both clauses pluralise
    // through `f.plural` inside the catalogue, never by appending a letter.
    subtitle: [
      tr.t("today.subtitle", { remaining: summary.remaining }),
      ...(summary.overdue > 0
        ? [tr.t("today.subtitle.overdue", { overdue: summary.overdue })]
        : []),
    ].join(SEPARATOR),
    groups,
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
