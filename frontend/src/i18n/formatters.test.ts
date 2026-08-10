import { describe, expect, it } from "vitest";
import { createFormatters } from "./formatters";

// A real Wednesday — verified via `new Date(2026, 7, 12).toDateString()` ===
// "Wed Aug 12 2026" before hardcoding.
const AUG_12_2026 = new Date(2026, 7, 12);

describe("plural forms", () => {
  it("Ukrainian: 1 доза (one), 2 дози (few), 5 доз (many), 21 доза (one)", () => {
    const f = createFormatters("uk");
    const forms = { one: "доза", few: "дози", many: "доз", other: "дози" };
    expect(`${1} ${f.plural(1, forms)}`).toBe("1 доза");
    expect(`${2} ${f.plural(2, forms)}`).toBe("2 дози");
    expect(`${5} ${f.plural(5, forms)}`).toBe("5 доз");
    expect(`${21} ${f.plural(21, forms)}`).toBe("21 доза");
  });

  it("English: 1 -> one, 2 -> other", () => {
    const f = createFormatters("en");
    const forms = { one: "dose", other: "doses" };
    expect(`${1} ${f.plural(1, forms)}`).toBe("1 dose");
    expect(`${2} ${f.plural(2, forms)}`).toBe("2 doses");
  });

  it("falls back to `other` when the selected form has no entry", () => {
    const f = createFormatters("uk");
    // No `few` entry supplied for a count (2) that selects `few`.
    expect(f.plural(2, { other: "fallback" })).toBe("fallback");
  });
});

describe("English date formatters", () => {
  it("weekdayDayMonth is byte-exact 'Wed 12 Aug'", () => {
    const f = createFormatters("en");
    expect(f.weekdayDayMonth(AUG_12_2026)).toBe("Wed 12 Aug");
  });

  it("dayMonth is byte-exact '12 Aug'", () => {
    const f = createFormatters("en");
    expect(f.dayMonth(AUG_12_2026)).toBe("12 Aug");
  });

  it("isoWeekdayShort(1..7) is Mon Tue Wed Thu Fri Sat Sun", () => {
    const f = createFormatters("en");
    const names = [1, 2, 3, 4, 5, 6, 7].map((n) => f.isoWeekdayShort(n));
    expect(names).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });
});

describe("Ukrainian date formatters are genuinely localized", () => {
  const CYRILLIC = /[а-яіїєґ]/i;

  it("weekdayDayMonth renders Cyrillic and differs from the English rendering", () => {
    const en = createFormatters("en");
    const uk = createFormatters("uk");
    const ukValue = uk.weekdayDayMonth(AUG_12_2026);
    expect(ukValue).toMatch(CYRILLIC);
    expect(ukValue).not.toBe(en.weekdayDayMonth(AUG_12_2026));
  });

  it("dayMonth renders Cyrillic and differs from the English rendering", () => {
    const en = createFormatters("en");
    const uk = createFormatters("uk");
    const ukValue = uk.dayMonth(AUG_12_2026);
    expect(ukValue).toMatch(CYRILLIC);
    expect(ukValue).not.toBe(en.dayMonth(AUG_12_2026));
  });

  it("isoWeekdayShort renders Cyrillic and differs from the English rendering", () => {
    const en = createFormatters("en");
    const uk = createFormatters("uk");
    const ukMonday = uk.isoWeekdayShort(1);
    expect(ukMonday).toMatch(CYRILLIC);
    expect(ukMonday).not.toBe(en.isoWeekdayShort(1));
  });
});
