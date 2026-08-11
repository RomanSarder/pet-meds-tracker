// Dose state derivation (SPEC §4) — a pure function of one Occurrence and
// the current instant, checked strictly top-down. A `missed` DoseEvent is
// deliberately not one of the terminal rules: it leaves the occurrence
// `overdue`, which is what makes the sweep idempotent (it tests
// `event === null`).
import { DUE_PRE_WINDOW_MIN, localDayKey, occurrenceKeyFor } from "@/domain";
import type { DoseState, Occurrence } from "./engine.types";

export function getDoseState(occurrence: Occurrence, now: Date): DoseState {
  const { event, dueAt, courseId, key, graceMinutes } = occurrence;

  if (event?.status === "given") return "given";
  if (event?.status === "skipped") return "skipped";

  // dueAt === null, or this is the `fromLastDose` "chain never started"
  // sentinel occurrence (its scheduledFor is null even when anchorTime
  // seeded a display dueAt) — SPEC §3b: "before the first given event,
  // nothing is due".
  if (dueAt === null || key === occurrenceKeyFor(courseId, null)) return "notStarted";

  const graceMs = graceMinutes * 60_000;
  if (now.getTime() > dueAt.getTime() + graceMs) return "overdue";

  const preWindowMs = DUE_PRE_WINDOW_MIN * 60_000;
  if (now.getTime() >= dueAt.getTime() - preWindowMs) return "due";

  if (localDayKey(dueAt) === localDayKey(now)) return "later";

  return "upcoming";
}

/** SPEC §5.1 Today-header counters, derived from a day's occurrences. */
export function summariseDay(
  occs: Occurrence[],
  now: Date,
): { remaining: number; overdue: number; earliestOverdue: Occurrence | null } {
  let remaining = 0;
  let overdue = 0;
  let earliestOverdue: Occurrence | null = null;

  for (const occ of occs) {
    const state = getDoseState(occ, now);
    if (state === "overdue") {
      overdue += 1;
      remaining += 1;
      if (
        occ.dueAt !== null &&
        (earliestOverdue === null ||
          (earliestOverdue.dueAt !== null && occ.dueAt.getTime() < earliestOverdue.dueAt.getTime()))
      ) {
        earliestOverdue = occ;
      }
    } else if (state === "due" || state === "later") {
      remaining += 1;
    } else if (state === "upcoming" && occ.kind === "fromLastDose") {
      // An anchored `fromLastDose` chain's next dose stays a live, giveable
      // row before its computed due instant crosses into a later local day
      // (SPEC §3b; `occurrences.ts`'s `fromLastDoseOccurrences` emits it from
      // the anchor's own day through the due day) — it must count toward
      // "remaining", or the header reads "0 doses left" above a card that
      // still has a Give button on it. `fixedTimes` never reaches `upcoming`
      // here: its `dueAt` is always inside the very day it was generated for
      // (`atLocalTime(day, t)`), so this branch is a no-op for it, not a
      // second, kind-agnostic reading of `upcoming`.
      remaining += 1;
    }
  }

  return { remaining, overdue, earliestOverdue };
}
