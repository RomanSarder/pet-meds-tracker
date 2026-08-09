// The pure model behind the Pet history screen (SPEC.md §6.4). No React, no
// IndexedDB — this module turns a course's DoseEvent/CourseEvent rows into
// the rows and groupings the screen renders. Every date/time computation goes
// through `@/domain`; every schedule description goes through `@/engine`.
import type {
  Course,
  CourseEvent,
  DoseEvent,
  DoseEventStatus,
  LocalDate,
  Medication,
} from "@/domain";
import { differenceInLocalDays, formatHHMM, localDayKey, parseLocalDay } from "@/domain";
import { courseProgress, describeSchedule, nextDueAt } from "@/engine";
import { courseLabel, doseLabel, joinMeta } from "@/features/pets/format";

export type LogEntryKind = "dose" | "course";
export type LogEntryStatus = "given" | "skipped" | "missed" | "course";

export interface LogEntry {
  id: string;
  kind: LogEntryKind;
  /** Drives the dot colour in the screen: green/grey/berry/terracotta. */
  status: LogEntryStatus;
  /**
   * ISO instant. THE DAY-GROUPING KEY ONLY (SPEC §3d — which calendar day an
   * event belongs to). For a dose entry this is `scheduledFor ?? givenAt`;
   * for a course entry it is the CourseEvent's own `at`. NOT used for
   * ordering — see `displayAt` — and NOT necessarily when the row is
   * displayed as having happened.
   */
  at: string;
  /**
   * ISO instant. THE ORDERING KEY, and what `time` is derived from — SPEC
   * §6.4's "newest first" means newest as the user reads it on the row, i.e.
   * the instant actually displayed. For a dose entry this is `de.givenAt`;
   * for a course entry it is the CourseEvent's own `at`.
   */
  displayAt: string;
  /** "HH:MM" — what the row displays. Always derived from the actual instant (`displayAt`), never from `at` above. */
  time: string;
  /** "Metacam 0.4 ml". */
  title: string;
  /** The factual detail line — see the per-kind builders below. */
  detail: string;
  actorId: string;
}

export interface LogSource {
  courses: Course[];
  medications: Medication[];
  doseEvents: DoseEvent[];
  courseEvents: CourseEvent[];
}

// --- local date-heading formatting -----------------------------------------
// format.ts already owns SHORT_MONTHS but we may not edit or import from a
// module outside this feature's four files' concerns — redeclared here.

