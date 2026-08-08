// Calendar primitives. No scheduling semantics live here — that is the
// engine's job. Everything below deals in wall-clock local time.
import type { LocalDate, LocalTime } from "./types";

interface CalendarComponents {
  y: number;
  m: number; // 1-indexed month
  d: number;
}

function componentsOf(day: LocalDate | Date): CalendarComponents {
  if (typeof day === "string") {
    const [y, m, d] = day.split("-").map(Number);
    return { y, m, d };
  }
  return { y: day.getFullYear(), m: day.getMonth() + 1, d: day.getDate() };
}

export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Local calendar day of an instant — LOCAL components, never `toISOString().slice(0, 10)` (UTC). */
export function localDayKey(d: Date): LocalDate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Local midnight of the given calendar day. */
export function parseLocalDay(day: LocalDate): Date {
  const { y, m, d } = componentsOf(day);
  return new Date(y, m - 1, d);
}

export function addLocalDays(day: LocalDate, n: number): LocalDate {
  const d = parseLocalDay(day);
  d.setDate(d.getDate() + n);
  return localDayKey(d);
}

/**
 * Whole calendar days between two local days/instants — computed from Y/M/D
 * components via `Date.UTC`, never `ms / 86_400_000` on local `Date`
 * instants. The latter is off by an hour across a DST boundary (a BST→GMT
 * day is 25 real hours, a GMT→BST day is 23) and silently breaks
 * `everyNDays`. Routing through `Date.UTC` sidesteps DST entirely: every
 * calendar day is exactly 86,400,000 ms in UTC.
 */
export function differenceInLocalDays(
  a: LocalDate | Date,
  b: LocalDate | Date,
): number {
  const ca = componentsOf(a);
  const cb = componentsOf(b);
  const epochA = Date.UTC(ca.y, ca.m - 1, ca.d) / 86_400_000;
  const epochB = Date.UTC(cb.y, cb.m - 1, cb.d) / 86_400_000;
  return epochA - epochB;
}

export function parseHHMM(t: LocalTime): { hours: number; minutes: number } {
  const [h, m] = t.split(":").map(Number);
  return { hours: h, minutes: m };
}

export function formatHHMM(d: Date): LocalTime {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Wall-clock local time via the `new Date(y, m, d, hh, mm)` constructor —
 * never a UTC-based construction. That single choice is what makes SPEC
 * §3d's "on DST shifts, `fixedTimes` keeps the wall-clock time" true for
 * free, with no special-casing at the DST boundary.
 */
export function atLocalTime(day: LocalDate, t: LocalTime): Date {
  const { y, m, d } = componentsOf(day);
  const { hours, minutes } = parseHHMM(t);
  return new Date(y, m - 1, d, hours, minutes);
}
