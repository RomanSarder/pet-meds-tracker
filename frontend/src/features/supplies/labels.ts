// Every string the Supplies screens show is produced here, mirroring how
// `features/pets/format.ts` owns strings for the Pets slice. See
// CONTRACT-supplies.md "features/supplies/labels.ts — exact contract".
import type { Schedule } from "@/domain";
import { doseLabel, joinMeta } from "@/features/pets/format";
import { createTranslator } from "@/i18n";

// TODO(wave3): replace enTr with a real translator when the supplies feature
// is localized.
const enTr = createTranslator("en");

/**
 * "2× daily" | "daily" | "weekly" | "every 2 days" | "every 5h". Kit's own
 * vocabulary — a once-daily course is "daily", never "once daily".
 */
export function frequencyLabel(schedule: Schedule): string {
  if (schedule.kind === "fromLastDose") {
    const n = 24 / schedule.intervalHours;
    if (Number.isInteger(n)) {
      return n === 1 ? "daily" : `${n}× daily`;
    }
    return `every ${schedule.intervalHours}h`;
  }

  if (schedule.everyNDays && schedule.everyNDays > 1) {
    return `every ${schedule.everyNDays} days`;
  }
  if (schedule.daysOfWeek?.length === 1) {
    return "weekly";
  }
  return schedule.times.length === 1 ? "daily" : `${schedule.times.length}× daily`;
}

/** "Nugget, Biscuit · weekly" — pet names in the given order, then the distinct frequency labels. */
export function forWhomLabel(petNames: string[], schedules: Schedule[]): string {
  const seen = new Set<string>();
  const distinctFrequencies: string[] = [];
  for (const schedule of schedules) {
    const label = frequencyLabel(schedule);
    if (!seen.has(label)) {
      seen.add(label);
      distinctFrequencies.push(label);
    }
  }
  return joinMeta([petNames.join(", "), distinctFrequencies.join(", ")]);
}

/** "54 tabs" | "3.3 ml" | "Stock not set". */
export function stockLabel(stockUnits: number | null, unit: string): string {
  return stockUnits === null ? "Stock not set" : doseLabel(stockUnits, unit, enTr);
}

const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
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

/** "Wed 12 Aug", from local `Date` getters. */
export function runOutLabel(d: Date): string {
  return `${SHORT_WEEKDAYS[d.getDay()]} ${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
}

/** "1 more pack" | "2 more packs" | "3 ml" when packSize is null. */
export function neededLabel(neededPacks: number | null, needed: number, unit: string): string {
  if (neededPacks !== null) {
    return `${neededPacks} more pack${neededPacks === 1 ? "" : "s"}`;
  }
  return doseLabel(needed, unit, enTr);
}

/** "~7 weeks of cover", "~1 week of cover" — never "~0 weeks". */
export function weeksOfCoverLabel(daysOfCover: number): string {
  const weeks = Math.max(1, Math.round(daysOfCover / 7));
  return `~${weeks} week${weeks === 1 ? "" : "s"} of cover`;
}
