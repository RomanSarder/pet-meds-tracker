// A pet's age, derived from `birthdate` and never stored (SPEC §2). Pure:
// callers do `ageLabel(pet.birthdate, localDayKey(now()))`.
import type { LocalDate } from "@/domain";
import { differenceInLocalDays } from "@/domain";

interface DateComponents {
  y: number;
  m: number;
  d: number;
}

/** Splits the "YYYY-MM-DD" string directly — no `Date` division involved. */
function componentsOf(day: LocalDate): DateComponents {
  const [y, m, d] = day.split("-").map(Number);
  return { y, m, d };
}

function pluralize(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/**
 * A pet's age, derived from `birthdate` and never stored (SPEC §2).
 * Truncated to whole units, never rounded up. Bands: >=1 year → "N yrs",
 * >=1 month (<1 year) → "N mths", >=1 week (<1 month) → "N wks", else
 * "N days". A future birthdate (or today's date) reads as "0 days", never
 * negative. Returns null when there is no birthdate.
 */
export function ageLabel(birthdate: LocalDate | null, today: LocalDate): string | null {
  if (birthdate === null) return null;

  // Weeks/days may use day-count arithmetic (DST/leap-year safe via
  // `differenceInLocalDays`'s `Date.UTC` epoch-day approach); years/months
  // never divide a timestamp — they compare calendar components directly.
  const totalDays = differenceInLocalDays(today, birthdate);
  if (totalDays <= 0) {
    // Rule 3: a future birthdate (or a birthdate of today) is never negative.
    return "0 days";
  }

  const birth = componentsOf(birthdate);
  const now = componentsOf(today);

  let years = now.y - birth.y;
  const beforeAnniversaryThisYear = now.m < birth.m || (now.m === birth.m && now.d < birth.d);
  if (beforeAnniversaryThisYear) years -= 1;

  if (years >= 1) {
    return pluralize(years, "yr");
  }

  let months = (now.y - birth.y) * 12 + (now.m - birth.m);
  if (now.d < birth.d) months -= 1;

  if (months >= 1) {
    return pluralize(months, "mth");
  }

  const weeks = Math.floor(totalDays / 7);
  if (weeks >= 1) {
    return pluralize(weeks, "wk");
  }

  return pluralize(totalDays, "day");
}
