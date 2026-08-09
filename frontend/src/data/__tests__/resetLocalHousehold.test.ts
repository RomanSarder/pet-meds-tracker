// W-session-lifecycle (design §D3a): `resetLocalHousehold()` — the WA-DESIGN
// "Required tests" item 5's repo-level half (after reset, the previous
// account's rows are gone and the ids differ). Table-driven across both
// `Repo` implementations, mirroring repoContract.test.ts's own pattern, plus
// one idbRepo-only regression for the closure-cache pitfall the brief calls
// out explicitly: a reset that clears the object stores but leaves
// `cachedHouseholdId`/`cachedSelfUserId` pointing at the discarded identity
// would make every subsequent write stamp a household/user that no longer
// exists.
import { describe, expect, it } from "vitest";
import type { Repo } from "@/data";
import { createIdbRepo, createMemoryRepo } from "@/data";
import { DEFAULT_SELF_DISPLAY_NAME } from "@/domain";

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
  return createIdbRepo({ dbName: `petmeds-reset-${crypto.randomUUID()}` });
}

const implementations: Array<[string, () => Repo]> = [
  ["memoryRepo", emptyMemoryRepo],
  ["idbRepo", idbFactory],
];

/** Populates every store `resetLocalHousehold` must clear, plus a live sync watermark. */
async function seedHousehold(
  repo: Repo,
): Promise<{ petId: string; courseId: string; medicationId: string }> {
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
  await repo.createJoinCode({ code: "ABCDEF", expiresAt: "2099-01-01T00:00:00.000Z" });
  await repo.setMeta("syncCursor", "opaque-cursor-1");
  await repo.setMeta("lastPushedAt", "2026-08-08T00:00:00.000Z");
  return { petId: pet.id, courseId: course.id, medicationId: medication.id };
}

describe.each(implementations)("%s — resetLocalHousehold", (_name, makeRepo) => {
  it("discards every domain row and mints a fresh household + self user", async () => {
    const repo = makeRepo();
    const { petId, courseId } = await seedHousehold(repo);
    const oldHouseholdId = await repo.currentHouseholdId();
    const oldSelfUserId = await repo.currentActorId();
    const oldSchemaVersion = await repo.getMeta("schemaVersion");

    await repo.resetLocalHousehold();

    // Previous rows are unreadable afterwards.
    expect(await repo.listPets()).toEqual([]);
    expect(await repo.getPet(petId)).toBeNull();
    expect(await repo.listCourses()).toEqual([]);
    expect(await repo.getCourse(courseId)).toBeNull();
    expect(await repo.listMedications()).toEqual([]);
    expect(await repo.listDoseEvents({})).toEqual([]);
    expect(await repo.listStockAdjustments()).toEqual([]);
    expect(await repo.listCourseEvents({})).toEqual([]);
    expect(await repo.listJoinCodes()).toEqual([]);

    // The new ids are the point: they must differ from the discarded identity.
    const newHouseholdId = await repo.currentHouseholdId();
    const newSelfUserId = await repo.currentActorId();
    expect(newHouseholdId).not.toBe(oldHouseholdId);
    expect(newSelfUserId).not.toBe(oldSelfUserId);

    // A matching Household row and an isSelf:true User row exist for the new ids.
    const household = await repo.getCurrentHousehold();
    expect(household.id).toBe(newHouseholdId);

    const users = await repo.listUsers();
    expect(users).toHaveLength(1);
    expect(users[0].id).toBe(newSelfUserId);
    expect(users[0].isSelf).toBe(true);
    expect(users[0].tint).toBe(1);
    expect(users[0].displayName).toBe(DEFAULT_SELF_DISPLAY_NAME);
    expect(users[0].householdId).toBe(newHouseholdId);

    // Meta resets to a fresh-store baseline, except schemaVersion.
    expect(await repo.getMeta("tintCursor")).toBe(0);
    expect(await repo.getMeta("lastSweepDay")).toBeNull();
    expect(await repo.getMeta("courseEventSeq")).toBe(0);
    expect(await repo.getMeta("syncCursor")).toBeNull();
    expect(await repo.getMeta("lastPushedAt")).toBeNull();
    expect(await repo.getMeta("schemaVersion")).toBe(oldSchemaVersion);
  });

  it("mints tints from 1 again for a pet created after reset", async () => {
    const repo = makeRepo();
    await repo.createPet({ name: "First", species: "dog" });
    await repo.createPet({ name: "Second", species: "cat" });

    await repo.resetLocalHousehold();

    const pet = await repo.createPet({ name: "Third", species: "other" });
    expect(pet.tint).toBe(1);
  });

  it("is safe to call on an already-empty store", async () => {
    const repo = makeRepo();
    const before = await repo.currentHouseholdId();

    await repo.resetLocalHousehold();

    expect(await repo.currentHouseholdId()).not.toBe(before);
    expect(await repo.listPets()).toEqual([]);
  });
});

describe("idbRepo — resetLocalHousehold closure cache", () => {
  it("does not stamp writes after reset with the pre-reset cached household/self ids", async () => {
    const repo = createIdbRepo({ dbName: `petmeds-reset-cache-${crypto.randomUUID()}` });
    // Warm the closure cache exactly the way any earlier write would.
    await repo.createPet({ name: "Before", species: "dog" });

    await repo.resetLocalHousehold();

    const newHouseholdId = await repo.currentHouseholdId();
    const newSelfUserId = await repo.currentActorId();

    const pet = await repo.createPet({ name: "After", species: "cat" });
    expect(pet.householdId).toBe(newHouseholdId);

    const medication = await repo.createMedication({ name: "Amoxicillin", form: "tablet", unit: "tab" });
    const course = await repo.createCourse({
      petId: pet.id,
      medicationId: medication.id,
      doseAmount: 1,
      doseUnit: "tab",
      instructions: null,
      schedule: { kind: "fixedTimes", times: ["08:00"] },
      startDate: "2026-08-01",
      endDate: null,
      notes: null,
    });
    const events = await repo.listCourseEvents({ courseId: course.id });
    expect(events).toHaveLength(1);
    expect(events[0].actorId).toBe(newSelfUserId);
  });
});
