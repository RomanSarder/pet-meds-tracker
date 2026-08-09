// SPEC §5 — why a join code is refused, not merely that it is.
//
// `@/domain`'s `isJoinCodeUsable` answers the yes/no question and is frozen.
// The screens need the reason, so this narrows the same four conditions into the
// shared `JoinCodeRejection` vocabulary. The backend implements the identical
// decision against its own row type; the two are kept honest by both importing
// the reason union from `@pet-tracker/shared` (a types-only package, so the
// behaviour itself is deliberately implemented once per side and tested twice).
import type { JoinCodeRejection, JoinCodeVerdict } from "@pet-tracker/shared";
import type { JoinCode } from "@/domain";

export type { JoinCodeRejection, JoinCodeVerdict };

/**
 * Order matters and is the SPEC §5 order: a code that was revoked *and* has since
 * expired reports `revoked`, because "a newer code was issued" is the thing the
 * person holding it needs to hear.
 */
export function evaluateJoinCode(code: JoinCode | null, at: Date): JoinCodeVerdict {
  if (!code || code.deletedAt !== null) {
    return { ok: false, reason: "not_found" };
  }
  if (code.usedBy !== null) {
    return { ok: false, reason: "already_used" };
  }
  if (code.revokedAt !== null) {
    return { ok: false, reason: "revoked" };
  }
  if (new Date(code.expiresAt).getTime() <= at.getTime()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true };
}

/** One factual line per refusal. No exclamation marks, no blame. */
export function joinCodeRejectionMessage(reason: JoinCodeRejection): string {
  switch (reason) {
    case "not_found":
      return "That code does not match any household.";
    case "already_used":
      return "That code has already been used. Ask for a new one.";
    case "expired":
      return "That code has expired. Codes last 24 hours — ask for a new one.";
    case "revoked":
      return "That code was replaced by a newer one. Ask for the current code.";
    case "already_in_household":
      return "You are already a member of this household.";
  }
}

/** Thrown by the redeem mutation so the screen can render the reason. */
export class JoinCodeRejectedError extends Error {
  constructor(public readonly reason: JoinCodeRejection) {
    super(joinCodeRejectionMessage(reason));
    this.name = "JoinCodeRejectedError";
  }
}
