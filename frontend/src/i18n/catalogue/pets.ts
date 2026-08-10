// Owned by the Pets wave. Backs `features/pets/format.ts`.
import type { Formatters } from "../formatters";

export interface PetsMessages {
  "pets.species.rabbit": () => string;
  "pets.species.guineaPig": () => string;
  "pets.species.cat": () => string;
  "pets.species.dog": () => string;
  "pets.species.other": () => string;

  "pets.eventWhen.today": () => string;
  "pets.eventWhen.yesterday": () => string;

  // The per-language "does this unit take a suffix" rule for doseLabel. The
  // unit string itself (`p.unit`) is user-entered DATA and must be echoed
  // verbatim — never translated — in both languages. See SPEC §10a and
  // I18N-DESIGN.md §4: English morphology (`+"s"`) is only correct applied
  // to English-entered data in an English sentence; Ukrainian renders the
  // unit exactly as entered, with no suffix.
  "pets.dose.countableUnit": (p: { unit: string; plural: boolean }) => string;
}

// `f` is unused by this domain today but kept in the signature so every
// domain factory has the same shape (`(f: Formatters) => <Domain>Messages`).
export const enPets = (_f: Formatters): PetsMessages => ({
  "pets.species.rabbit": () => "Rabbit",
  "pets.species.guineaPig": () => "Guinea pig",
  "pets.species.cat": () => "Cat",
  "pets.species.dog": () => "Dog",
  "pets.species.other": () => "Other",

  "pets.eventWhen.today": () => "today",
  "pets.eventWhen.yesterday": () => "yesterday",

  "pets.dose.countableUnit": (p) => (p.plural ? `${p.unit}s` : p.unit),
});

export const ukPets = (_f: Formatters): PetsMessages => ({
  "pets.species.rabbit": () => "Кріль",
  "pets.species.guineaPig": () => "Морська свинка",
  "pets.species.cat": () => "Кіт",
  "pets.species.dog": () => "Собака",
  "pets.species.other": () => "Інше",

  "pets.eventWhen.today": () => "сьогодні",
  "pets.eventWhen.yesterday": () => "учора",

  // No English pluralisation morphology applied to Ukrainian sentences, and
  // the unit is never translated — it is echoed exactly as the user typed
  // it, regardless of amount.
  "pets.dose.countableUnit": (p) => p.unit,
});
