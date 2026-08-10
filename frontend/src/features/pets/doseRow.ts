// Pure presentation mapper: `DoseState` + `Occurrence` -> `DoseRow` props.
// `@/engine`'s `getDoseState` is a typed stub on this branch (always returns
// "upcoming"), so the state-dependent presentation rule below — in
// particular the skipped-dose treatment (SPEC §4: rendered as the DS
// `given` variant at 55% opacity with the literal "Skipped" in place of the
// clock time) — has to live here, as a function callable directly with any
// `DoseState`, so it stays testable without going through the stub.
import type { DoseRowProps } from "@/components/ds";
import type { DoseState, Occurrence } from "@/engine";
import { formatHHMM } from "@/domain";
import type { Translator } from "@/i18n";
import { courseLabel, joinMeta } from "./format";

/** `DoseState` -> `DoseRowProps.state`. See the brief's §MAPPER table. */
const ROW_STATE: Record<DoseState, NonNullable<DoseRowProps["state"]>> = {
  given: "given",
  skipped: "given",
  overdue: "overdue",
  due: "due",
  later: "later",
  upcoming: "later",
  notStarted: "later",
};

export function doseRowPropsFor(args: {
  occurrence: Occurrence;
  state: DoseState;
  medicationName: string;
  instructions: string | null;
  /** `courseProgress(course, day)`, passed in, never computed here. */
  progress: string;
  tr: Translator;
}): DoseRowProps {
  const { occurrence, state, medicationName, instructions, progress, tr } = args;

  // `detail` is the day's SCHEDULE (SPEC §5.3), so its first clause is
  // always the scheduled clock time — `formatHHMM(dueAt)` when non-null,
  // else "Not started" (a `fromLastDose` course with no given event yet has
  // `dueAt === null`). This word is reused verbatim from a catalogue entry
  // another domain already owns (`today.notStarted`) — same concept, same
  // word, in both languages — rather than duplicating a near-identical key
  // here.
  const scheduledClock = occurrence.dueAt ? formatHHMM(occurrence.dueAt) : tr.t("today.notStarted");

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
    detail: joinMeta([scheduledClock, instructions, progress]),
    time,
    state: ROW_STATE[state],
  };
}
