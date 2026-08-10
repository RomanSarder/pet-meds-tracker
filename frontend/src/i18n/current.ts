// Wave 1 — the i18n foundation. See I18N-DESIGN.md §2.5.
//
// The non-React accessor: notifications and the service-worker bridge build
// copy outside a component tree. `LocaleProvider` calls `setCurrentLocale`
// whenever the locale changes so the two never diverge while the app is
// running; `currentTranslator` falls back to storage when the provider never
// ran (e.g. a background script that boots before React does).
import { DEFAULT_LOCALE, readStoredLocale, type Locale } from "./locale";
import { createTranslator, type Translator } from "./translator";

let currentLocale: Locale | null = null;

export function setCurrentLocale(l: Locale): void {
  currentLocale = l;
}

export function currentTranslator(): Translator {
  const locale = currentLocale ?? readStoredLocale() ?? DEFAULT_LOCALE;
  return createTranslator(locale);
}
