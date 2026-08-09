import { JoinCodeVerdict } from "@pet-tracker/shared";

// SPEC §2/§5: six uppercase chars, ambiguous glyphs excluded (no O/0, no I/1).
export const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const JOIN_CODE_LENGTH = 6;
export const JOIN_CODE_TTL_MS = 24 * 60 * 60 * 1000;

export function generateJoinCode(): string {
  // 256 % 32 === 0, so `bytes[i] % 32` is a uniform pick over the 32-character
  // alphabet — no rejection loop, no Math.random, per CONTRACT-W8 §6.2.
  const bytes = new Uint8Array(JOIN_CODE_LENGTH);
  crypto.getRandomValues(bytes);

  let code = "";
  for (let i = 0; i < bytes.length; i++) {
    code += JOIN_CODE_ALPHABET[bytes[i] % JOIN_CODE_ALPHABET.length];
  }
  return code;
}

export function isWellFormedJoinCode(code: string): boolean {
  if (code.length !== JOIN_CODE_LENGTH) {
    return false;
  }
  for (const char of code) {
    if (!JOIN_CODE_ALPHABET.includes(char)) {
      return false;
    }
  }
  return true;
}

export function evaluateJoinCode(
  row: { expiresAt: Date; usedBy: string | null; revokedAt: Date | null } | null,
  now: Date,
): JoinCodeVerdict {
  if (!row) {
    return { ok: false, reason: "not_found" };
  }
  if (row.usedBy !== null) {
    return { ok: false, reason: "already_used" };
  }
  if (row.revokedAt !== null) {
    return { ok: false, reason: "revoked" };
  }
  if (row.expiresAt <= now) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true };
}
