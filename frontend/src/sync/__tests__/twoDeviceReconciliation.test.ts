// W9-DESIGN §D7 items 1-3 — SPEC §12's "offline logs from two devices
// reconcile without duplicating or losing events" and "two members logging
// the same dose within the grace window produce exactly one DoseEvent",
// plus the residual case §D1 names and asks to be documented rather than
// hidden. Two independent `createMemoryRepo()` instances stand in for two
// devices, both driven through their own `SyncEngine` against one shared
// fake server (`testSupport.ts`) — never through the real network.
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryRepo, liveDoseEvents } from "@/data";
import type { Repo } from "@/data";
import { setClock, systemClock } from "@/domain";
import type { SyncEngine } from "../types";
import { createSyncEngine } from "../engine";
import { createControllableClock, createFakeServer, seedAs } from "./testSupport";

// D2's push quarantine (UNDO_WINDOW_MS + RETRACT_GRACE_MS = 35s) — every
// scenario below must clear it before syncing, or the dose events under
// test never leave the device.
const CLEAR_QUARANTINE_MS = 36_000;

const T0 = "2026-08-09T00:00:00.000Z";

afterEach(() => {
  setClock(systemClock);
});

/** A push from A, then a push+pull from B, then a final pull from A — the
 *  minimum dance that brings two participants of a shared fake server to
 *  the same state in both directions. */
async function reconcile(a: SyncEngine, b: SyncEngine): Promise<void> {
  await a.syncOnce();
  await b.syncOnce();
  await a.syncOnce();
}

async function idSet(repo: Repo): Promise<Set<string>> {
  return new Set((await repo.listDoseEvents({})).map((e) => e.id));
}

