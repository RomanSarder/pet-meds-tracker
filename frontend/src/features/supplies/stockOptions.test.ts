import { describe, expect, it } from "vitest";
import type { Medication } from "@/domain";
import { allowsCoarseFigure, coarseUnits, COARSE_FRACTIONS, COARSE_LEVELS } from "./stockOptions";

function medication(overrides: Partial<Medication>): Medication {
  return {
    id: "med-1",
    name: "Metacam",
    strength: null,
    form: "liquid",
    unit: "ml",
    packSize: null,
    stockUnits: null,
    lowThreshold: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("COARSE_FRACTIONS", () => {
  it("maps each level to its fraction", () => {
    expect(COARSE_FRACTIONS.full).toBe(1);
    expect(COARSE_FRACTIONS["about half"]).toBe(0.5);
    expect(COARSE_FRACTIONS["nearly out"]).toBe(0.1);
    expect(COARSE_FRACTIONS.empty).toBe(0);
  });
});

describe("COARSE_LEVELS", () => {
  it("is the exact display order", () => {
    expect(COARSE_LEVELS).toEqual(["full", "about half", "nearly out", "empty"]);
  });
});

describe("coarseUnits", () => {
  it("stores the coarse figure as a fraction of packSize", () => {
    expect(coarseUnits(15, "about half")).toBe(7.5);
    expect(coarseUnits(10, "empty")).toBe(0);
  });
});

describe("allowsCoarseFigure", () => {
  it("is true for liquid medications", () => {
    expect(allowsCoarseFigure(medication({ form: "liquid" }))).toBe(true);
  });

  it("is false for tablet medications", () => {
    expect(allowsCoarseFigure(medication({ form: "tablet" }))).toBe(false);
  });
});
