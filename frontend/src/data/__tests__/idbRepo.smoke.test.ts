// A smoke test only — enough to prove `createIdbRepo()` actually talks to a
// real (fake-indexeddb-backed) database end to end. A separate agent owns the
// full invariant suite (transaction scopes, retract window, tint cursor,
// export/import round trip, etc.) in a different file.
import { describe, expect, it } from "vitest";
import { createIdbRepo } from "../idbRepo";

function uniqueDbName(): string {
  return `petmeds-smoke-${crypto.randomUUID()}`;
}

describe("createIdbRepo — smoke", () => {
  it("creates a pet and reads it back", async () => {
    const repo = createIdbRepo({ dbName: uniqueDbName() });

    const created = await repo.createPet({ name: "Clover", species: "rabbit" });
    expect(created.id).toBeTruthy();
    expect(created.tint).toBe(1);

    const fetched = await repo.getPet(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.name).toBe("Clover");
    expect(fetched?.species).toBe("rabbit");
  });

  it("creates a medication and finds it by name", async () => {
    const repo = createIdbRepo({ dbName: uniqueDbName() });

    const created = await repo.createMedication({
      name: "Metacam",
      form: "liquid",
      unit: "ml",
    });
    expect(created.id).toBeTruthy();

    const found = await repo.findMedicationByName("  metacam  ");
    expect(found?.id).toBe(created.id);
    expect(found?.name).toBe("Metacam");
    // The internal `nameLower` column must never leak onto a returned Medication.
    expect(found).not.toHaveProperty("nameLower");
  });

  it("logs a dose and lists it back", async () => {
    const repo = createIdbRepo({ dbName: uniqueDbName() });

    const pet = await repo.createPet({ name: "Nugget", species: "guinea_pig" });
    const medication = await repo.createMedication({
      name: "Vitamin C",
      form: "tablet",
      unit: "tab",
    });
    const course = await repo.createCourse({
      petId: pet.id,
      medicationId: medication.id,
      doseAmount: 1,
      doseUnit: "tab",
      instructions: null,
      schedule: { kind: "fixedTimes", times: ["08:00"] },
      startDate: "2026-08-08",
      endDate: null,
      notes: null,
    });

    const logged = await repo.logDose({
      courseId: course.id,
      status: "given",
      scheduledFor: null,
      amount: 1,
    });
    expect(logged.id).toBeTruthy();
    expect(logged.courseId).toBe(course.id);

    const events = await repo.listDoseEvents({ courseId: course.id });
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(logged.id);
  });
});
