import { describe, expect, it } from "vitest";
import { GRACE_INTERVAL_CAP_MIN } from "./constants";
import { intervalGraceMinutes } from "./grace";

// The table-driven proof that this formula clears the collision for every
// interval the app actually offers lives in
// `features/courses/scheduleChoice.test.ts`, next to `INTERVAL_CHOICES` —
// this file only pins the formula's own arithmetic in isolation.
describe("intervalGraceMinutes", () => {
  it("is half the interval for a short interval below the cap", () => {
    expect(intervalGraceMinutes(2)).toBe(60);
    expect(intervalGraceMinutes(3)).toBe(90);
  });

  it("caps at GRACE_INTERVAL_CAP_MIN once half the interval would exceed it", () => {
    expect(intervalGraceMinutes(4)).toBe(GRACE_INTERVAL_CAP_MIN);
    expect(intervalGraceMinutes(8)).toBe(GRACE_INTERVAL_CAP_MIN);
    expect(intervalGraceMinutes(24)).toBe(GRACE_INTERVAL_CAP_MIN);
  });

  it("lands exactly on the cap at intervalHours: 6 — half of 6h is exactly 180min/2=90", () => {
    expect(intervalGraceMinutes(6)).toBe(90);
  });
});
