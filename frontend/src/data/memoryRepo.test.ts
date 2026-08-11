import { afterEach, describe, expect, it } from "vitest";
import {
  displayNameFor,
  fixedClock,
  fixtures,
  RETRACT_GRACE_MS,
  setClock,
  systemClock,
  UNDO_WINDOW_MS,
} from "@/domain";
import { createMemoryRepo, DuplicateDoseError, RetractWindowExpiredError } from "./memoryRepo";

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

describe("createMemoryRepo — identity", () => {
  it("currentActorId() and currentHouseholdId() are non-empty and stable across repeated calls, even with no seed at all", async () => {
    const repo = createMemoryRepo();

    const actorId = await repo.currentActorId();
    const householdId = await repo.currentHouseholdId();
    expect(actorId.length).toBeGreaterThan(0);
    expect(householdId.length).toBeGreaterThan(0);

    expect(await repo.currentActorId()).toBe(actorId);
    expect(await repo.currentHouseholdId()).toBe(householdId);
  });

  it("createPet stamps householdId from currentHouseholdId()", async () => {
    const repo = createMemoryRepo();
    const householdId = await repo.currentHouseholdId();

    const pet = await repo.createPet({ name: "Pip", species: "cat" });
    expect(pet.householdId).toBe(householdId);
  });

  it("logDose, correctDose, recordMissed, adjustStock and setStockOnHand stamp actorId from currentActorId(), with no actorId passed by the caller", async () => {
    const repo = createMemoryRepo();
    const actorId = await repo.currentActorId();
    const course = fixtures.courses[0];
    const medicationId = fixtures.medications[0].id;

    const logged = await repo.logDose({
      courseId: course.id,
      status: "given",
      scheduledFor: "2026-08-10T07:00:00.000Z",
      amount: 1,
    });
    expect(logged.actorId).toBe(actorId);

    const corrected = await repo.correctDose(logged.id, { amount: 2 });
    expect(corrected.actorId).toBe(actorId);

    const [missed] = await repo.recordMissed([
      { courseId: course.id, scheduledFor: "2026-08-11T07:00:00.000Z", amount: 1 },
    ]);
    expect(missed.actorId).toBe(actorId);

    const adjusted = await repo.adjustStock({ medicationId, deltaUnits: 1, reason: "purchase" });
    expect(adjusted.actorId).toBe(actorId);

    const onHand = await repo.setStockOnHand(medicationId, 10);
    expect(onHand.actorId).toBe(actorId);
  });
});

