// Renders the engine's structured schedule/course descriptors into localized
// text (I18N-DESIGN.md §3.5). This is the layer the engine used to own: the
// English output here is byte-identical to what `describeSchedule` /
// `courseProgress` returned before localization — pinned by
// `i18n/schedule.test.ts`.
import type { CourseProgress, ScheduleDescription, ScheduleSegment } from "@/engine";
import type { Translator } from "./translator";

/** The separator the engine's `parts.join(" · ")` used, kept verbatim. */
const SEPARATOR = " · ";

function renderSegment(segment: ScheduleSegment, tr: Translator): string {
  switch (segment.kind) {
    case "everyHours":
      return tr.t("schedule.everyHours", { hours: segment.hours });
    case "fromLastDose":
      return tr.t("schedule.fromLastDose");
    case "firstDose":
      // A clock time — interpolated verbatim, never formatted (SPEC §10a).
      return tr.t("schedule.firstDose", { time: segment.time });
    case "weekly":
      return tr.t("schedule.weekly");
    case "weekday":
      return tr.fmt.isoWeekdayShort(segment.isoWeekday);
    case "weekdays":
      return segment.isoWeekdays.map((d) => tr.fmt.isoWeekdayShort(d)).join(", ");
    case "everyNDays":
      return tr.t("schedule.everyNDays", { days: segment.days });
    case "timesPerDay":
      return tr.t("schedule.timesPerDay", { times: segment.times });
    case "times":
      // Clock times, never localized.
      return segment.times.join(", ");
  }
}

export function renderSchedule(d: ScheduleDescription, tr: Translator): string {
  return d.segments.map((segment) => renderSegment(segment, tr)).join(SEPARATOR);
}

export function renderCourseProgress(p: CourseProgress, tr: Translator): string {
  if (p.kind === "ongoing") return tr.t("schedule.courseOngoing");
  return tr.t("schedule.courseDayOfTotal", { day: p.day, total: p.total });
}
