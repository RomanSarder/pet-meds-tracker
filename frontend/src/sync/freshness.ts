// "Has this device heard from the household yet, since it was loaded?"
//
// One boolean, deliberately in-memory and deliberately NOT persisted: it must
// go back to false on every page load, because that is exactly the window it
// exists to describe — the seconds between the app rendering from IndexedDB
// and the first `/sync/pull` landing, during which local data can be a whole
// day behind what other members have already recorded.
//
// Reading a stale local store is normally harmless — the screen repaints when
// the pull lands (`sync/index.ts` invalidates every query on a cycle that
// changed anything). WRITING from one is not: `useDailySweep` derives `missed`
// DoseEvents from the absence of a logged dose, and absence is precisely the
// thing an unfinished pull cannot be trusted about. A missed row written that
// way is permanent (the ledger is append-only and `applyRemoteChanges`
// inserts rather than overwrites), so the sweep waits for this flag.
//
// Only `startBackgroundSync`'s engine wrapper sets it, and only after a full
// `syncOnce()` — push, then pull to exhaustion — has resolved.
let syncedSinceLoad = false;

/** True once a full sync cycle has completed since this page load. */
export function hasSyncedSinceLoad(): boolean {
  return syncedSinceLoad;
}

export function markSyncedSinceLoad(): void {
  syncedSinceLoad = true;
}

/**
 * Back to "never synced". Called on sign-out — the next session's local store
 * may be a different account's entirely — and by tests between cases.
 */
export function resetSyncedSinceLoad(): void {
  syncedSinceLoad = false;
}