describe("createMemoryRepo — logDose concurrent-log dedup guard", () => {
  it("fixedTimes: rejects a second log for the identical scheduledFor, leaving exactly one live event for that occurrence", async () => {
    const repo = createMemoryRepo();
    // A fixedTimes course (times ["08:00", "20:00"]); a fresh scheduledFor
    // not already present in the fixture doseEvents for this course.
    const course = fixtures.courses.find((c) => c.schedule.kind === "fixedTimes")!;
    const scheduledFor = "2026-08-09T07:00:00.000Z";

    const first = await repo.logDose({
      courseId: course.id,
      status: "given",
      scheduledFor,
      amount: 1,
    });

    let caught: unknown;
    try {
      await repo.logDose({ courseId: course.id, status: "given", scheduledFor, amount: 1 });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DuplicateDoseError);
    const dupError = caught as DuplicateDoseError;
    expect(dupError.actorId).toBe(first.actorId);
    expect(dupError.givenAt).toBe(first.givenAt);
    expect(dupError.message).not.toMatch(/@/);
    expect(dupError.message).not.toMatch(/Roman|Marta/);

    const events = await repo.listDoseEvents({ courseId: course.id });
    expect(events.filter((e) => e.scheduledFor === scheduledFor)).toHaveLength(1);
  });

  it("fromLastDose: a distinct scheduledFor rejects within the grace window, accepts once the grace window has passed", async () => {
    setClock(fixedClock("2026-08-08T07:00:00.000Z"));
    const repo = createMemoryRepo();
    // A fromLastDose course with no fixture doseEvents at all, so the test
    // starts from a genuinely clean slate on this course.
    const course = fixtures.courses.find(
      (c) => c.schedule.kind === "fromLastDose" && !fixtures.doseEvents.some((e) => e.courseId === c.id),
    )!;

    const first = await repo.logDose({
      courseId: course.id,
      status: "given",
      scheduledFor: null,
      amount: 1,
    });

    // A DIFFERENT (non-null) scheduledFor, 30 minutes later — past the
    // 10-minute `EARLY_GIVE_FLOOR_MIN` floor (F1) but still inside the
    // 90-minute fromLastDose grace window, so it collides with `first` via
    // the (bypassable) grace-window heuristic, not the floor and not the
    // same-occurrence block (which `scheduledFor: null` alone would trip
    // regardless of timing — see the dedicated test below for that).
    setClock(fixedClock("2026-08-08T07:30:00.000Z"));
    await expect(
      repo.logDose({ courseId: course.id, status: "given", scheduledFor: "2026-08-08T15:00:00.000Z", amount: 1 }),
    ).rejects.toBeInstanceOf(DuplicateDoseError);

    // 91 minutes after the FIRST log — outside the grace window.
    setClock(fixedClock("2026-08-08T08:31:00.000Z"));
    const second = await repo.logDose({
      courseId: course.id,
      status: "given",
      scheduledFor: "2026-08-08T15:00:00.000Z",
      amount: 1,
    });
    expect(second.id).not.toBe(first.id);

    const events = await repo.listDoseEvents({ courseId: course.id });
    expect(events).toHaveLength(2);
  });

  // Latent fix: the same-occurrence hard block now keys on `scheduledFor`
  // unconditionally, including `null` (the "chain never started" sentinel)
  // — `repo.types.ts`'s doc always said `allowWithinGrace` never bypasses
  // it, but the guard used to carve `null` out of it silently.
  it("fromLastDose: scheduledFor: null is the SAME occurrence every time — rejected at any gap, even with allowWithinGrace", async () => {
    setClock(fixedClock("2026-08-08T07:00:00.000Z"));
    const repo = createMemoryRepo();
    const course = fixtures.courses.find(
      (c) => c.schedule.kind === "fromLastDose" && !fixtures.doseEvents.some((e) => e.courseId === c.id),
    )!;

    await repo.logDose({ courseId: course.id, status: "given", scheduledFor: null, amount: 1 });

    // Well past the 90-minute grace window — under the OLD, null-guarded
    // check this would have been accepted as a different occurrence.
    setClock(fixedClock("2026-08-09T07:00:00.000Z"));
    await expect(
      repo.logDose({ courseId: course.id, status: "given", scheduledFor: null, amount: 1 }),
    ).rejects.toBeInstanceOf(DuplicateDoseError);
    await expect(
      repo.logDose({ courseId: course.id, status: "given", scheduledFor: null, amount: 1, allowWithinGrace: true }),
    ).rejects.toBeInstanceOf(DuplicateDoseError);

    expect(await repo.listDoseEvents({ courseId: course.id })).toHaveLength(1);
  });

  it("does not block correctDose (a superseding row is still written)", async () => {
    const repo = createMemoryRepo();
    const course = fixtures.courses.find((c) => c.schedule.kind === "fixedTimes")!;
    const original = await repo.logDose({
      courseId: course.id,
      status: "given",
      scheduledFor: "2026-08-09T07:00:00.000Z",
      amount: 1,
    });

    const corrected = await repo.correctDose(original.id, { amount: 2 });
    expect(corrected.supersedesId).toBe(original.id);
  });

  it("does not block recordMissed", async () => {
    const repo = createMemoryRepo();
    const course = fixtures.courses.find((c) => c.schedule.kind === "fixedTimes")!;
    const scheduledFor = "2026-08-09T07:00:00.000Z";

    await repo.logDose({ courseId: course.id, status: "given", scheduledFor, amount: 1 });
    const [missed] = await repo.recordMissed([
      { courseId: course.id, scheduledFor: "2026-08-10T07:00:00.000Z", amount: 1 },
    ]);
    expect(missed.status).toBe("missed");
  });

  it("does not permanently poison an occurrence retractDoseEvent has undone", async () => {
    setClock(fixedClock("2026-08-08T07:00:00.000Z"));
    const repo = createMemoryRepo();
    const course = fixtures.courses.find((c) => c.schedule.kind === "fixedTimes")!;
    const scheduledFor = "2026-08-09T07:00:00.000Z";

    const event = await repo.logDose({ courseId: course.id, status: "given", scheduledFor, amount: 1 });
    await repo.retractDoseEvent(event.id);

    const relogged = await repo.logDose({ courseId: course.id, status: "given", scheduledFor, amount: 1 });
    expect(relogged.id).not.toBe(event.id);
  });
});

