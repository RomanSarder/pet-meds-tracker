import { describe, expect, it } from "vitest";
import { buildTitle, formatAmount } from "./copy";

describe("buildTitle", () => {
  it("produces the exact SPEC §7 fixture for a due dose", () => {
    const title = buildTitle({
      petName: "Clover",
      medicationName: "Metacam",
      amount: 0.4,
      unit: "ml",
      state: "due",
    });
    // Whole-string assertion, not a substring — the spacing and the
    // U+00B7 MIDDLE DOT are both load-bearing.
    expect(title).toBe("Clover · Metacam 0.4 ml due now");
  });

  it("produces the overdue variant", () => {
    const title = buildTitle({
      petName: "Clover",
      medicationName: "Metacam",
      amount: 0.4,
      unit: "ml",
      state: "overdue",
    });
    expect(title).toBe("Clover · Metacam 0.4 ml overdue");
  });

  it("has no body, no emoji, no exclamation — the title is the whole message", () => {
    const title = buildTitle({
      petName: "Clover",
      medicationName: "Metacam",
      amount: 0.4,
      unit: "ml",
      state: "due",
    });
    expect(title).not.toMatch(/[!]/);
    // A crude but effective emoji sweep: no character outside the BMP.
    expect([...title].every((ch) => ch.codePointAt(0)! <= 0xffff)).toBe(true);
  });
});

describe("formatAmount", () => {
  it.each([
    [0.4, "0.4"],
    [1, "1"],
    [0.5, "0.5"],
    [12.5, "12.5"],
  ])("formatAmount(%s) === %s", (input, expected) => {
    expect(formatAmount(input)).toBe(expected);
  });
});
