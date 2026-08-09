import { describe, expect, it } from "vitest";
import type { SupplyItem } from "./model";
import type { MedicationProjection } from "./projection";
import { shoppingListText } from "./shoppingList";

const MED_ID = "z0000000-0000-4000-8000-000000000001";

function projection(overrides: Partial<MedicationProjection> = {}): MedicationProjection {
  return {
    medicationId: MED_ID,
    dailyUse: 1,
    remaining: 10,
    stockSet: true,
    horizonDays: 30,
    daysOfCover: 5,
    runOutDate: new Date("2026-08-13T07:00:00.000Z"),
    tone: "out",
    percent: 17,
    needed: 15,
    neededPacks: 1,
    runsOutInsideHorizon: true,
    needsStockPrompt: false,
    ...overrides,
  };
}

function supplyItem(overrides: Partial<SupplyItem> = {}): SupplyItem {
  return {
    medicationId: MED_ID,
    name: "Metacam",
    unit: "ml",
    forWhom: "Clover · 2× daily",
    stock: "1 bottle",
    tone: "out",
    percent: 22,
    note: "Runs out Thu 13 Aug · need 1 more pack",
    petNames: ["Clover"],
    projection: projection(),
    buyNow: true,
    ...overrides,
  };
}

describe("shoppingListText", () => {
  it("one line per item, with name, quantity needed and which pets, joined by ' · ', lines joined by '\\n'", () => {
    const items = [
      supplyItem({
        name: "Metacam",
        petNames: ["Clover", "Nugget"],
        projection: projection({ neededPacks: 1, needed: 15 }),
      }),
      supplyItem({
        name: "Baytril",
        petNames: ["Clover"],
        projection: projection({ neededPacks: 2, needed: 20 }),
      }),
    ];
    expect(shoppingListText(items)).toBe(
      "Metacam · 1 more pack · Clover, Nugget\nBaytril · 2 more packs · Clover",
    );
  });

  it("an item with no pets renders with no dangling middle dot", () => {
    const items = [
      supplyItem({ name: "Metacam", petNames: [], projection: projection({ neededPacks: 1, needed: 15 }) }),
    ];
    expect(shoppingListText(items)).toBe("Metacam · 1 more pack");
  });

  it("empty input -> ''", () => {
    expect(shoppingListText([])).toBe("");
  });

  it("an item whose medication has no packSize renders its quantity with the unit", () => {
    const items = [
      supplyItem({
        name: "Metacam",
        unit: "ml",
        petNames: ["Clover"],
        projection: projection({ neededPacks: null, needed: 3 }),
      }),
    ];
    expect(shoppingListText(items)).toBe("Metacam · 3 ml · Clover");
  });
});
