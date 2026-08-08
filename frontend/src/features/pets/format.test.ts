import { describe, expect, it } from "vitest";
import { addLocalDays, atLocalTime } from "@/domain";
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

describe("speciesLabel", () => {
  it("cases every species the kit's own way", () => {
    expect(speciesLabel("guinea_pig")).toBe("Guinea pig");
    expect(speciesLabel("rabbit")).toBe("Rabbit");
  });
});

describe("weightLabel", () => {
  it("formats grams as kg to one decimal", () => {
    expect(weightLabel(1900)).toBe("1.9 kg");
    expect(weightLabel(1000)).toBe("1.0 kg");
  });

  it("passes through null", () => {
    expect(weightLabel(null)).toBeNull();
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
    expect(doseLabel(2, "drop")).toBe("2 drops");
    expect(doseLabel(1, "tab")).toBe("1 tab");
    expect(doseLabel(54, "tab")).toBe("54 tabs");
  });

  it("never pluralises measures", () => {
    expect(doseLabel(0.4, "ml")).toBe("0.4 ml");
    expect(doseLabel(50, "mg")).toBe("50 mg");
  });
});

describe("courseLabel", () => {
  it("joins the medication name and dose label", () => {
    expect(courseLabel("Metacam", 0.4, "ml")).toBe("Metacam 0.4 ml");
  });
});

describe("eventWhenLabel", () => {
  it("labels an instant today as 'today HH:MM'", () => {
    const at = atLocalTime(TODAY, "07:10");
    expect(eventWhenLabel(at, TODAY)).toBe("today 07:10");
  });

  it("labels an instant on the previous day as 'yesterday HH:MM'", () => {
    const at = atLocalTime(addLocalDays(TODAY, -1), "20:04");
    expect(eventWhenLabel(at, TODAY)).toBe("yesterday 20:04");
  });

  it("labels an instant five days earlier as 'D Mon HH:MM'", () => {
    const at = atLocalTime(addLocalDays(TODAY, -5), "07:05");
    expect(eventWhenLabel(at, TODAY)).toBe("3 Aug 07:05");
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
