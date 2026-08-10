// One-tap logging, and the undo that makes it safe.
//
// THE GOVERNING PRODUCT RULE (SPEC §5.1): "Give logs the dose at the current
// time. The row animates to its given state in place. The tap must not
// navigate. Undo is available for 5 seconds via a toast." Nothing in this file
// navigates, opens a sheet, or blocks on a spinner — the row changes because
// `onMutate` rewrites the cached occurrence before the write is even attempted,
// and the write is reconciled underneath it.
//
// WHAT THIS FILE MUST NOT DO (SPEC §11): "Logging any number of doses leaves
// `stockUnits` unchanged." Stock is drawn down by the Supplies slice, never by
// logging, so `adjustStock`, `setStockOnHand` and the medication writers are
// not imported here at all.
import { useCallback } from "react";
import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { DoseEvent, IsoDateTime, LocalDate } from "@/domain";
import { UNDO_WINDOW_MS, now, occurrenceKeyFor, qk } from "@/domain";
import { getRepo, RetractWindowExpiredError } from "@/data";
import { useToast } from "@/app/Toast";
import { useT } from "@/i18n";
import type { TodaySnapshot } from "./types";

export interface LogDoseVars {
  occurrenceKey: string;
  courseId: string;
  scheduledFor: IsoDateTime | null;
  amount: number;
  status: "given" | "skipped";
  /** Omitted → the repo stamps the current time. Set for "log at a different time". */
  givenAt?: IsoDateTime;
  /**
   * Toast copy, ALREADY LOCALIZED by the caller — `TodayPage` resolves
   * `today.toast.logged` / `today.toast.skipped` before handing the vars over,
   * so this hook never words anything about a medication itself.
   */
  toastMessage: string;
}

interface LogDoseContext {
  /** The snapshot as it was before the optimistic flip, for `onError`. */
  previous: TodaySnapshot | undefined;
}

/**
 * The row the screen renders while the write is in flight. `id` is the literal
 * string "optimistic" rather than a generated UUID: this row must never be
 * mistaken for a persisted event, and `onSettled`'s invalidation replaces it
 * with the real one moments later.
 */
function provisionalEvent(vars: LogDoseVars, actorId: string): DoseEvent {
  const stamp: IsoDateTime = vars.givenAt ?? now().toISOString();
  return {
    id: "optimistic",
    courseId: vars.courseId,
    scheduledFor: vars.scheduledFor,
    status: vars.status,
    loggedAt: stamp,
    givenAt: stamp,
    amount: vars.amount,
    note: null,
    occurrenceKey: occurrenceKeyFor(vars.courseId, vars.scheduledFor),
    supersedesId: null,
    actorId,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  };
}

/**
 * Retracts a just-logged event and refreshes everything that could be showing
 * it.
 *
 * `retractDoseEvent` is a bounded HARD delete, and deliberately so: it is the
 * only reason SPEC §11's "logging then undoing a dose leaves history exactly as
 * before" can hold literally. A soft delete or a compensating row would leave
 * history *changed but cancelled out*, which is a different claim.
 */
export function useUndoDose(day: LocalDate): (eventId: string) => Promise<void> {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const t = useT();

  return useCallback(
    async (eventId: string): Promise<void> => {
      try {
        await getRepo().retractDoseEvent(eventId);
      } catch (error) {
        // A named error, not a message match: "too late" is an ordinary
        // outcome of a 5-second window, so it gets a plain factual toast
        // rather than being thrown at an error boundary. Anything else is a
        // real failure and propagates.
        if (error instanceof RetractWindowExpiredError) {
          show({ message: t("today.undo.tooLate") });
          return;
        }
        throw error;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.today(day) }),
        queryClient.invalidateQueries({ queryKey: qk.events({}) }),
      ]);
    },
    [queryClient, show, day, t],
  );
}

export function useLogDose(day: LocalDate): UseMutationResult<DoseEvent, Error, LogDoseVars> {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const t = useT();
  const undo = useUndoDose(day);

  return useMutation<DoseEvent, Error, LogDoseVars, LogDoseContext>({
    mutationFn: (vars) =>
      getRepo().logDose({
        courseId: vars.courseId,
        status: vars.status,
        scheduledFor: vars.scheduledFor,
        givenAt: vars.givenAt,
        amount: vars.amount,
      }),

    onMutate: async (vars): Promise<LogDoseContext> => {
      // Cancel first: an in-flight refetch that resolves after the line below
      // would overwrite the optimistic snapshot with pre-log server data and
      // the row would visibly flip back.
      await queryClient.cancelQueries({ queryKey: qk.today(day) });
      const previous = queryClient.getQueryData<TodaySnapshot>(qk.today(day));
      if (previous) {
        // The optimistic row must carry the real actor id, not a placeholder —
        // it stands in for the row `logDose` is about to write, and that row's
        // `actorId` is always the repo's stamped `currentActorId()`.
        const actorId = await getRepo().currentActorId();
        queryClient.setQueryData<TodaySnapshot>(qk.today(day), {
          ...previous,
          occurrences: previous.occurrences.map((occurrence) =>
            occurrence.key === vars.occurrenceKey
              ? { ...occurrence, event: provisionalEvent(vars, actorId) }
              : occurrence,
          ),
        });
      }
      return { previous };
    },

    onError: (_error, _vars, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData<TodaySnapshot>(qk.today(day), context.previous);
      }
    },

    onSuccess: (event, vars) => {
      show({
        message: vars.toastMessage,
        actionLabel: t("today.undo"),
        durationMs: UNDO_WINDOW_MS,
        onAction: () => {
          void undo(event.id);
        },
      });
    },

    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.today(day) }),
        // `{}` is an empty partial filter, and TanStack Query matches query
        // keys partially, so this reaches every `["events", …]` key in the
        // cache regardless of the filter the other screens keyed theirs with.
        queryClient.invalidateQueries({ queryKey: qk.events({}) }),
      ]);
    },
  });
}
