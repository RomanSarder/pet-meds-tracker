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
import type { DoseEvent, DoseEventStatus, IsoDateTime, LocalDate } from "@/domain";
import { UNDO_WINDOW_MS, displayNameFor, formatHHMM, now, occurrenceKeyFor, qk } from "@/domain";
import { DuplicateDoseError, getRepo, RetractWindowExpiredError, TooSoonSinceLastDoseError } from "@/data";
import { useAllMembers } from "@/features/household/hooks";
import { useToast } from "@/app/Toast";
import { useT } from "@/i18n";
import { elapsedSince } from "./logAtTimeModel";
import type { TodaySnapshot } from "./types";

export interface LogDoseVars {
  occurrenceKey: string;
  courseId: string;
  scheduledFor: IsoDateTime | null;
  amount: number;
  status: "given" | "skipped";
  /** Short medication name alone — DATA, never translated. Titles the early-give confirm dialog. */
  medicationName: string;
  /** Omitted → the repo stamps the current time. Set for "log at a different time". */
  givenAt?: IsoDateTime;
  /**
   * Toast copy, ALREADY LOCALIZED by the caller — `TodayPage` resolves
   * `today.toast.logged` / `today.toast.skipped` before handing the vars over,
   * so this hook never words anything about a medication itself.
   */
  toastMessage: string;
  /**
   * The occurrence's own due instant, when it has one. Used only to word the
   * confirm dialog ("not due for another 40 min"); the decision to show that
   * dialog does not depend on it. Absent for a `fromLastDose` chain that has
   * never started, which has no due instant to be early against.
   */
  dueAt?: IsoDateTime;
  /**
   * User-confirmed retry after a give conflict — forwarded to the repo
   * verbatim, where it clears both heuristic guards (`repo.types.ts`).
   */
  confirmedGive?: boolean;
  /**
   * SPEC §3b-i: set when the caller (`TodayPage.tsx`'s `give`) is logging a
   * `capped` occurrence — "the cap warns, it does not lock", so this is
   * never a reason to refuse the write, only to flag it. Forwarded to the
   * repo verbatim, which stamps `overMax: true` on the created event (never
   * an explicit `false` — `repo.types.ts`'s own convention).
   */
  overMax?: boolean;
}

/**
 * What a give conflict hands the caller, to render the confirm dialog.
 *
 * SPEC §5: EVERY heuristic guard arrives here — there is no path where one of
 * them refuses on its own. The dialog states facts, not a wall-clock time the
 * user must do arithmetic on: how long ago the colliding dose was logged, and
 * (when it applies) how far ahead of its own due instant this give is. Both
 * are already `elapsedSince`-shaped (`./logAtTimeModel`), so the dialog only
 * ever formats, never computes.
 */
export interface GiveConflict {
  vars: LogDoseVars;
  /**
   * Which guard fired. `recentDose` is a grace-window collision with a
   * DIFFERENT occurrence and names the actor who logged it; `tooSoon` is the
   * `EARLY_GIVE_FLOOR_MIN` floor, which knows only that a dose went in very
   * recently — hence the nullable `name`/`status` below.
   */
  reason: "recentDose" | "tooSoon";
  /** The prior dose's actor, already resolved to a display name. `null` for `tooSoon`. */
  name: string | null;
  /** Whether the prior dose was given or skipped. `null` for `tooSoon`. */
  status: DoseEventStatus | null;
  /** How long ago the colliding dose was given/skipped. */
  sinceLast: { hours: number; minutes: number };
  /** How far ahead of its own `dueAt` this give would land — `null` once it is due. */
  early: { hours: number; minutes: number } | null;
}

/**
 * How far ahead of its own due instant this give would land, or `null` when
 * it is already due (or has no due instant at all — a `fromLastDose` chain
 * that has never started). The dialog drops its "not due for another …"
 * sentence on `null` rather than printing "0 min", which would read as a
 * warning about nothing.
 *
 * `elapsedSince` floors at zero, so an already-due dose comes back as
 * `{hours: 0, minutes: 0}` and has to be recognised here rather than by the
 * dialog eyeballing both fields.
 */
