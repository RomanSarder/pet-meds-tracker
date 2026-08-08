import { describe, it, expect, afterEach } from "vitest";
import { fixedClock, getClock, now, setClock, systemClock } from "./clock";

describe("clock", () => {
  afterEach(() => {
    setClock(systemClock);
  });

  it("round-trips fixedClock through setClock/getClock/now", () => {
    const iso = "2026-08-08T07:00:00.000Z";
    setClock(fixedClock(iso));
    expect(getClock().now().toISOString()).toBe(iso);
    expect(now().toISOString()).toBe(iso);
  });

  it("defaults to systemClock", () => {
    expect(getClock()).toBe(systemClock);
  });

  it("hands out independent Date objects on each call", () => {
    const clock = fixedClock("2026-08-08T07:00:00.000Z");
    const first = clock.now();
    const second = clock.now();
    expect(first).not.toBe(second);
    expect(first.getTime()).toBe(second.getTime());

    first.setFullYear(2000);
    expect(second.getFullYear()).not.toBe(2000);
    // A fresh call is unaffected by mutating a previously handed-out Date.
    expect(clock.now().getFullYear()).toBe(2026);
  });
});
