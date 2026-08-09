// W9-DESIGN §D7 item 7 / §D2 — a dose event is not eligible for push until it
// has aged past `UNDO_WINDOW_MS + RETRACT_GRACE_MS` (35s): if a row still
// inside its retract window were pushed and then retracted, the next pull
// would resurrect it, since insert-if-absent has no tombstone to stop it.
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryRepo } from "@/data";
import { setClock, systemClock } from "@/domain";
import type { SyncTransport } from "../types";
import { createSyncEngine } from "../engine";
import { createControllableClock, createFakeServer } from "./testSupport";

afterEach(() => {
  setClock(systemClock);
});

describe("push quarantine", () => {
  it("holds a young dose event back and pushes it once it ages past the window", async () => {
    const clock = createControllableClock("2026-08-09T00:00:00.000Z");
    setClock(clock);
    const { transport: server } = createFakeServer();

    const pushedBatches: Array<Set<string>> = [];
    const transport: SyncTransport = {
      push: async (changes) => {
        pushedBatches.push(new Set((changes.doseEvents ?? []).map((d) => d.id)));
        return server.push(changes);
      },
      pull: (cursor) => server.pull(cursor),
    };

    const device = createMemoryRepo();
    const engine = createSyncEngine({ repo: device, transport, clock });

    const [course] = await device.listCourses();
    const dose = await device.logDose({
      courseId: course.id,
      status: "given",
      scheduledFor: "2026-08-20T08:00:00.000Z",
      givenAt: clock.now().toISOString(),
      amount: course.doseAmount,
    });

    // Synced immediately: the new dose is 0ms old, well inside the window.
    await engine.syncOnce();
    expect(pushedBatches.at(-1)?.has(dose.id)).toBe(false);

    // Still inside the window a few seconds later.
    clock.advance(10_000);
    await engine.syncOnce();
    expect(pushedBatches.at(-1)?.has(dose.id)).toBe(false);

    // Now past UNDO_WINDOW_MS (5s) + RETRACT_GRACE_MS (30s) = 35s.
    clock.advance(26_000);
    await engine.syncOnce();
    expect(pushedBatches.at(-1)?.has(dose.id)).toBe(true);
  });
});
