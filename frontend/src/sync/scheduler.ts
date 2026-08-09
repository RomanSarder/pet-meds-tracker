// W9-DESIGN §D6 — polls every 30s while online; on failure, exponential
// backoff 1s → 2s → 4s → … capped at 5 min, reset on success; syncs
// immediately on the `online` event and on `visibilitychange` → visible. A
// failed sync is never surfaced to the user — offline is the normal case,
// not an error state. Every timer comes from the injected `timers` object;
// no bare `setTimeout` anywhere in this file.
import type { Clock } from "@/domain";
import type { SyncEngine, SyncScheduler, SyncStatus, Timers } from "./types";

const POLL_INTERVAL_MS = 30_000;
const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;

export interface CreateSyncSchedulerOptions {
  engine: SyncEngine;
  /**
   * Accepted for signature parity with `createSyncEngine` and to keep the
   * door open for clock-driven scheduling decisions later; nothing in this
   * scheduler currently reads an instant off it — every delay it schedules
   * is relative (`timers.setTimeout(fn, ms)`), not absolute.
   */
  clock: Clock;
  timers: Timers;
}

export function createSyncScheduler({ engine, timers }: CreateSyncSchedulerOptions): SyncScheduler {
  let status: SyncStatus = "idle";
  let started = false;
  let timerHandle: unknown = null;
  let backoffMs: number | null = null;

  function clearPending(): void {
    if (timerHandle !== null) {
      timers.clearTimeout(timerHandle);
      timerHandle = null;
    }
  }

  function scheduleNext(delayMs: number): void {
    clearPending();
    timerHandle = timers.setTimeout(() => {
      void runCycle();
    }, delayMs);
  }

  async function runCycle(): Promise<void> {
    // An `online`/`visibilitychange` trigger firing while a cycle is
    // already in flight should not start a second, overlapping one — the
    // one in flight will reschedule (or back off) when it settles.
    if (status === "syncing") return;
    status = "syncing";
    try {
      await engine.syncOnce();
      backoffMs = null;
      status = "idle";
      scheduleNext(POLL_INTERVAL_MS);
    } catch {
      backoffMs = backoffMs === null ? BACKOFF_INITIAL_MS : Math.min(backoffMs * 2, BACKOFF_MAX_MS);
      status = "backoff";
      scheduleNext(backoffMs);
    }
  }

  function runNow(): void {
    clearPending();
    void runCycle();
  }

  function handleOnline(): void {
    runNow();
  }

  function handleVisibilityChange(): void {
    if (document.visibilityState === "visible") runNow();
  }

  function start(): void {
    if (started) return;
    started = true;
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    runNow();
  }

  function stop(): void {
    started = false;
    status = "idle";
    backoffMs = null;
    clearPending();
    window.removeEventListener("online", handleOnline);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  }

  return { start, stop };
}
