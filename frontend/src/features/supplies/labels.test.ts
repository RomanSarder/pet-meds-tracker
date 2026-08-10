import { describe, expect, it } from "vitest";
import type { Schedule } from "@/domain";
import { createTranslator } from "@/i18n";
import {
  forWhomLabel,
  frequencyLabel,
  neededLabel,
  runOutLabel,
  stockLabel,
  weeksOfCoverLabel,
} from "./labels";

const en = createTranslator("en");
const uk = createTranslator("uk");

const twiceDaily: Schedule = { kind: "fixedTimes", times: ["07:00", "19:00"] };
const daily: Schedule = { kind: "fixedTimes", times: ["07:00"] };
const weekly: Schedule = { kind: "fixedTimes", times: ["07:00"], daysOfWeek: [6] };
const everyTwoDays: Schedule = { kind: "fixedTimes", times: ["07:00"], everyNDays: 2 };
const everyEightHours: Schedule = { kind: "fromLastDose", intervalHours: 8 };
const everyTwentyFourHours: Schedule = { kind: "fromLastDose", intervalHours: 24 };
const everyFiveHours: Schedule = { kind: "fromLastDose", intervalHours: 5 };

describe("frequencyLabel", () => {
  it("fixedTimes, 2 times -> 2× daily", () => {
    expect(frequencyLabel(twiceDaily, en)).toBe("2× daily");
  });

  it("fixedTimes, 1 time -> daily (not 'once daily')", () => {
    expect(frequencyLabel(daily, en)).toBe("daily");
  });

  it("fixedTimes, single daysOfWeek entry -> weekly", () => {
    expect(frequencyLabel(weekly, en)).toBe("weekly");
  });

  it("fixedTimes, everyNDays -> every N days", () => {
    expect(frequencyLabel(everyTwoDays, en)).toBe("every 2 days");
  });

  it("fromLastDose, intervalHours: 8 -> 3× daily", () => {
    expect(frequencyLabel(everyEightHours, en)).toBe("3× daily");
  });

  it("fromLastDose, intervalHours: 24 -> daily", () => {
    expect(frequencyLabel(everyTwentyFourHours, en)).toBe("daily");
  });

  it("fromLastDose, non-integer doses per day -> every Nh", () => {
    expect(frequencyLabel(everyFiveHours, en)).toBe("every 5h");
  });
});

describe("forWhomLabel", () => {
  it("dedups a repeated frequency across pets", () => {
    expect(forWhomLabel(["Nugget", "Biscuit"], [weekly, weekly], en)).toBe(
      "Nugget, Biscuit · weekly",
    );
  });

  it("formats a single pet", () => {
    expect(forWhomLabel(["Clover"], [twiceDaily], en)).toBe("Clover · 2× daily");
  });

  it("keeps two different frequencies, first-seen order", () => {
    expect(forWhomLabel(["Clover", "Nugget"], [twiceDaily, daily], en)).toBe(
      "Clover, Nugget · 2× daily, daily",
    );
  });

  it("empty input -> empty string, no dangling middle dot", () => {
    expect(forWhomLabel([], [], en)).toBe("");
  });
});

describe("stockLabel", () => {
  it("null -> Stock not set", () => {
    expect(stockLabel(null, "ml", en)).toBe("Stock not set");
  });

  // SPEC pins this string exactly — asserted in both languages.
  it("null -> Запас не вказано (Ukrainian)", () => {
    expect(stockLabel(null, "ml", uk)).toBe("Запас не вказано");
  });

  it("54 tabs", () => {
    expect(stockLabel(54, "tab", en)).toBe("54 tabs");
  });

  it("3.3 ml", () => {
    expect(stockLabel(3.3, "ml", en)).toBe("3.3 ml");
  });

  it("zero is a real figure, not 'not set'", () => {
    expect(stockLabel(0, "ml", en)).toBe("0 ml");
  });

  // Dose/stock amounts never localize (SPEC §10a): the decimal separator
  // stays "." in Ukrainian too, and the unit is rendered exactly as entered.
  it("3.3 ml stays '.'-separated and untranslated in Ukrainian", () => {
    expect(stockLabel(3.3, "ml", uk)).toBe("3.3 ml");
  });
});

describe("runOutLabel", () => {
  it("formats a local Date as weekday day month", () => {
    expect(runOutLabel(new Date(2026, 7, 12), en)).toBe("Wed 12 Aug");
  });

  it("localizes the weekday/month names in Ukrainian", () => {
    expect(runOutLabel(new Date(2026, 7, 12), uk)).toBe("ср, 12 серп.");
  });
});

describe("neededLabel", () => {
  it("singular pack", () => {
    expect(neededLabel(1, 15, "ml", en)).toBe("1 more pack");
  });

  it("plural packs", () => {
    expect(neededLabel(2, 30, "ml", en)).toBe("2 more packs");
  });

  it("falls back to doseLabel when packSize is null", () => {
    expect(neededLabel(null, 3, "ml", en)).toBe("3 ml");
  });

  // Ukrainian one/few/many, pinned at n = 1, 2, 5, 21.
  it("Ukrainian plural forms: 1, 2, 5, 21", () => {
    expect(neededLabel(1, 15, "ml", uk)).toBe("ще 1 упаковка");
    expect(neededLabel(2, 30, "ml", uk)).toBe("ще 2 упаковки");
    expect(neededLabel(5, 75, "ml", uk)).toBe("ще 5 упаковок");
    expect(neededLabel(21, 315, "ml", uk)).toBe("ще 21 упаковка");
  });
});

describe("weeksOfCoverLabel", () => {
  it("rounds to the nearest week", () => {
    expect(weeksOfCoverLabel(49, en)).toBe("~7 weeks of cover");
  });

  it("singular week", () => {
    expect(weeksOfCoverLabel(7, en)).toBe("~1 week of cover");
  });

  it("never reports ~0 weeks", () => {
    expect(weeksOfCoverLabel(2, en)).toBe("~1 week of cover");
  });

  // Ukrainian one/few/many, pinned at n = 1, 2, 5, 21 weeks.
  it("Ukrainian plural forms: 1, 2, 5, 21 weeks", () => {
    expect(weeksOfCoverLabel(7, uk)).toBe("~1 тиждень запасу");
    expect(weeksOfCoverLabel(14, uk)).toBe("~2 тижні запасу");
    expect(weeksOfCoverLabel(35, uk)).toBe("~5 тижнів запасу");
    expect(weeksOfCoverLabel(21 * 7, uk)).toBe("~21 тиждень запасу");
  });
});
