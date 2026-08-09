import { describe, it, expect } from "vitest";
import {
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  JOIN_CODE_TTL_MS,
  evaluateJoinCode,
  generateJoinCode,
  isWellFormedJoinCode,
} from "./joinCode";

describe("generateJoinCode", () => {
  it("never contains ambiguous glyphs and only uses the declared alphabet", () => {
    const forbidden = ["O", "0", "I", "1"];
    for (let i = 0; i < 2000; i++) {
      const code = generateJoinCode();
      expect(code).toHaveLength(JOIN_CODE_LENGTH);
      for (const char of code) {
        expect(JOIN_CODE_ALPHABET).toContain(char);
        expect(forbidden).not.toContain(char);
      }
    }
  });

  it("produces well-formed codes", () => {
    for (let i = 0; i < 50; i++) {
      expect(isWellFormedJoinCode(generateJoinCode())).toBe(true);
    }
  });
});

describe("isWellFormedJoinCode", () => {
  it("rejects the wrong length", () => {
    expect(isWellFormedJoinCode("ABCDE")).toBe(false);
    expect(isWellFormedJoinCode("ABCDEFG")).toBe(false);
    expect(isWellFormedJoinCode("")).toBe(false);
  });

  it("rejects characters outside the alphabet", () => {
    expect(isWellFormedJoinCode("ABCDEO")).toBe(false);
    expect(isWellFormedJoinCode("ABCDE0")).toBe(false);
    expect(isWellFormedJoinCode("ABCDEI")).toBe(false);
    expect(isWellFormedJoinCode("ABCDE1")).toBe(false);
    expect(isWellFormedJoinCode("abcdef")).toBe(false);
  });

  it("accepts a code drawn from the alphabet at the right length", () => {
    expect(isWellFormedJoinCode("ABCDEF")).toBe(true);
  });
});

describe("evaluateJoinCode", () => {
  const now = new Date("2026-06-01T12:00:00.000Z");
  const future = new Date(now.getTime() + JOIN_CODE_TTL_MS);
  const past = new Date(now.getTime() - 1000);

  it("refuses a missing row as not_found", () => {
    expect(evaluateJoinCode(null, now)).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses an already-used code, even if it would otherwise still be valid", () => {
    const row = { expiresAt: future, usedBy: "user-1", revokedAt: null };
    expect(evaluateJoinCode(row, now)).toEqual({ ok: false, reason: "already_used" });
  });

  it("refuses a revoked code", () => {
    const row = { expiresAt: future, usedBy: null, revokedAt: past };
    expect(evaluateJoinCode(row, now)).toEqual({ ok: false, reason: "revoked" });
  });

  it("refuses an expired code", () => {
    const row = { expiresAt: past, usedBy: null, revokedAt: null };
    expect(evaluateJoinCode(row, now)).toEqual({ ok: false, reason: "expired" });
  });

  it("treats expiresAt exactly at now as expired", () => {
    const row = { expiresAt: now, usedBy: null, revokedAt: null };
    expect(evaluateJoinCode(row, now)).toEqual({ ok: false, reason: "expired" });
  });

  it("accepts a code that is unused, unrevoked and not yet expired", () => {
    const row = { expiresAt: future, usedBy: null, revokedAt: null };
    expect(evaluateJoinCode(row, now)).toEqual({ ok: true });
  });

  it("checks already_used before revoked before expired", () => {
    // A code that is simultaneously used, revoked and expired is reported as
    // already_used first — the order pinned by CONTRACT-W8 §6.2.
    const row = { expiresAt: past, usedBy: "user-1", revokedAt: past };
    expect(evaluateJoinCode(row, now)).toEqual({ ok: false, reason: "already_used" });
  });

  it("checks revoked before expired", () => {
    const row = { expiresAt: past, usedBy: null, revokedAt: past };
    expect(evaluateJoinCode(row, now)).toEqual({ ok: false, reason: "revoked" });
  });
});
