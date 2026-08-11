// Pure presentation mapper: `DoseState` + `Occurrence` -> `DoseRow` props.
// `@/engine`'s `getDoseState` is a typed stub on this branch (always returns
// "upcoming"), so the state-dependent presentation rule below — in
// particular the skipped-dose treatment (SPEC §4: rendered as the DS
// `given` variant at 55% opacity with the literal "Skipped" in place of the
// clock time) — has to live here, as a function callable directly with any
// `DoseState`, so it stays testable without going through the stub.
import type { DoseRowProps } from "@/components/ds";
import type { DoseState, Occurrence } from "@/engine";
import { differenceInLocalDays, formatHHMM, localDayKey, type LocalDate } from "@/domain";
import type { Translator } from "@/i18n";
import { courseLabel, joinMeta } from "./format";

/**
 * "tomorrow" / "in 3 days" for an `upcoming` occurrence's day-word, mirroring
 * `features/today/todayModel.ts`'s own (file-local, unexported) `whenLabel` —
 * duplicated rather than imported: it is four lines of pure catalogue
 * routing, not scheduling arithmetic, and this feature has no legitimate way
 * to reach across into `today`'s internals for it.
 */
function whenLabel(offsetDays: number, tr: Translator): string {
  if (offsetDays <= 0) return tr.t("today.when.today");
  if (offsetDays === 1) return tr.t("today.when.tomorrow");
  return tr.t("today.when.inDays", { days: offsetDays });
}

/** `DoseState` -> `DoseRowProps.state`. See the brief's §MAPPER table. */
const ROW_STATE: Record<DoseState, NonNullable<DoseRowProps["state"]>> = {
  given: "given",
  skipped: "given",
  overdue: "overdue",
  due: "due",
  later: "later",
  upcoming: "later",
  notStarted: "later",
  // SPEC §6.3: Pet detail's Schedule block is READ-ONLY — there is no Give
  // action here at all, let alone a ghost "Give anyway" one, so there is no
  // `onGiveAnyway` this file could ever wire a `DoseRowCap` to (contrast
  // `features/today/TodayDoseRow.tsx`, which does own that action). `later`
  // is therefore the final button-state mapping for `capped`, not a
  // placeholder awaiting a later phase — same reasoning as `upcoming`/
  // `notStarted` above: nothing here is "due" in the filled-button sense.
  capped: "later",
};

export function doseRowPropsFor(args: {
  occurrence: Occurrence;
  state: DoseState;
  medicationName: string;
  instructions: string | null;
  /** `courseProgress(course, day)`, passed in, never computed here. */
  progress: string;
  /** The local day this Schedule block is showing — SPEC §5.3, "today's occurrences". */
  today: LocalDate;
  tr: Translator;
}): DoseRowProps {
  const { occurrence, state, medicationName, instructions, progress, today, tr } = args;

  // `detail` is the day's SCHEDULE (SPEC §5.3), so its first clause is
  // always the scheduled clock time — `formatHHMM(dueAt)` when non-null,
  // else "Not started" (a `fromLastDose` course with no given event yet has
  // `dueAt === null`). This word is reused verbatim from a catalogue entry
  // another domain already owns (`today.notStarted`) — same concept, same
  // word, in both languages — rather than duplicating a near-identical key
  // here.
  const scheduledClock = occurrence.dueAt ? formatHHMM(occurrence.dueAt) : tr.t("today.notStarted");

  // `upcoming`: an anchored `fromLastDose` chain's next dose, reachable a day
  // or more before it is actually due (SPEC §3b; `occurrences.ts` now emits
  // it starting the anchor's own day). Its `scheduledClock` above is a bare
  // clock time that, alone, reads as due TODAY at that hour — the day-word
  // says otherwise, exactly as `today/todayModel.ts`'s `detailFor` already
  // does for the Today dashboard's own version of this same row.
  const dayWord =
    state === "upcoming" && occurrence.dueAt
      ? whenLabel(differenceInLocalDays(localDayKey(occurrence.dueAt), today), tr)
      : null;

  // The trailing slot, by contrast, is state-dependent and — SPEC §4 — for
  // `given` shows the LOGGED time, not the scheduled one: a dose given 8h25m
  // late must say when it was actually given, not repeat its due time. Only
  // `given` reads `occurrence.event`; every other state's trailing slot is
  // still the scheduled clock (or its "Skipped" override). The `event`
  // null-check is for type-safety only — `state === "given"` already implies
  // a resolving `event` (see `engine/state.ts`'s `getDoseState`).
  const time =
    state === "skipped"
      ? tr.t("history.detail.skipped")
      : state === "given" && occurrence.event
        ? formatHHMM(new Date(occurrence.event.givenAt))
        : scheduledClock;

  return {
    medication: courseLabel(medicationName, occurrence.doseAmount, occurrence.doseUnit, tr),
    detail: joinMeta([scheduledClock, dayWord, instructions, progress]),
    time,
    state: ROW_STATE[state],
  };
}
