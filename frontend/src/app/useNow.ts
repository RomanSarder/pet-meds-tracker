import { useEffect, useState } from "react";
import { now } from "@/domain";

/**
 * Ticks off the injected clock (never `new Date()` directly), re-rendering
 * at most every `intervalMs`. Also always fires exactly at the next local
 * midnight, even if that lands before `intervalMs` would next fire, so
 * "today" recomputes on the day boundary rather than up to `intervalMs`
 * late.
 *
 * AND re-reads the clock whenever the page is looked at again, because the
 * timer above cannot be relied on to have fired. A backgrounded tab has its
 * timers throttled, and a phone that locks or a tab the OS evicts has them
 * frozen outright — so a dose logged at 23:50 with the app left open would
 * still be sitting under yesterday's date the next morning, reporting
 * everything complete, until something else forced a re-render. Everything
 * downstream is keyed off this one value (`TodayPage`'s `day`, and through it
 * the `qk.today(day)` query and `useDailySweep`), so the day boundary is only
 * ever as reliable as this hook is.
 *
 * `sync/scheduler.ts` and `notifications/scheduler.ts` already wake on the
 * same event for the same reason; this is the third instance of that rule,
 * not a new idea.
 */
export function useNow(intervalMs = 30_000): Date {
  const [value, setValue] = useState(() => now());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const scheduleNext = () => {
      const current = now();
      const msToMidnight = startOfNextLocalDay(current).getTime() - current.getTime();
      const delay = msToMidnight > 0 ? Math.min(intervalMs, msToMidnight) : intervalMs;
      timer = setTimeout(() => {
        setValue(now());
        scheduleNext();
      }, delay);
    };

    scheduleNext();

    /**
     * Re-read, then re-arm. Re-arming matters as much as the re-read: the
     * pending timeout was scheduled against a delay computed before the tab
     * was frozen, so its remaining time no longer points at midnight. Left
     * alone it would fire at some arbitrary offset and schedule the next one
     * from there.
     */
    const resync = () => {
      clearTimeout(timer);
      setValue(now());
      scheduleNext();
    };

    const onVisibilityChange = () => {
      // Only the transition INTO visible is interesting. Re-reading on the way
      // out would re-render a screen nobody is looking at, and on mobile that
      // fires as the app is being suspended.
      if (document.visibilityState === "visible") resync();
    };

    // `pageshow` covers the bfcache restore (back/forward, or returning to a
    // PWA the OS unloaded), which can hand back a fully-restored page without
    // a `visibilitychange` ever firing.
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", resync);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", resync);
    };
  }, [intervalMs]);

  return value;
}

function startOfNextLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
}
