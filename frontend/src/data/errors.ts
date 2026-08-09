// Error types shared by every `Repo` implementation. Living here (rather than
// inside one repo file) is what lets `memoryRepo.ts` and `idbRepo.ts` throw
// and `instanceof`-check the exact same class.
import type { DoseEvent, DoseEventStatus, IsoDateTime } from "@/domain";

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

/**
 * SPEC §5: "Two people logging the same dose within the grace window produce one DoseEvent; the
 * second log is rejected client-side." Carries the ids the caller needs to compose §5's exact
 * copy — "Already given by Marta at 07:12" — via `displayNameFor(actorId)`. It deliberately
 * carries no name and no address; the message string contains neither.
 */
export class DuplicateDoseError extends Error {
  readonly existingEventId: string;
  readonly actorId: string;
  readonly givenAt: IsoDateTime;
  readonly status: DoseEventStatus;
  constructor(existing: DoseEvent) {
    super(`A dose is already logged for this occurrence`);
    this.name = "DuplicateDoseError";
    this.existingEventId = existing.id;
    this.actorId = existing.actorId;
    this.givenAt = existing.givenAt;
    this.status = existing.status;
  }
}
