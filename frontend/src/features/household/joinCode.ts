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
import type { Translator } from "@/i18n";

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
export function joinCodeRejectionMessage(reason: JoinCodeRejection, tr: Translator): string {
  switch (reason) {
    case "not_found":
      return tr.t("household.joinCode.notFound");
    case "already_used":
      return tr.t("household.joinCode.alreadyUsed");
    case "expired":
      return tr.t("household.joinCode.expired");
    case "revoked":
      return tr.t("household.joinCode.revoked");
    case "already_in_household":
      return tr.t("household.joinCode.alreadyInHousehold");
  }
}

/**
 * Thrown by the redeem mutation so the screen can render the reason. The
 * `Error.message` here is a diagnostic string only — never rendered to a
 * user; the screen renders `.reason` through the live translator instead
 * (`joinCodeRejectionMessage` in `JoinHouseholdPage.tsx`), so this stays a
 * plain, un-catalogued label rather than pulling in a translator for text
 * nobody sees.
 */
export class JoinCodeRejectedError extends Error {
  constructor(public readonly reason: JoinCodeRejection) {
    super(`Join code rejected: ${reason}`);
    this.name = "JoinCodeRejectedError";
  }
}
