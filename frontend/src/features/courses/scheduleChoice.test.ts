import { describe, expect, it } from "vitest";
import { differenceInLocalDays, type Schedule } from "@/domain";
import {
  FREQUENCY_CHOICES,
  INTERVAL_CHOICES,
  choicesForSchedule,
  endDateForDurationChoice,
  scheduleForFrequencyChoice,
  scheduleForIntervalChoice,
} from "./scheduleChoice";

describe("scheduleForIntervalChoice", () => {
  it.each([
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
