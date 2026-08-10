import { describe, expect, it } from "vitest";
import { addLocalDays, atLocalTime } from "@/domain";
import { createTranslator } from "@/i18n";
import {
  amountLabel,
  courseLabel,
  doseLabel,
  eventWhenLabel,
  joinMeta,
  speciesLabel,
  weightLabel,
} from "./format";

const TODAY = "2026-08-08";

const en = createTranslator("en");
const uk = createTranslator("uk");

describe("speciesLabel", () => {
  it("cases every species the kit's own way", () => {
    expect(speciesLabel("guinea_pig", en)).toBe("Guinea pig");
    expect(speciesLabel("rabbit", en)).toBe("Rabbit");
  });

  it("cases every species in Ukrainian", () => {
    expect(speciesLabel("guinea_pig", uk)).toBe("Морська свинка");
    expect(speciesLabel("rabbit", uk)).toBe("Кріль");
  });
});

describe("weightLabel", () => {
  it("formats grams as kg to one decimal", () => {
    expect(weightLabel(1900, en)).toBe("1.9 kg");
    expect(weightLabel(1000, en)).toBe("1.0 kg");
  });

  it("passes through null", () => {
    expect(weightLabel(null, en)).toBeNull();
  });

  it("keeps the '.' decimal separator and untranslated 'kg' in Ukrainian", () => {
    expect(weightLabel(1900, uk)).toBe("1.9 kg");
    expect(weightLabel(1000, uk)).toBe("1.0 kg");
  });
});

describe("amountLabel", () => {
  it("drops trailing zeros", () => {
    expect(amountLabel(0.4)).toBe("0.4");
    expect(amountLabel(50)).toBe("50");
    expect(amountLabel(2)).toBe("2");
  });
});

describe("doseLabel", () => {
  it("pluralises countable units", () => {
    expect(doseLabel(2, "drop", en)).toBe("2 drops");
    expect(doseLabel(1, "tab", en)).toBe("1 tab");
    expect(doseLabel(54, "tab", en)).toBe("54 tabs");
  });

  it("never pluralises measures", () => {
    expect(doseLabel(0.4, "ml", en)).toBe("0.4 ml");
    expect(doseLabel(50, "mg", en)).toBe("50 mg");
  });

  it("renders countable units verbatim in Ukrainian, with no English suffix", () => {
    expect(doseLabel(2, "drop", uk)).toBe("2 drop");
    expect(doseLabel(1, "tab", uk)).toBe("1 tab");
    expect(doseLabel(54, "tab", uk)).toBe("54 tab");
  });

  it("never pluralises measures in Ukrainian either", () => {
    expect(doseLabel(0.4, "ml", uk)).toBe("0.4 ml");
    expect(doseLabel(50, "mg", uk)).toBe("50 mg");
  });
});

describe("courseLabel", () => {
  it("joins the medication name and dose label", () => {
    expect(courseLabel("Metacam", 0.4, "ml", en)).toBe("Metacam 0.4 ml");
  });

  it("keeps the medication name as DATA while localizing the dose in Ukrainian", () => {
    expect(courseLabel("Metacam", 2, "drop", uk)).toBe("Metacam 2 drop");
  });
});

describe("eventWhenLabel", () => {
  it("labels an instant today as 'today HH:MM'", () => {
    const at = atLocalTime(TODAY, "07:10");
    expect(eventWhenLabel(at, TODAY, en)).toBe("today 07:10");
  });

  it("labels an instant on the previous day as 'yesterday HH:MM'", () => {
    const at = atLocalTime(addLocalDays(TODAY, -1), "20:04");
    expect(eventWhenLabel(at, TODAY, en)).toBe("yesterday 20:04");
  });

  it("labels an instant five days earlier as 'D Mon HH:MM'", () => {
    const at = atLocalTime(addLocalDays(TODAY, -5), "07:05");
    expect(eventWhenLabel(at, TODAY, en)).toBe("3 Aug 07:05");
  });

  it("labels an instant today as 'сьогодні HH:MM' in Ukrainian", () => {
    const at = atLocalTime(TODAY, "07:10");
    expect(eventWhenLabel(at, TODAY, uk)).toBe("сьогодні 07:10");
  });

  it("labels an instant on the previous day as 'учора HH:MM' in Ukrainian", () => {
    const at = atLocalTime(addLocalDays(TODAY, -1), "20:04");
    expect(eventWhenLabel(at, TODAY, uk)).toBe("учора 20:04");
  });

  it("labels an instant five days earlier with the Ukrainian locale date", () => {
    const at = atLocalTime(addLocalDays(TODAY, -5), "07:05");
    expect(eventWhenLabel(at, TODAY, uk)).toBe("3 серп. 07:05");
  });
});

describe("joinMeta", () => {
  it("joins every clause when all are present", () => {
    expect(joinMeta(["Rabbit", "2 yrs", "1.9 kg"])).toBe("Rabbit · 2 yrs · 1.9 kg");
  });

  it("drops a null middle clause without doubling the dot", () => {
    expect(joinMeta(["Rabbit", null, "1.9 kg"])).toBe("Rabbit · 1.9 kg");
  });

  it("drops a null last clause without a trailing dot", () => {
    expect(joinMeta(["Rabbit", "2 yrs", null])).toBe("Rabbit · 2 yrs");
  });

  it("renders a single clause with no dots at all", () => {
    expect(joinMeta(["Rabbit", null, null])).toBe("Rabbit");
  });
});
