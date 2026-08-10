// Every string the three ported kit screens show is produced here, so no
// page invents one. See CONTRACT.md §3. Age derivation lives in the sibling
// `./age.ts` (`ageLabel`), not here.
import type { LocalDate, Species } from "@/domain";
import { differenceInLocalDays, formatHHMM, localDayKey, parseLocalDay } from "@/domain";
import type { Translator } from "@/i18n";

// The five composing functions below REQUIRE a real `Translator` from the
// caller — there is no default. A default would let a call site silently
// render English inside a Ukrainian screen with no compile error and no test
// failure; requiring the argument makes the compiler find every call site.

/** "rabbit" → "Rabbit", "guinea_pig" → "Guinea pig". The kit's own casing. */
export function speciesLabel(s: Species, tr: Translator): string {
  switch (s) {
    case "rabbit":
      return tr.t("pets.species.rabbit");
    case "guinea_pig":
      return tr.t("pets.species.guineaPig");
    case "cat":
      return tr.t("pets.species.cat");
    case "dog":
      return tr.t("pets.species.dog");
    case "other":
      return tr.t("pets.species.other");
  }
}

/** 1900 → "1.9 kg". null → null. */
export function weightLabel(grams: number | null, tr: Translator): string | null {
  if (grams === null) return null;
  // "kg" is a unit — measurement data, never translated (SPEC §10a) — and
  // `.toFixed(1)` keeps its `.` decimal separator unchanged in both
  // languages. There is no prose in this string, so `tr` is accepted only
  // for signature consistency with the other four functions and is unused.
  void tr;
  return `${(grams / 1000).toFixed(1)} kg`;
}

/** 0.4 → "0.4", 50 → "50", 2 → "2". No trailing zeros. Locale-free: doses never localize. */
export function amountLabel(n: number): string {
  return String(n);
}

/**
 * Countable units pluralise in English, measures never. Taken from the
 * kit's own "Ivermectin drops" / "54 tabs" strings — do not extend this set.
 */
const COUNTABLE_UNITS = new Set(["drop", "tab", "capsule", "application"]);

/**
 * (2,"drop") → "2 drops", (0.4,"ml") → "0.4 ml", (54,"tab") → "54 tabs",
 * (1,"tab") → "1 tab" in English; in Ukrainian the unit is always rendered
 * exactly as entered ("2 drop", "54 tab") — see `pets.dose.countableUnit`
 * in `i18n/catalogue/pets.ts` and I18N-DESIGN.md §4 / SPEC §10a. The amount
 * itself is DATA and never goes through `f.plural` — only `amountLabel`.
 */
export function doseLabel(amount: number, unit: string, tr: Translator): string {
  const amountStr = amountLabel(amount);
  if (COUNTABLE_UNITS.has(unit)) {
    const unitStr = tr.t("pets.dose.countableUnit", { unit, plural: amount !== 1 });
    return `${amountStr} ${unitStr}`;
  }
  return `${amountStr} ${unit}`;
}

/** "Metacam 0.4 ml", "Vitamin C 50 mg". `medicationName` is DATA, never translated. */
export function courseLabel(
  medicationName: string,
  amount: number,
  unit: string,
  tr: Translator,
): string {
  return `${medicationName} ${doseLabel(amount, unit, tr)}`;
}

/**
 * "today 07:10", "yesterday 20:04", else "6 Aug 07:05" (locale date, e.g.
 * "6 серп. 07:05" in Ukrainian). Uses `formatHHMM` + `differenceInLocalDays`
 * from `@/domain` for the never-localized HH:MM portion, and
 * `tr.fmt.dayMonth` (Intl.DateTimeFormat) for the date fallback — no local
 * date arithmetic or month-name table here.
 */
export function eventWhenLabel(at: Date, today: LocalDate, tr: Translator): string {
  const eventDay = localDayKey(at);
  const daysAgo = differenceInLocalDays(today, eventDay);
  const time = formatHHMM(at); // never localized — SPEC §10a

  if (daysAgo === 0) return `${tr.t("pets.eventWhen.today")} ${time}`;
  if (daysAgo === 1) return `${tr.t("pets.eventWhen.yesterday")} ${time}`;

  const d = parseLocalDay(eventDay);
  return `${tr.fmt.dayMonth(d)} ${time}`;
}

/**
 * Joins present clauses with " · ", dropping nulls/undefined/empty strings.
 * Used for the roster's "species · age" and pet detail's
 * "species · age · weight" identity lines, where any clause may be absent —
 * a naive template string would leave a dangling or doubled middle dot.
 * Locale-free: it only joins already-localized strings.
 */
export function joinMeta(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => !!p).join(" · ");
}
