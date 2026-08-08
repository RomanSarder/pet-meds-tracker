// Every string the three ported kit screens show is produced here, so no
// page invents one. See CONTRACT.md §3. Age derivation lives in the sibling
// `./age.ts` (`ageLabel`), not here.
import type { LocalDate, Species } from "@/domain";
import { differenceInLocalDays, formatHHMM, localDayKey, parseLocalDay } from "@/domain";

const SPECIES_LABELS: Record<Species, string> = {
  rabbit: "Rabbit",
  guinea_pig: "Guinea pig",
  cat: "Cat",
  dog: "Dog",
  other: "Other",
};

/** "rabbit" → "Rabbit", "guinea_pig" → "Guinea pig". The kit's own casing. */
export function speciesLabel(s: Species): string {
  return SPECIES_LABELS[s];
}

/** 1900 → "1.9 kg". null → null. */
export function weightLabel(grams: number | null): string | null {
  if (grams === null) return null;
  return `${(grams / 1000).toFixed(1)} kg`;
}

/** 0.4 → "0.4", 50 → "50", 2 → "2". No trailing zeros. */
export function amountLabel(n: number): string {
  return String(n);
}

/**
 * Countable units pluralise, measures never. Taken from the kit's own
 * "Ivermectin drops" / "54 tabs" strings — do not extend this set.
 */
const COUNTABLE_UNITS = new Set(["drop", "tab", "capsule", "application"]);

/** (2,"drop") → "2 drops", (0.4,"ml") → "0.4 ml", (54,"tab") → "54 tabs", (1,"tab") → "1 tab". */
export function doseLabel(amount: number, unit: string): string {
  const amountStr = amountLabel(amount);
  if (COUNTABLE_UNITS.has(unit)) {
    return `${amountStr} ${amount === 1 ? unit : `${unit}s`}`;
  }
  return `${amountStr} ${unit}`;
}

/** "Metacam 0.4 ml", "Vitamin C 50 mg". */
export function courseLabel(medicationName: string, amount: number, unit: string): string {
  return `${medicationName} ${doseLabel(amount, unit)}`;
}

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

/**
 * "today 07:10", "yesterday 20:04", else "6 Aug 07:05". Uses `formatHHMM` +
 * `differenceInLocalDays` from `@/domain` — no local date arithmetic here.
 */
export function eventWhenLabel(at: Date, today: LocalDate): string {
  const eventDay = localDayKey(at);
  const daysAgo = differenceInLocalDays(today, eventDay);
  const time = formatHHMM(at);

  if (daysAgo === 0) return `today ${time}`;
  if (daysAgo === 1) return `yesterday ${time}`;

  const d = parseLocalDay(eventDay);
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]} ${time}`;
}

/**
 * Joins present clauses with " · ", dropping nulls/undefined/empty strings.
 * Used for the roster's "species · age" and pet detail's
 * "species · age · weight" identity lines, where any clause may be absent —
 * a naive template string would leave a dangling or doubled middle dot.
 */
export function joinMeta(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => !!p).join(" · ");
}
