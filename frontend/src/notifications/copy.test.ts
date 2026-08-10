import { beforeEach, describe, expect, it } from "vitest";
import { setCurrentLocale } from "@/i18n/current";
import { buildTitle } from "./copy";

// `buildTitle` now reads `currentTranslator()` (I18N-DESIGN.md §2.5) instead
// of a module-level English translator, and nothing here renders through
// `renderWithProviders` to pin a locale — pin it explicitly so the existing
// assertions keep meaning English.
beforeEach(() => {
  setCurrentLocale("en");
});

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

  it("pluralises a countable unit via the reused doseLabel formatter", () => {
    const title = buildTitle({
      petName: "Nugget",
      medicationName: "Ivermectin",
      amount: 2,
      unit: "drop",
      state: "due",
    });
    expect(title).toBe("Nugget · Ivermectin 2 drops due now");
  });

  it("Ukrainian: state word localizes, dose amount and unit never do (SPEC §7 / §10a)", () => {
    setCurrentLocale("uk");
    const due = buildTitle({
      petName: "Clover",
      medicationName: "Metacam",
      amount: 0.4,
      unit: "ml",
      state: "due",
    });
    // The decimal separator is never localized — "0.4", never "0,4" — and
    // the unit ("ml") is user-entered data, never translated.
    expect(due).toBe("Clover · Metacam 0.4 ml час приймати");

    const overdue = buildTitle({
      petName: "Clover",
      medicationName: "Metacam",
      amount: 0.4,
      unit: "ml",
      state: "overdue",
    });
    expect(overdue).toBe("Clover · Metacam 0.4 ml прострочено");
  });
});
