// Plain unit test of the pure mapper — no rendering, and NOT routed through
// `getDoseState` (which is a stub on this branch that always returns
// "upcoming"). Every `DoseState` is passed in directly instead.
import { describe, expect, it } from "vitest";
import type { DoseState, Occurrence } from "@/engine";
import { createTranslator } from "@/i18n";
import { doseRowPropsFor } from "./doseRow";

const enTr = createTranslator("en");

/** A minimal, valid `Occurrence` literal — built by hand from `engine.types.ts`. */
function baseOccurrence(overrides: Partial<Occurrence> = {}): Occurrence {
  return {
    key: "course-1|2026-08-08T07:00:00.000Z",
    courseId: "course-1",
    petId: "pet-1",
    medicationId: "med-1",
    kind: "fixedTimes",
    day: "2026-08-08",
    dueAt: new Date("2026-08-08T07:00:00.000Z"), // 08:00 local (Europe/London BST)
    graceMinutes: 60,
    doseAmount: 0.4,
    doseUnit: "ml",
    instructions: null,
    event: null,
    ...overrides,
  };
}

describe("doseRowPropsFor", () => {
  const STATE_TABLE: Array<{ state: DoseState; rowState: NonNullable<import("@/components/ds").DoseRowProps["state"]>; time: string }> = [
    { state: "given", rowState: "given", time: "08:00" },
    { state: "overdue", rowState: "overdue", time: "08:00" },
    { state: "due", rowState: "due", time: "08:00" },
    { state: "later", rowState: "later", time: "08:00" },
    { state: "upcoming", rowState: "later", time: "08:00" },
  ];

  it.each(STATE_TABLE)("maps $state to state=$rowState, time=$time", ({ state, rowState, time }) => {
    const props = doseRowPropsFor({
      occurrence: baseOccurrence(),
      state,
      medicationName: "Metacam",
      instructions: null,
      progress: "Day 3 of 7",
      tr: enTr,
    });
    expect(props.state).toBe(rowState);
    expect(props.time).toBe(time);
  });

  it("skipped renders as the given variant with the literal 'Skipped' time, regardless of dueAt", () => {
    const props = doseRowPropsFor({
      occurrence: baseOccurrence(),
      state: "skipped",
      medicationName: "Metacam",
      instructions: null,
      progress: "Day 3 of 7",
      tr: enTr,
    });
    expect(props).toMatchObject({ state: "given", time: "Skipped" });
  });

  it("notStarted with dueAt: null renders as later with the literal 'Not started'", () => {
    const props = doseRowPropsFor({
      occurrence: baseOccurrence({ dueAt: null }),
      state: "notStarted",
      medicationName: "Metoclopramide",
      instructions: null,
      progress: "Ongoing — from last dose",
      tr: enTr,
    });
    expect(props).toMatchObject({ state: "later", time: "Not started" });
  });

  it("detail contains the instructions when present, separated from the time and progress", () => {
    const props = doseRowPropsFor({
      occurrence: baseOccurrence(),
      state: "due",
      medicationName: "Metacam",
      instructions: "after food",
      progress: "Day 3 of 7",
      tr: enTr,
    });
    expect(props.detail).toBe("08:00 · after food · Day 3 of 7");
  });

  it("detail omits the separator when instructions are absent", () => {
    const props = doseRowPropsFor({
      occurrence: baseOccurrence(),
      state: "due",
      medicationName: "Metacam",
      instructions: null,
      progress: "Day 3 of 7",
      tr: enTr,
    });
    expect(props.detail).toBe("08:00 · Day 3 of 7");
    expect(props.detail).not.toContain("· ·");
  });

  it("medication is the courseLabel form", () => {
    const props = doseRowPropsFor({
      occurrence: baseOccurrence({ doseAmount: 2, doseUnit: "drop" }),
      state: "later",
      medicationName: "Ivermectin",
      instructions: null,
      progress: "Day 1",
      tr: enTr,
    });
    expect(props.medication).toBe("Ivermectin 2 drops");
  });
});

// Deliberate Ukrainian coverage of the dose states SPEC pins by name:
// "Skipped", "Overdue" (via ScheduleRow.tsx, not this mapper) and
// "Not started" both resolve through this file's own catalogue lookups.
describe("doseRowPropsFor — Ukrainian", () => {
  const ukTr = createTranslator("uk");

  it("skipped renders the given variant with the literal 'Пропущено' time, regardless of dueAt", () => {
    const props = doseRowPropsFor({
      occurrence: baseOccurrence(),
      state: "skipped",
      medicationName: "Metacam",
      instructions: null,
      progress: "день 3 з 7",
      tr: ukTr,
    });
    expect(props).toMatchObject({ state: "given", time: "Пропущено" });
  });

  it("notStarted with dueAt: null renders as later with the literal 'Не розпочато'", () => {
    const props = doseRowPropsFor({
      occurrence: baseOccurrence({ dueAt: null }),
      state: "notStarted",
      medicationName: "Metoclopramide",
      instructions: null,
      progress: "триває",
      tr: ukTr,
    });
    expect(props).toMatchObject({ state: "later", time: "Не розпочато" });
  });

  it("keeps a dosed medication label's amount unlocalized (0.4, never 0,4) even while every word around it is Ukrainian", () => {
    const props = doseRowPropsFor({
      occurrence: baseOccurrence(),
      state: "due",
      medicationName: "Metacam",
      instructions: null,
      progress: "день 3 з 7",
      tr: ukTr,
    });
    expect(props.medication).toBe("Metacam 0.4 ml");
  });

  it("countable-unit amounts render verbatim in Ukrainian, with no English '+s' suffix", () => {
    const props = doseRowPropsFor({
      occurrence: baseOccurrence({ doseAmount: 2, doseUnit: "drop" }),
      state: "later",
      medicationName: "Ivermectin",
      instructions: null,
      progress: "день 1",
      tr: ukTr,
    });
    expect(props.medication).toBe("Ivermectin 2 drop");
  });
});
