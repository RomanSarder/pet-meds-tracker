// SPEC §5: household join codes — six-character, single-use, 24h TTL.
import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from "./constants";
import type { JoinCode } from "./types";

/** Six characters drawn from `JOIN_CODE_ALPHABET`. Uses `crypto.getRandomValues`. */
export function generateJoinCode(): string {
  const bytes = new Uint32Array(JOIN_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    code += JOIN_CODE_ALPHABET[bytes[i] % JOIN_CODE_ALPHABET.length];
  }
  return code;
}

/** Shape-checks a user-entered code: length 6, every char in the alphabet. Case-insensitive input is caller-normalised. */
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

/** SPEC §5: usable iff not used, not revoked, not soft-deleted, and `expiresAt` is strictly in the future. */
export function isJoinCodeUsable(code: JoinCode, at: Date): boolean {
  if (code.usedBy !== null) {
    return false;
  }
  if (code.revokedAt !== null) {
    return false;
  }
  if (code.deletedAt !== null) {
    return false;
  }
  return new Date(code.expiresAt).getTime() > at.getTime();
}
