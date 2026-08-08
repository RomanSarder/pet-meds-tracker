// The SPEC §9 `now()` provider.
//
// The engine never calls `now()` — every engine function takes `now: Date` as
// an explicit parameter. The repository calls `now()` for stamps, and the UI
// calls it through `useNow()`. This module is the injection seam for the repo
// and the UI only; keeping the engine pure is what makes it deterministically
// testable.
import type { IsoDateTime } from "./types";

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** Returns a fresh `Date` on every call — never leaks a mutable shared instance. */
export function fixedClock(iso: IsoDateTime): Clock {
  return {
    now: () => new Date(iso),
  };
}

let currentClock: Clock = systemClock;

export function getClock(): Clock {
  return currentClock;
}

export function setClock(c: Clock): void {
  currentClock = c;
}

/** Sugar for `getClock().now()`. */
export function now(): Date {
  return getClock().now();
}
