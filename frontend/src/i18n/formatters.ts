// Wave 1 — the i18n foundation. See I18N-DESIGN.md §2.2.
//
// `Intl.*` instances are expensive to construct and these formatters run
// inside render, so every instance is built once per locale and cached in a
// module-level map.

import type { Locale } from "./locale";

export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

export interface Formatters {
  /** `Intl.PluralRules` for the locale; falls back to `other` when the selected form is absent. */
  plural(count: number, forms: PluralForms): string;
  /** "12 Aug" / "12 серп." */
  dayMonth(d: Date): string;
  /** "Wed 12 Aug" / "ср, 12 серп." */
  weekdayDayMonth(d: Date): string;
  /** "Mon" / "пн" — short weekday name from an ISO weekday number 1..7 (1 = Monday). */
  isoWeekdayShort(isoWeekday: number): string;
}

// en-GB (not en-US) so `dayMonth`/`weekdayDayMonth` render "12 Aug", matching
// the app's existing English output. en-US would render "Aug 12".
const INTL_LOCALE_TAG: Record<Locale, string> = {
  uk: "uk-UA",
  en: "en-GB",
};

interface CachedIntl {
  pluralRules: Intl.PluralRules;
  dayMonthFormat: Intl.DateTimeFormat;
  weekdayDayMonthFormat: Intl.DateTimeFormat;
  /** Index 0 = Monday .. index 6 = Sunday. */
  weekdayShortNames: string[];
}

const cache = new Map<Locale, CachedIntl>();

/**
 * Builds the seven short weekday names from a fixed reference week of real
 * `Date` objects (Mon 2026-08-03 .. Sun 2026-08-09) run through
 * `Intl.DateTimeFormat`, rather than a hand-written lookup table — the
 * locale's own weekday-naming rules produce the strings.
 */
function buildWeekdayShortNames(intlLocaleTag: string): string[] {
  const format = new Intl.DateTimeFormat(intlLocaleTag, { weekday: "short" });
  const names: string[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    names.push(format.format(new Date(2026, 7, 3 + offset)));
  }
  return names;
}

function getCached(locale: Locale): CachedIntl {
  const existing = cache.get(locale);
  if (existing) return existing;

  const intlLocaleTag = INTL_LOCALE_TAG[locale];
  const entry: CachedIntl = {
    pluralRules: new Intl.PluralRules(intlLocaleTag),
    dayMonthFormat: new Intl.DateTimeFormat(intlLocaleTag, { day: "numeric", month: "short" }),
    weekdayDayMonthFormat: new Intl.DateTimeFormat(intlLocaleTag, {
      weekday: "short",
      day: "numeric",
      month: "short",
    }),
    weekdayShortNames: buildWeekdayShortNames(intlLocaleTag),
  };
  cache.set(locale, entry);
  return entry;
}

export function createFormatters(locale: Locale): Formatters {
  const cached = getCached(locale);
  return {
    plural(count, forms) {
      const rule = cached.pluralRules.select(count);
      return forms[rule] ?? forms.other;
    },
    dayMonth(d) {
      return cached.dayMonthFormat.format(d);
    },
    weekdayDayMonth(d) {
      return cached.weekdayDayMonthFormat.format(d);
    },
    isoWeekdayShort(isoWeekday) {
      return cached.weekdayShortNames[isoWeekday - 1];
    },
  };
}
