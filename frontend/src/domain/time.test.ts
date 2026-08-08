import { describe, it, expect } from "vitest";
import {
  atLocalTime,
  differenceInLocalDays,
  localDayKey,
} from "./time";

// The test runner pins TZ=Europe/London (see vitest.config.ts), so these DST
// assertions are deterministic regardless of the machine running them.

describe("differenceInLocalDays", () => {
  it("returns whole calendar days across the BST→GMT boundary (2026-10-25)", () => {
    // That local day has 25 real hours (clocks fall back at 02:00→01:00).
    expect(differenceInLocalDays("2026-10-26", "2026-10-24")).toBe(2);
    expect(differenceInLocalDays("2026-10-26", "2026-10-25")).toBe(1);
  });

  it("returns whole calendar days across the GMT→BST boundary (2026-03-29)", () => {
    // That local day has 23 real hours (clocks spring forward at 01:00→02:00).
    expect(differenceInLocalDays("2026-03-30", "2026-03-28")).toBe(2);
    expect(differenceInLocalDays("2026-03-30", "2026-03-29")).toBe(1);
  });

  it("is a case a naive ms/86_400_000 implementation would get wrong", () => {
    // Local midnights on either side of the spring-forward transition, built
    // the same way atLocalTime/parseLocalDay build them.
    const before = new Date(2026, 2, 29); // 2026-03-29 local midnight
    const after = new Date(2026, 2, 30); // 2026-03-30 local midnight
    const naiveMsDivision = (after.getTime() - before.getTime()) / 86_400_000;
    // The real-world elapsed time is 23 hours, so the naive division comes
    // out to 0.9583 — floored, that is 0 whole days, not 1.
    expect(naiveMsDivision).not.toBe(1);
    expect(Math.floor(naiveMsDivision)).toBe(0);
    // Our calendar-based implementation gets it right regardless.
    expect(differenceInLocalDays("2026-03-30", "2026-03-29")).toBe(1);
  });
});

describe("atLocalTime", () => {
  it("yields local 08:00 wall-clock across a DST boundary (2026-10-25)", () => {
    const d = atLocalTime("2026-10-25", "08:00");
    expect(d.getHours()).toBe(8);
    expect(d.getMinutes()).toBe(0);
  });

  it("yields local 08:00 wall-clock in BST (2026-07-01)", () => {
    const d = atLocalTime("2026-07-01", "08:00");
    expect(d.getHours()).toBe(8);
    expect(d.getMinutes()).toBe(0);
  });
});

describe("localDayKey", () => {
  it("returns the LOCAL day for an instant late in the local evening (BST)", () => {
    const d = new Date(2026, 7, 7, 23, 30); // 2026-08-07 23:30 local
    expect(localDayKey(d)).toBe("2026-08-07");
  });

  it("returns the LOCAL day just after local midnight, not the UTC day", () => {
    // 2026-08-08 00:30 local (BST, UTC+1) is 2026-08-07 23:30 UTC — a naive
    // toISOString().slice(0, 10) implementation would report the wrong day.
    const d = new Date(2026, 7, 8, 0, 30);
    expect(localDayKey(d)).toBe("2026-08-08");
    expect(d.toISOString().slice(0, 10)).toBe("2026-08-07");
  });
});
