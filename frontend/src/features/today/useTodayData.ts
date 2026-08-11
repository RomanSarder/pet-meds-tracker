// The single read the Today screen performs.
//
// One query, one cache entry, one engine call. Everything the screen shows —
// pets, medications, courses, events and the day's occurrences — lands in
// `qk.today(day)` together, so the optimistic update in `useLogDose` has
// exactly one object to rewrite and the screen can never render a half-fresh
// mixture of two independently-refetched lists.
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { LocalDate } from "@/domain";
import { qk } from "@/domain";
import { getRepo } from "@/data";
import { getOccurrences } from "@/engine";
import type { TodaySnapshot } from "./types";

export function useTodayQuery(day: LocalDate): UseQueryResult<TodaySnapshot> {
  return useQuery<TodaySnapshot>({
    queryKey: qk.today(day),
    queryFn: async (): Promise<TodaySnapshot> => {
      const repo = getRepo();
      const [pets, medications, courses, events, courseEvents] = await Promise.all([
        repo.listPets(),
        repo.listMedications(),
        repo.listCourses(),
        // Deliberately unfiltered. A `fromLastDose` chain is anchored on the
        // last `given` event, which may be days old, so narrowing to today's
        // events here would make the engine compute the wrong next due time.
        // Deciding what is relevant to `day` is the engine's job (SPEC §10:
        // "slices 5 and 7 consume it and must not reimplement it").
        repo.listDoseEvents({}),
        // Same reasoning as `events` above: the engine reconstructs the
        // schedule in effect at each slot's own due instant from the full
        // ledger (SPEC §3c), so this is unfiltered too.
        repo.listCourseEvents({}),
      ]);
      return {
        day,
        pets,
        medications,
        courses,
        events,
        courseEvents,
        occurrences: getOccurrences(day, { courses, events, courseEvents }),
      };
    },
  });
}
