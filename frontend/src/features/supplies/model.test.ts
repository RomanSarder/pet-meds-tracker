import { describe, expect, it } from "vitest";
import type { Course, DoseEvent, Medication, Pet, StockAdjustment } from "@/domain";
import { FIXTURE_NOW, fixtures } from "@/domain";
import { weeksOfCoverLabel } from "./labels";
import { buildSupplyItems, sortSupplyItems } from "./model";

const NOW = new Date(FIXTURE_NOW); // 2026-08-08T07:00:00.000Z

const MED_ID = "z0000000-0000-4000-8000-000000000001";
const PET_ID = "p0000000-0000-4000-8000-000000000001";
const IVERMECTIN_ID = "b0000000-0000-4000-8000-000000000004";

function medication(overrides: Partial<Medication> = {}): Medication {
  return {
    id: MED_ID,
    name: "Test Med",
    strength: null,
    form: "liquid",
    unit: "ml",
    packSize: 15,
    stockUnits: 10,
    lowThreshold: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function course(overrides: Partial<Course> = {}): Course {
  return {
    id: "y0000000-0000-4000-8000-000000000001",
    petId: PET_ID,
    medicationId: MED_ID,
    doseAmount: 1,
    doseUnit: "ml",
    instructions: null,
    schedule: { kind: "fromLastDose", intervalHours: 24 },
    startDate: "2026-01-01",
    endDate: null,
    status: "active",
    notes: null,
    resumedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function pet(overrides: Partial<Pet> = {}): Pet {
  return {
    id: PET_ID,
    name: "Test Pet",
    species: "rabbit",
    birthdate: null,
    weightGrams: null,
    tint: 1,
    archived: false,
    householdId: "household-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function adjustment(overrides: Partial<StockAdjustment> = {}): StockAdjustment {
  return {
    id: "x0000000-0000-4000-8000-000000000001",
    medicationId: MED_ID,
    deltaUnits: 10,
    reason: "purchase",
    note: null,
    actorId: "actor",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function deepFreeze<T>(obj: T): T {
  if (obj !== null && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.values(obj as Record<string, unknown>).forEach((v) => deepFreeze(v));
    Object.freeze(obj);
  }
  return obj;
}

describe("SPEC §12: two pets sharing one medication", () => {
  it("forWhom is 'Nugget, Biscuit · weekly' and dailyUse sums both courses (4/7)", () => {
    const items = buildSupplyItems({
      medications: fixtures.medications,
      courses: fixtures.courses,
      pets: fixtures.pets,
      adjustments: fixtures.stockAdjustments,
      now: NOW,
    });
    const ivermectin = items.find((i) => i.medicationId === IVERMECTIN_ID);
    expect(ivermectin).toBeDefined();
    expect(ivermectin!.forWhom).toBe("Nugget, Biscuit · weekly");
    expect(ivermectin!.projection.dailyUse).toBeCloseTo(4 / 7, 12);
  });
});

describe("SPEC §12: a medication with only weekly courses reports weeks, not days, of cover", () => {
  it("note is a weeks-of-cover string with no mention of days", () => {
    const items = buildSupplyItems({
      medications: [medication({ id: "m-weekly", name: "WeeklyMed", stockUnits: 100, packSize: 10 })],
      courses: [
        course({
          id: "c-weekly",
          medicationId: "m-weekly",
          doseAmount: 1,
          schedule: { kind: "fixedTimes", times: ["07:00"], daysOfWeek: [6] },
        }),
      ],
      pets: [pet()],
      adjustments: [],
      now: NOW,
    });
    const item = items.find((i) => i.medicationId === "m-weekly")!;
    // stockUnits 100 against dailyUse 1/7 -> daysOfCover 700, well outside
    // the 30-day horizon, so this sits in the Stocked group.
    expect(item.buyNow).toBe(false);
    expect(item.note).toMatch(/~\d+ weeks? of cover/);
    expect(item.note).not.toContain(" days");
    expect(item.note).not.toContain(" day ");
  });
});

describe("SPEC §12: logging doses leaves stock unchanged", () => {
  it("buildSupplyItems takes no dose events; adding many `given` events to the input changes nothing", () => {
    const meds = [medication({ stockUnits: 20 })];
    const cs = [course()];
    const pts = [pet()];
    const adj = [adjustment()];

    const before = buildSupplyItems({ medications: meds, courses: cs, pets: pts, adjustments: adj, now: NOW });
    const beforeItem = before.find((i) => i.medicationId === MED_ID)!;

    // Structural guarantee: buildSupplyItems's input type has no `doseEvents`
    // field at all. Simulate "adding many given DoseEvents to the input
    // data" by attaching an unrelated doseEvents array onto the same input
    // shape — the function must not read it, so results are byte-identical.
    const manyGivenDoseEvents: DoseEvent[] = Array.from({ length: 50 }, (_, i) => ({
      id: `dose-${i}`,
      courseId: cs[0].id,
      scheduledFor: null,
      status: "given",
      loggedAt: NOW.toISOString(),
      givenAt: NOW.toISOString(),
      amount: 1,
      note: null,
      occurrenceKey: `dose-${i}`,
      supersedesId: null,
      actorId: "actor",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      deletedAt: null,
    }));
    const inputWithEvents = {
      medications: meds,
      courses: cs,
      pets: pts,
      adjustments: adj,
      now: NOW,
      doseEvents: manyGivenDoseEvents,
    };
    const after = buildSupplyItems(
      inputWithEvents as unknown as Parameters<typeof buildSupplyItems>[0],
    );
    const afterItem = after.find((i) => i.medicationId === MED_ID)!;

    expect(afterItem.stock).toBe(beforeItem.stock);
    expect(afterItem.projection.remaining).toBe(beforeItem.projection.remaining);
    expect(afterItem.projection.daysOfCover).toBe(beforeItem.projection.daysOfCover);
  });
});

describe("stockUnits === null", () => {
  it("stock is 'Stock not set', percent is undefined, buyNow is false", () => {
    const items = buildSupplyItems({
      medications: [medication({ stockUnits: null })],
      courses: [course()],
      pets: [pet()],
      adjustments: [],
      now: NOW,
    });
    const item = items[0];
    expect(item.stock).toBe("Stock not set");
    expect(item.percent).toBeUndefined();
    expect(item.buyNow).toBe(false);
  });
});

describe("note precedence", () => {
  it("(a) needsStockPrompt note starts with the stock-prompt sentence and still contains the quantity needed", () => {
    const items = buildSupplyItems({
      medications: [medication({ name: "Metacam", stockUnits: 0, packSize: 15 })],
      courses: [course()], // dailyUse 1 -> daysOfCover 0 -> needsStockPrompt
      pets: [pet()],
      adjustments: [],
      now: NOW,
    });
    const note = items[0].note!;
    expect(note.startsWith("Still have Metacam? Update stock.")).toBe(true);
    expect(note).toContain("need 2 more packs"); // deficit 30, packSize 15 -> 2 packs
  });

  it("(b) a buy-now item's note matches the kit's run-out format", () => {
    const items = buildSupplyItems({
      medications: [medication({ stockUnits: 5, packSize: 15 })], // daysOfCover 5, buyNow
      courses: [course()],
      pets: [pet()],
      adjustments: [],
      now: NOW,
    });
    expect(items[0].note).toMatch(/^Runs out \w{3} \d{1,2} \w{3} · need /);
  });

  it("(c) a stocked item's note is the weeks-of-cover string", () => {
    const items = buildSupplyItems({
      medications: [medication({ stockUnits: 1000, packSize: 15 })], // daysOfCover 1000
      courses: [course()],
      pets: [pet()],
      adjustments: [],
      now: NOW,
    });
    expect(items[0].note).toBe(weeksOfCoverLabel(1000));
  });

  it("(d) an item with dailyUse === 0 has note undefined", () => {
    const items = buildSupplyItems({
      medications: [medication({ stockUnits: 10 })],
      courses: [], // no active courses -> dailyUse 0
      pets: [pet()],
      adjustments: [],
      now: NOW,
    });
    expect(items[0].note).toBeUndefined();
  });
});

describe("needed rounds up to whole packs", () => {
  it("a sub-pack deficit renders 'need 1 more pack'", () => {
    const items = buildSupplyItems({
      medications: [medication({ stockUnits: 29.9, packSize: 15 })], // deficit 0.1 -> 1 pack
      courses: [course()], // dailyUse 1, horizon 30
      pets: [pet()],
      adjustments: [],
      now: NOW,
    });
    expect(items[0].note).toContain("need 1 more pack");
  });
});

describe("sortSupplyItems", () => {
  it("'By urgency' orders ascending daysOfCover, pushes stock-not-set/infinite-cover last, ties by name, and never changes group membership", () => {
    const items = buildSupplyItems({
      medications: [
        medication({ id: "m-a", name: "A", stockUnits: 5, packSize: 15 }), // daysOfCover 5
        medication({ id: "m-b", name: "B", stockUnits: 2, packSize: 15 }), // daysOfCover 2
        medication({ id: "m-c", name: "C", stockUnits: null, packSize: 15 }), // stock not set
        medication({ id: "m-d", name: "D", stockUnits: 100, packSize: 15 }), // no course -> infinite cover
      ],
      courses: [
        course({ id: "c-a", medicationId: "m-a" }),
        course({ id: "c-b", medicationId: "m-b" }),
        course({ id: "c-c", medicationId: "m-c" }),
      ],
      pets: [pet()],
      adjustments: [],
      now: NOW,
    });

    const buyNowBefore = new Map(items.map((i) => [i.medicationId, i.buyNow]));
    const sorted = sortSupplyItems(items, "By urgency");

    expect(sorted.map((i) => i.medicationId)).toEqual(["m-b", "m-a", "m-c", "m-d"]);
    for (const item of sorted) {
      expect(item.buyNow).toBe(buyNowBefore.get(item.medicationId));
    }
  });

  it("'By pet' orders by first pet name A→Z, ties by medication name, and never changes group membership", () => {
    const items = buildSupplyItems({
      medications: [
        medication({ id: "m-1", name: "Zeta", stockUnits: 5, packSize: 15 }),
        medication({ id: "m-2", name: "Alpha", stockUnits: 5, packSize: 15 }),
      ],
      courses: [
        course({ id: "c-1", medicationId: "m-1", petId: "pet-b" }),
        course({ id: "c-2", medicationId: "m-2", petId: "pet-a" }),
      ],
      pets: [pet({ id: "pet-b", name: "Biscuit" }), pet({ id: "pet-a", name: "Alpha-Pet" })],
      adjustments: [],
      now: NOW,
    });

    const buyNowBefore = new Map(items.map((i) => [i.medicationId, i.buyNow]));
    const sorted = sortSupplyItems(items, "By pet");

    expect(sorted.map((i) => i.petNames[0])).toEqual(["Alpha-Pet", "Biscuit"]);
    for (const item of sorted) {
      expect(item.buyNow).toBe(buyNowBefore.get(item.medicationId));
    }
  });
});

describe("immutability", () => {
  it("buildSupplyItems does not mutate its inputs", () => {
    const meds = deepFreeze([medication()]);
    const cs = deepFreeze([course()]);
    const pts = deepFreeze([pet()]);
    const adj = deepFreeze([adjustment()]);
    expect(() =>
      buildSupplyItems({ medications: meds, courses: cs, pets: pts, adjustments: adj, now: NOW }),
    ).not.toThrow();
  });
});
