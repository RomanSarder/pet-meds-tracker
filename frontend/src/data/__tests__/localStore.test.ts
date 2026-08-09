// W-session-lifecycle (design §D3b): `localStoreIsDisposable()`. Covers all
// four cases from WA-DESIGN.md "Required tests" item 8, table-driven across
// both `Repo` implementations.
import { afterEach, describe, expect, it } from "vitest";
import type { Repo } from "@/data";
import { createIdbRepo, createMemoryRepo, localStoreIsDisposable } from "@/data";
import { fixedClock, setClock, systemClock } from "@/domain";

afterEach(() => {
  setClock(systemClock);
});

function emptyMemoryRepo(): Repo {
  return createMemoryRepo({
    pets: [],
    medications: [],
    courses: [],
    doseEvents: [],
    stockAdjustments: [],
  });
}

function idbFactory(): Repo {
  return createIdbRepo({ dbName: `petmeds-disposable-${crypto.randomUUID()}` });
}

const implementations: Array<[string, () => Repo]> = [
  ["memoryRepo", emptyMemoryRepo],
  ["idbRepo", idbFactory],
];

describe.each(implementations)("%s — localStoreIsDisposable", (_name, makeRepo) => {
  it("is true for an empty store", async () => {
    const repo = makeRepo();
    expect(await localStoreIsDisposable(repo)).toBe(true);
  });

  it("is false when rows exist and lastPushedAt is null", async () => {
    const repo = makeRepo();
    await repo.createPet({ name: "Clover", species: "rabbit" });
    expect(await repo.getMeta("lastPushedAt")).toBeNull();
    expect(await localStoreIsDisposable(repo)).toBe(false);
  });

  it("is true when every row's updatedAt is at or before lastPushedAt", async () => {
    const repo = makeRepo();
    setClock(fixedClock("2026-08-08T07:00:00.000Z"));
    const pet = await repo.createPet({ name: "Clover", species: "rabbit" });
    const medication = await repo.createMedication({ name: "Metacam", form: "liquid", unit: "ml" });
    const course = await repo.createCourse({
      petId: pet.id,
      medicationId: medication.id,
      doseAmount: 0.4,
      doseUnit: "ml",
      instructions: null,
      schedule: { kind: "fixedTimes", times: ["08:00"] },
      startDate: "2026-08-01",
      endDate: null,
      notes: null,
    });
    await repo.logDose({ courseId: course.id, status: "given", scheduledFor: null, amount: 0.4 });
    await repo.adjustStock({ medicationId: medication.id, deltaUnits: 10, reason: "purchase" });

    await repo.setMeta("lastPushedAt", "2026-08-08T07:00:00.000Z");

    expect(await localStoreIsDisposable(repo)).toBe(true);
  });

  it("is false when one row is newer than lastPushedAt", async () => {
    const repo = makeRepo();
    setClock(fixedClock("2026-08-08T07:00:00.000Z"));
    await repo.createPet({ name: "Clover", species: "rabbit" });
    const medication = await repo.createMedication({ name: "Metacam", form: "liquid", unit: "ml" });

    await repo.setMeta("lastPushedAt", "2026-08-08T07:00:00.000Z");

    // A row written after the push watermark — unsynced.
    setClock(fixedClock("2026-08-08T08:00:00.000Z"));
    await repo.adjustStock({ medicationId: medication.id, deltaUnits: 5, reason: "purchase" });

    expect(await localStoreIsDisposable(repo)).toBe(false);
  });
});
