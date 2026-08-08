import { describe, it, expect } from "vitest";

describe("test harness", () => {
  it("loads fake-indexeddb", () => {
    expect(indexedDB).toBeDefined();
  });

  it("stubs matchMedia so prefers-reduced-motion reads false", () => {
    expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(false);
  });

  it("registers jest-dom matchers", () => {
    expect(document.body).toBeInTheDocument();
  });

  it("runs in the Europe/London timezone", () => {
    // BST = UTC+1
    expect(new Date("2026-07-01T12:00:00Z").getHours()).toBe(13);
    // GMT = UTC+0
    expect(new Date("2026-01-01T12:00:00Z").getHours()).toBe(12);
  });
});
