import { describe, expect, it } from "vitest";
import type { DoseEvent } from "@/domain";
import { dosesLoggedThisWeek, formatJoinedDate, memberLine, otherMemberNamesLabel } from "./memberLine";

function doseEvent(overrides: Partial<DoseEvent>): DoseEvent {
  return {
    id: "d1",
    courseId: "c1",
    scheduledFor: null,
    status: "given",
    loggedAt: "2026-08-08T07:00:00.000Z",
    givenAt: "2026-08-08T07:00:00.000Z",
    amount: 1,
    note: null,
    occurrenceKey: "c1|-",
    supersedesId: null,
    actorId: "u1",
    createdAt: "2026-08-08T07:00:00.000Z",
    updatedAt: "2026-08-08T07:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("formatJoinedDate", () => {
  it("renders 'd MMM' in local time", () => {
    expect(formatJoinedDate("2026-06-12T09:00:00.000Z")).toBe("12 Jun");
  });

  it("uses the local calendar day, not the UTC one", () => {
    // The test runner pins TZ=Europe/London (vitest.config.ts); in August
    // that's BST (UTC+1), so 23:30 UTC on the 8th is already 00:30 local on
    // the 9th. Formatting via UTC getters instead of local ones would read
    // this back as "8 Aug".
    expect(formatJoinedDate("2026-08-08T23:30:00.000Z")).toBe("9 Aug");
  });
});

describe("dosesLoggedThisWeek", () => {
  const NOW = new Date("2026-08-08T07:00:00.000Z");

  it("counts given and skipped events by the same actor within the last 7 days", () => {
    const events = [
      doseEvent({ id: "d1", actorId: "u1", status: "given", loggedAt: "2026-08-07T07:00:00.000Z" }),
      doseEvent({ id: "d2", actorId: "u1", status: "skipped", loggedAt: "2026-08-06T07:00:00.000Z" }),
    ];
    expect(dosesLoggedThisWeek(events, "u1", NOW)).toBe(2);
  });

  it("excludes missed events — those are written by the sweep, not logged", () => {
    const events = [doseEvent({ actorId: "u1", status: "missed", loggedAt: "2026-08-07T07:00:00.000Z" })];
    expect(dosesLoggedThisWeek(events, "u1", NOW)).toBe(0);
  });

  it("excludes events outside the 7-day window", () => {
    const events = [
      doseEvent({ id: "d1", actorId: "u1", loggedAt: "2026-08-01T06:59:59.000Z" }), // >7d before NOW
    ];
    expect(dosesLoggedThisWeek(events, "u1", NOW)).toBe(0);
  });

  it("excludes another actor's events", () => {
    const events = [doseEvent({ actorId: "u2", loggedAt: "2026-08-07T07:00:00.000Z" })];
    expect(dosesLoggedThisWeek(events, "u1", NOW)).toBe(0);
  });
});

describe("memberLine", () => {
  it("always reads 'You · joined ‹date›' for self, even with activity this week", () => {
    expect(
      memberLine({ isSelf: true, joinedAt: "2026-06-12T09:00:00.000Z", dosesThisWeek: 5 }),
    ).toBe("You · joined 12 Jun");
  });

  it("reads the activity line for another member who logged doses this week", () => {
    expect(
      memberLine({ isSelf: false, joinedAt: "2026-06-02T09:00:00.000Z", dosesThisWeek: 4 }),
    ).toBe("Logged 4 doses this week");
  });

  it("falls back to the joined line for another member with no activity this week", () => {
    expect(
      memberLine({ isSelf: false, joinedAt: "2026-06-02T09:00:00.000Z", dosesThisWeek: 0 }),
    ).toBe("Joined 2 Jun");
  });
});

describe("otherMemberNamesLabel", () => {
  it("falls back to the generic line when there is nobody else", () => {
    expect(otherMemberNamesLabel([])).toBe("Everyone in the household");
  });

  it("names the one other member", () => {
    expect(otherMemberNamesLabel(["Marta"])).toBe("Marta");
  });

  it("joins two names with 'and'", () => {
    expect(otherMemberNamesLabel(["Marta", "Ilya"])).toBe("Marta and Ilya");
  });

  it("joins three or more names with commas and a trailing 'and'", () => {
    expect(otherMemberNamesLabel(["Marta", "Ilya", "Sam"])).toBe("Marta, Ilya and Sam");
  });
});
