// Pure schedule/course description (SPEC §5.3) — no scheduling semantics and,
// since localization, no prose either. These functions return STRUCTURED
// values (I18N-DESIGN.md §3); `i18n/schedule.ts` owns the wording. The
// branching and arithmetic below are unchanged from the prose version, and the
// segment order reproduces the old `parts` order exactly, so the English
// rendering is byte-identical to what these functions used to return.
import type { Course, LocalDate, Schedule } from "@/domain";
import { differenceInLocalDays } from "@/domain";
import type { CourseProgress, ScheduleDescription, ScheduleSegment } from "./engine.types";

export function describeSchedule(s: Schedule): ScheduleDescription {
  if (s.kind === "fromLastDose") {
    // The clause "from last dose" must always be present (SPEC §3b).
    const segments: ScheduleSegment[] = [
      { kind: "everyHours", hours: s.intervalHours },
      { kind: "fromLastDose" },
    ];
    if (s.anchorTime) segments.push({ kind: "firstDose", time: s.anchorTime });
    return { segments };
  }

  const segments: ScheduleSegment[] = [];
  const hasDays = s.daysOfWeek !== undefined && s.daysOfWeek.length > 0;
  const hasEveryN = s.everyNDays !== undefined && s.everyNDays > 1;

  if (hasDays) {
    const days = [...s.daysOfWeek!].sort((a, b) => a - b);
    if (days.length === 1) {
      segments.push({ kind: "weekly" });
      segments.push({ kind: "weekday", isoWeekday: days[0] });
    } else {
      segments.push({ kind: "weekdays", isoWeekdays: days });
    }
    if (hasEveryN) {
      segments.push({ kind: "everyNDays", days: s.everyNDays! });
    }
  } else if (hasEveryN) {
    segments.push({ kind: "everyNDays", days: s.everyNDays! });
  } else {
    segments.push({ kind: "timesPerDay", times: s.times.length });
  }

  // Copied, not aliased: the description must not hand a caller a live
  // reference to the course's own `times` array.
  segments.push({ kind: "times", times: [...s.times] });
  return { segments };
}

export function courseProgress(c: Course, day: LocalDate): CourseProgress {
  if (c.endDate === null) return { kind: "ongoing" };
  const dayIndex = differenceInLocalDays(day, c.startDate) + 1;
  const total = differenceInLocalDays(c.endDate, c.startDate) + 1;
  return { kind: "dayOfTotal", day: dayIndex, total };
}
