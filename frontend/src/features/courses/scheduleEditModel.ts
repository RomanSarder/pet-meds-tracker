// The pure model behind "shift a course's dose times earlier" — editing a
// `fixedTimes` slot with a −/+ stepper, or shortening a `fromLastDose`
// `intervalHours`. Modeled on `features/today/logAtTimeModel.ts`: no React,
// no locale lookup, no wall-clock read — every function that needs the
// current instant takes `now: Date` — and results are discriminators and
// numbers, never prose. The sheet resolves everything through the catalogue.
import type { DoseEvent, LocalTime, Schedule } from "@/domain";
import { GRACE_FIXED_MIN, formatHHMM, localDayKey, parseHHMM } from "@/domain";

const MINUTES_PER_DAY = 24 * 60;

/**
 * The −/+ stepper's granularity for the times editor.
 *
 * Module-local ON PURPOSE, and deliberately NOT `logAtTimeModel.STEP_MIN`
 * (5). That one corrects a real observed instant — a person nudging "when did
 * I actually give this" a few minutes at a time. This one plans a grid of
 * future dose times on a 24 h dial; 5-minute steps would need 12 presses to
 * move a slot by an hour. They happen to both be "the stepper's granularity"
 * for a schedule-adjacent screen; reusing the constant would couple two
 * unrelated UI tunings so that retuning either silently moves the other.
 */
export const SCHEDULE_STEP_MIN = 15;

/** `00:00`, in minutes-of-day — the lower clamp for a `fixedTimes` slot. */
const MIN_OF_DAY = 0;
/** `23:45`, in minutes-of-day — the upper clamp. Never `23:59`: the grid is
 * built on `SCHEDULE_STEP_MIN` boundaries, and `23:45 + 15` would cross
 * midnight, which is exactly what the clamp exists to prevent. */
const MAX_OF_DAY = 23 * 60 + 45;

function toMinutes(t: LocalTime): number {
  const { hours, minutes } = parseHHMM(t);
  return hours * 60 + minutes;
}

