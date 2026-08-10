// The wording layer for the Pet history screen.
//
// The English half of this file is the regression guard for making
// `features/history/logModel.ts` locale-free (I18N-DESIGN.md §6): before
// localization, logModel built these exact strings itself. Every English
// literal below is the pre-refactor output, byte for byte — if a clause, a
// separator or a space changes, this file fails.
import { describe, expect, it } from "vitest";
import { describeSchedule } from "@/engine";
import type { DetailClause } from "@/features/history/logModel";
import { createTranslator } from "./translator";
import { renderDayHeading, renderDetail, renderLogTitle } from "./history";

const en = createTranslator("en");
const uk = createTranslator("uk");

const TWICE_DAILY = describeSchedule({ kind: "fixedTimes", times: ["08:00", "20:00"] });
const EVERY_12H = describeSchedule({ kind: "fromLastDose", intervalHours: 12 });
const EVERY_8H = describeSchedule({ kind: "fromLastDose", intervalHours: 8 });

describe("renderLogTitle", () => {
  // Moved here from `features/history/logModel.test.ts`, which used to assert
  // this string off `entry.title` back when logModel composed it itself.
  it("reproduces the pre-localization English title exactly", () => {
    expect(renderLogTitle({ medicationName: "Metacam", amount: 0.4, unit: "ml" }, en)).toBe(
      "Metacam 0.4 ml",
    );
  });

  // The regression this structured title closes: a countable unit pluralises
  // in English but must be rendered exactly as entered in Ukrainian (SPEC
  // §10a). A locale-free logModel composing the string itself could only ever
  // emit the English form on both screens.
  it("pluralises a countable unit in English but leaves it verbatim in Ukrainian", () => {
    const title = { medicationName: "Ivermectin", amount: 2, unit: "drop" };
    expect(renderLogTitle(title, en)).toBe("Ivermectin 2 drops");
    expect(renderLogTitle(title, uk)).toBe("Ivermectin 2 drop");
  });

  // The amount is DATA, never run through a locale number format — "0.4" in
  // both languages, never Ukrainian's "0,4".
  it("keeps a decimal amount's '.' separator in both languages", () => {
    const title = { medicationName: "Metacam", amount: 0.4, unit: "ml" };
    expect(renderLogTitle(title, en)).toBe("Metacam 0.4 ml");
    expect(renderLogTitle(title, uk)).toBe("Metacam 0.4 ml");
  });
});

