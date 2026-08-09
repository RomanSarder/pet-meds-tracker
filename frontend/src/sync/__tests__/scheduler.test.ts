// W9-DESIGN §D7 item 5 / §D6 — retry/backoff entirely under an injected
// clock and an injected timers object: no bare `setTimeout` anywhere in
// `scheduler.ts`. A fake `Timers` queue lets the test fire the scheduler's
// next-scheduled callback by hand and inspect the delay it chose, instead of
// racing real wall-clock time.
import { describe, expect, it, vi } from "vitest";
import type { SyncEngine, Timers } from "../types";
import { createSyncScheduler } from "../scheduler";
import { createControllableClock } from "./testSupport";

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
    // The scheduler's `runCycle` awaits exactly one promise
    // (`engine.syncOnce()`) before it schedules its next timer — a handful
    // of microtask turns is enough to let that settle deterministically.
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  }

  return {
    timers,
    /** The delay of whichever timer is currently pending — there is at most one, since
     *  the scheduler always clears its previous one before scheduling the next. */
    lastDelay(): number | undefined {
      const entries = Array.from(scheduled.values());
      return entries.at(-1)?.ms;
    },
    pendingCount(): number {
      return scheduled.size;
    },
    async fireLatest(): Promise<void> {
      const ids = Array.from(scheduled.keys());
      const id = ids.at(-1);
      if (id === undefined) throw new Error("no pending timer to fire");
      const { fn } = scheduled.get(id)!;
      scheduled.delete(id);
      fn();
      await flush();
    },
    async settle(): Promise<void> {
      await flush();
    },
  };
}

function makeEngine(run: () => Promise<void>): SyncEngine {
  return { syncOnce: vi.fn(run) };
}

describe("sync scheduler", () => {
  it("polls every 30s on success, backs off exponentially on failure, and resets on success", async () => {
    const fake = createFakeTimers();
    const clock = createControllableClock("2026-08-09T00:00:00.000Z");

    // fail, fail, fail, succeed, fail — proves both the doubling and that a
    // success resets the sequence rather than continuing to double from
    // wherever it left off.
    const outcomes: Array<"ok" | "fail"> = ["fail", "fail", "fail", "ok", "fail"];
    let call = 0;
    const engine = makeEngine(async () => {
      const outcome = outcomes[call];
      call += 1;
      if (outcome === "fail") throw new Error("offline");
    });

    const scheduler = createSyncScheduler({ engine, clock, timers: fake.timers });
    scheduler.start();
    await fake.settle();

    expect(engine.syncOnce).toHaveBeenCalledTimes(1); // the immediate on-start attempt
    expect(fake.lastDelay()).toBe(1_000); // 1st failure -> 1s

    await fake.fireLatest();
    expect(fake.lastDelay()).toBe(2_000); // 2nd failure -> 2s

    await fake.fireLatest();
    expect(fake.lastDelay()).toBe(4_000); // 3rd failure -> 4s

    await fake.fireLatest();
    expect(fake.lastDelay()).toBe(30_000); // success -> back to the plain poll interval

    await fake.fireLatest();
    expect(fake.lastDelay()).toBe(1_000); // failure after a reset starts at 1s again, not 8s

    scheduler.stop();
  });

  it("caps backoff at 5 minutes and never exceeds it", async () => {
    const fake = createFakeTimers();
    const clock = createControllableClock("2026-08-09T00:00:00.000Z");
    const engine = makeEngine(async () => {
      throw new Error("offline");
    });

    const scheduler = createSyncScheduler({ engine, clock, timers: fake.timers });
    scheduler.start();
    await fake.settle();
    expect(fake.lastDelay()).toBe(1_000);

    let previous = fake.lastDelay()!;
    let sawCap = false;
    for (let i = 0; i < 15; i += 1) {
      await fake.fireLatest();
      const current = fake.lastDelay()!;
      expect(current).toBeLessThanOrEqual(300_000);
      if (current === 300_000) {
        sawCap = true;
        // Doubling would try to exceed the cap; it must stay pinned instead.
        expect(current).not.toBeGreaterThan(previous * 2);
      } else {
        expect(current).toBe(previous * 2);
      }
      previous = current;
    }
    expect(sawCap).toBe(true);

    // One more failure at the cap must not push it past 5 minutes.
    await fake.fireLatest();
    expect(fake.lastDelay()).toBe(300_000);

    scheduler.stop();
  });

  it("a failed sync is swallowed, never rejecting or throwing out of the scheduler", async () => {
    const fake = createFakeTimers();
    const clock = createControllableClock("2026-08-09T00:00:00.000Z");
    const engine = makeEngine(async () => {
      throw new Error("offline");
    });

    const scheduler = createSyncScheduler({ engine, clock, timers: fake.timers });
    expect(() => scheduler.start()).not.toThrow();
    await fake.settle();
    expect(fake.pendingCount()).toBe(1); // backed off and rescheduled, not stuck or crashed
    scheduler.stop();
  });
});
