import { describe, it, expect } from "vitest";
import { displayNameFor, displayNameLookup } from "./identity";
import { UNKNOWN_ACTOR_NAME } from "./constants";
import type { User } from "./types";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "u0000000-0000-4000-8000-000000000001",
    householdId: "f0000000-0000-4000-8000-000000000001",
    email: null,
    displayName: "Roman",
    tint: 1,
    isSelf: true,
    joinedAt: "2026-06-01T09:00:00.000Z",
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-06-01T09:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("displayNameFor", () => {
  it("returns the display name for a known id", () => {
    const users = [makeUser({ id: "u1", displayName: "Roman" })];
    expect(displayNameFor("u1", users)).toBe("Roman");
  });

  it("returns 'Someone' for an unknown id", () => {
    const users = [makeUser({ id: "u1", displayName: "Roman" })];
    expect(displayNameFor("nonexistent", users)).toBe(UNKNOWN_ACTOR_NAME);
  });

  it("returns 'Someone' when displayName is empty", () => {
    const users = [makeUser({ id: "u1", displayName: "" })];
    expect(displayNameFor("u1", users)).toBe(UNKNOWN_ACTOR_NAME);
  });

  it("returns 'Someone' when displayName is whitespace only", () => {
    const users = [makeUser({ id: "u1", displayName: "   " })];
    expect(displayNameFor("u1", users)).toBe(UNKNOWN_ACTOR_NAME);
  });

  it("still resolves the name for a soft-deleted user", () => {
    const users = [
      makeUser({ id: "u1", displayName: "Marta", deletedAt: "2026-08-01T00:00:00.000Z" }),
    ];
    expect(displayNameFor("u1", users)).toBe("Marta");
  });

  it("never returns a string containing '@' even when email is populated", () => {
    // Not a real email address — just a value containing "@" to prove the
    // function never reads this field for display (CONTRACT.md §0 forbids
    // writing literal email addresses anywhere, including tests).
    const users = [
      makeUser({
        id: "u1",
        displayName: "Roman",
        email: "@",
      }),
    ];
    expect(displayNameFor("u1", users)).not.toContain("@");
    expect(displayNameFor("unknown", users)).not.toContain("@");
  });
});

describe("displayNameLookup", () => {
  it("behaves identically to displayNameFor for a known id", () => {
    const users = [makeUser({ id: "u1", displayName: "Roman" })];
    const name = displayNameLookup(users);
    expect(name("u1")).toBe(displayNameFor("u1", users));
  });

  it("behaves identically to displayNameFor for an unknown id", () => {
    const users = [makeUser({ id: "u1", displayName: "Roman" })];
    const name = displayNameLookup(users);
    expect(name("nonexistent")).toBe(displayNameFor("nonexistent", users));
  });

  it("behaves identically to displayNameFor for a blank name", () => {
    const users = [makeUser({ id: "u1", displayName: "  " })];
    const name = displayNameLookup(users);
    expect(name("u1")).toBe(displayNameFor("u1", users));
  });

  it("behaves identically to displayNameFor for a soft-deleted user", () => {
    const users = [
      makeUser({ id: "u1", displayName: "Marta", deletedAt: "2026-08-01T00:00:00.000Z" }),
    ];
    const name = displayNameLookup(users);
    expect(name("u1")).toBe(displayNameFor("u1", users));
  });

  it("never returns a string containing '@'", () => {
    const users = [makeUser({ id: "u1", displayName: "Roman", email: "@" })];
    const name = displayNameLookup(users);
    expect(name("u1")).not.toContain("@");
  });
});
