import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { fixedClock, setClock, systemClock } from "@/domain";
import { useNow } from "./useNow";

describe("useNow", () => {
  afterEach(() => {
    setClock(systemClock);
    vi.useRealTimers();
  });

  it("returns the instant of the injected clock", () => {
    setClock(fixedClock("2026-08-08T09:00:00.000Z"));

    const { result } = renderHook(() => useNow());

    expect(result.current.toISOString()).toBe("2026-08-08T09:00:00.000Z");
  });

  it("re-reads the clock once intervalMs has elapsed", () => {
    vi.useFakeTimers();
    setClock(fixedClock("2026-08-08T09:00:00.000Z"));

    const { result } = renderHook(() => useNow(1_000));
    expect(result.current.toISOString()).toBe("2026-08-08T09:00:00.000Z");

    setClock(fixedClock("2026-08-08T09:00:05.000Z"));
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(result.current.toISOString()).toBe("2026-08-08T09:00:05.000Z");
  });

  it("also fires exactly at the next local midnight", () => {
    vi.useFakeTimers();
    // 23:50 local (Europe/London, BST, UTC+1) — 10 minutes to local midnight,
    // well under the 30-minute interval below.
    setClock(fixedClock("2026-08-08T22:50:00.000Z"));

    const { result } = renderHook(() => useNow(30 * 60_000));
    expect(result.current.toISOString()).toBe("2026-08-08T22:50:00.000Z");

    setClock(fixedClock("2026-08-08T23:00:00.000Z"));
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });

    expect(result.current.toISOString()).toBe("2026-08-08T23:00:00.000Z");
  });

  // The reported bug: a dose logged just before midnight, the phone locked,
  // and the next morning Today still shows yesterday — "everything completed"
  // — because a backgrounded tab's timers are throttled or frozen outright,
  // so the midnight tick never ran. Coming back to the page has to re-read
  // the clock; the timer alone cannot be trusted to have fired.
  it("re-reads the clock when the page becomes visible again, even if no timer fired", () => {
    vi.useFakeTimers();
    setClock(fixedClock("2026-08-08T22:50:00.000Z")); // 23:50 local

    const { result } = renderHook(() => useNow(30_000));
    expect(result.current.toISOString()).toBe("2026-08-08T22:50:00.000Z");

    // The tab is frozen overnight: the clock moves on, but NO timer runs.
    setClock(fixedClock("2026-08-09T07:00:00.000Z"));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(result.current.toISOString()).toBe("2026-08-09T07:00:00.000Z");
  });

  it("ignores a visibilitychange that hides the page", () => {
    vi.useFakeTimers();
    setClock(fixedClock("2026-08-08T09:00:00.000Z"));

    const { result } = renderHook(() => useNow(30_000));

    const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    setClock(fixedClock("2026-08-08T10:00:00.000Z"));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(result.current.toISOString()).toBe("2026-08-08T09:00:00.000Z");
    spy.mockRestore();
  });

  it("re-reads the clock on pageshow, for a bfcache restore that fires no visibilitychange", () => {
    vi.useFakeTimers();
    setClock(fixedClock("2026-08-08T22:50:00.000Z"));

    const { result } = renderHook(() => useNow(30_000));

    setClock(fixedClock("2026-08-09T07:00:00.000Z"));
    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });

    expect(result.current.toISOString()).toBe("2026-08-09T07:00:00.000Z");
  });

  it("stops listening once unmounted, so a later visibilitychange cannot set state", () => {
    vi.useFakeTimers();
    setClock(fixedClock("2026-08-08T09:00:00.000Z"));

    const { result, unmount } = renderHook(() => useNow(30_000));
    const before = result.current.toISOString();
    unmount();

    setClock(fixedClock("2026-08-09T07:00:00.000Z"));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(result.current.toISOString()).toBe(before);
  });

  it("cleans up its timer on unmount", () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    setClock(fixedClock("2026-08-08T09:00:00.000Z"));

    const { unmount } = renderHook(() => useNow(1_000));
    unmount();

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
