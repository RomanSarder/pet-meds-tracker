// React Query hooks over the event-log slice of `Repo`. Composes with
// `./logModel`'s `buildLogEntries`/`filterEntries`/`groupByDay`/`summarise` —
// this file only fetches; the log model owns turning raw rows into
// `LogEntry`s. See CONTRACT.md §3 for the QUERY_OPTS/qk conventions this
// mirrors from `@/features/courses/hooks`.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { CourseEvent, DoseEvent, EventFilter, IsoDateTime, User } from "@/domain";
import { localDayKey, now, qk } from "@/domain";
import { getRepo } from "@/data";
import { useToast } from "@/app/Toast";
import { useT } from "@/i18n";

/** Query options for every repo-backed query, per CONTRACT.md §3. */
const QUERY_OPTS = { staleTime: 0, retry: false, refetchOnWindowFocus: true } as const;

/**
 * `options.enabled` defaults to `true` so the existing `PetDetailPage.tsx`
 * call site (which passes none) is unaffected. `HistoryView` passes
 * `enabled: courses.data !== undefined` so the log queries never fire with a
 * placeholder `courseIds: []` before the real course ids are known — firing
 * early would resolve to zero rows and paint a false "no history" before the
 * correctly-filtered fetch replaces it.
 */
export function useDoseEventLog(
  filter: EventFilter,
  options?: { enabled?: boolean },
): UseQueryResult<DoseEvent[], Error> {
  return useQuery({
    queryKey: qk.events(filter),
    queryFn: () => getRepo().listDoseEvents(filter),
    ...QUERY_OPTS,
    enabled: options?.enabled ?? true,
  });
}

export function useCourseEventLog(
  filter: EventFilter,
  options?: { enabled?: boolean },
): UseQueryResult<CourseEvent[], Error> {
  return useQuery({
    queryKey: qk.courseEvents(filter),
    queryFn: () => getRepo().listCourseEvents(filter),
    ...QUERY_OPTS,
    enabled: options?.enabled ?? true,
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

export interface CorrectDoseTimeVars {
  eventId: string;
  givenAt: IsoDateTime;
  /**
   * Toast copy, ALREADY LOCALIZED by the caller — the same division
   * `useLogDose`'s `LogDoseVars.toastMessage` draws, so this hook never words
   * anything about a medication itself.
   */
  toastMessage: string;
}

/**
 * Corrects a past dose's `givenAt` (SPEC §4's "a dose remembered after
 * midnight is corrected from history instead").
 *
 * `correctDose`, never an update: `DoseEvent` is append-only (SPEC §9), so
 * this appends a row carrying `supersedesId` and leaves the original in the
 * ledger. `Repo` has no `updateDoseEvent` to reach for — the interface's
 * shape is what enforces that, per its own header.
 *
 * NO OPTIMISTIC WRITE, unlike `useLogDose`. That hook flips a Today row
 * in place because SPEC §5.1 forbids the tap from feeling like a round trip;
 * here the sheet is dismissed on confirm and the list repaints from the
 * invalidation a moment later, so a hand-rolled provisional row would buy
 * nothing and could disagree with what the repo actually wrote.
 *
 * Both `qk.events({})` and `qk.today(...)` are invalidated: `{}` is an empty
 * partial filter and TanStack matches keys partially, so it reaches every
 * `["events", …]` entry whatever filter each screen keyed its own with, and
 * an edited chain anchor changes what Today shows next.
 */
export function useCorrectDoseTime(): UseMutationResult<DoseEvent, Error, CorrectDoseTimeVars> {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const t = useT();

  return useMutation<DoseEvent, Error, CorrectDoseTimeVars>({
    mutationFn: (vars) => getRepo().correctDose(vars.eventId, { givenAt: vars.givenAt }),
    onSuccess: (_event, vars) => {
      show({ message: vars.toastMessage });
    },
    onError: () => {
      // A plain factual toast rather than silence — `useLogDose.onError` makes
      // the same choice for a write that fails outside a named error case.
      show({ message: t("history.toast.timeUpdateFailed") });
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.events({}) }),
        queryClient.invalidateQueries({ queryKey: qk.today(localDayKey(now())) }),
      ]);
    },
  });
}
