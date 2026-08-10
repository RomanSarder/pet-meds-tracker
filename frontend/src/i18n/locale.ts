// Wave 1 — the i18n foundation. See I18N-DESIGN.md §2.1.

export type Locale = "uk" | "en";

/** SPEC §10a — Ukrainian is the default; a device with no stored preference sees Ukrainian. */
export const DEFAULT_LOCALE: Locale = "uk";

export const LOCALE_STORAGE_KEY = "petmeds.language";

function isLocale(value: unknown): value is Locale {
  return value === "uk" || value === "en";
}

/**
 * Reads the persisted language choice. Tolerant of everything that can go
 * wrong with `localStorage`: private-mode throws, missing keys, and junk
 * values written by an older/future build all resolve to `null` rather than
 * ever returning something that isn't exactly `"uk"` or `"en"`.
 */
export function readStoredLocale(): Locale | null {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Tolerant of `localStorage` throwing (private mode / storage disabled). */
export function writeStoredLocale(l: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, l);
  } catch {
    // Nothing to do — the in-memory locale still applies for this session.
  }
}
