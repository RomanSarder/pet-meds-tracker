// The wording layer for the engine's schedule/course descriptors.
//
// The English half of this file is the regression guard for the engine
// refactor (I18N-DESIGN.md §3.5): before localization, `describeSchedule` and
// `courseProgress` returned these exact strings themselves. Every literal
// below is the pre-refactor output, byte for byte — if a segment, a separator
// or a space changes, this file fails.
import { describe, expect, it } from "vitest";
import { fixtures, type Schedule } from "@/domain";
import { courseProgress, describeSchedule } from "@/engine";
import { createTranslator } from "./translator";
import { renderCourseProgress, renderSchedule } from "./schedule";

const en = createTranslator("en");
const uk = createTranslator("uk");

function renderEn(s: Schedule): string {
  return renderSchedule(describeSchedule(s), en);
}

function renderUk(s: Schedule): string {
  return renderSchedule(describeSchedule(s), uk);
}

interface Case {
  label: string;
  schedule: Schedule;
  expected: string;
}

// I18N-DESIGN.md §3.1's table, row for row — the exact strings the engine
// returned before it started returning structure.
const ENGLISH_CASES: Case[] = [
  {
    label: "fromLastDose, 8h",
    schedule: { kind: "fromLastDose", intervalHours: 8 },
    expected: "every 8h · from last dose",
  },
  {
    label: "fromLastDose, 8h, anchor 08:00",
    schedule: { kind: "fromLastDose", intervalHours: 8, anchorTime: "08:00" },
    expected: "every 8h · from last dose · first dose 08:00",
  },
  {
    label: "fixedTimes, days [3], times [09:00]",
    schedule: { kind: "fixedTimes", times: ["09:00"], daysOfWeek: [3] },
    expected: "weekly · Wed · 09:00",
  },
  {
    label: "fixedTimes, days [1,4], times [08:00]",
    schedule: { kind: "fixedTimes", times: ["08:00"], daysOfWeek: [1, 4] },
    expected: "Mon, Thu · 08:00",
  },
  {
    label: "fixedTimes, days [3], everyNDays 2",
    schedule: { kind: "fixedTimes", times: ["09:00"], daysOfWeek: [3], everyNDays: 2 },
    expected: "weekly · Wed · every 2 days · 09:00",
  },
  {
    label: "fixedTimes, everyNDays 3",
    schedule: { kind: "fixedTimes", times: ["09:00"], everyNDays: 3 },
    expected: "every 3 days · 09:00",
  },
  {
    label: "fixedTimes, 1 time",
    schedule: { kind: "fixedTimes", times: ["08:00"] },
    expected: "once daily · 08:00",
  },
  {
    label: "fixedTimes, 2 times",
    schedule: { kind: "fixedTimes", times: ["08:00", "20:00"] },
    expected: "2× daily · 08:00, 20:00",
  },
];

describe("renderSchedule — English is byte-identical to the pre-localization engine output", () => {
  for (const testCase of ENGLISH_CASES) {
    it(testCase.label, () => {
      expect(renderEn(testCase.schedule)).toBe(testCase.expected);
    });
  }

  // Moved from engine/engine.test.ts, which asserted these substrings of
  // `describeSchedule`'s return value while it still returned prose.
  it("describes a fixedTimes schedule (moved from engine.test.ts)", () => {
    const text = renderEn({ kind: "fixedTimes", times: ["08:00", "20:00"] });
    expect(text).toContain("08:00");
    expect(text).toContain("20:00");
  });

  it("describes a fixedTimes schedule with daysOfWeek and everyNDays (moved from engine.test.ts)", () => {
    const text = renderEn({
      kind: "fixedTimes",
      times: ["07:00"],
      daysOfWeek: [6],
      everyNDays: 2,
    });
    expect(text).toContain("07:00");
    expect(text).toContain("Sat");
    expect(text).toContain("every 2 days");
    expect(text).toBe("weekly · Sat · every 2 days · 07:00");
  });

  it("carries the phrase 'from last dose' (SPEC §3b, moved from engine.test.ts)", () => {
    const text = renderEn({ kind: "fromLastDose", intervalHours: 8 });
    expect(text).toContain("from last dose");
  });

  it("sorts weekdays ascending regardless of input order", () => {
    expect(renderEn({ kind: "fixedTimes", times: ["08:00"], daysOfWeek: [4, 1] })).toBe(
      "Mon, Thu · 08:00",
    );
  });

  it("ignores an everyNDays of 1 and an empty daysOfWeek list", () => {
    expect(renderEn({ kind: "fixedTimes", times: ["08:00"], daysOfWeek: [], everyNDays: 1 })).toBe(
      "once daily · 08:00",
    );
  });
});

