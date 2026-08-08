import { afterEach, describe, expect, it } from "vitest";
import {
  fixedClock,
  fixtures,
  RETRACT_GRACE_MS,
  setClock,
  systemClock,
  UNDO_WINDOW_MS,
} from "@/domain";
import { createMemoryRepo, RetractWindowExpiredError } from "./memoryRepo";

afterEach(() => {
  setClock(systemClock);
});

describe("createMemoryRepo — createPet tint assignment", () => {
  it("assigns tints 1,2,3,4,1 across five creates, and archiving pet 2 does not change pet 5's tint", async () => {
    const repo = createMemoryRepo({
      pets: [],
      medications: [],
      courses: [],
      doseEvents: [],
      stockAdjustments: [],
    });

    const created = [];
    for (let i = 0; i < 5; i++) {
      created.push(await repo.createPet({ name: `Pet ${i}`, species: "cat" }));
    }
    expect(created.map((p) => p.tint)).toEqual([1, 2, 3, 4, 1]);

    await repo.setPetArchived(created[1].id, true);

    const pet5 = await repo.getPet(created[4].id);
    expect(pet5?.tint).toBe(1);
  });
});

describe("createMemoryRepo — retractDoseEvent", () => {
  it("succeeds inside the retract window", async () => {
    setClock(fixedClock("2026-08-08T07:00:00.000Z"));
    const repo = createMemoryRepo();
    const courseId = fixtures.courses[0].id;
    const event = await repo.logDose({
      courseId,
      status: "given",
      scheduledFor: null,
      amount: 1,
    });

    setClock(fixedClock("2026-08-08T07:00:20.000Z")); // 20s later, inside 35s window
    await repo.retractDoseEvent(event.id);

    const remaining = await repo.listDoseEvents({ courseId });
    expect(remaining.find((e) => e.id === event.id)).toBeUndefined();
  });

  it("throws RetractWindowExpiredError outside the retract window", async () => {
    setClock(fixedClock("2026-08-08T07:00:00.000Z"));
    const repo = createMemoryRepo();
    const courseId = fixtures.courses[0].id;
    const event = await repo.logDose({
      courseId,
      status: "given",
      scheduledFor: null,
      amount: 1,
    });

    const windowMs = UNDO_WINDOW_MS + RETRACT_GRACE_MS;
    const outside = new Date(new Date("2026-08-08T07:00:00.000Z").getTime() + windowMs + 1);
    setClock(fixedClock(outside.toISOString()));

    await expect(repo.retractDoseEvent(event.id)).rejects.toBeInstanceOf(RetractWindowExpiredError);
  });

  it("refuses when another event supersedes the target row", async () => {
    setClock(fixedClock("2026-08-08T07:00:00.000Z"));
    const repo = createMemoryRepo();
    const courseId = fixtures.courses[0].id;
    const event = await repo.logDose({
      courseId,
      status: "given",
      scheduledFor: null,
      amount: 1,
    });
    await repo.correctDose(event.id, { amount: 2 });

    await expect(repo.retractDoseEvent(event.id)).rejects.toThrow();
  });
});

describe("createMemoryRepo — correctDose", () => {
  it("leaves the original row intact and appends a new row with supersedesId set", async () => {
    const repo = createMemoryRepo();
    const courseId = fixtures.courses[0].id;
    const original = await repo.logDose({
      courseId,
      status: "given",
      scheduledFor: null,
      amount: 1,
    });

    const corrected = await repo.correctDose(original.id, { amount: 2, note: "fixed amount" });

    expect(corrected.id).not.toBe(original.id);
    expect(corrected.supersedesId).toBe(original.id);
    expect(corrected.amount).toBe(2);

    const events = await repo.listDoseEvents({ courseId });
    const originalRow = events.find((e) => e.id === original.id);
    expect(originalRow).toBeDefined();
    expect(originalRow?.amount).toBe(1);
    expect(originalRow?.supersedesId).toBeNull();
  });
});

describe("createMemoryRepo — stockUnits invariant", () => {
  it("logDose and recordMissed never change stockUnits; adjustStock does and keeps it in sync", async () => {
    const repo = createMemoryRepo();
    const medicationId = fixtures.medications[0].id;
    const course = fixtures.courses.find((c) => c.medicationId === medicationId)!;

    const before = await repo.getMedication(medicationId);

    await repo.logDose({
      courseId: course.id,
      status: "given",
      scheduledFor: null,
      amount: course.doseAmount,
    });
    await repo.recordMissed([
      { courseId: course.id, scheduledFor: "2026-08-09T08:00:00.000Z", amount: course.doseAmount },
    ]);

    const afterLogging = await repo.getMedication(medicationId);
    expect(afterLogging?.stockUnits).toBe(before?.stockUnits);

    await repo.adjustStock({ medicationId, deltaUnits: 5, reason: "purchase" });

    const adjustments = await repo.listStockAdjustments(medicationId);
    const total = adjustments.reduce((sum, a) => sum + a.deltaUnits, 0);
    const afterAdjust = await repo.getMedication(medicationId);
    expect(afterAdjust?.stockUnits).toBe(total);
  });
});

describe("createMemoryRepo — export/import round trip", () => {
  it("exportHousehold -> importHousehold(replace) round-trips the fixture household to deep equality", async () => {
    const repo = createMemoryRepo();
    const backup = await repo.exportHousehold();

    const empty = createMemoryRepo({
      pets: [],
      medications: [],
      courses: [],
      doseEvents: [],
      stockAdjustments: [],
    });
    await empty.importHousehold(backup, "replace");
    const roundTripped = await empty.exportHousehold();

    expect(roundTripped.pets).toEqual(backup.pets);
    expect(roundTripped.medications).toEqual(backup.medications);
    expect(roundTripped.courses).toEqual(backup.courses);
    expect(roundTripped.doseEvents).toEqual(backup.doseEvents);
    expect(roundTripped.stockAdjustments).toEqual(backup.stockAdjustments);
  });
});

describe("createMemoryRepo — return values are deep copies", () => {
  it("a returned object mutated by the caller does not corrupt the store", async () => {
    const repo = createMemoryRepo();
    const petId = fixtures.pets[0].id;

    const pet = await repo.getPet(petId);
    expect(pet).not.toBeNull();
    pet!.name = "MUTATED";

    const petAgain = await repo.getPet(petId);
    expect(petAgain?.name).not.toBe("MUTATED");
  });
});
