/**
 * The exact copy for a notification. SPEC §7: "Notification copy is
 * factual: 'Clover · Metacam 0.4 ml due now'." No emoji, no exclamation, no
 * encouragement — the title is the whole message; nothing sets a `body`.
 */
import type { DoseState } from "@/engine";
import { doseLabel } from "@/features/pets/format";
import { currentTranslator } from "@/i18n/current";

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
 *
 * Notification copy is built outside React (from the scheduler and the
 * service-worker bridge), so this reads `currentTranslator()` — the
 * non-React accessor `LocaleProvider` keeps in sync with the user's choice —
 * rather than taking a `Translator` parameter. Read fresh on every call
 * (never cached at module load) so a language switch is reflected in the
 * very next notification.
 */
export function buildTitle(input: {
  petName: string;
  medicationName: string;
  amount: number;
  unit: string;
  state: DoseState;
}): string {
  const tr = currentTranslator();
  const stateWord =
    input.state === "due" ? tr.t("notifications.stateDueNow") : tr.t("notifications.stateOverdue");
  return `${input.petName} · ${input.medicationName} ${doseLabel(input.amount, input.unit, tr)} ${stateWord}`;
}