describe("renderSchedule — Ukrainian", () => {
  it("renders an interval schedule counted from the last dose", () => {
    expect(renderUk({ kind: "fromLastDose", intervalHours: 8 })).toBe(
      "кожні 8 год · від останньої дози",
    );
  });

  it("renders the anchor time verbatim — times never localize (SPEC §10a)", () => {
    expect(renderUk({ kind: "fromLastDose", intervalHours: 12, anchorTime: "08:00" })).toBe(
      "кожні 12 год · від останньої дози · перша доза 08:00",
    );
  });

  it("agrees the determiner with the interval count", () => {
    expect(renderUk({ kind: "fromLastDose", intervalHours: 1 })).toBe(
      "кожну 1 год · від останньої дози",
    );
  });

  it("renders a weekly schedule with a localized weekday name", () => {
    expect(renderUk({ kind: "fixedTimes", times: ["09:00"], daysOfWeek: [3] })).toBe(
      "щотижня · ср · 09:00",
    );
  });

  it("renders a weekday list with localized names", () => {
    expect(renderUk({ kind: "fixedTimes", times: ["08:00"], daysOfWeek: [1, 4] })).toBe(
      "пн, чт · 08:00",
    );
  });

  it("renders once-daily and N-times-daily", () => {
    expect(renderUk({ kind: "fixedTimes", times: ["08:00"] })).toBe("раз на день · 08:00");
    expect(renderUk({ kind: "fixedTimes", times: ["08:00", "20:00"] })).toBe(
      "2× на день · 08:00, 20:00",
    );
  });

  // Real plural rules, not an appended letter (I18N-DESIGN.md §4): uk selects
  // `one` for 1/21, `few` for 2–4, `many` for 5–20.
  const EVERY_N_DAYS_CASES: { days: number; expected: string }[] = [
    { days: 2, expected: "кожні 2 дні · 09:00" },
    { days: 3, expected: "кожні 3 дні · 09:00" },
    { days: 5, expected: "кожні 5 днів · 09:00" },
    { days: 11, expected: "кожні 11 днів · 09:00" },
    { days: 21, expected: "кожен 21 день · 09:00" },
  ];
  for (const testCase of EVERY_N_DAYS_CASES) {
    it(`pluralizes an every-${testCase.days}-days schedule`, () => {
      expect(
        renderUk({ kind: "fixedTimes", times: ["09:00"], everyNDays: testCase.days }),
      ).toBe(testCase.expected);
    });
  }

  it("never localizes the clock times themselves", () => {
    expect(renderUk({ kind: "fixedTimes", times: ["08:00", "14:10", "20:00"] })).toContain(
      "08:00, 14:10, 20:00",
    );
  });
});

describe("renderCourseProgress", () => {
  // Moved from engine/engine.test.ts — the same fixture, the same literals.
  it("renders SPEC's 'day N of M' style in English (moved from engine.test.ts)", () => {
    // COURSE_CLOVER_METACAM: startDate 2026-08-06, endDate 2026-08-12.
    const course = fixtures.courses[0];
    expect(course.schedule.kind).toBe("fixedTimes");
    expect(renderCourseProgress(courseProgress(course, "2026-08-08"), en)).toBe("day 3 of 7");
  });

  it("renders 'ongoing' in English for a course with no endDate (moved from engine.test.ts)", () => {
    const course = fixtures.courses.find((c) => c.schedule.kind === "fromLastDose")!;
    const text = renderCourseProgress(courseProgress(course, "2026-08-08"), en);
    expect(text).not.toMatch(/^day \d/);
    expect(text).toBe("ongoing");
  });

  it("renders both shapes in Ukrainian", () => {
    expect(renderCourseProgress({ kind: "dayOfTotal", day: 3, total: 7 }, uk)).toBe("день 3 з 7");
    expect(renderCourseProgress({ kind: "ongoing" }, uk)).toBe("триває");
  });
});
