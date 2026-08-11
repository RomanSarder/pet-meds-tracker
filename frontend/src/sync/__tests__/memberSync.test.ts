// Pins the two reported symptoms this slice fixes:
//   A. a screen shows no data until a manual refresh — traced (in part) to
//      the household roster never reaching a device that hasn't visited the
//      Household screen (`useRefreshMembers` was the only path).
//   B. History attributes a dose to "Someone" instead of the real member,
//      because the local `users` store never learned that member's name.
//
// Both are exercised the same way: a fresh device (only its own local self
// row, no other members — the realistic "never visited Household" starting
// point, since `currentActorId()` always auto-mints a self row on first
// access) runs the background `SyncEngine` alone, with no `GET /household`
// call and no Household screen ever mounted, against a fake server that
// already carries another member's roster entry and a dose event they logged.
import { describe, expect, it } from "vitest";
import { createMemoryRepo } from "@/data";
import { displayNameFor, systemClock } from "@/domain";
import { createSyncEngine } from "../engine";
import { createFakeServer } from "./testSupport";

const MARTA_ID = "b0000000-0000-4000-8000-00000000c001";
const HOUSEHOLD_ID = "a0000000-0000-4000-8000-00000000d001";
const COURSE_ID = "c0000000-0000-4000-8000-000000000001";

function martaRosterEntry() {
  return {
    id: MARTA_ID,
    householdId: HOUSEHOLD_ID,
    displayName: "Marta",
    tint: 2 as const,
    joinedAt: "2026-08-01T00:00:00.000Z",
  };
}

function freshDevice() {
  // Omitting `household`/`users` mints a single self row and nothing else
  // (`memoryRepo.ts`'s `mintSelfUser`) — the same starting point a real
  // device has before its first sync cycle ever completes.
  return createMemoryRepo({
    pets: [],
    medications: [],
    courses: [],
    doseEvents: [],
    stockAdjustments: [],
    joinCodes: [],
  });
}

describe("household roster and attribution arrive from background sync alone", () => {
  it("pins symptom B: a dose logged by another member resolves to their real name (not 'Someone') after sync, with no Household screen involved", async () => {
    const { transport } = createFakeServer({ roster: [martaRosterEntry()] });

    // Simulates Marta's own device having already logged and pushed this
    // dose before this device ever syncs.
    await transport.push({
      doseEvents: [
        {
          id: "d0000000-0000-4000-8000-00000000f001",
          courseId: COURSE_ID,
          scheduledFor: null,
          status: "given",
          loggedAt: "2026-08-10T08:00:00.000Z",
          givenAt: "2026-08-10T08:00:00.000Z",
          amount: 1,
          note: null,
          occurrenceKey: `${COURSE_ID}|-`,
          supersedesId: null,
          actorId: MARTA_ID,
          createdAt: "2026-08-10T08:00:00.000Z",
          updatedAt: "2026-08-10T08:00:00.000Z",
          deletedAt: null,
        },
      ],
    });

    const repo = freshDevice();
    const localUsersBefore = await repo.listUsers({ includeRemoved: true });
    // Only this device's own self row — the empty-roster starting point.
    expect(localUsersBefore).toHaveLength(1);
    expect(displayNameFor(MARTA_ID, localUsersBefore)).toBe("Someone");

    const engine = createSyncEngine({ repo, transport, clock: systemClock });
    await engine.syncOnce();

    const martaDose = (await repo.listDoseEvents({})).find((e) => e.actorId === MARTA_ID);
    expect(martaDose).toBeDefined();

    const usersAfter = await repo.listUsers({ includeRemoved: true });
    expect(displayNameFor(MARTA_ID, usersAfter)).toBe("Marta");
  });

  it("pins symptom A: the roster is populated by the background sync cycle alone, without the Household screen ever mounting", async () => {
    const { transport } = createFakeServer({ roster: [martaRosterEntry()] });
    const repo = freshDevice();

    expect((await repo.listUsers()).some((u) => u.displayName === "Marta")).toBe(false);

    const engine = createSyncEngine({ repo, transport, clock: systemClock });
    const changed = await engine.syncOnce();

    // `syncOnce()` reports the change itself — this is what `sync/index.ts`
    // uses to invalidate the query cache instead of leaving screens showing
    // whatever they rendered before the cycle finished.
    expect(changed).toBe(true);

    const users = await repo.listUsers();
    expect(users.map((u) => u.displayName)).toContain("Marta");
  });

  it("does not report a change (and does not re-invalidate) on a second, unchanged cycle", async () => {
    const { transport } = createFakeServer({ roster: [martaRosterEntry()] });
    const repo = freshDevice();
    const engine = createSyncEngine({ repo, transport, clock: systemClock });

    expect(await engine.syncOnce()).toBe(true);
    expect(await engine.syncOnce()).toBe(false);
  });
});
