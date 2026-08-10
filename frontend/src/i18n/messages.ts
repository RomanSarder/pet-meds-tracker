// Wave 1 — the i18n foundation. See I18N-DESIGN.md §2.3.
import type { Locale } from "./locale";
import { createFormatters } from "./formatters";
import { type CommonMessages, enCommon, ukCommon } from "./catalogue/common";
import { type ScheduleMessages, enSchedule, ukSchedule } from "./catalogue/schedule";
import { type TodayMessages, enToday, ukToday } from "./catalogue/today";
import { type PetsMessages, enPets, ukPets } from "./catalogue/pets";
import { type HistoryMessages, enHistory, ukHistory } from "./catalogue/history";
import { type SuppliesMessages, enSupplies, ukSupplies } from "./catalogue/supplies";
import { type HouseholdMessages, enHousehold, ukHousehold } from "./catalogue/household";
import { type OnboardingMessages, enOnboarding, ukOnboarding } from "./catalogue/onboarding";
import { type SettingsMessages, enSettings, ukSettings } from "./catalogue/settings";
import {
  type NotificationsMessages,
  enNotifications,
  ukNotifications,
} from "./catalogue/notifications";

export type Messages = CommonMessages &
  ScheduleMessages &
  TodayMessages &
  PetsMessages &
  HistoryMessages &
  SuppliesMessages &
  HouseholdMessages &
  OnboardingMessages &
  SettingsMessages &
  NotificationsMessages;

export function createMessages(locale: Locale): Messages {
  const f = createFormatters(locale);
  const build = locale === "en"
    ? {
        common: enCommon,
        schedule: enSchedule,
        today: enToday,
        pets: enPets,
        history: enHistory,
        supplies: enSupplies,
        household: enHousehold,
        onboarding: enOnboarding,
        settings: enSettings,
        notifications: enNotifications,
      }
    : {
        common: ukCommon,
        schedule: ukSchedule,
        today: ukToday,
        pets: ukPets,
        history: ukHistory,
        supplies: ukSupplies,
        household: ukHousehold,
        onboarding: ukOnboarding,
        settings: ukSettings,
        notifications: ukNotifications,
      };

  return {
    ...build.common(f),
    ...build.schedule(f),
    ...build.today(f),
    ...build.pets(f),
    ...build.history(f),
    ...build.supplies(f),
    ...build.household(f),
    ...build.onboarding(f),
    ...build.settings(f),
    ...build.notifications(f),
  };
}