describe("renderDetail — English is byte-identical to the pre-localization logModel output", () => {
  // The three examples I18N-DESIGN.md §6 and SPEC §6.4 name explicitly.
  it('SPEC §6.4: "Given 40 min late · chain shifted"', () => {
    const clauses: DetailClause[] = [
      { kind: "givenLate", hours: 0, minutes: 40 },
      { kind: "chainShifted" },
    ];
    expect(renderDetail(clauses, en)).toBe("Given 40 min late · chain shifted");
  });

  it('"Course started · 2× daily · 08:00, 20:00 · for 7 days"', () => {
    const clauses: DetailClause[] = [
      { kind: "courseStarted", schedule: TWICE_DAILY, totalDays: 7 },
    ];
    expect(renderDetail(clauses, en)).toBe(
      "Course started · 2× daily · 08:00, 20:00 · for 7 days",
    );
  });

  it('"Interval changed · every 12h · from last dose to 2× daily · 08:00, 20:00"', () => {
    const clauses: DetailClause[] = [
      { kind: "intervalChanged", before: EVERY_12H, after: TWICE_DAILY },
    ];
    expect(renderDetail(clauses, en)).toBe(
      "Interval changed · every 12h · from last dose to 2× daily · 08:00, 20:00",
    );
  });

  // Every remaining clause kind, at its pre-localization wording.
  const CASES: Array<{ label: string; clauses: DetailClause[]; expected: string }> = [
    { label: "given", clauses: [{ kind: "given" }], expected: "Given" },
    { label: "skipped", clauses: [{ kind: "skipped" }], expected: "Skipped" },
    { label: "missed", clauses: [{ kind: "missed" }], expected: "Missed" },
    {
      label: "missed with a scheduled time",
      clauses: [{ kind: "missed" }, { kind: "scheduledAt", time: "08:00" }],
      expected: "Missed · scheduled 08:00",
    },
    {
      label: "skipped with instructions and a note",
      clauses: [
        { kind: "skipped" },
        { kind: "text", text: "after food" },
        { kind: "text", text: "vomited" },
      ],
      expected: "Skipped · after food · vomited",
    },
    {
      label: "given with the next due time",
      clauses: [{ kind: "given" }, { kind: "nextDue", time: "15:00", schedule: EVERY_8H }],
      expected: "Given · next due 15:00, every 8h · from last dose",
    },
    {
      label: "given with course progress",
      clauses: [{ kind: "given" }, { kind: "progress", progress: { kind: "dayOfTotal", day: 3, total: 7 } }],
      expected: "Given · day 3 of 7",
    },
    {
      label: "course started with no end date",
      clauses: [{ kind: "courseStarted", schedule: TWICE_DAILY, totalDays: null }],
      expected: "Course started · 2× daily · 08:00, 20:00",
    },
    { label: "course paused", clauses: [{ kind: "coursePaused" }], expected: "Course paused" },
    { label: "course resumed", clauses: [{ kind: "courseResumed" }], expected: "Course resumed" },
    { label: "course stopped", clauses: [{ kind: "courseStopped" }], expected: "Course stopped" },
    { label: "course finished", clauses: [{ kind: "courseFinished" }], expected: "Course finished" },
    { label: "course edited", clauses: [{ kind: "courseEdited" }], expected: "Course edited" },
    {
      label: "dose changed",
      clauses: [
        {
          kind: "doseChanged",
          before: { amount: 0.4, unit: "ml" },
          after: { amount: 0.6, unit: "ml" },
        },
      ],
      expected: "Dose changed · 0.4 ml to 0.6 ml",
    },
    {
      label: "an interval and a dose change together",
      clauses: [
        { kind: "intervalChanged", before: EVERY_12H, after: TWICE_DAILY },
        {
          kind: "doseChanged",
          before: { amount: 0.4, unit: "ml" },
          after: { amount: 0.6, unit: "ml" },
        },
      ],
      expected:
        "Interval changed · every 12h · from last dose to 2× daily · 08:00, 20:00 · Dose changed · 0.4 ml to 0.6 ml",
    },
  ];

  for (const testCase of CASES) {
    it(testCase.label, () => {
      expect(renderDetail(testCase.clauses, en)).toBe(testCase.expected);
    });
  }

  it("joins present clauses with ' · ' and drops empty ones, like the old joinMeta", () => {
    expect(renderDetail([], en)).toBe("");
    expect(renderDetail([{ kind: "given" }, { kind: "text", text: "" }], en)).toBe("Given");
  });

  // lateLabel's three English shapes, computed from { hours, minutes }.
  const LATE_CASES: Array<{ hours: number; minutes: number; expected: string }> = [
    { hours: 0, minutes: 40, expected: "Given 40 min late" },
    { hours: 2, minutes: 0, expected: "Given 2 h late" },
    { hours: 2, minutes: 15, expected: "Given 2 h 15 min late" },
    { hours: 1, minutes: 20, expected: "Given 1 h 20 min late" },
  ];
  for (const testCase of LATE_CASES) {
    it(`renders ${testCase.hours}h ${testCase.minutes}m late as "${testCase.expected}"`, () => {
      expect(
        renderDetail(
          [{ kind: "givenLate", hours: testCase.hours, minutes: testCase.minutes }],
          en,
        ),
      ).toBe(testCase.expected);
    });
  }

  // A pre-existing English defect that a real plural rule fixes for free:
  // the old logModel emitted `for ${totalDays} days` unconditionally.
  it("says 'for 1 day', not the old 'for 1 days'", () => {
    expect(renderDetail([{ kind: "courseStarted", schedule: TWICE_DAILY, totalDays: 1 }], en)).toBe(
      "Course started · 2× daily · 08:00, 20:00 · for 1 day",
    );
  });
});

