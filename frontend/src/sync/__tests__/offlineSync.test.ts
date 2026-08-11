// W-session-lifecycle (design §D8): `sync/scheduler.ts` already catches every
// `syncOnce()` rejection and converts it to backoff, and nothing routes sync
// through react-query, so no sync failure reaches the user today. This file
// asserts, not changes, that behaviour — a regression lock so a future
// refactor cannot start surfacing a sync failure to the user by accident.
// Read `sync/scheduler.ts` and `sync/__tests__/scheduler.test.ts` first: this
// file follows the same fake-timer harness so a test never races real
// wall-clock time, and does not touch `sync/**` source.
import { afterEach, describe, expect, it, vi } from "vitest";
import { setRepo } from "@/data";
import { createMemoryRepo } from "@/data/memoryRepo";
import { clearSessionEstablished, markSessionEstablished } from "@/shared/session";
import { createSyncEngine } from "../engine";
import { createSyncScheduler } from "../scheduler";
import type { SyncEngine, SyncTransport, Timers } from "../types";
import { createControllableClock } from "./testSupport";

// Identical shape to the fake timer queue in `scheduler.test.ts` — kept local
// rather than exported/shared, since that file documents it is the fixture
// for scheduler-specific delay assertions and this file only needs "does a
// timer get scheduled", not the exact backoff sequence (already covered
// there).
function createFakeTimers() {
  let nextId = 1;
  const scheduled = new Map<number, { fn: () => void; ms: number }>();

  const timers: Timers = {
    setTimeout: (fn, ms) => {
      const id = nextId++;
      scheduled.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (handle) => {
      scheduled.delete(handle as number);
    },
  };

  async function flush(): Promise<void> {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  }

  return {
    timers,
    pendingCount(): number {
      return scheduled.size;
    },
    lastDelay(): number | undefined {
      return Array.from(scheduled.values()).at(-1)?.ms;
    },
    settle: flush,
  };
}

const offlineTransport: SyncTransport = {
  push: () => Promise.reject(new Error("offline")),
  pull: () => Promise.reject(new Error("offline")),
};

describe("offline sync (D8 regression lock)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    clearSessionEstablished();
  });

  it("syncOnce() rejects honestly when push/pull fail offline — the engine reports failure rather than swallowing it", async () => {
    const clock = createControllableClock("2026-08-10T00:00:00.000Z");
    const repo = createMemoryRepo();
    const engine = createSyncEngine({ repo, transport: offlineTransport, clock });

    // Confirms the premise the rest of this file locks in: `syncOnce()`
    // itself rejects. Swallowing the failure is the SCHEDULER's job
    // (design §D8), not the engine's.
    await expect(engine.syncOnce()).rejects.toThrow();
  });

  it("a rejecting syncOnce surfaces nothing and does not reject out of the scheduler, even repeatedly", async () => {
    const fake = createFakeTimers();
    const clock = createControllableClock("2026-08-10T00:00:00.000Z");
    const repo = createMemoryRepo();
    const engine = createSyncEngine({ repo, transport: offlineTransport, clock });

    const scheduler = createSyncScheduler({ engine, clock, timers: fake.timers });
    expect(() => scheduler.start()).not.toThrow();
    await fake.settle();

    // Backed off and rescheduled — not stuck, not thrown, not surfaced to
    // any caller. `scheduler.start()` returns `void`; there is nothing for
    // a failure to reject *out of* except an unhandled rejection, which
    // vitest would fail this test on if one occurred.
    expect(fake.pendingCount()).toBe(1);
    expect(fake.lastDelay()).toBe(1_000);

    scheduler.stop();
  });

  it("a scheduler whose engine always fails never throws on repeated start/stop cycles", async () => {
    const fake = createFakeTimers();
    const clock = createControllableClock("2026-08-10T00:00:00.000Z");
    const alwaysFails: SyncEngine = { syncOnce: () => Promise.reject(new Error("offline")) };
    const scheduler = createSyncScheduler({ engine: alwaysFails, clock, timers: fake.timers });

    for (let i = 0; i < 3; i += 1) {
      expect(() => scheduler.start()).not.toThrow();
      await fake.settle();
      expect(fake.pendingCount()).toBe(1);
      scheduler.stop();
    }
  });

  it("startBackgroundSync() — the one export main.tsx calls — never throws synchronously and never surfaces an offline rejection", async () => {
    vi.useFakeTimers();
    setRepo(createMemoryRepo());
    // Background sync only runs for an established session; without this the
    // start below would return before building an engine and this test would
    // assert nothing about the offline chain it exists to lock in.
    markSessionEstablished();
    // Every fetch fails the way it would offline: apiClient wraps this in a
    // NetworkError, httpTransport's push/pull reject, and syncOnce rejects —
    // exactly the chain the rest of this file locks in as swallowed.
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const { startBackgroundSync } = await import("../index");
    expect(() => startBackgroundSync()).not.toThrow();

    // Let the fire-and-forget first cycle (and its reschedule) settle under
    // fake time without ever touching a real wall-clock timer.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_000);
  });
});
