import { describe, expect, it } from "vitest";
import type { Course, Medication, StockAdjustment } from "@/domain";
import { FIXTURE_NOW, fixtures } from "@/domain";
import {
  HORIZON_DAYS,
  TONE_LOW_DAYS,
  TONE_OUT_DAYS,
  dailyUseFor,
  dosesPerDay,
  projectMedication,
} from "./projection";

const NOW = new Date(FIXTURE_NOW); // 2026-08-08T07:00:00.000Z

const MED_ID = "z0000000-0000-4000-8000-000000000001";
const PET_ID = "p0000000-0000-4000-8000-000000000001";

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

describe("dosesPerDay", () => {
  it("fromLastDose: 24 / intervalHours", () => {
    expect(dosesPerDay({ kind: "fromLastDose", intervalHours: 8 })).toBe(3);
  });

  it("fixedTimes: one entry per listed time", () => {
    expect(dosesPerDay({ kind: "fixedTimes", times: ["08:00", "20:00"] })).toBe(2);
  });

  it("fixedTimes with daysOfWeek: weekly averages to 1/7 per day", () => {
    expect(
      dosesPerDay({ kind: "fixedTimes", times: ["07:00"], daysOfWeek: [6] }),
    ).toBeCloseTo(1 / 7, 12);
  });

  it("fixedTimes with everyNDays: halves the rate", () => {
    expect(
      dosesPerDay({ kind: "fixedTimes", times: ["09:00"], everyNDays: 2 }),
    ).toBe(0.5);
  });

  it("guards intervalHours <= 0 and empty times to 0", () => {
    expect(dosesPerDay({ kind: "fromLastDose", intervalHours: 0 })).toBe(0);
    expect(dosesPerDay({ kind: "fromLastDose", intervalHours: -4 })).toBe(0);
    expect(dosesPerDay({ kind: "fixedTimes", times: [] })).toBe(0);
  });
});

describe("tone boundaries", () => {
  function toneFor(remaining: number): string {
    const proj = projectMedication({
      medication: medication({ stockUnits: remaining, lowThreshold: null }),
      courses: [course()], // dosesPerDay 1, doseAmount 1 => dailyUse 1
      adjustments: [],
      now: NOW,
    });
    return proj.tone;
  }

  it(`daysOfCover === ${TONE_OUT_DAYS} -> "out"`, () => {
    expect(toneFor(3)).toBe("out");
  });

  it("daysOfCover just above the out boundary -> \"low\"", () => {
    expect(toneFor(3.1)).toBe("low");
  });

  it(`daysOfCover === ${TONE_LOW_DAYS} -> "low"`, () => {
    expect(toneFor(10)).toBe("low");
  });

  it("daysOfCover just above the low boundary -> \"good\"", () => {
    expect(toneFor(10.1)).toBe("good");
  });
});

describe("lowThreshold override", () => {
  it("overrides to \"low\" even with plenty of days of cover", () => {
    // dailyUse is tiny so daysOfCover is huge (well over the 10-day "good"
    // boundary) — this assertion fails if the lowThreshold override is dropped.
    const proj = projectMedication({
      medication: medication({ stockUnits: 5, lowThreshold: 5 }),
      courses: [
        course({ schedule: { kind: "fromLastDose", intervalHours: 24 }, doseAmount: 0.01 }),
      ],
      adjustments: [],
      now: NOW,
    });
    expect(proj.daysOfCover).toBeGreaterThan(TONE_LOW_DAYS);
    expect(proj.tone).toBe("low");
  });

  it("overrides to \"good\" even with few days of cover", () => {
    // daysOfCover is 2 (well inside the "out" band by day thresholds) — this
    // assertion fails if the lowThreshold override is dropped.
    const proj = projectMedication({
      medication: medication({ stockUnits: 100, lowThreshold: 1 }),
      courses: [
        course({ schedule: { kind: "fromLastDose", intervalHours: 24 }, doseAmount: 50 }),
      ],
      adjustments: [],
      now: NOW,
    });
    expect(proj.daysOfCover).toBeLessThan(TONE_OUT_DAYS);
    expect(proj.tone).toBe("good");
  });
});

describe("horizonDays", () => {
  it("uses the course end date when sooner than 30 days", () => {
    const proj = projectMedication({
      medication: medication(),
      courses: [course({ endDate: "2026-08-15" })], // 7 days from FIXTURE_NOW's local day
      adjustments: [],
      now: NOW,
    });
    expect(proj.horizonDays).toBe(7);
  });

  it("uses 30 when the course is ongoing (endDate null)", () => {
    const proj = projectMedication({
      medication: medication(),
      courses: [course({ endDate: null })],
      adjustments: [],
      now: NOW,
    });
    expect(proj.horizonDays).toBe(HORIZON_DAYS);
  });
});

describe("two pets sharing one medication", () => {
  it("sums dailyUse across both courses (Ivermectin: 4/7)", () => {
    const IVERMECTIN_ID = "b0000000-0000-4000-8000-000000000004";
    const ivermectinCourses = fixtures.courses.filter(
      (c) => c.medicationId === IVERMECTIN_ID,
    );
    expect(ivermectinCourses).toHaveLength(2);
    expect(dailyUseFor(ivermectinCourses)).toBeCloseTo(4 / 7, 12);

    const ivermectin = fixtures.medications.find((m) => m.id === IVERMECTIN_ID)!;
    const proj = projectMedication({
      medication: ivermectin,
      courses: ivermectinCourses,
      adjustments: fixtures.stockAdjustments.filter((a) => a.medicationId === IVERMECTIN_ID),
      now: NOW,
    });
    expect(proj.dailyUse).toBeCloseTo(4 / 7, 12);
  });
});

