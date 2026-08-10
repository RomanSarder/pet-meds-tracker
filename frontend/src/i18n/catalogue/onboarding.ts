// Owned by the Onboarding wave. Every user-facing literal from
// `features/onboarding/FirstRunPage.tsx` lives here. `nameSuggestion.ts` is
// pure name-guessing logic with no prose of its own and needs no entries.
import type { Formatters } from "../formatters";

export interface OnboardingMessages {
  "onboarding.title": () => string;
  "onboarding.subtitle": () => string;
  "onboarding.nameLabel": () => string;
  "onboarding.namePlaceholder": () => string;
  /**
   * "3 / 24 · your email is never shown to anyone" — `count`/`max` are the
   * live character counter against `DISPLAY_NAME_MAX`, interpolated as plain
   * numbers (not a plural count of items, so not routed through `f.plural`).
   */
  "onboarding.nameCounter": (p: { count: number; max: number }) => string;
  "onboarding.startHousehold": () => string;
  "onboarding.haveJoinCode": () => string;
}

// `f` is unused by this domain today but kept in the signature so every
// domain factory has the same shape (`(f: Formatters) => <Domain>Messages`).
export const enOnboarding = (_f: Formatters): OnboardingMessages => ({
  "onboarding.title": () => "What should we call you?",
  "onboarding.subtitle": () =>
    "Shown against every dose you log, so the rest of the household can see who gave what. You can change it later.",
  "onboarding.nameLabel": () => "Your name",
  "onboarding.namePlaceholder": () => "e.g. Roman",
  "onboarding.nameCounter": (p) =>
    `${p.count} / ${p.max} · your email is never shown to anyone`,
  "onboarding.startHousehold": () => "Start a household",
  "onboarding.haveJoinCode": () => "I have a join code",
});

export const ukOnboarding = (_f: Formatters): OnboardingMessages => ({
  "onboarding.title": () => "Як до вас звертатися?",
  "onboarding.subtitle": () =>
    "Показується біля кожної дози, яку ви записуєте, щоб інші учасники домогосподарства бачили, хто що дав. Ви можете змінити це пізніше.",
  "onboarding.nameLabel": () => "Ваше ім'я",
  "onboarding.namePlaceholder": () => "напр. Роман",
  "onboarding.nameCounter": (p) =>
    `${p.count} / ${p.max} · вашу електронну пошту ніхто не бачить`,
  "onboarding.startHousehold": () => "Створити домогосподарство",
  "onboarding.haveJoinCode": () => "У мене є код запрошення",
});
