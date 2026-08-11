// The pure model behind the Pet history screen (SPEC.md §6.4). No React, no
// IndexedDB — this module turns a course's DoseEvent/CourseEvent rows into
// the rows and groupings the screen renders. Every date/time computation goes
// through `@/domain`; every schedule description goes through `@/engine`.
//
// LOCALE-FREE BY CONTRACT (I18N-DESIGN.md §5/§6): this module composes no
// prose, takes no `Translator`, and imports no `Intl`. Row titles are emitted
// as structured medication+dose objects, detail lines as `DetailClause[]` and
// day headings as descriptors;
// `i18n/history.ts#renderLogTitle`/`#renderDetail`/`#renderDayHeading` do the
// wording.
import type {
  Course,
  CourseEvent,
  DoseEvent,
  DoseEventStatus,
  LocalDate,
  Medication,
} from "@/domain";
import { differenceInLocalDays, formatHHMM, localDayKey } from "@/domain";
import type { CourseProgress, ScheduleDescription } from "@/engine";
import { courseProgress, describeSchedule, nextDueAt } from "@/engine";

export type LogEntryKind = "dose" | "course";
export type LogEntryStatus = "given" | "skipped" | "missed" | "course";

/**
 * One clause of a row's factual detail line (I18N-DESIGN.md §6). The renderer
 * joins the present clauses with " · ", which is what the old
 * `joinMeta(clauses)` did when this module still built the string itself.
 *
 * `text` is the one clause carrying free-form content: course instructions
 * and the user's own dose note. Both are DATA (SPEC §10a) — passed through
 * verbatim, never translated, never looked up in the catalogue. Clock times
 * likewise travel as the literal "HH:MM" they were formatted to.
 */
export type DetailClause =
  | { kind: "given" }
  | { kind: "givenLate"; hours: number; minutes: number } // hours may be 0
  | { kind: "skipped" }
  | { kind: "missed" }
  | { kind: "scheduledAt"; time: string } // "07:00"
  | { kind: "text"; text: string } // instructions / note — DATA, verbatim
  | { kind: "chainShifted" }
  | { kind: "timeEdited"; from: string } // "08:12" — the time this dose used to carry
  | { kind: "nextDue"; time: string; schedule: ScheduleDescription }
  | { kind: "progress"; progress: CourseProgress }
  | { kind: "courseStarted"; schedule: ScheduleDescription; totalDays: number | null }
  | { kind: "coursePaused" }
  | { kind: "courseResumed" }
  | { kind: "courseStopped" }
  | { kind: "courseFinished" }
  | { kind: "courseEdited" }
  | { kind: "intervalChanged"; before: ScheduleDescription; after: ScheduleDescription }
  | {
      kind: "doseChanged";
      before: { amount: number; unit: string };
      after: { amount: number; unit: string };
    };

/**
 * Which day a group of rows belongs to, and whether the screen should call it
 * out relatively. `i18n/history.ts#renderDayHeading` turns this into
 * "Today · Sun 9 Aug" / "Yesterday · Sat 8 Aug" / "Fri 7 Aug".
 */
export interface DayHeading {
  relative: "today" | "yesterday" | null;
  day: LocalDate;
}

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
  /**
   * The row's medication + dose, as STRUCTURE — rendered into
   * "Metacam 0.4 ml" by `i18n/history.ts#renderLogTitle`, exactly as `detail`
   * below is rendered by `#renderDetail`. Kept structured so the unit's
   * countable-plural morphology is the renderer's decision, not this
   * locale-free module's.
   *
   * All three fields are DATA (SPEC §1/§10a) — rendered verbatim, never
   * translated.
   */
  title: { medicationName: string; amount: number; unit: string };
  /** The factual detail line, as structure — see the per-kind builders below. */
  detail: DetailClause[];
  actorId: string;
  /**
   * The course this row belongs to — for a dose entry the event's own
   * `courseId`, for a course entry the CourseEvent's. The screen needs it to
   * find the `Course` behind a row it is about to act on (the edit-time
   * sheet); nothing renders it.
   */
  courseId: string;
  /**
   * Whether this row offers "Edit time". `given` dose rows only: a `skipped`
   * or `missed` row records that a dose did NOT happen, so it has no
   * administration time to correct, and a course-lifecycle row is a stamped
   * fact rather than a recollection.
   */
  canEditTime: boolean;
}

