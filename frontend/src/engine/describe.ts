// Pure formatting (SPEC §5.3) — no scheduling semantics. The exact strings
// here are the contract other branches (the DS components, Pet detail) build
// against; see the decisions doc §9 for the required outputs.
import type { Course, LocalDate, Schedule } from "@/domain";
import { differenceInLocalDays } from "@/domain";

const ISO_WEEKDAY_NAMES: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  7: "Sun",
};

export function describeSchedule(s: Schedule): string {
  if (s.kind === "fromLastDose") {
    // The literal phrase "from last dose" must always appear (SPEC §3b).
    let text = `every ${s.intervalHours}h · from last dose`;
    if (s.anchorTime) text += ` · first dose ${s.anchorTime}`;
    return text;
  }

  const parts: string[] = [];
  const hasDays = s.daysOfWeek !== undefined && s.daysOfWeek.length > 0;
  const hasEveryN = s.everyNDays !== undefined && s.everyNDays > 1;

  if (hasDays) {
    const days = [...s.daysOfWeek!].sort((a, b) => a - b);
    if (days.length === 1) {
      parts.push("weekly");
      parts.push(ISO_WEEKDAY_NAMES[days[0]]);
    } else {
      parts.push(days.map((d) => ISO_WEEKDAY_NAMES[d]).join(", "));
    }
    if (hasEveryN) {
      parts.push(`every ${s.everyNDays} days`);
    }
  } else if (hasEveryN) {
    parts.push(`every ${s.everyNDays} days`);
  } else {
    parts.push(s.times.length === 1 ? "once daily" : `${s.times.length}× daily`);
  }

  parts.push(s.times.join(", "));
  return parts.join(" · ");
}

export function courseProgress(c: Course, day: LocalDate): string {
  if (c.endDate === null) return "ongoing";
  const dayIndex = differenceInLocalDays(day, c.startDate) + 1;
  const total = differenceInLocalDays(c.endDate, c.startDate) + 1;
  return `day ${dayIndex} of ${total}`;
}
