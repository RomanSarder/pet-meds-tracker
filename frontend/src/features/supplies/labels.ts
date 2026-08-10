// Every string the Supplies screens show is produced here, mirroring how
// `features/pets/format.ts` owns strings for the Pets slice. See
// CONTRACT-supplies.md "features/supplies/labels.ts — exact contract".
import type { Schedule } from "@/domain";
import { doseLabel, joinMeta } from "@/features/pets/format";
import type { Translator } from "@/i18n";

// Every function below REQUIRES a real `Translator` from the caller — there
// is no default. A default would let a call site silently render English
// inside a Ukrainian screen with no compile error and no test failure;
// requiring the argument makes the compiler find every call site.

/**
 * "2× daily" | "daily" | "weekly" | "every 2 days" | "every 5h". Kit's own
 * vocabulary — a once-daily course is "daily", never "once daily".
 */
export function frequencyLabel(schedule: Schedule, tr: Translator): string {
  if (schedule.kind === "fromLastDose") {
    const n = 24 / schedule.intervalHours;
    if (Number.isInteger(n)) {
      return n === 1 ? tr.t("supplies.frequency.daily") : tr.t("supplies.frequency.timesDaily", { n });
    }
    return tr.t("supplies.frequency.everyHours", { hours: schedule.intervalHours });
  }

  if (schedule.everyNDays && schedule.everyNDays > 1) {
    return tr.t("supplies.frequency.everyDays", { days: schedule.everyNDays });
  }
  if (schedule.daysOfWeek?.length === 1) {
    return tr.t("supplies.frequency.weekly");
  }
  return schedule.times.length === 1
    ? tr.t("supplies.frequency.daily")
    : tr.t("supplies.frequency.timesDaily", { n: schedule.times.length });
}

/** "Nugget, Biscuit · weekly" — pet names in the given order, then the distinct frequency labels. */
export function forWhomLabel(petNames: string[], schedules: Schedule[], tr: Translator): string {
  const seen = new Set<string>();
  const distinctFrequencies: string[] = [];
  for (const schedule of schedules) {
    const label = frequencyLabel(schedule, tr);
    if (!seen.has(label)) {
      seen.add(label);
      distinctFrequencies.push(label);
    }
  }
  return joinMeta([petNames.join(", "), distinctFrequencies.join(", ")]);
}

/** "54 tabs" | "3.3 ml" | "Stock not set". */
export function stockLabel(stockUnits: number | null, unit: string, tr: Translator): string {
  return stockUnits === null ? tr.t("supplies.stock.notSet") : doseLabel(stockUnits, unit, tr);
}

/** "Wed 12 Aug" — a DATE, so it localizes via `tr.fmt.weekdayDayMonth`. */
export function runOutLabel(d: Date, tr: Translator): string {
  return tr.fmt.weekdayDayMonth(d);
}

/** "1 more pack" | "2 more packs" | "3 ml" when packSize is null. */
export function neededLabel(
  neededPacks: number | null,
  needed: number,
  unit: string,
  tr: Translator,
): string {
  if (neededPacks !== null) {
    return tr.t("supplies.needed.morePacks", { n: neededPacks });
  }
  return doseLabel(needed, unit, tr);
}

/** "~7 weeks of cover", "~1 week of cover" — never "~0 weeks". */
export function weeksOfCoverLabel(daysOfCover: number, tr: Translator): string {
  const weeks = Math.max(1, Math.round(daysOfCover / 7));
  return tr.t("supplies.weeksOfCover", { weeks });
}