function earlyBy(vars: LogDoseVars): { hours: number; minutes: number } | null {
  if (vars.dueAt === undefined) return null;
  const attemptAt = vars.givenAt ? new Date(vars.givenAt) : now();
  const early = elapsedSince(attemptAt, new Date(vars.dueAt));
  return early.hours === 0 && early.minutes === 0 ? null : early;
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
    // Same convention as `idbRepo.ts`/`memoryRepo.ts`'s own `logDose`: absent
    // unless true, never an explicit `false`, so the optimistic row matches
    // the shape the real write settles into.
    ...(vars.overMax ? { overMax: true } : {}),
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

export interface UseLogDoseOptions {
  /**
   * Every heuristic collision reaches here — the caller (`TodayPage`) owns
   * the confirm dialog; this hook only routes, never words the question.
   *
   * Optional in the TYPE only. A caller that omits it falls back to the flat
   * rejection toast, which is the behaviour SPEC §5 no longer wants, so the
   * omission is a bug rather than a mode — it exists so a caller that has
   * genuinely no way to render a dialog degrades to saying something rather
   * than to silence.
   */
  onGiveConflict?: (conflict: GiveConflict) => void;
}

export function useLogDose(
  day: LocalDate,
  opts?: UseLogDoseOptions,
): UseMutationResult<DoseEvent, Error, LogDoseVars> {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const t = useT();
  const undo = useUndoDose(day);
  // Removed members INCLUDED — the same roster History and Pet detail resolve
  // attribution against (SPEC §5/§12: a removed member's name keeps rendering
  // on their past events). `useMembers()`, the live-only list, was wrong here:
  // it left the one surface that names an actor on Today — "Already given by
  // {name} at 07:12", and the early-give dialog — reading "Someone" for a
  // member History still names correctly on the very same device.
  const membersQuery = useAllMembers();

  return useMutation<DoseEvent, Error, LogDoseVars, LogDoseContext>({
    mutationFn: (vars) =>
      getRepo().logDose({
        courseId: vars.courseId,
        status: vars.status,
        scheduledFor: vars.scheduledFor,
        givenAt: vars.givenAt,
        amount: vars.amount,
        confirmedGive: vars.confirmedGive,
        overMax: vars.overMax,
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

    onError: (error, vars, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData<TodaySnapshot>(qk.today(day), context.previous);
      }
      // The very-recent-dose floor — thrown INSTEAD of `DuplicateDoseError`
      // (never alongside it) when the collision is within
      // `EARLY_GIVE_FLOOR_MIN` of ANY live dose on the course, so it is
      // caught here, ahead of the `DuplicateDoseError` branch.
      //
      // SPEC §5: this now ASKS. It used to be the one guard with no retry
      // path at all — a flat toast and nothing else — which meant a carer who
      // genuinely needed to give another dose ten minutes later could not
      // record it. A dose given and not recorded is worse than a recorded
      // exception, which is the same reasoning §3b-i's cap already follows.
      if (error instanceof TooSoonSinceLastDoseError) {
        const duration = { hours: Math.floor(error.minutesSinceLast / 60), minutes: error.minutesSinceLast % 60 };
        if (opts?.onGiveConflict) {
          opts.onGiveConflict({
            vars,
            reason: "tooSoon",
            // The floor guard compares against ANY live dose on the course
            // and carries no actor or status — there is nothing honest to
            // name here, so the dialog words this case without a name.
            name: null,
            status: null,
            sinceLast: duration,
            early: earlyBy(vars),
          });
          return;
        }
        show({
          message: t("today.toast.tooSoonSinceLastDose", {
            duration: t("history.detail.lateDuration", duration),
          }),
        });
        return;
      }
      // SPEC §5: "the second log is rejected client-side with 'Already given
      // by Marta at 07:12'" — a named error, not a message match, so the
      // copy is composed from the fields `DuplicateDoseError` carries rather
      // than parsed out of its (English, developer-facing) `.message`. Never
      // `error.actorId`'s raw id and never an email (SPEC §12): the name
      // always goes through `displayNameFor`, which already falls back to
      // "Someone" for an id this device has no member row for.
      if (error instanceof DuplicateDoseError) {
        const name = displayNameFor(error.actorId, membersQuery.data ?? []);
        const time = formatHHMM(new Date(error.givenAt));
        // A grace-window collision with a DIFFERENT occurrence: someone gave
        // a nearby dose recently, and this is a second one. SPEC §5 says ask,
        // whatever state the row was in — an on-time or overdue give, a Skip
        // and "log at a different time" all reach the dialog now. The
        // previous not-yet-due gate limited it to `later`/`upcoming` rows,
        // which left every other collision as a flat refusal.
        //
        // `error.scheduledFor !== vars.scheduledFor` is what keeps this the
        // GRACE-WINDOW guard's collision rather than the same-occurrence hard
        // block: a double-tap (tap 2 sees tap 1's just-written row before the
        // optimistic flip repaints the button, `onMutate` is async) hits the
        // exact-match block, and there is nothing to ask about — that dose is
        // already given, and confirming would re-send the identical
        // `scheduledFor` the block refuses no matter how often it is retried
        // (see `TodayPage.tsx`'s `confirmGive`, which also sets
        // `confirmedGive` on the retry so any FURTHER collision falls through
        // to the flat toast instead of silently reopening the dialog).
        if (opts?.onGiveConflict && error.scheduledFor !== vars.scheduledFor) {
          const attemptAt = vars.givenAt ? new Date(vars.givenAt) : now();
          // The dialog's OWN name resolution — not `name` above. `displayNameFor`
          // returns the actor's raw, stored `displayName` VERBATIM (SPEC §10a:
          // names are DATA, never translated) — for an un-renamed self-user
          // that literal string IS "You" (`DEFAULT_SELF_DISPLAY_NAME`,
          // `@/domain`), which stayed untranslated inside Ukrainian dialog
          // prose. `HouseholdPage`'s member list solves the identical
          // problem for the self row the same way: `isSelf`, not the raw
          // name, decides whether to substitute a genuinely localized "you"
          // (`household.memberLine.you` there; `today.giveConfirm.you` here —
          // this template's own atomic word, since it needs just the noun,
          // not a whole phrase). Every OTHER `displayNameFor` call site
          // (the flat toast a few lines below included) still shows the
          // raw, untranslated "You" — a pre-existing, wider issue this fix
          // deliberately does not touch.
          const isSelf = (membersQuery.data ?? []).find((u) => u.id === error.actorId)?.isSelf ?? false;
          opts.onGiveConflict({
            vars,
            reason: "recentDose",
            name: isSelf ? t("today.giveConfirm.you") : name,
            status: error.status,
            sinceLast: elapsedSince(new Date(error.givenAt), attemptAt),
            early: earlyBy(vars),
          });
          return;
        }
        show({
          message:
            error.status === "skipped"
              ? t("today.toast.duplicateSkipped", { name, time })
              : t("today.toast.duplicateGiven", { name, time }),
        });
        return;
      }
      // Mirrors `useUndoDose` above: a named error gets specific copy, and
      // anything else still gets a plain factual toast rather than the
      // silence this hook used to fall back to.
      show({ message: t("today.toast.logFailed") });
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
