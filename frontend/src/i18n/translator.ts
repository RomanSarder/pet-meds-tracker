// Wave 1 — the i18n foundation. See I18N-DESIGN.md §2.3.
import type { Locale } from "./locale";
import { createFormatters, type Formatters } from "./formatters";
import { createMessages, type Messages } from "./messages";

export type MessageKey = keyof Messages;

export type T = <K extends MessageKey>(key: K, ...args: Parameters<Messages[K]>) => string;

export interface Translator {
  t: T;
  locale: Locale;
  fmt: Formatters;
}

const cache = new Map<Locale, Translator>();

function buildTranslator(locale: Locale): Translator {
  const fmt = createFormatters(locale);
  const messages = createMessages(locale);
  // `T` is a generic call signature (`<K>(key: K, ...args: Parameters<Messages[K]>) => string`)
  // correlating the key with its own argument tuple. TypeScript cannot verify
  // that correlation inside a single non-generic implementation, so the
  // function body is written against the erased `(key, ...args: unknown[])`
  // shape and cast once to `T` here — the only place, and outside any
  // catalogue file.
  const t = ((key: MessageKey, ...args: unknown[]) => {
    const entry = messages[key] as (...a: unknown[]) => string;
    return entry(...args);
  }) as T;
  return { t, locale, fmt };
}

/** Memoized per locale — translators are cheap to reuse and expensive to rebuild. */
export function createTranslator(locale: Locale): Translator {
  const cached = cache.get(locale);
  if (cached) return cached;
  const translator = buildTranslator(locale);
  cache.set(locale, translator);
  return translator;
}