describe("non-active courses contribute 0 to dailyUse", () => {
  it("paused, finished and stopped courses are excluded", () => {
    const courses = [
      course({ id: "c1", status: "paused" }),
      course({ id: "c2", status: "finished" }),
      course({ id: "c3", status: "stopped" }),
    ];
    expect(dailyUseFor(courses)).toBe(0);
  });

  it("only active courses count when mixed with inactive ones", () => {
    const activeCourse = course({ id: "c-active", status: "active" });
    const withInactive = [
      activeCourse,
      course({ id: "c-paused", status: "paused" }),
      course({ id: "c-stopped", status: "stopped" }),
    ];
    expect(dailyUseFor(withInactive)).toBe(dailyUseFor([activeCourse]));
  });
});

describe("stockUnits === null", () => {
  it("produces the not-set projection shape", () => {
    const proj = projectMedication({
      medication: medication({ stockUnits: null }),
      courses: [course()],
      adjustments: [],
      now: NOW,
    });
    expect(proj.stockSet).toBe(false);
    expect(proj.daysOfCover).toBeNull();
    expect(proj.percent).toBeNull();
    expect(proj.needed).toBe(0);
    expect(proj.runsOutInsideHorizon).toBe(false);
  });
});

describe("dailyUse === 0", () => {
  it("produces the no-usage projection shape", () => {
    const proj = projectMedication({
      medication: medication({ stockUnits: 10 }),
      courses: [], // no active courses => dailyUse 0
      adjustments: [],
      now: NOW,
    });
    expect(proj.dailyUse).toBe(0);
    expect(proj.daysOfCover).toBe(Infinity);
    expect(proj.runOutDate).toBeNull();
    expect(proj.percent).toBe(100);
    expect(proj.tone).toBe("good");
  });
});

describe("needed rounds up to whole packs", () => {
  it("a deficit of 0.1 with packSize 15 needs 1 pack", () => {
    const proj = projectMedication({
      medication: medication({ stockUnits: 29.9, packSize: 15 }),
      courses: [course({ endDate: null })], // dailyUse 1, horizon 30 -> deficit 0.1
      adjustments: [],
      now: NOW,
    });
    expect(proj.neededPacks).toBe(1);
    expect(proj.needed).toBe(15);
  });

  it("a deficit of exactly 15 needs 1 pack", () => {
    const proj = projectMedication({
      medication: medication({ stockUnits: 15, packSize: 15 }),
      courses: [course({ endDate: null })],
      adjustments: [],
      now: NOW,
    });
    expect(proj.neededPacks).toBe(1);
    expect(proj.needed).toBe(15);
  });

  it("a deficit of 15.1 needs 2 packs", () => {
    const proj = projectMedication({
      medication: medication({ stockUnits: 14.9, packSize: 15 }),
      courses: [course({ endDate: null })],
      adjustments: [],
      now: NOW,
    });
    expect(proj.neededPacks).toBe(2);
    expect(proj.needed).toBe(30);
  });

  it("packSize === null rounds up to whole units", () => {
    const proj = projectMedication({
      medication: medication({ stockUnits: 24.8, packSize: null }),
      courses: [course({ endDate: null })], // deficit 5.2
      adjustments: [],
      now: NOW,
    });
    expect(proj.neededPacks).toBeNull();
    expect(proj.needed).toBe(6);
  });
});

describe("percent", () => {
  it("clamps at 100 when cover exceeds the horizon", () => {
    const proj = projectMedication({
      medication: medication({ stockUnits: 40 }),
      courses: [course({ endDate: null })], // dailyUse 1, horizon 30 -> daysOfCover 40
      adjustments: [],
      now: NOW,
    });
    expect(proj.percent).toBe(100);
  });

  it("is min(100, daysOfCover / horizonDays * 100) on a non-clamped case", () => {
    const proj = projectMedication({
      medication: medication({ stockUnits: 15 }),
      courses: [course({ endDate: null })], // dailyUse 1, horizon 30 -> daysOfCover 15
      adjustments: [],
      now: NOW,
    });
    expect(proj.percent).toBe(50);
  });
});

describe("needsStockPrompt", () => {
  it("is true when cover has run out and no recent adjustment exists", () => {
    const proj = projectMedication({
      medication: medication({ stockUnits: 0 }),
      courses: [course()], // dailyUse 1 -> daysOfCover 0
      adjustments: [],
      now: NOW,
    });
    expect(proj.needsStockPrompt).toBe(true);
  });

  it("is false when an adjustment exists 13 days ago", () => {
    const thirteenDaysAgo = new Date(NOW.getTime() - 13 * 86_400_000).toISOString();
    const proj = projectMedication({
      medication: medication({ stockUnits: 0 }),
      courses: [course()],
      adjustments: [adjustment({ createdAt: thirteenDaysAgo })],
      now: NOW,
    });
    expect(proj.needsStockPrompt).toBe(false);
  });

  it("is false when cover has NOT run out even though the last adjustment is 20 days old", () => {
    const twentyDaysAgo = new Date(NOW.getTime() - 20 * 86_400_000).toISOString();
    const proj = projectMedication({
      medication: medication({ stockUnits: 10 }),
      courses: [course()], // dailyUse 1 -> daysOfCover 10 (not run out)
      adjustments: [adjustment({ createdAt: twentyDaysAgo })],
      now: NOW,
    });
    expect(proj.needsStockPrompt).toBe(false);
  });
});

describe("immutability", () => {
  it("never mutates its inputs", () => {
    const med = deepFreeze(medication());
    const courses = deepFreeze([course()]);
    const adjustments = deepFreeze([adjustment()]);
    expect(() =>
      projectMedication({ medication: med, courses, adjustments, now: NOW }),
    ).not.toThrow();
  });
});
