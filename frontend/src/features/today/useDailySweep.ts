// The once-per-local-day housekeeping pass (SPEC §4 and §3c).
//
// Two things happen here and nowhere else in the app:
//
//  1. A `fixedTimes` occurrence more than 12 hours past due with no event is
//     written as a `missed` DoseEvent "so history is complete" (SPEC §4).
//     Missed doses are written to HISTORY ONLY — they are never surfaced on
//     Today, which lists pending doses (SPEC §5.1).
//  2. A course whose last scheduled dose has passed auto-transitions to
//     `finished` (SPEC §3c). Nothing else in the app triggers that transition,
//     so a household that never opens Today would keep finished courses active
//     forever — which is why this hook lives on the default screen.
//
// It decides nothing: `findMissedOccurrences` and `findCoursesToFinish` are the
// engine's, and this hook only carries their answers to the repo.
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { IsoDateTime, LocalDate } from "@/domain";
import { localDayKey, qk } from "@/domain";
import { getRepo } from "@/data";
import type { EngineContext } from "@/engine";
import { findCoursesToFinish, findMissedOccurrences } from "@/engine";
import { scheduledForOf } from "./todayModel";

export function useDailySweep(now: Date): void {
  const queryClient = useQueryClient();
  const day = localDayKey(now);
  // Holds the day whose sweep is currently in flight or already done for this
  // mounted hook. Two jobs: it absorbs React 19 StrictMode's double effect
  // invocation (which the `lastSweepDay` meta row cannot, since the second
  // invocation fires before the first has written anything), and it lets a
  // resolved sweep tell whether its day is still the current one.
  const sweptDayRef = useRef<LocalDate | null>(null);

  useEffect(() => {
    if (sweptDayRef.current === day) return;
    sweptDayRef.current = day;

    void (async () => {
      const repo = getRepo();
      try {
        // At most once per local day, across reloads — this is the guard that
        // survives a refresh, where the ref above does not.
        if ((await repo.getMeta("lastSweepDay")) === day) return;

        const [courses, events] = await Promise.all([
          repo.listCourses(),
          repo.listDoseEvents({}),
        ]);
        const ctx: EngineContext = { courses, events };

        const missed = findMissedOccurrences(ctx, now);
        const inputs: Array<{ courseId: string; scheduledFor: IsoDateTime; amount: number }> = [];
        for (const occurrence of missed) {
          // Read back out of the canonical occurrence key rather than
          // reconstructed from `dueAt`: `recordMissed` dedupes on the key it
          // derives from `scheduledFor`, so the two must agree exactly or the
          // sweep stops being idempotent and double-writes.
          //
          // A null `scheduledFor` is a `fromLastDose` chain with no scheduled
          // instant. Such an occurrence can be late but can never be *missed*
          // — there is no moment for it to have been missed at — so it is
          // skipped rather than written with a fabricated `scheduledFor`.
          const scheduledFor = scheduledForOf(occurrence);
          if (scheduledFor === null) continue;
          inputs.push({
            courseId: occurrence.courseId,
            scheduledFor,
            amount: occurrence.doseAmount,
          });
        }
        if (inputs.length > 0) {
          await repo.recordMissed(inputs);
        }

        for (const courseId of findCoursesToFinish(ctx, now)) {
          await repo.setCourseStatus(courseId, "finished");
        }

        await repo.setMeta("lastSweepDay", day);

        // The clock rolled past midnight while this was in flight: a newer
        // sweep owns the current day, so this one's invalidations would be
        // refreshing yesterday.
        if (sweptDayRef.current !== day) return;

        await Promise.all([
          queryClient.invalidateQueries({ queryKey: qk.today(day) }),
          queryClient.invalidateQueries({ queryKey: qk.courses() }),
          queryClient.invalidateQueries({ queryKey: qk.events({}) }),
        ]);
      } catch {
        // Housekeeping must never take the screen down with it. Releasing the
        // ref lets the next `useNow` tick retry; `lastSweepDay` was not
        // written, so nothing was silently marked done.
        if (sweptDayRef.current === day) sweptDayRef.current = null;
      }
    })();
    // `now` ticks every 30s and is a fresh Date each time, so this effect
    // re-runs often; the ref guard above makes every run after the first of a
    // given day a no-op. That is cheaper than the alternative of smuggling
    // `now` in through a ref that is mutated during render.
  }, [day, now, queryClient]);
}
