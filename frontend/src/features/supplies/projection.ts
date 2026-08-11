// Pure supply-projection maths — SPEC.md §8. No React, no repo access, no
// `Date.now()`/zero-argument `new Date()`: `now` is always an explicit
// parameter so this module is fully deterministic and unit-testable.
import type { Course, Medication, Schedule, StockAdjustment } from "@/domain";
import { differenceInLocalDays, localDayKey } from "@/domain";

export const HORIZON_DAYS = 30;
export const STALE_STOCK_DAYS = 14;
export const TONE_OUT_DAYS = 3;
export const TONE_LOW_DAYS = 10;

export type SupplyTone = "good" | "low" | "out";

export interface MedicationProjection {
  medicationId: string;
  /** Σ over ACTIVE courses of (dosesPerDay × doseAmount). */
  dailyUse: number;
  /** medication.stockUnits, verbatim. null = not set. */
  remaining: number | null;
  /** true when remaining !== null. */
  stockSet: boolean;
  /** 30, or fewer when every active course ends sooner. Never negative. */
  horizonDays: number;
  /** remaining / dailyUse. Infinity when dailyUse === 0. null when !stockSet. */
  daysOfCover: number | null;
  /** now + daysOfCover. null when !stockSet or daysOfCover is Infinity. */
  runOutDate: Date | null;
  tone: SupplyTone;
  /** min(100, daysOfCover / horizonDays × 100). null when !stockSet. */
  percent: number | null;
  /** Deficit in UNITS, rounded up to whole packs. 0 when !stockSet. */
  needed: number;
  /** Whole packs to buy. null when medication.packSize is null. */
  neededPacks: number | null;
  /** stockSet && daysOfCover < horizonDays. Drives Buy-now membership. */
  runsOutInsideHorizon: boolean;
  /** SPEC §8 stale-stock prompt. */
  needsStockPrompt: boolean;
}

/**
 * Average doses per day implied by the schedule SHAPE. SPEC §8: a
 * `fromLastDose` course counts `24 / intervalHours` doses per day, or
 * `min(24 / intervalHours, maxPerDay)` once a daily maximum is set — the
 * `undefined` (unset) case takes the plain-division branch untouched, with
 * no `min()` in the computation at all (SPEC §3b-i's builder checklist).
 */
export function dosesPerDay(schedule: Schedule): number {
  if (schedule.kind === "fromLastDose") {
    if (schedule.intervalHours <= 0) return 0;
    const perDay = 24 / schedule.intervalHours;
    return schedule.maxPerDay !== undefined ? Math.min(perDay, schedule.maxPerDay) : perDay;
  }
  if (schedule.times.length === 0) return 0;
  const weekdayFactor = schedule.daysOfWeek?.length
    ? schedule.daysOfWeek.length / 7
    : 1;
  const everyNDaysFactor =
    schedule.everyNDays && schedule.everyNDays > 1 ? schedule.everyNDays : 1;
  return (schedule.times.length * weekdayFactor) / everyNDaysFactor;
}

/** Σ over the given courses of dosesPerDay × doseAmount. Filters to status === "active" itself. */
export function dailyUseFor(courses: Course[]): number {
  return courses
    .filter((c) => c.status === "active")
    .reduce((sum, c) => sum + dosesPerDay(c.schedule) * c.doseAmount, 0);
}

function hasAdjustmentWithinLast(
  adjustments: StockAdjustment[],
  now: Date,
  windowMs: number,
): boolean {
  const nowMs = now.getTime();
  const cutoffMs = nowMs - windowMs;
  return adjustments.some((a) => {
    const t = new Date(a.createdAt).getTime();
    return t >= cutoffMs && t <= nowMs;
  });
}

