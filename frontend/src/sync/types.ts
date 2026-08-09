// W9-DESIGN §D6 — the shapes the rest of `frontend/src/sync/**` is built
// against. Nothing here is React, and nothing here is imported by any
// component, hook, context or screen: sync is a peer of the UI, not part of
// it.
import type { SyncPayload, SyncPullResult, SyncPushResult } from "@pet-tracker/shared";

/**
 * The network boundary, injected everywhere it is used. `httpTransport()`
 * (transport.ts) is the production implementation over `shared/api.ts`'s
 * `apiClient`; tests supply a fake in-memory server instead — there is no
 * `msw` in this repo and none is being added.
 */
export interface SyncTransport {
  push(changes: SyncPayload): Promise<SyncPushResult>;
  pull(cursor: string | null): Promise<SyncPullResult>;
}

/** `createSyncEngine(...)`'s return shape (engine.ts). */
export interface SyncEngine {
  /**
   * Collect local changes → push → pull from `syncCursor` →
   * `repo.applyRemoteChanges()` → advance `syncCursor` and `lastPushedAt`
   * (W9-DESIGN §D6). Rejects on any transport failure; a failed sync is
   * never surfaced to the user (offline is the normal case), which is the
   * scheduler's job, not this one's — `syncOnce()` reports failure honestly
   * by rejecting, and the scheduler is what swallows it.
   */
  syncOnce(): Promise<void>;
}

/**
 * The timer boundary, injected everywhere it is used. Real usage
 * (`index.ts`) wires this to `window.setTimeout`/`clearTimeout`; tests
 * supply a fake queue they can advance by hand — no bare `setTimeout`
 * anywhere in scheduling or backoff (W9-DESIGN §D6).
 */
export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/**
 * Observability only — nothing currently reads this off the scheduler
 * (there is no UI surface to show it to), but the states a sync cycle can be
 * in are exactly these three, and naming them here keeps `scheduler.ts`'s
 * internal state machine self-documenting.
 */
export type SyncStatus = "idle" | "syncing" | "backoff";

/** `createSyncScheduler(...)`'s return shape (scheduler.ts). */
export interface SyncScheduler {
  start(): void;
  stop(): void;
}
