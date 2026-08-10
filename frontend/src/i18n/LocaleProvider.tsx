// Wave 1 — the i18n foundation. See I18N-DESIGN.md §2.4.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { DEFAULT_LOCALE, readStoredLocale, writeStoredLocale, type Locale } from "./locale";
import { createTranslator, type Translator } from "./translator";
import { setCurrentLocale } from "./current";

interface LocaleContextValue {
  translator: Translator;
  locale: Locale;
  setLocale: (l: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider(props: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(
    () => props.initialLocale ?? readStoredLocale() ?? DEFAULT_LOCALE,
  );

  // Runs on mount (covering a fresh page load) and again on every locale
  // change. Keeps `document.documentElement.lang` and the non-React
  // `current.ts` accessor in sync with whatever this provider is showing,
  // even when `initialLocale` overrides what's in storage.
  useEffect(() => {
    document.documentElement.lang = locale;
    setCurrentLocale(locale);
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    writeStoredLocale(l);
    setLocaleState(l);
  }, []);

  const translator = useMemo(() => createTranslator(locale), [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({ translator, locale, setLocale }),
    [translator, locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{props.children}</LocaleContext.Provider>;
}

function useLocaleContext(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error(
      "useTranslator/useT/useLocale must be called within a <LocaleProvider>. " +
        "Wrap the component tree (see frontend/src/main.tsx) or, in a test, " +
        "render through frontend/src/test/renderWithProviders.tsx.",
    );
  }
  return ctx;
}

export function useTranslator(): Translator {
  return useLocaleContext().translator;
}

export function useT() {
  return useLocaleContext().translator.t;
}

export function useLocale(): { locale: Locale; setLocale: (l: Locale) => void } {
  const { locale, setLocale } = useLocaleContext();
  return { locale, setLocale };
}