const SHORT_MONTHS = [
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

/** JS `Date#getDay()` indexing: 0 = Sunday. This is a DISPLAY label, not the domain's ISO weekday numbering. */
const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDayHeading(day: LocalDate): string {
  const d = parseLocalDay(day);
  return `${SHORT_WEEKDAYS[d.getDay()]} ${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
}

/**
 * "Today · Sun 9 Aug" / "Yesterday · Sat 8 Aug" / "Fri 7 Aug" — the design
 * kit's exact section-label format for §6.4.
 */
export function dayLabel(day: LocalDate, today: LocalDate): string {
  const daysAgo = differenceInLocalDays(today, day);
  const heading = formatDayHeading(day);
  if (daysAgo === 0) return `Today · ${heading}`;
  if (daysAgo === 1) return `Yesterday · ${heading}`;
  return heading;
}

// --- detail-line builders ---------------------------------------------------

function lateLabel(lateMs: number): string {
  const totalMinutes = Math.round(lateMs / 60_000);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

function doseHeadClause(status: DoseEventStatus, lateMs: number | null): string {
  if (status === "given") {
    return lateMs !== null ? `Given ${lateLabel(lateMs)} late` : "Given";
  }
  if (status === "skipped") return "Skipped";
  return "Missed";
}

function buildDoseEntry(
  de: DoseEvent,
  course: Course,
  medication: Medication,
  allDoseEvents: DoseEvent[],
): LogEntry {
  const scheduledFor = de.scheduledFor;
  const givenAtDate = new Date(de.givenAt);
  const at = scheduledFor ?? de.givenAt;
  const title = courseLabel(medication.name, de.amount, course.doseUnit);

  // SPEC §6.4: "Given 40 min late" — late only when GIVEN and at least a
  // minute past its scheduled instant. An interval course's first-ever dose
  // has `scheduledFor === null` and can never be "late".
  let lateMs: number | null = null;
  if (de.status === "given" && scheduledFor !== null) {
    const diff = givenAtDate.getTime() - new Date(scheduledFor).getTime();
    if (diff >= 60_000) lateMs = diff;
  }

  const clauses: Array<string | null | undefined> = [doseHeadClause(de.status, lateMs)];

  if (de.status === "missed" && scheduledFor !== null) {
    clauses.push(`scheduled ${formatHHMM(new Date(scheduledFor))}`);
  }
  if (course.instructions) clauses.push(course.instructions);
  if (de.note) clauses.push(de.note);

  if (de.status === "given") {
    if (course.schedule.kind === "fromLastDose") {
      if (lateMs !== null) {
        clauses.push("chain shifted");
      } else {
        // `nextDueAt` is the engine's own function — never reimplemented
        // here. It returns null once the course is no longer active, in
        // which case the clause is simply omitted.
        const nextDue = nextDueAt(course, allDoseEvents, givenAtDate);
        if (nextDue !== null) {
          clauses.push(`next due ${formatHHMM(nextDue)}, ${describeSchedule(course.schedule)}`);
        }
      }
    } else if (course.schedule.kind === "fixedTimes" && course.endDate !== null) {
      clauses.push(courseProgress(course, localDayKey(new Date(at))));
    }
  }

  return {
    id: de.id,
    kind: "dose",
    status: de.status,
    at,
    displayAt: de.givenAt,
    time: formatHHMM(givenAtDate),
    title,
    detail: joinMeta(clauses),
    actorId: de.actorId,
  };
}

function courseEventDetail(ce: CourseEvent): string {
  switch (ce.kind) {
    case "started": {
      const after = ce.after;
      const totalDays =
        after.endDate !== null ? differenceInLocalDays(after.endDate, after.startDate) + 1 : null;
      // NOTE: SPEC §6.4's illustrative "2× daily for 7 days" is shorter than
      // `describeSchedule`'s real output ("2× daily · 08:00, 20:00"). Using
      // describeSchedule is deliberate — hand-writing the shorter string
      // would reimplement the frozen engine's formatting. The composed
      // result reads "Course started · 2× daily · 08:00, 20:00 · for 7 days".
      return joinMeta([
        "Course started",
        describeSchedule(after.schedule),
        totalDays !== null ? `for ${totalDays} days` : null,
      ]);
    }
    case "paused":
      return "Course paused";
    case "resumed":
      return "Course resumed";
    case "stopped":
      return "Course stopped";
    case "finished":
      return "Course finished";
    case "edited": {
      if (ce.before === null) return "Course edited";
      const before = ce.before;
      const after = ce.after;
      const clauses: string[] = [];
      if (JSON.stringify(before.schedule) !== JSON.stringify(after.schedule)) {
        clauses.push(
          `Interval changed · ${describeSchedule(before.schedule)} to ${describeSchedule(after.schedule)}`,
        );
      }
      if (before.doseAmount !== after.doseAmount || before.doseUnit !== after.doseUnit) {
        clauses.push(
          `Dose changed · ${doseLabel(before.doseAmount, before.doseUnit)} to ${doseLabel(after.doseAmount, after.doseUnit)}`,
        );
      }
      // Defensive fallback: `before` is non-null but nothing a detail line
      // renders actually changed (e.g. only `notes`/`instructions` edited,
      // which SPEC says records no lifecycle event in the first place).
      return clauses.length > 0 ? joinMeta(clauses) : "Course edited";
    }
  }
}

function buildCourseEntry(ce: CourseEvent, medication: Medication): LogEntry {
  return {
    id: ce.id,
    kind: "course",
    status: "course",
    at: ce.at,
    displayAt: ce.at,
    time: formatHHMM(new Date(ce.at)),
    title: courseLabel(medication.name, ce.after.doseAmount, ce.after.doseUnit),
    detail: courseEventDetail(ce),
    actorId: ce.actorId,
  };
}

/**
 * Newest first, in three passes: the DAY an entry belongs to (`at`, per SPEC
 * §3d — a late-night dose still sorts under the day it was scheduled for),
 * then the instant actually displayed on the row (`displayAt`, per SPEC
 * §6.4 — "newest first" means newest as the user reads it), then the
 * deterministic id tie-break. Day keys are "YYYY-MM-DD" strings, so a plain
 * string comparison is correct and total.
 */
function compareEntriesNewestFirst(a: LogEntry, b: LogEntry): number {
  const dayA = localDayKey(new Date(a.at));
  const dayB = localDayKey(new Date(b.at));
  if (dayA !== dayB) return dayA < dayB ? 1 : -1;
  const diff = new Date(b.displayAt).getTime() - new Date(a.displayAt).getTime();
  if (diff !== 0) return diff;
  // Arbitrary but deterministic tie-break so output is stable across runs.
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Builds every dose and course-lifecycle row for a pet's history, newest
 * first. An event whose course (or that course's medication) cannot be found
 * is silently skipped — never throws.
 */
export function buildLogEntries(src: LogSource): LogEntry[] {
  const courseById = new Map(src.courses.map((c) => [c.id, c]));
  const medicationById = new Map(src.medications.map((m) => [m.id, m]));
  const entries: LogEntry[] = [];

  for (const de of src.doseEvents) {
    const course = courseById.get(de.courseId);
    if (!course) continue;
    const medication = medicationById.get(course.medicationId);
    if (!medication) continue;
    entries.push(buildDoseEntry(de, course, medication, src.doseEvents));
  }

  for (const ce of src.courseEvents) {
    const course = courseById.get(ce.courseId);
    if (!course) continue;
    const medication = medicationById.get(course.medicationId);
    if (!medication) continue;
    entries.push(buildCourseEntry(ce, medication));
  }

  return entries.sort(compareEntriesNewestFirst);
}

/** Narrows to the filter chip. "all" returns every entry, in the same order. */
export function filterEntries(
  entries: LogEntry[],
  filter: "all" | "doses" | "courses",
): LogEntry[] {
  if (filter === "doses") return entries.filter((e) => e.kind === "dose");
  if (filter === "courses") return entries.filter((e) => e.kind === "course");
  return entries;
}

/**
 * Groups already-sorted (newest-first) entries by their day-grouping instant
 * (`entry.at`), newest day first. Each day's entries keep their relative
 * order from `entries`.
 */
export function groupByDay(
  entries: LogEntry[],
  today: LocalDate,
): Array<{ key: LocalDate; label: string; entries: LogEntry[] }> {
  const groups: Array<{ key: LocalDate; label: string; entries: LogEntry[] }> = [];
  const indexByKey = new Map<string, number>();

  for (const entry of entries) {
    const key = localDayKey(new Date(entry.at));
    let idx = indexByKey.get(key);
    if (idx === undefined) {
      idx = groups.length;
      indexByKey.set(key, idx);
      groups.push({ key, label: dayLabel(key, today), entries: [] });
    }
    groups[idx].entries.push(entry);
  }

  return groups;
}

/**
 * Counts given/skipped/missed over exactly the entries passed in. Per the
 * design kit, the screen's summary strip always counts the full visible
 * range — call this with the UNFILTERED entries, independent of which filter
 * chip is active. Course entries (status "course") are not counted.
 */
export function summarise(entries: LogEntry[]): {
  given: number;
  skipped: number;
  missed: number;
} {
  let given = 0;
  let skipped = 0;
  let missed = 0;
  for (const e of entries) {
    if (e.status === "given") given++;
    else if (e.status === "skipped") skipped++;
    else if (e.status === "missed") missed++;
  }
  return { given, skipped, missed };
}