export function projectMedication(input: {
  medication: Medication;
  /** Courses for THIS medication. Any status; the function filters to active. */
  courses: Course[];
  /** StockAdjustments for THIS medication. Order irrelevant. */
  adjustments: StockAdjustment[];
  now: Date;
}): MedicationProjection {
  const { medication, courses, adjustments, now } = input;
  const activeCourses = courses.filter((c) => c.status === "active");

  const dailyUse = dailyUseFor(courses);

  const remaining = medication.stockUnits;
  const stockSet = remaining !== null;

  // horizonDays: SPEC §8 says "30 days, or the course end date when it is
  // sooner" — literal for the single-course case. §8 does not address a
  // medication used by several active courses at once (e.g. Ivermectin,
  // shared by a Nugget course and a Biscuit course), so we generalise by
  // taking the LATEST active-course end date, capped at 30 — not the
  // soonest — because the soonest reading would under-buy for the course
  // that runs longer: horizonDays = min(30, max over active courses of
  // daysUntilEnd), where an ongoing course (endDate === null) contributes
  // 30. With no active courses, horizonDays = 30.
  const todayKey = localDayKey(now);
  const horizonDays =
    activeCourses.length === 0
      ? HORIZON_DAYS
      : Math.min(
          HORIZON_DAYS,
          Math.max(
            ...activeCourses.map((c) =>
              c.endDate === null
                ? HORIZON_DAYS
                : Math.max(0, differenceInLocalDays(c.endDate, todayKey)),
            ),
          ),
        );

  let daysOfCover: number | null;
  if (!stockSet) {
    daysOfCover = null;
  } else if (dailyUse === 0) {
    daysOfCover = Infinity;
  } else {
    daysOfCover = (remaining as number) / dailyUse;
  }

  const runOutDate: Date | null =
    !stockSet || daysOfCover === null || daysOfCover === Infinity
      ? null
      : new Date(now.getTime() + daysOfCover * 86_400_000);

  const percent: number | null = !stockSet
    ? null
    : horizonDays > 0
      ? Math.max(0, Math.min(100, ((daysOfCover as number) / horizonDays) * 100))
      : 100;

  let tone: SupplyTone;
  if (!stockSet) {
    // No urgency can be asserted with no stock figure — the row shows
    // "Stock not set" and carries no meter. `tone` still has to be a valid
    // SupplyTone to satisfy the type, so "good" is used here, but it is
    // inert on screen: model.ts routes "Stock not set" through SupplyRow's
    // neutral `note` slot instead of its tone-coloured `stock` slot (a
    // green "good" would otherwise falsely assert positive stock for a
    // figure that is actually UNKNOWN — see SPEC slice 11 Task 1), and
    // `percent` is null below so no meter renders either. Nothing reads
    // this tone value for the not-set case.
    tone = "good";
  } else if (medication.lowThreshold !== null) {
    // lowThreshold overrides the numeric day thresholds (SPEC §8) and tone
    // is computed from units on hand instead of days of cover.
    const r = remaining as number;
    tone = r <= 0 ? "out" : r <= medication.lowThreshold ? "low" : "good";
  } else {
    const cover = daysOfCover as number;
    tone = cover <= TONE_OUT_DAYS ? "out" : cover <= TONE_LOW_DAYS ? "low" : "good";
  }

  const rawDeficit = stockSet
    ? Math.max(0, dailyUse * horizonDays - (remaining as number))
    : 0;
  // Round to 6 decimal places before ceiling: float noise like
  // 0.30000000000000004 must not push a deficit into an extra pack that
  // exact arithmetic would not require, while a genuine 3.0000000000000004
  // (which really is over the pack line) still ceils up.
  const deficit = Math.round(rawDeficit * 1_000_000) / 1_000_000;

  let needed: number;
  let neededPacks: number | null;
  if (medication.packSize !== null) {
    neededPacks = Math.ceil(deficit / medication.packSize);
    needed = neededPacks * medication.packSize;
  } else {
    neededPacks = null;
    needed = Math.ceil(deficit);
  }

  const runsOutInsideHorizon =
    stockSet && daysOfCover !== null && daysOfCover < horizonDays;

  // SPEC §8: "prompt ... when a medication's projected cover has run out but
  // no StockAdjustment has been recorded in the last 14 days". §8 itself
  // defines runOutDate = today + daysOfCover, so "cover has run out" is
  // taken LITERALLY as runOutDate not being in the future, i.e.
  // daysOfCover <= 0. The alternative reading — projecting cover forward
  // from the last adjustment date instead of from `now` — was rejected as
  // non-literal.
  const needsStockPrompt =
    stockSet &&
    dailyUse > 0 &&
    daysOfCover !== null &&
    daysOfCover <= 0 &&
    !hasAdjustmentWithinLast(adjustments, now, STALE_STOCK_DAYS * 86_400_000);

  return {
    medicationId: medication.id,
    dailyUse,
    remaining,
    stockSet,
    horizonDays,
    daysOfCover,
    runOutDate,
    tone,
    percent,
    needed,
    neededPacks,
    runsOutInsideHorizon,
    needsStockPrompt,
  };
}
