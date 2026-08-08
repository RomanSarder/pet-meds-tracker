import { useEffect, useState } from "react";
import { now } from "@/domain";

/**
 * Ticks off the injected clock (never `new Date()` directly), re-rendering
 * at most every `intervalMs`. Also always fires exactly at the next local
 * midnight, even if that lands before `intervalMs` would next fire, so
 * "today" recomputes on the day boundary rather than up to `intervalMs`
 * late.
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
    return () => clearTimeout(timer);
  }, [intervalMs]);

  return value;
}

function startOfNextLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
}