describe("renderDetail — Ukrainian", () => {
  it("renders the late-dose example with the invariant hour/minute abbreviations", () => {
    expect(
      renderDetail(
        [{ kind: "givenLate", hours: 2, minutes: 15 }, { kind: "chainShifted" }],
        uk,
      ),
    ).toBe("Дано із запізненням на 2 год 15 хв · ланцюжок зсунуто");
  });

  it("distinguishes a skipped dose from a missed one", () => {
    expect(renderDetail([{ kind: "skipped" }], uk)).toBe("Пропущено");
    expect(renderDetail([{ kind: "missed" }, { kind: "scheduledAt", time: "08:00" }], uk)).toBe(
      "Не дано · за розкладом 08:00",
    );
  });

  it("renders a course start with a localized schedule and a real plural for the length", () => {
    expect(renderDetail([{ kind: "courseStarted", schedule: TWICE_DAILY, totalDays: 7 }], uk)).toBe(
      "Курс розпочато · 2× на день · 08:00, 20:00 · на 7 днів",
    );
  });

  // uk selects `one` for 1/21, `few` for 2–4, `many` for 5–20 — never an
  // appended letter (I18N-DESIGN.md §4).
  const DAYS_CASES: Array<{ days: number; expected: string }> = [
    { days: 1, expected: "на 1 день" },
    { days: 3, expected: "на 3 дні" },
    { days: 7, expected: "на 7 днів" },
    { days: 21, expected: "на 21 день" },
  ];
  for (const testCase of DAYS_CASES) {
    it(`pluralizes a ${testCase.days}-day course`, () => {
      expect(
        renderDetail([{ kind: "courseStarted", schedule: TWICE_DAILY, totalDays: testCase.days }], uk),
      ).toContain(testCase.expected);
    });
  }

  it("renders an interval change and a dose change", () => {
    expect(renderDetail([{ kind: "intervalChanged", before: EVERY_12H, after: TWICE_DAILY }], uk)).toBe(
      "Інтервал змінено · кожні 12 год · від останньої дози на 2× на день · 08:00, 20:00",
    );
    expect(
      renderDetail(
        [
          {
            kind: "doseChanged",
            before: { amount: 0.4, unit: "ml" },
            after: { amount: 0.6, unit: "ml" },
          },
        ],
        uk,
      ),
      // Doses and units never localize: 0.4 stays 0.4, "ml" stays "ml".
    ).toBe("Дозу змінено · 0.4 ml на 0.6 ml");
  });

  it("never applies English morphology to a countable unit in a Ukrainian sentence", () => {
    expect(
      renderDetail(
        [
          {
            kind: "doseChanged",
            before: { amount: 1, unit: "tab" },
            after: { amount: 2, unit: "tab" },
          },
        ],
        uk,
      ),
    ).toBe("Дозу змінено · 1 tab на 2 tab");
  });

  it("carries the user's own note through untranslated — it is data", () => {
    expect(
      renderDetail([{ kind: "skipped" }, { kind: "text", text: "refused syringe" }], uk),
    ).toBe("Пропущено · refused syringe");
  });
});

describe("renderDayHeading", () => {
  it("reproduces the pre-localization English shapes exactly", () => {
    expect(renderDayHeading({ relative: "today", day: "2026-08-09" }, en)).toBe("Today · Sun 9 Aug");
    expect(renderDayHeading({ relative: "yesterday", day: "2026-08-08" }, en)).toBe(
      "Yesterday · Sat 8 Aug",
    );
    expect(renderDayHeading({ relative: null, day: "2026-08-07" }, en)).toBe("Fri 7 Aug");
  });

  it("localizes the weekday and month names in Ukrainian", () => {
    expect(renderDayHeading({ relative: "today", day: "2026-08-09" }, uk)).toBe(
      "Сьогодні · нд, 9 серп.",
    );
    expect(renderDayHeading({ relative: "yesterday", day: "2026-08-08" }, uk)).toBe(
      "Учора · сб, 8 серп.",
    );
    expect(renderDayHeading({ relative: null, day: "2026-08-07" }, uk)).toBe("пт, 7 серп.");
  });
});
