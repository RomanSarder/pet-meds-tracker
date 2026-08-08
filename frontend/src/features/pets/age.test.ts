import { describe, expect, it } from "vitest";
import { ageLabel } from "./age";

describe("ageLabel", () => {
  it("returns null when there is no birthdate", () => {
    expect(ageLabel(null, "2026-08-08")).toBeNull();
  });

  it("returns '0 days' for a future birthdate, never negative", () => {
    expect(ageLabel("2026-08-09", "2026-08-08")).toBe("0 days");
  });

  describe("the four bands", () => {
    it("years", () => {
      expect(ageLabel("2020-06-01", "2026-08-08")).toBe("6 yrs");
    });

    it("months", () => {
      expect(ageLabel("2026-03-01", "2026-08-08")).toBe("5 mths");
    });

    it("weeks", () => {
      expect(ageLabel("2026-07-20", "2026-08-08")).toBe("2 wks");
    });

    it("days", () => {
      expect(ageLabel("2026-08-05", "2026-08-08")).toBe("3 days");
    });
  });

  describe("singular forms", () => {
    it("1 yr", () => {
      expect(ageLabel("2025-08-08", "2026-08-08")).toBe("1 yr");
    });

    it("1 mth", () => {
      expect(ageLabel("2026-07-08", "2026-08-08")).toBe("1 mth");
    });

    it("1 wk", () => {
      expect(ageLabel("2026-08-01", "2026-08-08")).toBe("1 wk");
    });

    it("1 day", () => {
      expect(ageLabel("2026-08-07", "2026-08-08")).toBe("1 day");
    });
  });

  describe("year boundary", () => {
    it("the day before the birthday is still the lower count", () => {
      expect(ageLabel("2023-05-15", "2026-05-14")).toBe("2 yrs");
    });

    it("the day of the birthday rolls over", () => {
      expect(ageLabel("2023-05-15", "2026-05-15")).toBe("3 yrs");
    });
  });

  describe("month boundary", () => {
    it("the day before the month anniversary is still weeks", () => {
      expect(ageLabel("2026-01-15", "2026-02-14")).toBe("4 wks");
    });

    it("the day of the month anniversary rolls over to months", () => {
      expect(ageLabel("2026-01-15", "2026-02-15")).toBe("1 mth");
    });
  });

  describe("29 Feb birthdate in a non-leap year", () => {
    it("has not yet had its anniversary the day before 1 Mar", () => {
      expect(ageLabel("2020-02-29", "2026-02-28")).toBe("5 yrs");
    });

    it("rolls over once the calendar reaches 1 Mar", () => {
      expect(ageLabel("2020-02-29", "2026-03-01")).toBe("6 yrs");
    });
  });
});
