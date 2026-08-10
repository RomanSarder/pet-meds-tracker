import { describe, expect, it } from "vitest";
import { createTranslator } from "@/i18n";
import { ageLabel } from "./age";

const enTr = createTranslator("en");
const ukTr = createTranslator("uk");

describe("ageLabel", () => {
  it("returns null when there is no birthdate", () => {
    expect(ageLabel(null, "2026-08-08", enTr)).toBeNull();
  });

  it("returns '0 days' for a future birthdate, never negative", () => {
    expect(ageLabel("2026-08-09", "2026-08-08", enTr)).toBe("0 days");
  });

  describe("the four bands", () => {
    it("years", () => {
      expect(ageLabel("2020-06-01", "2026-08-08", enTr)).toBe("6 yrs");
    });

    it("months", () => {
      expect(ageLabel("2026-03-01", "2026-08-08", enTr)).toBe("5 mths");
    });

    it("weeks", () => {
      expect(ageLabel("2026-07-20", "2026-08-08", enTr)).toBe("2 wks");
    });

    it("days", () => {
      expect(ageLabel("2026-08-05", "2026-08-08", enTr)).toBe("3 days");
    });
  });

  describe("singular forms", () => {
    it("1 yr", () => {
      expect(ageLabel("2025-08-08", "2026-08-08", enTr)).toBe("1 yr");
    });

    it("1 mth", () => {
      expect(ageLabel("2026-07-08", "2026-08-08", enTr)).toBe("1 mth");
    });

    it("1 wk", () => {
      expect(ageLabel("2026-08-01", "2026-08-08", enTr)).toBe("1 wk");
    });

    it("1 day", () => {
      expect(ageLabel("2026-08-07", "2026-08-08", enTr)).toBe("1 day");
    });
  });

  describe("year boundary", () => {
    it("the day before the birthday is still the lower count", () => {
      expect(ageLabel("2023-05-15", "2026-05-14", enTr)).toBe("2 yrs");
    });

    it("the day of the birthday rolls over", () => {
      expect(ageLabel("2023-05-15", "2026-05-15", enTr)).toBe("3 yrs");
    });
  });

  describe("month boundary", () => {
    it("the day before the month anniversary is still weeks", () => {
      expect(ageLabel("2026-01-15", "2026-02-14", enTr)).toBe("4 wks");
    });

    it("the day of the month anniversary rolls over to months", () => {
      expect(ageLabel("2026-01-15", "2026-02-15", enTr)).toBe("1 mth");
    });
  });

  describe("29 Feb birthdate in a non-leap year", () => {
    it("has not yet had its anniversary the day before 1 Mar", () => {
      expect(ageLabel("2020-02-29", "2026-02-28", enTr)).toBe("5 yrs");
    });

    it("rolls over once the calendar reaches 1 Mar", () => {
      expect(ageLabel("2020-02-29", "2026-03-01", enTr)).toBe("6 yrs");
    });
  });

  describe("Ukrainian", () => {
    // Real Ukrainian noun declension, not English morphology: 1 -> one,
    // 2 -> few, 5 -> many, 21 -> one (SPEC §10a / I18N-DESIGN.md §4).
    it("years: 1, 2, 5, 21", () => {
      expect(ageLabel("2025-08-08", "2026-08-08", ukTr)).toBe("1 рік");
      expect(ageLabel("2024-08-08", "2026-08-08", ukTr)).toBe("2 роки");
      expect(ageLabel("2021-08-08", "2026-08-08", ukTr)).toBe("5 років");
      expect(ageLabel("2005-08-08", "2026-08-08", ukTr)).toBe("21 рік");
    });

    it("months: 1, 2, 5", () => {
      expect(ageLabel("2026-07-08", "2026-08-08", ukTr)).toBe("1 місяць");
      expect(ageLabel("2026-06-08", "2026-08-08", ukTr)).toBe("2 місяці");
      expect(ageLabel("2026-03-08", "2026-08-08", ukTr)).toBe("5 місяців");
    });

    it("weeks: 1, 2", () => {
      expect(ageLabel("2026-08-01", "2026-08-08", ukTr)).toBe("1 тиждень");
      expect(ageLabel("2026-07-25", "2026-08-08", ukTr)).toBe("2 тижні");
    });

    it("days: 0 (future birthdate), 1, 3", () => {
      expect(ageLabel("2026-08-09", "2026-08-08", ukTr)).toBe("0 днів");
      expect(ageLabel("2026-08-07", "2026-08-08", ukTr)).toBe("1 день");
      expect(ageLabel("2026-08-05", "2026-08-08", ukTr)).toBe("3 дні");
    });
  });
});
