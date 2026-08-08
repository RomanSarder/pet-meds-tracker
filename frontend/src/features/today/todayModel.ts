// Slice 5's view model: `TodaySnapshot` in, `TodayView` out.
//
// PURITY RULE. Everything here is a pure function of (snapshot, now, opts).
// No React, no clock reads, and — the load-bearing one — no scheduling
// semantics: dose states come from `getDoseState`, counters from
// `summariseDay`, future occurrences from `getOccurrences`/`nextDueAt`, and
// the interval-schedule wording from `describeSchedule`. SPEC §10: slice 5
// consumes the engine and must not reimplement it. If a rule below looks like
// it could be derived from `dueAt` and `now`, that is exactly the derivation
// this file is forbidden to make.
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

/** Indexed by `Date#getDay()` (0 = Sunday) — locale-independent by design. */
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** How far ahead the "coming up" row looks (COMMON §6 item 11). */
const COMING_UP_DAYS = 7;

export function greetingFor(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
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
): string {
  const parts = [
    time ?? "Not started",
    course.instructions ?? "",
    // SPEC §3b: an interval course's detail line must carry the literal
    // phrase "from last dose", and `describeSchedule` is the only place that
    // phrase is written.
    occ.kind === "fixedTimes"
      ? courseProgress(course, day)
      : describeSchedule(course.schedule),
  ];
  return parts.filter((p) => p.length > 0).join(" · ");
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
): TodayDose {
  const state = getDoseState(occ, now);
  const time = timeFor(occ, state);
  return {
    key: occ.key,
    occurrence: occ,
    state,
    courseId: occ.courseId,
    petId: occ.petId,
    title: `${medication.name} ${occ.doseAmount} ${occ.doseUnit}`,
    medicationName: medication.name,
    detail: detailFor(occ, course, snapshot.day, time),
    time,
  };
}

function statusFor(
  pending: TodayDose[],
  resolved: TodayDose[],
  earliestOverdue: TodayDose | null,
  next: Date | null,
): string {
  if (earliestOverdue !== null && earliestOverdue.time !== null) {
    return `Overdue since ${earliestOverdue.time}`;
  }
  if (next !== null) return `Next at ${formatHHMM(next)}`;
  if (pending.length > 0) return "Not started";
  if (resolved.length > 0) {
    // Last by scheduled due time; the time it reports is the logged one.
    const last = resolved[resolved.length - 1];
    const time = last.time;
    return time === null
      ? `All done · ${last.medicationName}`
      : `All done · ${last.medicationName} at ${time}`;
  }
  return "Nothing scheduled";
}

function groupFor(
  pet: Pet,
  doses: TodayDose[],
  keepResolved: ReadonlySet<string> | undefined,
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
    counterLabel: total === 0 ? "" : `${resolved.length} of ${total} today`,
    status: statusFor(pending, resolved, overdueDoses[0] ?? null, next ?? null),
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

function formatNextDose(due: Date, now: Date): string {
  const today = localDayKey(now);
  const dueDay = localDayKey(due);
  if (dueDay === today) return `Next dose at ${formatHHMM(due)}`;
  if (dueDay === addLocalDays(today, 1)) {
    return `Next dose tomorrow at ${formatHHMM(due)}`;
  }
  const weekday = WEEKDAY_SHORT[due.getDay()];
  const month = MONTH_SHORT[due.getMonth()];
  return `Next dose ${weekday} ${due.getDate()} ${month} at ${formatHHMM(due)}`;
}

function emptyDetailFor(snapshot: TodaySnapshot, now: Date): string | null {
  let earliest: Date | null = null;
  for (const course of snapshot.courses) {
    if (course.status !== "active") continue;
    const due = nextDueAt(course, snapshot.events, now);
    if (due === null) continue;
    if (earliest === null || due.getTime() < earliest.getTime()) earliest = due;
  }
  return earliest === null ? null : formatNextDose(earliest, now);
}

function whenLabel(offsetDays: number): string {
  if (offsetDays === 0) return "today";
  if (offsetDays === 1) return "tomorrow";
  return `in ${offsetDays} days`;
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
        label: `Coming up · ${pet.name}'s ${medication.name} course ends`,
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
        label: `Coming up · ${pet.name}'s ${medication.name}`,
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
): ComingUp | null {
  const ending = courseEndingCandidate(snapshot, petsById, medsById);
  const weekly = weeklyTreatmentCandidate(
    snapshot,
    coursesById,
    petsById,
    medsById,
  );
  const chosen =
    ending === null
      ? weekly
      : weekly === null || ending.offsetDays <= weekly.offsetDays
        ? ending
        : weekly;
  if (chosen === null) return null;
  return { label: chosen.label, when: whenLabel(chosen.offsetDays) };
}

export function buildTodayView(
  snapshot: TodaySnapshot,
  now: Date,
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
    doses.push(toDose(occ, course, medication, snapshot, now));
  }

  const groups = snapshot.pets
    .filter((pet) => !pet.archived)
    .map((pet) =>
      groupFor(
        pet,
        doses.filter((d) => d.petId === pet.id),
        opts?.keepResolved,
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
    greeting: greetingFor(now),
    subtitle:
      `${summary.remaining} dose${summary.remaining === 1 ? "" : "s"} left today` +
      (summary.overdue > 0 ? ` · ${summary.overdue} overdue` : ""),
    groups,
    overdue: {
      count: summary.overdue,
      earliest,
      petName: earliest ? (petsById.get(earliest.petId)?.name ?? null) : null,
    },
    isEmpty: groups.every((g) => g.pending.length === 0),
    emptyDetail: emptyDetailFor(snapshot, now),
    comingUp: comingUpFor(snapshot, coursesById, petsById, medsById),
  };
}
