// W9-DESIGN §D6/§D6b — the one export `main.tsx` is allowed to call.
// Fire-and-forget: must never throw synchronously and must never be
// awaited, or cold start regresses and the local-first guarantee dies at
// the front door.
//
// Background sync only runs for a session that has been established at
// least once (`shared/session.ts`). Before that there is nothing to sync —
// every `/sync/pull` is a guaranteed 401 — so a signed-out visitor sitting
// on /sign-in must produce no sync traffic at all. `startBackgroundSync()`
// is therefore called twice: once at boot (for the returning user, whose
// flag is already set, including offline) and once from the router guard
// the moment a session is confirmed. It is idempotent — a second call while
// a scheduler is already running is a no-op.
import { getRepo } from "@/data";
import { getClock } from "@/domain";
import { ApiError } from "@/shared/api";
import { isSessionEstablished } from "@/shared/session";
import { createSyncEngine } from "./engine";
import { createSyncScheduler } from "./scheduler";
import { httpTransport } from "./transport";
import type { SyncScheduler, Timers } from "./types";

const windowTimers: Timers = {
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as ReturnType<typeof window.setTimeout>),
};

let running: SyncScheduler | null = null;

function isSessionRevoked(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function startBackgroundSync(): void {
  try {
    if (!isSessionEstablished()) return;
    if (running !== null) {
      // `scheduler.start()` is a no-op while already started, and revives
      // the same instance if it stopped itself on a 401 — so this is both
      // the idempotence path and the "signed back in" path.
      running.start();
      return;
    }
    const clock = getClock();
    const engine = createSyncEngine({ repo: getRepo(), transport: httpTransport(), clock });
    const scheduler = createSyncScheduler({
      engine,
      clock,
      timers: windowTimers,
      isSessionRevoked,
    });
    running = scheduler;
    scheduler.start();
  } catch {
    // A background sync that fails to even start must never take the rest
    // of the app down with it (W9-DESIGN §D6b).
  }
}

/**
 * Called on sign-out and on a 401 discovered anywhere else in the app. Safe
 * to call when nothing is running.
 */
export function stopBackgroundSync(): void {
  try {
    running?.stop();
  } catch {
    // Same reasoning as above: teardown must never break the caller's flow
    // (sign-out, a session-revoked redirect).
  } finally {
    running = null;
  }
}
