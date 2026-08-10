// Wave 1 owns this file. Cross-cutting strings shared by more than one
// screen — currently just the tab-bar labels used at the AppShell call site.
import type { Formatters } from "../formatters";

export interface CommonMessages {
  "nav.today": () => string;
  "nav.pets": () => string;
  "nav.supplies": () => string;
}

// `f` is unused by this domain today but kept in the signature so every
// domain factory has the same shape (`(f: Formatters) => <Domain>Messages`).
export const enCommon = (_f: Formatters): CommonMessages => ({
  "nav.today": () => "Today",
  "nav.pets": () => "Pets",
  "nav.supplies": () => "Supplies",
});

export const ukCommon = (_f: Formatters): CommonMessages => ({
  "nav.today": () => "Сьогодні",
  "nav.pets": () => "Улюбленці",
  "nav.supplies": () => "Запаси",
});
