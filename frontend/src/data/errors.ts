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
 *
 * `scheduledFor` is the colliding event's own occurrence key half — the caller needs it to tell
 * apart the two guards that both throw this SAME error: an exact `scheduledFor` match (the
 * same-occurrence hard block, never bypassable) from a grace-window hit on a DIFFERENT occurrence
 * (bypassable via `allowWithinGrace`, and the one the early-give confirm dialog is for). Without
 * it, a caller offering that dialog whenever `earlyGive` is set cannot distinguish "give this
 * anyway?" from "this exact dose was already given" — see the F2 fix in `useLogDose.ts`'s
 * `onError`, which gates the dialog on `error.scheduledFor !== vars.scheduledFor`.
 */
export class DuplicateDoseError extends Error {
  readonly existingEventId: string;
  readonly actorId: string;
  readonly givenAt: IsoDateTime;
  readonly status: DoseEventStatus;
  readonly scheduledFor: IsoDateTime | null;
  constructor(existing: DoseEvent) {
    super(`A dose is already logged for this occurrence`);
    this.name = "DuplicateDoseError";
    this.existingEventId = existing.id;
    this.actorId = existing.actorId;
    this.givenAt = existing.givenAt;
    this.status = existing.status;
    this.scheduledFor = existing.scheduledFor;
  }
}

/**
 * The hard floor beneath `allowWithinGrace` (`EARLY_GIVE_FLOOR_MIN`, `@/domain`): thrown instead
 * of `DuplicateDoseError` when the attempted `givenAt` lands within the floor of ANY live dose
 * already on the course, so the caller can tell it apart and refuse flatly — no early-give
 * dialog, no retry path, because none exists for this one. Checked unconditionally, before the
 * bypassable grace-window heuristic, so `allowWithinGrace: true` cannot route around it either.
 */
export class TooSoonSinceLastDoseError extends Error {
  readonly minutesSinceLast: number;
  constructor(minutesSinceLast: number) {
    super(`Only ${minutesSinceLast} minute(s) since the last dose on this course`);
    this.name = "TooSoonSinceLastDoseError";
    this.minutesSinceLast = minutesSinceLast;
  }
}
