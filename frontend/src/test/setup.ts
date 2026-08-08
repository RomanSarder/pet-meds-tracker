import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { setClock, systemClock } from "@/domain";
import { setRepo } from "@/data";
import { createMemoryRepo } from "@/data/memoryRepo";

// jsdom does not implement matchMedia. The design system reads it to detect
// prefers-reduced-motion, so tests need a well-formed (if inert) implementation.
if (!window.matchMedia) {
  window.matchMedia = (media: string): MediaQueryList => {
    const mql: MediaQueryList = {
      matches: false,
      media,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
    return mql;
  };
}

// jsdom defines window.scrollTo but only as a stub that logs "Not
// implemented" when called. TanStack Router's scroll restoration calls it on
// every navigation/match commit, which otherwise prints that error to the
// console on every render that goes through `renderWithProviders` — noise,
// not a signal, since nothing here tests scroll position. (Unconditional,
// unlike the matchMedia stub above: jsdom's version is truthy, so a `!`
// guard would never fire.)
window.scrollTo = () => {};

// Global safety net: reset the injected clock and repo after every test, so
// a test that calls `setClock`/`setRepo` (directly, or via
// `renderWithProviders`) can never leak that state into the next test file's
// first test. Individual tests still get a *fresh* repo/clock from
// `renderWithProviders` itself; this is the backstop for tests that install
// state without going through it, or that forget to.
afterEach(() => {
  cleanup();
  setClock(systemClock);
  setRepo(createMemoryRepo());
});
