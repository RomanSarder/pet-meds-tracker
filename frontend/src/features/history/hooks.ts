// React Query hooks over the event-log slice of `Repo`. Composes with
// `./logModel`'s `buildLogEntries`/`filterEntries`/`groupByDay`/`summarise` —
// this file only fetches; the log model owns turning raw rows into
// `LogEntry`s. See CONTRACT.md §3 for the QUERY_OPTS/qk conventions this
// mirrors from `@/features/courses/hooks`.
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { CourseEvent, DoseEvent, EventFilter, User } from "@/domain";
import { qk } from "@/domain";
import { getRepo } from "@/data";

/** Query options for every repo-backed query, per CONTRACT.md §3. */
const QUERY_OPTS = { staleTime: 0, retry: false, refetchOnWindowFocus: true } as const;

export function useDoseEventLog(filter: EventFilter): UseQueryResult<DoseEvent[], Error> {
  return useQuery({
    queryKey: qk.events(filter),
    queryFn: () => getRepo().listDoseEvents(filter),
    ...QUERY_OPTS,
  });
}

export function useCourseEventLog(filter: EventFilter): UseQueryResult<CourseEvent[], Error> {
  return useQuery({
    queryKey: qk.courseEvents(filter),
    queryFn: () => getRepo().listCourseEvents(filter),
    ...QUERY_OPTS,
  });
}

/**
 * Household members, removed ones included — `displayNameFor` needs a
 * removed member's row to still resolve their name (SPEC §5/§11). No `qk`
 * entry exists for this yet (the sharing slice owns that), so this key is
 * local to the history feature; nothing else invalidates or reads it.
 */
export function useUsers(): UseQueryResult<User[], Error> {
  return useQuery({
    queryKey: ["users", { includeRemoved: true }] as const,
    queryFn: () => getRepo().listUsers({ includeRemoved: true }),
    ...QUERY_OPTS,
  });
}