export interface LogSource {
  courses: Course[];
  medications: Medication[];
  doseEvents: DoseEvent[];
  courseEvents: CourseEvent[];
}

// --- day-heading descriptor -------------------------------------------------
// No month/weekday tables here any more: the names come from the renderer's
// `tr.fmt.weekdayDayMonth` (i.e. from `Intl.DateTimeFormat`), which is why
// this module needs neither a locale nor a lookup table.

/**
 * Which day a group covers, and whether it is today/yesterday relative to
 * `today`. Rendered as "Today · Sun 9 Aug" / "Yesterday · Sat 8 Aug" /
 * "Fri 7 Aug" — the design kit's exact section-label format for §6.4.
 */
export function dayHeading(day: LocalDate, today: LocalDate): DayHeading {
  const daysAgo = differenceInLocalDays(today, day);
  if (daysAgo === 0) return { relative: "today", day };
  if (daysAgo === 1) return { relative: "yesterday", day };
  return { relative: null, day };
}

// --- detail-clause builders -------------------------------------------------

/**
 * Splits the lateness into whole hours and leftover minutes. `hours` is 0 for
 * anything under an hour; the wording ("40 min" / "2 h" / "2 h 15 min") is the
 * renderer's to choose.
 */
function lateParts(lateMs: number): { hours: number; minutes: number } {
  const totalMinutes = Math.round(lateMs / 60_000);
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

function doseHeadClause(status: DoseEventStatus, lateMs: number | null): DetailClause {
  if (status === "given") {
    return lateMs !== null ? { kind: "givenLate", ...lateParts(lateMs) } : { kind: "given" };
  }
  if (status === "skipped") return { kind: "skipped" };
  return { kind: "missed" };
}

function buildDoseEntry(
  de: DoseEvent,
  course: Course,
  medication: Medication,
  allDoseEvents: DoseEvent[],
  eventById: Map<string, DoseEvent>,
): LogEntry {
  const scheduledFor = de.scheduledFor;
  const givenAtDate = new Date(de.givenAt);
  const at = scheduledFor ?? de.givenAt;
  const title = { medicationName: medication.name, amount: de.amount, unit: course.doseUnit };

  // SPEC §6.4: "Given 40 min late" — late only when GIVEN and at least a
  // minute past its scheduled instant. An interval course's first-ever dose
  // has `scheduledFor === null` and can never be "late".
  let lateMs: number | null = null;
  if (de.status === "given" && scheduledFor !== null) {
    const diff = givenAtDate.getTime() - new Date(scheduledFor).getTime();
    if (diff >= 60_000) lateMs = diff;
  }

  const clauses: DetailClause[] = [doseHeadClause(de.status, lateMs)];

  if (de.status === "missed" && scheduledFor !== null) {
    clauses.push({ kind: "scheduledAt", time: formatHHMM(new Date(scheduledFor)) });
  }
  // Instructions and the user's note are DATA — carried verbatim.
  if (course.instructions) clauses.push({ kind: "text", text: course.instructions });
  if (de.note) clauses.push({ kind: "text", text: de.note });

  // A correction supersedes the row it replaces, and only the correction is
  // rendered (see `buildLogEntries`) — so without this clause a time edit
  // would look like the dose had always been at the new time. Silent only
  // when the superseded row is outside the fetched range, or when the
  // correction changed something other than the time.
  if (de.supersedesId !== null) {
    const original = eventById.get(de.supersedesId);
    if (original && original.givenAt !== de.givenAt) {
      clauses.push({ kind: "timeEdited", from: formatHHMM(new Date(original.givenAt)) });
    }
  }

  if (de.status === "given") {
    if (course.schedule.kind === "fromLastDose") {
      if (lateMs !== null) {
        clauses.push({ kind: "chainShifted" });
      } else {
        // `nextDueAt` is the engine's own function — never reimplemented
        // here. It returns null once the course is no longer active, in
        // which case the clause is simply omitted.
        const nextDue = nextDueAt(course, allDoseEvents, givenAtDate);
        if (nextDue !== null) {
          clauses.push({
            kind: "nextDue",
            time: formatHHMM(nextDue),
            schedule: describeSchedule(course.schedule),
          });
        }
      }
    } else if (course.schedule.kind === "fixedTimes" && course.endDate !== null) {
      clauses.push({ kind: "progress", progress: courseProgress(course, localDayKey(new Date(at))) });
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
    detail: clauses,
    actorId: de.actorId,
    courseId: de.courseId,
    canEditTime: de.status === "given",
  };
}

function courseEventDetail(ce: CourseEvent): DetailClause[] {
  switch (ce.kind) {
    case "started": {
      const after = ce.after;
      const totalDays =
        after.endDate !== null ? differenceInLocalDays(after.endDate, after.startDate) + 1 : null;
      // NOTE: SPEC §6.4's illustrative "2× daily for 7 days" is shorter than
      // the engine's real schedule description ("2× daily · 08:00, 20:00").
      // Carrying the engine's own description is deliberate — hand-writing
      // the shorter one would reimplement the frozen engine's formatting. The
      // composed result reads
      // "Course started · 2× daily · 08:00, 20:00 · for 7 days".
      return [{ kind: "courseStarted", schedule: describeSchedule(after.schedule), totalDays }];
    }
    case "paused":
      return [{ kind: "coursePaused" }];
    case "resumed":
      return [{ kind: "courseResumed" }];
    case "stopped":
      return [{ kind: "courseStopped" }];
    case "finished":
      return [{ kind: "courseFinished" }];
    case "edited": {
      if (ce.before === null) return [{ kind: "courseEdited" }];
      const before = ce.before;
      const after = ce.after;
      const clauses: DetailClause[] = [];
      if (JSON.stringify(before.schedule) !== JSON.stringify(after.schedule)) {
        clauses.push({
          kind: "intervalChanged",
          before: describeSchedule(before.schedule),
          after: describeSchedule(after.schedule),
        });
      }
      if (before.doseAmount !== after.doseAmount || before.doseUnit !== after.doseUnit) {
        clauses.push({
          kind: "doseChanged",
          before: { amount: before.doseAmount, unit: before.doseUnit },
          after: { amount: after.doseAmount, unit: after.doseUnit },
        });
      }
      // Defensive fallback: `before` is non-null but nothing a detail line
      // renders actually changed (e.g. only `notes`/`instructions` edited,
      // which SPEC says records no lifecycle event in the first place).
      return clauses.length > 0 ? clauses : [{ kind: "courseEdited" }];
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
    title: {
      medicationName: medication.name,
      amount: ce.after.doseAmount,
      unit: ce.after.doseUnit,
    },
    detail: courseEventDetail(ce),
    actorId: ce.actorId,
    courseId: ce.courseId,
    canEditTime: false,
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
 *
 * SUPERSEDED AND SOFT-DELETED DOSE ROWS ARE NOT RENDERED. `DoseEvent` is an
 * append-only ledger (SPEC §9): a correction is a NEW row carrying
 * `supersedesId`, and the row it replaces stays in the table forever. The
 * ledger is the storage model, not the reading model — showing both would put
 * one dose on the screen twice and count it twice in the summary strip. This
 * is the same live-row rule `@/engine`'s `liveEventFor`/`anchorFor` apply, so
 * history and the scheduler agree on which rows are real.
 */
export function buildLogEntries(src: LogSource): LogEntry[] {
  const courseById = new Map(src.courses.map((c) => [c.id, c]));
  const medicationById = new Map(src.medications.map((m) => [m.id, m]));
  const eventById = new Map(src.doseEvents.map((e) => [e.id, e]));
  const superseded = new Set(
    src.doseEvents
      .filter((e) => e.deletedAt === null && e.supersedesId !== null)
      .map((e) => e.supersedesId as string),
  );
  const entries: LogEntry[] = [];

  for (const de of src.doseEvents) {
    if (de.deletedAt !== null || superseded.has(de.id)) continue;
    const course = courseById.get(de.courseId);
    if (!course) continue;
    const medication = medicationById.get(course.medicationId);
    if (!medication) continue;
    entries.push(buildDoseEntry(de, course, medication, src.doseEvents, eventById));
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
): Array<{ key: LocalDate; heading: DayHeading; entries: LogEntry[] }> {
  const groups: Array<{ key: LocalDate; heading: DayHeading; entries: LogEntry[] }> = [];
  const indexByKey = new Map<string, number>();

  for (const entry of entries) {
    const key = localDayKey(new Date(entry.at));
    let idx = indexByKey.get(key);
    if (idx === undefined) {
      idx = groups.length;
      indexByKey.set(key, idx);
      groups.push({ key, heading: dayHeading(key, today), entries: [] });
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