function fromMinutes(totalMinutes: number): LocalTime {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * One stepper press on a `fixedTimes` slot: `t ± deltaMin`, clamped into
 * `[00:00, 23:45]` rather than wrapping.
 *
 * PURE STRING ARITHMETIC — never `Date` arithmetic. A schedule slot (SPEC
 * §3d: "on DST shifts `fixedTimes` keeps the wall-clock time") is a
 * minutes-of-day value with no calendar day attached; running it through a
 * `Date` would attach one implicitly and reintroduce the DST bug this
 * representation exists to avoid. There is nothing here for a DST date to
 * affect, because no date is ever constructed.
 *
 * Clamping (rather than wrapping `23:50 + 15` to `00:05`) is deliberate too:
 * a wrap could silently invert two slots' order in the `times` array, and
 * `gapWarningFor` below relies on that array's own order to find the
 * minimum consecutive gap.
 */
export function stepTime(t: LocalTime, deltaMin: number): LocalTime {
  const clamped = Math.min(MAX_OF_DAY, Math.max(MIN_OF_DAY, toMinutes(t) + deltaMin));
  return fromMinutes(clamped);
}

/**
 * The minimum gap between consecutive entries of `times`, wrapping from the
 * last entry back to the first — plus the earlier clock time bounding that
 * minimum pair, so a caller can say "since 08:00" rather than just "600
 * minutes". A single-entry grid has no consecutive pair at all, so its only
 * "gap" is the full day until the same slot repeats tomorrow.
 */
function minGridGap(times: readonly LocalTime[]): { gapMinutes: number; sinceTime: LocalTime } {
  if (times.length <= 1) {
    return { gapMinutes: MINUTES_PER_DAY, sinceTime: times[0] ?? "00:00" };
  }
  let best = { gapMinutes: Infinity, sinceTime: times[0] };
  for (let i = 0; i < times.length; i++) {
    const cur = times[i];
    const next = times[(i + 1) % times.length];
    const gap = (toMinutes(next) - toMinutes(cur) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    if (gap < best.gapMinutes) best = { gapMinutes: gap, sinceTime: cur };
  }
  return best;
}

/** The earliest of `times` that falls strictly after `afterMinutes`, or
 * `null` when every slot is at or before it (nothing left to compare
 * against, later the same day). */
function earliestSlotAfter(times: readonly LocalTime[], afterMinutes: number): number | null {
  let best: number | null = null;
  for (const t of times) {
    const m = toMinutes(t);
    if (m > afterMinutes && (best === null || m < best)) best = m;
  }
  return best;
}

/**
 * The newest LIVE `given` event for `courseId` whose `givenAt` falls on
 * `now`'s local day, or `null`. "Live" mirrors the repos' own
 * `liveDoseEventsForCourse` reading of the word: not soft-deleted, and not
 * superseded by a later `correctDose` row. `skipped` rows are excluded on
 * purpose — this is "the gap since the LAST GIVEN DOSE", not the dedup
 * guard's broader "given or skipped" definition of a live event.
 */
function latestGivenToday(events: DoseEvent[], courseId: string, now: Date): DoseEvent | null {
  const todayKey = localDayKey(now);
  const supersededIds = new Set(
    events.filter((e) => e.deletedAt === null && e.supersedesId !== null).map((e) => e.supersedesId as string),
  );
  let latest: DoseEvent | null = null;
  for (const e of events) {
    if (e.courseId !== courseId) continue;
    if (e.status !== "given") continue;
    if (e.deletedAt !== null) continue;
    if (supersededIds.has(e.id)) continue;
    if (localDayKey(new Date(e.givenAt)) !== todayKey) continue;
    if (latest === null || new Date(e.givenAt).getTime() > new Date(latest.givenAt).getTime()) latest = e;
  }
  return latest;
}

/**
 * Does the edited schedule squeeze two doses closer together than the plan
 * intends — WARN, never block (a tighter grid is a real clinical choice the
 * form must allow).
 *
 * `fixedTimes`: the reported gap is the smaller of two candidates —
 *   1. the minimum gap between consecutive entries of `next.times`
 *      (wrapping midnight), compared against an expected spacing of
 *      `24 h / times.length`;
 *   2. when a live `given` event exists today for `courseId` and the
 *      earliest not-yet-given entry of `next.times` falls later the same
 *      day, the REAL gap from that given time to that slot.
 * That is the literal reading of "the gap since the last given dose" —
 * the grid can look fine in the abstract while today's actual dose was
 * given late enough to make the next slot arrive early. `sinceTime` is
 * always the earlier clock time bounding whichever candidate was smaller.
 *
 * `fromLastDose`: warn when `next.intervalHours < previous.intervalHours`.
 * `sinceTime` is `null` here — an interval has no clock time to anchor to,
 * only a duration.
 *
 * THRESHOLD IS RELATIVE: warn on `gap < expected`, never an absolute floor.
 * `previous`/`next` being schedules of different `kind` (not a shape this
 * feature produces — only same-kind edits are offered) is treated as
 * nothing to compare and returns `null`.
 *
 * ONE STRONGER BAND: below `GRACE_FIXED_MIN` (60 min, `@/domain`) this
 * returns `tooSoonToLog` instead of `tooSoon`. Both repos' `logDose` throw
 * `DuplicateDoseError` when a new `givenAt` lands within `GRACE_FIXED_MIN`
 * of an existing live event's `givenAt` (`idbRepo.ts`/`memoryRepo.ts`) — so
 * at that spacing the schedule edit itself is still allowed and the warning
 * still just warns, but the SECOND dose it implies physically cannot be
 * logged afterwards, and the copy has to say so plainly rather than reuse
 * the softer "only N since…" wording. The dedup guard itself is untouched —
 * it exists to absorb double-taps, not to be loosened by this feature.
 */
export function gapWarningFor(args: {
  next: Schedule;
  previous: Schedule;
  events: DoseEvent[];
  courseId: string;
  now: Date;
}):
  | { kind: "tooSoon"; gapMinutes: number; expectedMinutes: number; sinceTime: LocalTime | null }
  | { kind: "tooSoonToLog"; gapMinutes: number; sinceTime: LocalTime | null }
  | null {
  const { next, previous, events, courseId, now } = args;

  if (next.kind === "fromLastDose") {
    if (previous.kind !== "fromLastDose") return null;
    const gapMinutes = next.intervalHours * 60;
    const expectedMinutes = previous.intervalHours * 60;
    if (gapMinutes >= expectedMinutes) return null;
    if (gapMinutes < GRACE_FIXED_MIN) return { kind: "tooSoonToLog", gapMinutes, sinceTime: null };
    return { kind: "tooSoon", gapMinutes, expectedMinutes, sinceTime: null };
  }

  if (previous.kind !== "fixedTimes") return null;

  const expectedMinutes = MINUTES_PER_DAY / next.times.length;
  const grid = minGridGap(next.times);
  let gapMinutes = grid.gapMinutes;
  let sinceTime: LocalTime | null = grid.sinceTime;

  const givenToday = latestGivenToday(events, courseId, now);
  if (givenToday !== null) {
    const givenTime = formatHHMM(new Date(givenToday.givenAt));
    const givenMinutes = toMinutes(givenTime);
    const earliestUpcoming = earliestSlotAfter(next.times, givenMinutes);
    if (earliestUpcoming !== null) {
      const realGap = earliestUpcoming - givenMinutes;
      if (realGap < gapMinutes) {
        gapMinutes = realGap;
        sinceTime = givenTime;
      }
    }
  }

  if (gapMinutes >= expectedMinutes) return null;
  if (gapMinutes < GRACE_FIXED_MIN) return { kind: "tooSoonToLog", gapMinutes, sinceTime };
  return { kind: "tooSoon", gapMinutes, expectedMinutes, sinceTime };
}