describe("createMemoryRepo — users", () => {
  it("removeUser soft-deletes: excluded from listUsers(), present with includeRemoved, and displayNameFor still resolves the name", async () => {
    const repo = createMemoryRepo();
    const marta = fixtures.users.find((u) => u.displayName === "Marta")!;

    await repo.removeUser(marta.id);

    const active = await repo.listUsers();
    expect(active.find((u) => u.id === marta.id)).toBeUndefined();

    const withRemoved = await repo.listUsers({ includeRemoved: true });
    const removed = withRemoved.find((u) => u.id === marta.id);
    expect(removed).toBeDefined();
    expect(removed?.deletedAt).not.toBeNull();

    expect(displayNameFor(marta.id, withRemoved)).toBe("Marta");
  });
});

describe("createMemoryRepo — join codes", () => {
  it("createJoinCode revokes the previously live code, leaving exactly one live code", async () => {
    const repo = createMemoryRepo();

    const first = await repo.createJoinCode({
      code: "K7RMQ9",
      expiresAt: "2026-08-10T07:00:00.000Z",
    });
    const second = await repo.createJoinCode({
      code: "K7RMQ8",
      expiresAt: "2026-08-10T07:00:00.000Z",
    });

    const codes = await repo.listJoinCodes();
    const firstAfter = codes.find((c) => c.id === first.id)!;
    const secondAfter = codes.find((c) => c.id === second.id)!;

    expect(firstAfter.revokedAt).not.toBeNull();
    expect(secondAfter.revokedAt).toBeNull();

    const live = codes.filter((c) => c.revokedAt === null && c.usedBy === null);
    expect(live).toHaveLength(1);
    expect(live[0]?.id).toBe(second.id);
  });
});

describe("createMemoryRepo — importHousehold backfill", () => {
  it("a v1-shaped backup (no households/users, pets without householdId, doseEvents without actorId) leaves no row missing the new fields", async () => {
    const repo = createMemoryRepo();
    const backup = await repo.exportHousehold();
    // Simulate a genuinely v1 backup: strip the fields this slice added.
    const v1Backup = structuredClone(backup);
    delete v1Backup.households;
    delete v1Backup.users;
    v1Backup.pets = v1Backup.pets.map((p) => {
      const clone: Record<string, unknown> = { ...p };
      delete clone.householdId;
      return clone as unknown as typeof p;
    });
    v1Backup.doseEvents = v1Backup.doseEvents.map((e) => {
      const clone: Record<string, unknown> = { ...e };
      delete clone.actorId;
      return clone as unknown as typeof e;
    });

    const empty = createMemoryRepo({
      pets: [],
      medications: [],
      courses: [],
      doseEvents: [],
      stockAdjustments: [],
    });
    await empty.importHousehold(v1Backup, "replace");

    const roundTripped = await empty.exportHousehold();
    for (const pet of roundTripped.pets) {
      expect(pet.householdId).toBeTruthy();
    }
    for (const event of roundTripped.doseEvents) {
      expect(event.actorId).toBeTruthy();
    }
    // Backfilled against the importing repo's own identity, established
    // before the import (a v1 backup carries no identity of its own).
    const emptyHouseholdId = await empty.currentHouseholdId();
    const emptyActorId = await empty.currentActorId();
    expect(roundTripped.pets.every((p) => p.householdId === emptyHouseholdId)).toBe(true);
    expect(roundTripped.doseEvents.every((e) => e.actorId === emptyActorId)).toBe(true);
  });
});
