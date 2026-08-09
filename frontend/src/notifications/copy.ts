/**
 * The exact copy for a notification. SPEC §7: "Notification copy is
 * factual: 'Clover · Metacam 0.4 ml due now'." No emoji, no exclamation, no
 * encouragement — the title is the whole message; nothing sets a `body`.
 */
import type { DoseState } from "@/engine";

/**
 * 0.4 -> "0.4", 1 -> "1", 0.5 -> "0.5", 12.5 -> "12.5" — no trailing zeros.
 *
 * Checked `domain/`, `lib/` and `features/today/` first: `features/today`
 * interpolates `occ.doseAmount` straight into a template string with no
 * helper, and neither `domain/` nor `lib/` has one. (`features/pets/format.ts`
 * has an `amountLabel` that does the same `String(n)` job, but it lives
 * outside the three locations the contract names and outside the files this
 * builder owns, so it is not "found" for reuse purposes here.) `String(n)`
 * already drops trailing zeros and matches every fixture, so nothing fancier
 * is needed.
 */
export function formatAmount(n: number): string {
  return String(n);
}

/**
 * `` `${petName} · ${medicationName} ${formatAmount(amount)} ${unit} ${stateWord}` ``
 * with U+00B7 MIDDLE DOT spaced either side. Only `due` and `overdue` ever
 * reach here (SPEC §4 + §7) — every other `DoseState` falls back to
 * "overdue" rather than widening the signature, since the scheduler never
 * calls this for them.
 */
export function buildTitle(input: {
  petName: string;
  medicationName: string;
  amount: number;
  unit: string;
  state: DoseState;
}): string {
  const stateWord = input.state === "due" ? "due now" : "overdue";
  return `${input.petName} · ${input.medicationName} ${formatAmount(input.amount)} ${input.unit} ${stateWord}`;
}
