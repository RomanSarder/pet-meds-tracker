// The correction to A3's original fix: an earlier version of `syncOnce()`
// filtered ledger rows down to only ones whose `actorId` was this device's
// own id or one of its own aliases, on the theory that the server would
// otherwise reattribute a foreign-authored row to whoever pushes it. True at
// the time, but it meant a row whose true author's own device never comes
// back online was stranded in this ONE device's IndexedDB forever, invisible
// to the rest of the household — worse than mis-attribution, for a
// medication tracker: a dose nobody can see was given invites a duplicate.
//
// The fix moved to the server (`backend/src/sync/index.ts`'s
// `allowedActorIdsForHousehold`/`pushTable`, covered in
// `backend/src/sync/index.test.ts`): it trusts a client-supplied `actorId`
// verbatim when it names a member of the CALLER's OWN household. This file
// proves the CLIENT half of that: `syncOnce()` no longer filters such rows
// out of the push payload at all — every row past the watermark and
// quarantine goes out, regardless of whose `actorId` it carries.
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryRepo } from "@/data";
import { setClock, systemClock } from "@/domain";
import type { SyncPayload } from "@pet-tracker/shared";
import type { SyncTransport } from "../types";
import { createSyncEngine } from "../engine";
import { createControllableClock, createFakeServer } from "./testSupport";

const CLEAR_QUARANTINE_MS = 36_000;

afterEach(() => {
  setClock(systemClock);
});

/** Wraps a transport to record every payload actually handed to `push()`. */
function recordingTransport(inner: SyncTransport): { transport: SyncTransport; pushed: SyncPayload[] } {
  const pushed: SyncPayload[] = [];
  const transport: SyncTransport = {
    push: async (changes) => {
      pushed.push(changes);
      return inner.push(changes);
    },
    pull: (cursor) => inner.pull(cursor),
  };
  return { transport, pushed };
}

describe("a merge-imported foreign-authored row is pushed, not stranded", () => {
  it("goes out in the push payload with its original author's actorId untouched", async () => {
    const clock = createControllableClock("2026-08-09T00:00:00.000Z");
    setClock(clock);
    const { transport: fakeTransport } = createFakeServer();
    const { transport, pushed } = recordingTransport(fakeTransport);

    const repo = createMemoryRepo();
    const [course] = (await repo.listCourses()).filter((c) => c.schedule.kind === "fixedTimes");
    const FOREIGN_AUTHOR_ID = "f0000000-0000-4000-8000-00000000ff01";

    // Simulates a merge-mode restore of ANOTHER member's own backup, which
    // legitimately brings in their own already-logged dose, still stamped
    // with THEIR actorId — `Repo.applyRemoteChanges` is the one write path
    // that never stamps `currentActorId()` (see its doc comment).
    const now = clock.now().toISOString();
    const foreignDose = {
      id: "f0000000-0000-4000-8000-00000000ff02",
      courseId: course.id,
      scheduledFor: null,
      status: "given" as const,
      loggedAt: now,
      givenAt: now,
      amount: course.doseAmount,
      note: null,
      occurrenceKey: `${course.id}|-`,
      supersedesId: null,
      actorId: FOREIGN_AUTHOR_ID,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await repo.applyRemoteChanges({ doseEvents: [foreignDose] });

    clock.advance(CLEAR_QUARANTINE_MS);

    const engine = createSyncEngine({ repo, transport, clock });
    await engine.syncOnce();

    const pushedDose = pushed.flatMap((p) => p.doseEvents ?? []).find((e) => e.id === foreignDose.id);
    // Not stranded: it left this device in the outgoing payload at all.
    expect(pushedDose).toBeDefined();
    // Arrives with its true author intact — the client no longer decides
    // this row isn't "its to push" and silently drops it.
    expect(pushedDose!.actorId).toBe(FOREIGN_AUTHOR_ID);
  });
});
