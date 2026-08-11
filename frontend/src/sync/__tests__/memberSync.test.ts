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

  it("pins the identity-mismatch fix: a dose logged under Device 1's stale local id resolves to the real name on Device 2, via the roster's aliasIds", async () => {
    // Marta's stale, locally-generated self id — the id her device stamped
    // on this dose BEFORE it reconciled with her canonical account id
    // (MARTA_ID). Some devices' pushed events can only ever carry this
    // stale id, since ledger rows are never rewritten once pushed — the
    // roster disclosing it as an alias (via `POST /household/me/aliases`,
    // simulated here by seeding it directly on the roster DTO) is the
    // only way a DIFFERENT device ever resolves it.
    const MARTA_STALE_LOCAL_ID = "d0000000-0000-4000-8000-00000000e001";
    const { transport } = createFakeServer({
      roster: [{ ...martaRosterEntry(), aliasIds: [MARTA_STALE_LOCAL_ID] }],
    });

    await transport.push({
      doseEvents: [
        {
          id: "d0000000-0000-4000-8000-00000000f002",
          courseId: COURSE_ID,
          scheduledFor: null,
          status: "given",
          loggedAt: "2026-08-10T08:00:00.000Z",
          givenAt: "2026-08-10T08:00:00.000Z",
          amount: 1,
          note: null,
          occurrenceKey: `${COURSE_ID}|-2`,
          supersedesId: null,
          actorId: MARTA_STALE_LOCAL_ID,
          createdAt: "2026-08-10T08:00:00.000Z",
          updatedAt: "2026-08-10T08:00:00.000Z",
          deletedAt: null,
        },
      ],
    });

    // Device 2's starting point: only its own local self row, no other
    // members, roster arriving purely through the background sync cycle
    // below — nothing about Marta was ever fetched via `GET /household`.
    const repo = freshDevice();
    expect(await repo.listUsers({ includeRemoved: true })).toHaveLength(1);

    const engine = createSyncEngine({ repo, transport, clock: systemClock });
    await engine.syncOnce();

    const staleDose = (await repo.listDoseEvents({})).find((e) => e.actorId === MARTA_STALE_LOCAL_ID);
    expect(staleDose).toBeDefined();

    const usersAfter = await repo.listUsers({ includeRemoved: true });
    expect(displayNameFor(MARTA_STALE_LOCAL_ID, usersAfter)).toBe("Marta");
  });

  // G1 (highest priority): the coordinator's exact reported scenario — NOT
  // another member's dose, but this SAME account's OWN pre-fix dose,
  // viewed from a SECOND device of theirs. `pullRoster` (backend) excludes
  // the caller's own row from `changes.users` by design ("every OTHER
  // member" — see that function's comment), so `mirrorMembers` alone can
  // never see this case; it has to arrive through `SyncPullResult`'s
  // separate `selfAliasIds` field, which `syncOnce()` now merges directly
  // into the local self row. No `GET /household` visit involved — purely
  // the background cycle, matching the live repro ("a third browser
  // profile... still showed 'Someone'").
  it("G1: a second device of the SAME account resolves that account's own pre-fix dose to their real name, via SyncPullResult.selfAliasIds", async () => {
    const ROMAN_STALE_LOCAL_ID = "d0000000-0000-4000-8000-00000000a001";
    const ROMAN_CANONICAL_ID = "d0000000-0000-4000-8000-00000000a002";
    const { transport, setSelfAliasIds } = createFakeServer();

    // Device 1 (Roman's first device) already reconciled and disclosed its
    // stale id, AND already pushed a dose it logged before that
    // reconciliation happened — still carrying the stale id, since ledger
    // rows are never rewritten.
    setSelfAliasIds([ROMAN_STALE_LOCAL_ID]);
    await transport.push({
      doseEvents: [
        {
          id: "d0000000-0000-4000-8000-00000000f003",
          courseId: COURSE_ID,
          scheduledFor: null,
          status: "given",
          loggedAt: "2026-08-10T08:00:00.000Z",
          givenAt: "2026-08-10T08:00:00.000Z",
          amount: 1,
          note: null,
          occurrenceKey: `${COURSE_ID}|-3`,
          supersedesId: null,
          actorId: ROMAN_STALE_LOCAL_ID,
          createdAt: "2026-08-10T08:00:00.000Z",
          updatedAt: "2026-08-10T08:00:00.000Z",
          deletedAt: null,
        },
      ],
    });

    // Device 2: a SEPARATE device, but signed into the SAME account —
    // already reconciled to the SAME canonical id (the realistic steady
    // state; `router.ts`'s `beforeLoad` runs `reconcileSelfId` before any
    // navigation completes). It has never heard of `ROMAN_STALE_LOCAL_ID`.
    const deviceTwo = freshDevice();
    await deviceTwo.reconcileSelfId(ROMAN_CANONICAL_ID);
    const selfBefore = await deviceTwo.getCurrentUser();
    expect(selfBefore.aliasIds ?? []).not.toContain(ROMAN_STALE_LOCAL_ID);
    expect(displayNameFor(ROMAN_STALE_LOCAL_ID, [selfBefore])).toBe("Someone");

    const engine = createSyncEngine({ repo: deviceTwo, transport, clock: systemClock });
    await engine.syncOnce();

    const pulledDose = (await deviceTwo.listDoseEvents({})).find((e) => e.actorId === ROMAN_STALE_LOCAL_ID);
    expect(pulledDose).toBeDefined();

    const selfAfter = await deviceTwo.getCurrentUser();
    expect(selfAfter.aliasIds).toContain(ROMAN_STALE_LOCAL_ID);
    expect(displayNameFor(ROMAN_STALE_LOCAL_ID, [selfAfter])).toBe(selfAfter.displayName);
    expect(displayNameFor(ROMAN_STALE_LOCAL_ID, [selfAfter])).not.toBe("Someone");
  });

  // A5: the mirror image of G1. There the device had never HEARD of the
  // stale id; here it is the disclosing device itself, wrongly convinced it
  // already delivered one. The pre-A1 `pushPendingSelfAliases` marked every
  // pending id as pushed on any bare 200, so an install carrying that
  // poisoned claim excluded the id from `pending` forever and never retried
  // it — and every dose it logged under that id stayed "Someone" on every
  // other device, with no member removed and no backup imported. The claim
  // is now overwritten by what the server actually reports.
  it("A5: resets a selfAliasIdsPushed claim the server does not back, so the undelivered id is offered again", async () => {
    const CANONICAL_ID = "d0000000-0000-4000-8000-00000000b002";
    const { transport, setSelfAliasIds } = createFakeServer();

    const device = freshDevice();
    // The stale id is the auto-minted local one `reconcileSelfId` displaces
    // into `aliasIds` — read back rather than hard-coded, since the repo
    // mints it itself.
    await device.reconcileSelfId(CANONICAL_ID);
    const self = await device.getCurrentUser();
    const staleId = (self.aliasIds ?? [])[0];
    expect(staleId).toBeDefined();

    // The poisoned state: this device believes it disclosed its stale id,
    // while the server holds no aliases for this account at all.
    await device.setMeta("selfAliasIdsPushed", [staleId]);
    setSelfAliasIds([]);

    const engine = createSyncEngine({ repo: device, transport, clock: systemClock });
    await engine.syncOnce();

    // Back to pending — `pushPendingSelfAliases` diffs `aliasIds` against
    // this exact list, so an empty claim is what re-arms the disclosure.
    expect(await device.getMeta("selfAliasIdsPushed")).toEqual([]);

    // And once the server does hold it, the claim tracks that instead of
    // being reset every cycle.
    setSelfAliasIds([staleId]);
    await engine.syncOnce();
    expect(await device.getMeta("selfAliasIdsPushed")).toEqual([staleId]);
  });

  it("does not report a change (and does not re-invalidate) on a second, unchanged cycle", async () => {
    const { transport } = createFakeServer({ roster: [martaRosterEntry()] });
    const repo = freshDevice();
    const engine = createSyncEngine({ repo, transport, clock: systemClock });

    expect(await engine.syncOnce()).toBe(true);
    expect(await engine.syncOnce()).toBe(false);
  });
});
