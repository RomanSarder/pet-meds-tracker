import { describe, it, expect } from "vitest";
import { generateJoinCode, isJoinCodeUsable, isWellFormedJoinCode } from "./joinCodes";
import { JOIN_CODE_ALPHABET } from "./constants";
import type { JoinCode } from "./types";

function makeJoinCode(overrides: Partial<JoinCode> = {}): JoinCode {
  return {
    id: "h0000000-0000-4000-8000-000000000001",
    householdId: "f0000000-0000-4000-8000-000000000001",
    code: "K7RMQ4",
    createdBy: "u0000000-0000-4000-8000-000000000001",
    expiresAt: "2026-08-09T07:00:00.000Z",
    usedBy: null,
    revokedAt: null,
    createdAt: "2026-08-08T07:00:00.000Z",
    updatedAt: "2026-08-08T07:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("generateJoinCode", () => {
  it("returns a 6-character code drawn from the alphabet", () => {
    const code = generateJoinCode();
    expect(code).toHaveLength(6);
    for (const char of code) {
      expect(JOIN_CODE_ALPHABET.includes(char)).toBe(true);
    }
  });

  it("never produces O, 0, I or 1 across 500 generated codes", () => {
    const banned = ["O", "0", "I", "1"];
    for (let i = 0; i < 500; i++) {
      const code = generateJoinCode();
      for (const char of code) {
        expect(banned.includes(char)).toBe(false);
      }
    }
  });
});

describe("isWellFormedJoinCode", () => {
  it("accepts a well-formed code", () => {
    expect(isWellFormedJoinCode("K7RMQ4")).toBe(true);
  });

  it("rejects a code of the wrong length", () => {
    expect(isWellFormedJoinCode("K7RMQ")).toBe(false);
    expect(isWellFormedJoinCode("K7RMQ44")).toBe(false);
    expect(isWellFormedJoinCode("")).toBe(false);
  });

  it("rejects a code containing an out-of-alphabet character", () => {
    expect(isWellFormedJoinCode("K7RMQO")).toBe(false); // O excluded
    expect(isWellFormedJoinCode("K7RMQ0")).toBe(false); // 0 excluded
    expect(isWellFormedJoinCode("K7RMQI")).toBe(false); // I excluded
    expect(isWellFormedJoinCode("K7RMQ1")).toBe(false); // 1 excluded
    expect(isWellFormedJoinCode("k7rmq4")).toBe(false); // lowercase not normalised here
  });
});

describe("isJoinCodeUsable", () => {
  const now = new Date("2026-08-08T12:00:00.000Z");

  it("returns true for a fresh unused code", () => {
    const code = makeJoinCode({ expiresAt: "2026-08-09T07:00:00.000Z" });
    expect(isJoinCodeUsable(code, now)).toBe(true);
  });

  it("returns false when used", () => {
    const code = makeJoinCode({ usedBy: "u0000000-0000-4000-8000-000000000002" });
    expect(isJoinCodeUsable(code, now)).toBe(false);
  });

  it("returns false when revoked", () => {
    const code = makeJoinCode({ revokedAt: "2026-08-08T08:00:00.000Z" });
    expect(isJoinCodeUsable(code, now)).toBe(false);
  });

  it("returns false when soft-deleted", () => {
    const code = makeJoinCode({ deletedAt: "2026-08-08T08:00:00.000Z" });
    expect(isJoinCodeUsable(code, now)).toBe(false);
  });

  it("returns false when expiresAt is exactly now", () => {
    const code = makeJoinCode({ expiresAt: now.toISOString() });
    expect(isJoinCodeUsable(code, now)).toBe(false);
  });

  it("returns false when expiresAt is in the past", () => {
    const code = makeJoinCode({ expiresAt: "2026-08-08T00:00:00.000Z" });
    expect(isJoinCodeUsable(code, now)).toBe(false);
  });
});
