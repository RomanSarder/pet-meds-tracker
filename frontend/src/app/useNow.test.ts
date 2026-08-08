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
