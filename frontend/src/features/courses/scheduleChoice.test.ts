import { describe, expect, it } from "vitest";
import { differenceInLocalDays, type Schedule } from "@/domain";
import { createTranslator } from "@/i18n";
import {
  FREQUENCY_CHOICES,
  INTERVAL_CHOICES,
  choicesForSchedule,
  endDateForDurationChoice,
  intervalChoiceHours,
  intervalChoiceLabel,
  isPresetSchedule,
  scheduleForFrequencyChoice,
  scheduleForIntervalChoice,
} from "./scheduleChoice";

const en = createTranslator("en");
const uk = createTranslator("uk");

describe("scheduleForIntervalChoice", () => {
  it.each([
    ["Every 2h", 2],
    ["Every 4h", 4],
    ["Every 6h", 6],
    ["Every 8h", 8],
    ["Every 12h", 12],
    ["Every 24h", 24],
  ] as const)("%s -> fromLastDose intervalHours %d, no other keys", (chip, hours) => {
    const schedule = scheduleForIntervalChoice(chip);
    expect(schedule).toEqual({ kind: "fromLastDose", intervalHours: hours });
    // anchorTime is optional on fromLastDose — assert it is truly absent, not
    // just falsy, per CONTRACT.md's "emit no anchorTime" rule.
    expect(Object.keys(schedule)).not.toContain("anchorTime");
  });
});

describe("INTERVAL_CHOICES ordering", () => {
  it("starts with the shortest interval, Every 2h", () => {
    expect(INTERVAL_CHOICES[0]).toBe("Every 2h");
  });

  it("is sorted ascending by hours — protects future additions too, not just this one", () => {
    const hours = INTERVAL_CHOICES.map(intervalChoiceHours);
    const sorted = [...hours].sort((a, b) => a - b);
    expect(hours).toEqual(sorted);
  });
});

describe("intervalChoiceLabel — Every 2h resolves to a real translation, not a missing-key fallback", () => {
  it("English", () => {
    expect(intervalChoiceLabel("Every 2h", en)).toBe("Every 2h");
  });

  it("Ukrainian", () => {
    expect(intervalChoiceLabel("Every 2h", uk)).toBe("Кожні 2 год");
  });
});

describe("scheduleForFrequencyChoice", () => {
  it("Once daily -> fixedTimes 09:00", () => {
    expect(scheduleForFrequencyChoice("Once daily")).toEqual({
      kind: "fixedTimes",
      times: ["09:00"],
    });
  });

  it("2x daily -> fixedTimes 08:00/20:00", () => {
    expect(scheduleForFrequencyChoice("2× daily")).toEqual({
      kind: "fixedTimes",
      times: ["08:00", "20:00"],
    });
  });

  it("3x daily -> fixedTimes 08:00/14:00/20:00", () => {
    expect(scheduleForFrequencyChoice("3× daily")).toEqual({
      kind: "fixedTimes",
      times: ["08:00", "14:00", "20:00"],
    });
  });

  it("Weekly -> fixedTimes 08:00 on ISO day 6 (Saturday, NOT JS getDay's Friday)", () => {
    const schedule = scheduleForFrequencyChoice("Weekly");
    expect(schedule).toEqual({
      kind: "fixedTimes",
      times: ["08:00"],
      daysOfWeek: [6],
    });
    // The highest-risk silent bug in the wave: assert no anchorTime/everyNDays
    // sneaked in, and that daysOfWeek is exactly [6] (Saturday, ISO 1=Monday).
    expect(Object.keys(schedule)).not.toContain("anchorTime");
    expect(Object.keys(schedule)).not.toContain("everyNDays");
    if (schedule.kind === "fixedTimes") {
      expect(schedule.daysOfWeek).toEqual([6]);
    }
  });

  it.each([...FREQUENCY_CHOICES])("%s never carries anchorTime or everyNDays", (chip) => {
    const schedule = scheduleForFrequencyChoice(chip);
    expect(Object.keys(schedule)).not.toContain("anchorTime");
    expect(Object.keys(schedule)).not.toContain("everyNDays");
  });
});

describe("endDateForDurationChoice", () => {
  const startDate = "2026-08-08";

  it("7 days -> startDate + 6, so courseProgress reads Day 1 of 7", () => {
    const end = endDateForDurationChoice("7 days", startDate, null);
    expect(end).toBe("2026-08-14");
    expect(differenceInLocalDays(end as string, startDate) + 1).toBe(7);
  });

  it("14 days -> startDate + 13, so courseProgress reads Day 1 of 14", () => {
    const end = endDateForDurationChoice("14 days", startDate, null);
    expect(end).toBe("2026-08-21");
    expect(differenceInLocalDays(end as string, startDate) + 1).toBe(14);
  });

  it("Ongoing -> null", () => {
    expect(endDateForDurationChoice("Ongoing", startDate, null)).toBeNull();
  });

  it("Custom -> the picked date, or null when none picked yet", () => {
    expect(endDateForDurationChoice("Custom", startDate, "2026-09-01")).toBe("2026-09-01");
    expect(endDateForDurationChoice("Custom", startDate, null)).toBeNull();
  });
});

describe("choicesForSchedule", () => {
  it.each([...INTERVAL_CHOICES])("round-trips %s back through fromLastDose", (chip) => {
    const schedule = scheduleForIntervalChoice(chip);
    const choices = choicesForSchedule(schedule);
    expect(choices.mode).toBe("From last dose");
    expect(choices.interval).toBe(chip);
  });

  it.each([...FREQUENCY_CHOICES])("round-trips %s back through fixedTimes", (chip) => {
    const schedule = scheduleForFrequencyChoice(chip);
    const choices = choicesForSchedule(schedule);
    expect(choices.mode).toBe("At set times");
    expect(choices.frequency).toBe(chip);
  });

  it("never throws on an out-of-list intervalHours, falling back to the nearest chip", () => {
    expect(() => choicesForSchedule({ kind: "fromLastDose", intervalHours: 5 })).not.toThrow();
    const choices = choicesForSchedule({ kind: "fromLastDose", intervalHours: 5 });
    expect(INTERVAL_CHOICES).toContain(choices.interval);
  });

  it("never throws on an unrecognised fixedTimes shape, falling back to Once daily", () => {
    const schedule: Schedule = { kind: "fixedTimes", times: ["11:11"] };
    expect(() => choicesForSchedule(schedule)).not.toThrow();
    expect(choicesForSchedule(schedule).frequency).toBe("Once daily");
  });
});

describe("isPresetSchedule", () => {
  it.each([...FREQUENCY_CHOICES])("%s's own schedule is a preset", (chip) => {
    expect(isPresetSchedule(scheduleForFrequencyChoice(chip))).toBe(true);
  });

  it("a schedule the times editor has nudged off 2x daily is not a preset", () => {
    expect(isPresetSchedule({ kind: "fixedTimes", times: ["08:00", "18:00"] })).toBe(false);
  });

  it("08:00 alone, with no daysOfWeek, is NOT the Weekly preset (which needs daysOfWeek: [6])", () => {
    expect(isPresetSchedule({ kind: "fixedTimes", times: ["08:00"] })).toBe(false);
  });

  it("fromLastDose is never a preset", () => {
    expect(isPresetSchedule({ kind: "fromLastDose", intervalHours: 8 })).toBe(false);
  });
});
