// Wave 1 — the i18n foundation. Public surface. See I18N-DESIGN.md §2.

export {
  type Locale,
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  readStoredLocale,
  writeStoredLocale,
} from "./locale";

export { type Formatters, type PluralForms, createFormatters } from "./formatters";

export type { CommonMessages } from "./catalogue/common";
export type { ScheduleMessages } from "./catalogue/schedule";
export type { TodayMessages } from "./catalogue/today";
export type { PetsMessages } from "./catalogue/pets";
export type { HistoryMessages } from "./catalogue/history";
export type { SuppliesMessages } from "./catalogue/supplies";
export type { HouseholdMessages } from "./catalogue/household";
export type { OnboardingMessages } from "./catalogue/onboarding";
export type { SettingsMessages } from "./catalogue/settings";
export type { NotificationsMessages } from "./catalogue/notifications";

export { type Messages, createMessages } from "./messages";
export { type MessageKey, type T, type Translator, createTranslator } from "./translator";

export { LocaleProvider, useTranslator, useT, useLocale } from "./LocaleProvider";

export { currentTranslator, setCurrentLocale } from "./current";
