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
import { courseLabel, joinMeta } from "./format";

const NOT_STARTED = "Not started";
const SKIPPED = "Skipped";

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
}): DoseRowProps {
  const { occurrence, state, medicationName, instructions, progress } = args;

  // Clock time = `formatHHMM(dueAt)` when non-null, else "Not started" (a
  // `fromLastDose` course with no given event yet has `dueAt === null`).
  // `skipped` overrides this with the literal "Skipped" regardless of `dueAt`.
  const clockTime = occurrence.dueAt ? formatHHMM(occurrence.dueAt) : NOT_STARTED;
  const time = state === "skipped" ? SKIPPED : clockTime;

  return {
    medication: courseLabel(medicationName, occurrence.doseAmount, occurrence.doseUnit),
    detail: joinMeta([time, instructions, progress]),
    time,
    state: ROW_STATE[state],
  };
}
