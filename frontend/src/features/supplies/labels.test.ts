import { describe, expect, it } from "vitest";
import type { Schedule } from "@/domain";
import {
  forWhomLabel,
  frequencyLabel,
  neededLabel,
  runOutLabel,
  stockLabel,
  weeksOfCoverLabel,
} from "./labels";

const twiceDaily: Schedule = { kind: "fixedTimes", times: ["07:00", "19:00"] };
const daily: Schedule = { kind: "fixedTimes", times: ["07:00"] };
const weekly: Schedule = { kind: "fixedTimes", times: ["07:00"], daysOfWeek: [6] };
const everyTwoDays: Schedule = { kind: "fixedTimes", times: ["07:00"], everyNDays: 2 };
const everyEightHours: Schedule = { kind: "fromLastDose", intervalHours: 8 };
const everyTwentyFourHours: Schedule = { kind: "fromLastDose", intervalHours: 24 };
const everyFiveHours: Schedule = { kind: "fromLastDose", intervalHours: 5 };

describe("frequencyLabel", () => {
  it("fixedTimes, 2 times -> 2× daily", () => {
    expect(frequencyLabel(twiceDaily)).toBe("2× daily");
  });

  it("fixedTimes, 1 time -> daily (not 'once daily')", () => {
    expect(frequencyLabel(daily)).toBe("daily");
  });

  it("fixedTimes, single daysOfWeek entry -> weekly", () => {
    expect(frequencyLabel(weekly)).toBe("weekly");
  });

  it("fixedTimes, everyNDays -> every N days", () => {
    expect(frequencyLabel(everyTwoDays)).toBe("every 2 days");
  });

  it("fromLastDose, intervalHours: 8 -> 3× daily", () => {
    expect(frequencyLabel(everyEightHours)).toBe("3× daily");
  });

  it("fromLastDose, intervalHours: 24 -> daily", () => {
    expect(frequencyLabel(everyTwentyFourHours)).toBe("daily");
  });

  it("fromLastDose, non-integer doses per day -> every Nh", () => {
    expect(frequencyLabel(everyFiveHours)).toBe("every 5h");
  });
});

describe("forWhomLabel", () => {
  it("dedups a repeated frequency across pets", () => {
    expect(forWhomLabel(["Nugget", "Biscuit"], [weekly, weekly])).toBe("Nugget, Biscuit · weekly");
  });

  it("formats a single pet", () => {
    expect(forWhomLabel(["Clover"], [twiceDaily])).toBe("Clover · 2× daily");
  });

  it("keeps two different frequencies, first-seen order", () => {
    expect(forWhomLabel(["Clover", "Nugget"], [twiceDaily, daily])).toBe(
      "Clover, Nugget · 2× daily, daily",
    );
  });

  it("empty input -> empty string, no dangling middle dot", () => {
    expect(forWhomLabel([], [])).toBe("");
  });
});

describe("stockLabel", () => {
  it("null -> Stock not set", () => {
    expect(stockLabel(null, "ml")).toBe("Stock not set");
  });

  it("54 tabs", () => {
    expect(stockLabel(54, "tab")).toBe("54 tabs");
  });

  it("3.3 ml", () => {
    expect(stockLabel(3.3, "ml")).toBe("3.3 ml");
  });

  it("zero is a real figure, not 'not set'", () => {
    expect(stockLabel(0, "ml")).toBe("0 ml");
  });
});

describe("runOutLabel", () => {
  it("formats a local Date as weekday day month", () => {
    expect(runOutLabel(new Date(2026, 7, 12))).toBe("Wed 12 Aug");
  });
});

describe("neededLabel", () => {
  it("singular pack", () => {
    expect(neededLabel(1, 15, "ml")).toBe("1 more pack");
  });

  it("plural packs", () => {
    expect(neededLabel(2, 30, "ml")).toBe("2 more packs");
  });

  it("falls back to doseLabel when packSize is null", () => {
    expect(neededLabel(null, 3, "ml")).toBe("3 ml");
  });
});

describe("weeksOfCoverLabel", () => {
  it("rounds to the nearest week", () => {
    expect(weeksOfCoverLabel(49)).toBe("~7 weeks of cover");
  });

  it("singular week", () => {
    expect(weeksOfCoverLabel(7)).toBe("~1 week of cover");
  });

  it("never reports ~0 weeks", () => {
    expect(weeksOfCoverLabel(2)).toBe("~1 week of cover");
  });
});