describe("two-device reconciliation (SPEC §12)", () => {
  it("offline logs from two devices reconcile without duplicating or losing events", async () => {
    const clock = createControllableClock(T0);
    setClock(clock);
    const { transport } = createFakeServer();

    const deviceA = createMemoryRepo();
    const deviceB = createMemoryRepo();
    const engineA = createSyncEngine({ repo: deviceA, transport, clock });
    const engineB = createSyncEngine({ repo: deviceB, transport, clock });

    const baseline = await idSet(deviceA);

    const courses = (await deviceA.listCourses()).filter((c) => c.schedule.kind === "fixedTimes");
    const [courseX, courseY] = courses;

    // Both devices offline: each logs a genuinely distinct occurrence, with
    // no knowledge of the other.
    const doseX = await deviceA.logDose({
      courseId: courseX.id,
      status: "given",
      scheduledFor: "2026-08-12T08:00:00.000Z",
      givenAt: "2026-08-12T08:02:00.000Z",
      amount: courseX.doseAmount,
    });
    const doseY = await deviceB.logDose({
      courseId: courseY.id,
      status: "given",
      scheduledFor: "2026-08-12T09:00:00.000Z",
      givenAt: "2026-08-12T09:01:00.000Z",
      amount: courseY.doseAmount,
    });

    clock.advance(CLEAR_QUARANTINE_MS);
    await reconcile(engineA, engineB);

    const expected = new Set([...baseline, doseX.id, doseY.id]);

    // The exact resulting id set, not its length: a reconciliation that
    // de-duplicated by dropping a real event would still pass a length
    // check but fail this one.
    expect(await idSet(deviceA)).toEqual(expected);
    expect(await idSet(deviceB)).toEqual(expected);
  });

  it("two members logging the same dose within the grace window produce exactly one live DoseEvent", async () => {
    const clock = createControllableClock(T0);
    setClock(clock);
    const { transport } = createFakeServer();

    // Two members of the same household, two devices: Roman's (the default
    // fixture self user) and Marta's (re-homed via `seedAs`).
    const deviceRoman = createMemoryRepo();
    const deviceMarta = createMemoryRepo(seedAs("Marta"));
    const engineRoman = createSyncEngine({ repo: deviceRoman, transport, clock });
    const engineMarta = createSyncEngine({ repo: deviceMarta, transport, clock });

    const [course] = (await deviceRoman.listCourses()).filter((c) => c.schedule.kind === "fixedTimes");
    const scheduledFor = "2026-08-13T08:00:00.000Z";

    // Roman logs it first, offline.
    const romanDose = await deviceRoman.logDose({
      courseId: course.id,
      status: "given",
      scheduledFor,
      givenAt: "2026-08-13T08:01:00.000Z",
      amount: course.doseAmount,
    });

    // A minute later, Marta — on her own device, also offline, with no way
    // to know Roman already gave it — logs the same occurrence.
    clock.advance(60_000);
    const martaDose = await deviceMarta.logDose({
      courseId: course.id,
      status: "given",
      scheduledFor,
      givenAt: "2026-08-13T08:03:00.000Z",
      amount: course.doseAmount,
    });

    clock.advance(CLEAR_QUARANTINE_MS);
    await reconcile(engineRoman, engineMarta);

    // Both rows survive in history on both devices — SPEC §1, nothing is
    // ever auto-deleted, and the server never rejected either write.
    for (const repo of [deviceRoman, deviceMarta]) {
      const rows = (await repo.listDoseEvents({ courseId: course.id })).filter(
        (e) => e.occurrenceKey === romanDose.occurrenceKey,
      );
      expect(rows.map((r) => r.id).sort()).toEqual([romanDose.id, martaDose.id].sort());
    }

    // `liveDoseEvents` collapses to exactly one per occurrenceKey — the
    // newer by `loggedAt` (Marta's) — and both devices, holding identical
    // rows, independently compute the same winner (W9-DESIGN §D1).
    const liveOnRoman = liveDoseEvents(await deviceRoman.listDoseEvents({})).filter(
      (e) => e.occurrenceKey === romanDose.occurrenceKey,
    );
    const liveOnMarta = liveDoseEvents(await deviceMarta.listDoseEvents({})).filter(
      (e) => e.occurrenceKey === romanDose.occurrenceKey,
    );
    expect(liveOnRoman).toHaveLength(1);
    expect(liveOnMarta).toHaveLength(1);
    expect(liveOnRoman[0].id).toBe(martaDose.id);
    expect(liveOnMarta[0].id).toBe(martaDose.id);
  });

  it("an interval course with divergently-computed scheduledFor values yields two live events (§D1 residual)", async () => {
    const clock = createControllableClock(T0);
    setClock(clock);
    const { transport } = createFakeServer();

    const deviceA = createMemoryRepo();
    const deviceB = createMemoryRepo();
    const engineA = createSyncEngine({ repo: deviceA, transport, clock });
    const engineB = createSyncEngine({ repo: deviceB, transport, clock });

    const [course] = (await deviceA.listCourses()).filter((c) => c.schedule.kind === "fromLastDose");

    // Two devices, each having independently walked the `fromLastDose`
    // chain from a slightly different last-known anchor, compute two
    // *different* `scheduledFor` values for what a person would call "the
    // same dose" — five minutes apart, both offline.
    const doseA = await deviceA.logDose({
      courseId: course.id,
      status: "given",
      scheduledFor: "2026-08-14T10:00:00.000Z",
      givenAt: "2026-08-14T10:00:00.000Z",
      amount: course.doseAmount,
    });
    const doseB = await deviceB.logDose({
      courseId: course.id,
      status: "given",
      scheduledFor: "2026-08-14T10:05:00.000Z",
      givenAt: "2026-08-14T10:05:00.000Z",
      amount: course.doseAmount,
    });
    expect(doseA.occurrenceKey).not.toBe(doseB.occurrenceKey);

    clock.advance(CLEAR_QUARANTINE_MS);
    await reconcile(engineA, engineB);

    // Documented behaviour, not a bug: W5's *online* guard catches this case
    // with a grace-window proximity test at logging time, but reconciliation
    // deliberately does not, because collapsing two rows that are not
    // provably the same occurrence would mean silently hiding a real dose a
    // user actually recorded. Both stay live, on both devices.
    const liveOnA = liveDoseEvents(await deviceA.listDoseEvents({ courseId: course.id }));
    const liveOnB = liveDoseEvents(await deviceB.listDoseEvents({ courseId: course.id }));
    const idsA = new Set(liveOnA.map((e) => e.id));
    const idsB = new Set(liveOnB.map((e) => e.id));
    expect(idsA.has(doseA.id) && idsA.has(doseB.id)).toBe(true);
    expect(idsB.has(doseA.id) && idsB.has(doseB.id)).toBe(true);
  });
});
