// Error types shared by every `Repo` implementation. Living here (rather than
// inside one repo file) is what lets `memoryRepo.ts` and `idbRepo.ts` throw
// and `instanceof`-check the exact same class.

/**
 * Thrown by `retractDoseEvent` when the row is older than
 * `UNDO_WINDOW_MS + RETRACT_GRACE_MS` (SPEC §7 item 1). A named error so
 * callers (the undo toast) can distinguish "too late" from any other
 * failure rather than pattern-matching a message string.
 */
export class RetractWindowExpiredError extends Error {
  constructor(id: string) {
    super(`Dose event ${id} is outside the retract window`);
    this.name = "RetractWindowExpiredError";
  }
}
