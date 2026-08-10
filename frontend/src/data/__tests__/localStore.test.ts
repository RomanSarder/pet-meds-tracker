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

  // sync never pushes or pulls `users`/`households` (repo.types.ts's
  // `RemoteChanges` deliberately excludes both), so a customised
  // `displayName` or household `name` is local-only, user-entered content
  // that `lastPushedAt` can never vouch for — it must block disposal even
  // with zero domain rows.
  it("is false when there are zero domain rows but the self user's displayName was customised", async () => {
    const repo = makeRepo();
    const self = await repo.getCurrentUser();
    await repo.updateUser(self.id, { displayName: "Roman" });

    expect(await localStoreIsDisposable(repo)).toBe(false);
  });

  it("is false when there are zero domain rows but the household was named", async () => {
    const repo = makeRepo();
    const household = await repo.getCurrentHousehold();
    await repo.updateHousehold(household.id, { name: "The Byte House" });

    expect(await localStoreIsDisposable(repo)).toBe(false);
  });

  // The case the fix must not break: a genuinely fresh device — default
  // display name, unnamed household, no domain rows — must still read as
  // disposable, or the silent-reset path (owner mismatch + disposable) could
  // never fire on first run.
  it("is true when there are zero domain rows, the default display name, and no household name", async () => {
    const repo = makeRepo();

    expect(await localStoreIsDisposable(repo)).toBe(true);
  });
});
