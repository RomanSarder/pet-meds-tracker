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
  // SPEC §4: "given" here uses `baseOccurrence()`'s default `event: null`,
  // so its trailing `time` falls through to the scheduled clock (the same
  // fallback every other non-given state uses) — this table does not
  // exercise the logged-time path; see the dedicated test below for that.
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
      today: "2026-08-08",
      tr: enTr,
    });
    expect(props.state).toBe(rowState);
    expect(props.time).toBe(time);
  });

  // Part 2 consumer fix (SPEC §3b): an anchored `fromLastDose` chain's next
  // dose can now be `upcoming` on Pet detail's Schedule block too — reachable
  // a day before it is due. Its bare clock time alone would read as due
  // TODAY at that hour; the day-word says otherwise.
  it("upcoming due tomorrow adds a 'tomorrow' day-word to detail, distinct from a same-day upcoming row", () => {
    const tomorrow = doseRowPropsFor({
      occurrence: baseOccurrence({
        kind: "fromLastDose",
        day: "2026-08-08",
        dueAt: new Date("2026-08-09T02:00:00.000Z"), // 03:00 BST, next local day
      }),
      state: "upcoming",
      medicationName: "Metoclopramide",
      instructions: null,
      progress: "every 8h · from last dose",
      today: "2026-08-08",
      tr: enTr,
    });
    expect(tomorrow.time).toBe("03:00");
    expect(tomorrow.detail).toBe("03:00 · tomorrow · every 8h · from last dose");

    // The STATE_TABLE case above pins the opposite: no day-word when the
    // occurrence's own `dueAt` is still within `today`.
    const sameDay = doseRowPropsFor({
      occurrence: baseOccurrence(),
      state: "upcoming",
      medicationName: "Metacam",
      instructions: null,
      progress: "Day 3 of 7",
      today: "2026-08-08",
      tr: enTr,
    });
    expect(sameDay.detail).not.toContain("tomorrow");
  });

  it("given derives its trailing time from the logged givenAt, not the scheduled dueAt (SPEC §4: 'the logged time')", () => {
    // Scheduled for 08:00 BST, actually given 16:25 BST — 8h25m late.
    const props = doseRowPropsFor({
      occurrence: baseOccurrence({
        event: {
          id: "event-1",
          courseId: "course-1",
          scheduledFor: "2026-08-08T07:00:00.000Z",
          status: "given",
          loggedAt: "2026-08-08T15:25:00.000Z",
          givenAt: "2026-08-08T15:25:00.000Z", // 16:25 BST
          amount: 0.4,
          note: null,
          occurrenceKey: "course-1|2026-08-08T07:00:00.000Z",
          supersedesId: null,
          actorId: "actor-1",
          createdAt: "2026-08-08T15:25:00.000Z",
          updatedAt: "2026-08-08T15:25:00.000Z",
          deletedAt: null,
        },
      }),
      state: "given",
      medicationName: "Amoxicillin",
      instructions: null,
      progress: "Day 1 of 7",
      today: "2026-08-08",
      tr: enTr,
    });

    // SPEC §4: the trailing slot shows the logged time...
    expect(props.time).toBe("16:25");
    // ...while `detail`'s schedule clause keeps the SCHEDULED time — it's the
    // day's schedule, and dropping it would lose information.
    expect(props.detail).toBe("08:00 · Day 1 of 7");
  });

  it("skipped renders as the given variant with the literal 'Skipped' time, regardless of dueAt", () => {
    const props = doseRowPropsFor({
      occurrence: baseOccurrence(),
      state: "skipped",
      medicationName: "Metacam",
      instructions: null,
      progress: "Day 3 of 7",
      today: "2026-08-08",
      tr: enTr,
    });
    expect(props).toMatchObject({ state: "given", time: "Skipped" });
  });

  // Before 28c8a89, `detail` was derived from `time`, so a skipped row's
  // schedule clause inherited the literal "Skipped" word too — the row said
  // "Skipped" twice (once in `detail`, once in the trailing slot). SPEC §4's
  // logged-time split gave `detail` its own scheduled-clock source
  // independent of `time`, so a skipped row now says "Skipped" once. This is
  // the intended shape — don't "restore" the duplication as a bug fix.
  it("skipped: detail starts with the scheduled clock, not the 'Skipped' word — it appears once per row, not twice", () => {
    const props = doseRowPropsFor({
      occurrence: baseOccurrence(),
      state: "skipped",
      medicationName: "Metacam",
      instructions: null,
      progress: "Day 3 of 7",
      today: "2026-08-08",
      tr: enTr,
    });
    expect(props.time).toBe("Skipped");
    expect(props.detail).toMatch(/^08:00/);
    expect(props.detail).not.toContain("Skipped");
  });

  it("notStarted with dueAt: null renders as later with the literal 'Not started'", () => {
    const props = doseRowPropsFor({
      occurrence: baseOccurrence({ dueAt: null }),
      state: "notStarted",
      medicationName: "Metoclopramide",
      instructions: null,
      progress: "Ongoing — from last dose",
      today: "2026-08-08",
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
      today: "2026-08-08",
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
      today: "2026-08-08",
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
      today: "2026-08-08",
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
      today: "2026-08-08",
      tr: ukTr,
    });
    expect(props).toMatchObject({ state: "given", time: "Пропущено" });
  });

  // Before 28c8a89, `detail` was derived from `time`, so a skipped row's
  // schedule clause inherited the literal "Пропущено" word too — the row
  // said "Пропущено" twice (once in `detail`, once in the trailing slot).
  // SPEC §4's logged-time split gave `detail` its own scheduled-clock source
  // independent of `time`, so a skipped row now says "Пропущено" once. This
  // is the intended shape — don't "restore" the duplication as a bug fix.
  it("skipped: detail starts with the scheduled clock, not the 'Пропущено' word — it appears once per row, not twice", () => {
    const props = doseRowPropsFor({
      occurrence: baseOccurrence(),
      state: "skipped",
      medicationName: "Metacam",
      instructions: null,
      progress: "день 3 з 7",
      today: "2026-08-08",
      tr: ukTr,
    });
    expect(props.time).toBe("Пропущено");
    expect(props.detail).toMatch(/^08:00/);
    expect(props.detail).not.toContain("Пропущено");
  });

  it("notStarted with dueAt: null renders as later with the literal 'Не розпочато'", () => {
    const props = doseRowPropsFor({
      occurrence: baseOccurrence({ dueAt: null }),
      state: "notStarted",
      medicationName: "Metoclopramide",
      instructions: null,
      progress: "триває",
      today: "2026-08-08",
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
      today: "2026-08-08",
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
      today: "2026-08-08",
      tr: ukTr,
    });
    expect(props.medication).toBe("Ivermectin 2 drop");
  });
});
