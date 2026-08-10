/**
 * The exact copy for a notification. SPEC §7: "Notification copy is
 * factual: 'Clover · Metacam 0.4 ml due now'." No emoji, no exclamation, no
 * encouragement — the title is the whole message; nothing sets a `body`.
 */
import type { DoseState } from "@/engine";
import { doseLabel } from "@/features/pets/format";
import { createTranslator } from "@/i18n";

// TODO(wave3): replace enTr with a real translator when the notifications
// feature is localized.
const enTr = createTranslator("en");

/**
 * `` `${petName} · ${medicationName} ${doseLabel(amount, unit)} ${stateWord}` ``
 * with U+00B7 MIDDLE DOT spaced either side. `doseLabel` (from
 * `features/pets/format.ts`, already used by the Today/Pet-detail screens)
 * supplies the amount+unit segment — including its countable-unit
 * pluralisation ("2 drops") — so this module does not keep a second,
 * drifting copy of that formatting. Only `due` and `overdue` ever reach here
 * (SPEC §4 + §7) — every other `DoseState` falls back to "overdue" rather
 * than widening the signature, since the scheduler never calls this for
 * them.
 */
export function buildTitle(input: {
  petName: string;
  medicationName: string;
  amount: number;
  unit: string;
  state: DoseState;
}): string {
  const stateWord = input.state === "due" ? "due now" : "overdue";
  return `${input.petName} · ${input.medicationName} ${doseLabel(input.amount, input.unit, enTr)} ${stateWord}`;
}
