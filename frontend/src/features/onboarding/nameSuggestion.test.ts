import { describe, expect, it } from "vitest";
import { suggestNameFromEmail } from "./nameSuggestion";

describe("suggestNameFromEmail", () => {
  it("title-cases the local part", () => {
    expect(suggestNameFromEmail("roman@example.com")).toBe("Roman");
  });

  it("cuts at the first +tag", () => {
    expect(suggestNameFromEmail("roman+home@example.com")).toBe("Roman");
    expect(suggestNameFromEmail("roman+home+again@example.com")).toBe("Roman");
  });

  it("replaces . _ and - with spaces and title-cases each word", () => {
    expect(suggestNameFromEmail("roman.k@example.com")).toBe("Roman K");
    expect(suggestNameFromEmail("clover_mum@example.com")).toBe("Clover Mum");
    expect(suggestNameFromEmail("clover-mum@example.com")).toBe("Clover Mum");
    expect(suggestNameFromEmail("ro.man_k-j@example.com")).toBe("Ro Man K J");
  });

  it("collapses runs of separators into a single space", () => {
    expect(suggestNameFromEmail("roman...k@example.com")).toBe("Roman K");
  });

  it("returns '' for null", () => {
    expect(suggestNameFromEmail(null)).toBe("");
  });

  it("returns '' for blank or whitespace-only input", () => {
    expect(suggestNameFromEmail("")).toBe("");
    expect(suggestNameFromEmail("   ")).toBe("");
  });

  it("returns '' for malformed input with no @", () => {
    expect(suggestNameFromEmail("not-an-email")).toBe("");
  });

  it("returns '' for an empty local part", () => {
    expect(suggestNameFromEmail("@example.com")).toBe("");
  });

  it("returns '' for an empty domain part", () => {
    expect(suggestNameFromEmail("roman@")).toBe("");
  });

  it("returns '' when the local part is only separators", () => {
    expect(suggestNameFromEmail("...@example.com")).toBe("");
  });

  it("trims to 24 characters", () => {
    const result = suggestNameFromEmail("alexanderfitzwilliammontgomery@example.com");
    expect(result.length).toBe(24);
    expect(result).toBe("Alexanderfitzwilliammont");
  });

  it("never returns a string containing @", () => {
    const inputs = [
      null,
      "",
      "roman@example.com",
      "roman+home@example.com",
      "not-an-email",
      "@example.com",
      "roman@",
      "a@b@c.com",
    ];
    for (const input of inputs) {
      expect(suggestNameFromEmail(input)).not.toContain("@");
    }
  });
});
