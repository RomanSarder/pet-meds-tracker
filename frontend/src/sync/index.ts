// W9-DESIGN §D6/§D6b — the one export `main.tsx` is allowed to call.
// Fire-and-forget: must never throw synchronously and must never be
// awaited, or cold start regresses and the local-first guarantee dies at
// the front door.
import { getRepo } from "@/data";
import { getClock } from "@/domain";
import { createSyncEngine } from "./engine";
import { createSyncScheduler } from "./scheduler";
import { httpTransport } from "./transport";
import type { Timers } from "./types";

const windowTimers: Timers = {
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as ReturnType<typeof window.setTimeout>),
};

export function startBackgroundSync(): void {
  try {
    const clock = getClock();
    const engine = createSyncEngine({ repo: getRepo(), transport: httpTransport(), clock });
    const scheduler = createSyncScheduler({ engine, clock, timers: windowTimers });
    scheduler.start();
  } catch {
    // A background sync that fails to even start must never take the rest
    // of the app down with it (W9-DESIGN §D6b).
  }
}
