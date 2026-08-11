// The wording layer for the Pet history screen (I18N-DESIGN.md §6).
//
// `features/history/logModel.ts` is locale-free: it emits `DetailClause[]`
// and day-heading descriptors and never composes prose. This module turns
// them into localized text. The English output here is byte-identical to the
// strings logModel used to build itself — pinned by `i18n/history.test.ts`.
//
// Import direction: this module depends on `features/history/logModel` (for
// the clause types) and on `features/pets/format#doseLabel` (so the dose
// rendering is not reimplemented). Neither creates a cycle: `i18n/index.ts`
// does not re-export this file, exactly as it does not re-export
// `i18n/schedule.ts`.
import { parseLocalDay } from "@/domain";
import type { DayHeading, DetailClause, LogEntry } from "@/features/history/logModel";
import { courseLabel, doseLabel } from "@/features/pets/format";
import { renderCourseProgress, renderSchedule } from "./schedule";
import type { Translator } from "./translator";

/** The separator `joinMeta` used when logModel still built these strings. */
const SEPARATOR = " · ";

function renderClause(clause: DetailClause, tr: Translator): string {
  switch (clause.kind) {
    case "given":
      return tr.t("history.detail.given");
    case "givenLate":
      return tr.t("history.detail.givenLate", {
        late: tr.t("history.detail.lateDuration", {
          hours: clause.hours,
          minutes: clause.minutes,
        }),
      });
    case "overMax":
      return tr.t("history.detail.overMax");
    case "skipped":
      return tr.t("history.detail.skipped");
    case "missed":
      return tr.t("history.detail.missed");
    case "scheduledAt":
      // A clock time — interpolated verbatim, never formatted (SPEC §10a).
      return tr.t("history.detail.scheduledAt", { time: clause.time });
    case "text":
      // Course instructions and the user's own note: DATA, verbatim.
      return clause.text;
    case "chainShifted":
      return tr.t("history.detail.chainShifted");
    case "timeEdited":
      // A clock time — interpolated verbatim, never formatted (SPEC §10a).
      return tr.t("history.detail.timeEdited", { from: clause.from });
    case "nextDue":
      return tr.t("history.detail.nextDue", {
        time: clause.time,
        schedule: renderSchedule(clause.schedule, tr),
      });
    case "progress":
      return renderCourseProgress(clause.progress, tr);
    case "courseStarted":
      return join([
        tr.t("history.detail.courseStarted"),
        renderSchedule(clause.schedule, tr),
        clause.totalDays !== null
          ? tr.t("history.detail.forDays", { days: clause.totalDays })
          : null,
      ]);
    case "coursePaused":
      return tr.t("history.detail.coursePaused");
    case "courseResumed":
      return tr.t("history.detail.courseResumed");
    case "courseStopped":
      return tr.t("history.detail.courseStopped");
    case "courseFinished":
      return tr.t("history.detail.courseFinished");
    case "courseEdited":
      return tr.t("history.detail.courseEdited");
    case "intervalChanged":
      return tr.t("history.detail.intervalChanged", {
        before: renderSchedule(clause.before, tr),
        after: renderSchedule(clause.after, tr),
      });
    case "doseChanged":
      return tr.t("history.detail.doseChanged", {
        before: doseLabel(clause.before.amount, clause.before.unit, tr),
        after: doseLabel(clause.after.amount, clause.after.unit, tr),
      });
  }
}

/** Joins the present parts with " · ", dropping empty ones — `joinMeta`'s semantics. */
function join(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => !!p).join(SEPARATOR);
}

/**
 * "Metacam 0.4 ml" — the row's medication and dose. Goes through
 * `courseLabel` so this stays the single place in the codebase that formats a
 * medication name + amount + unit into prose, including the countable-unit
 * pluralisation that differs between English ("2 drops") and Ukrainian
 * ("2 drop", unit verbatim as entered — SPEC §10a).
 */
export function renderLogTitle(title: LogEntry["title"], tr: Translator): string {
  return courseLabel(title.medicationName, title.amount, title.unit, tr);
}

/** The factual detail line for one history row. */
export function renderDetail(clauses: DetailClause[], tr: Translator): string {
  return join(clauses.map((clause) => renderClause(clause, tr)));
}

/**
 * "Today · Sun 9 Aug" / "Yesterday · Sat 8 Aug" / "Fri 7 Aug". The weekday and
 * month names come from `Intl.DateTimeFormat` via `tr.fmt.weekdayDayMonth`,
 * never from a lookup table.
 */
export function renderDayHeading(heading: DayHeading, tr: Translator): string {
  const date = tr.fmt.weekdayDayMonth(parseLocalDay(heading.day));
  if (heading.relative === null) return date;
  const relative =
    heading.relative === "today"
      ? tr.t("history.day.today")
      : tr.t("history.day.yesterday");
  return tr.t("history.day.heading", { relative, date });
}
