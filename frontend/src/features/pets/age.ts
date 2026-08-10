// A pet's age, derived from `birthdate` and never stored (SPEC §2). Pure but
// takes an injected `tr: Translator` (I18N-DESIGN.md §5): callers do
// `ageLabel(pet.birthdate, localDayKey(now()), tr)`.
import type { LocalDate } from "@/domain";
import { differenceInLocalDays } from "@/domain";
import type { Translator } from "@/i18n";

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

/**
 * A pet's age, derived from `birthdate` and never stored (SPEC §2).
 * Truncated to whole units, never rounded up. Bands: >=1 year → "N yrs",
 * >=1 month (<1 year) → "N mths", >=1 week (<1 month) → "N wks", else
 * "N days". A future birthdate (or today's date) reads as "0 days", never
 * negative. Returns null when there is no birthdate.
 *
 * Every band is a real plural rule via `tr.t`/`tr.fmt.plural`
 * (`i18n/catalogue/pets.ts#pets.age.*`) — SPEC §10a: a count is never built
 * by appending a letter.
 */
export function ageLabel(
  birthdate: LocalDate | null,
  today: LocalDate,
  tr: Translator,
): string | null {
  if (birthdate === null) return null;

  // Weeks/days may use day-count arithmetic (DST/leap-year safe via
  // `differenceInLocalDays`'s `Date.UTC` epoch-day approach); years/months
  // never divide a timestamp — they compare calendar components directly.
  const totalDays = differenceInLocalDays(today, birthdate);
  if (totalDays <= 0) {
    // Rule 3: a future birthdate (or a birthdate of today) is never negative.
    return tr.t("pets.age.days", { n: 0 });
  }

  const birth = componentsOf(birthdate);
  const now = componentsOf(today);

  let years = now.y - birth.y;
  const beforeAnniversaryThisYear = now.m < birth.m || (now.m === birth.m && now.d < birth.d);
  if (beforeAnniversaryThisYear) years -= 1;

  if (years >= 1) {
    return tr.t("pets.age.years", { n: years });
  }

  let months = (now.y - birth.y) * 12 + (now.m - birth.m);
  if (now.d < birth.d) months -= 1;

  if (months >= 1) {
    return tr.t("pets.age.months", { n: months });
  }

  const weeks = Math.floor(totalDays / 7);
  if (weeks >= 1) {
    return tr.t("pets.age.weeks", { n: weeks });
  }

  return tr.t("pets.age.days", { n: totalDays });
}
