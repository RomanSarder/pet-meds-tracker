/**
 * The single registration point for slice 10 (notifications). `main.tsx`
 * calls `startNotifications()` once, exactly like `startBackgroundSync()` —
 * see W10-CONTRACT.md `index.ts`.
 *
 * Order:
 *   1. `drainPendingAction` — ALWAYS, even when notifications are
 *      unsupported: a Give that arrived by URL must still log.
 *   2. Return if `!notificationsSupported()`.
 *   3. `registerNotificationWorker()`.
 *   4. `onNotificationAction` wired to `performGive`/`performSnooze`.
 *   5. `armPermissionRequest`, with `hasExpressedIntent` reading, from the
 *      repo, whether an active course exists AND the current actor has
 *      logged a dose (Fix 4 — see `hasExpressedIntent` below).
 *   6. Create and `start()` the scheduler with the real (injected) clock and
 *      the window's own timers.
 *
 * `startNotifications()` itself never throws, never returns a rejected
 * promise, and never blocks first render — it returns synchronously; every
 * step after (1) runs fire-and-forget inside `silentlyAsync`.
 */
import { getClock } from "@/domain";
import { getRepo } from "@/data";
import { performGive, performSnooze, type ActionDeps } from "./actions";
import { onNotificationAction, registerNotificationWorker, showNotification } from "./bridge";
import { AlertLedger } from "./ledger";
import { drainPendingAction } from "./pendingAction";
import { armPermissionRequest } from "./permission";
import { createNotificationScheduler } from "./scheduler";
import { canShowNotifications, notificationsSupported, silentlyAsync } from "./support";

/**
 * SPEC §6.9 / permission.ts (Fix 4): only ask a user who has actually
 * expressed intent to manage medication — not merely a user for whom data
 * exists. Requires BOTH (a) at least one active course exists (there is
 * something to be reminded about), AND (b) the current actor has authored
 * at least one relevant write. `Course` carries no `actorId` (see
 * `domain/types.ts` — only `DoseEvent` and `CourseEvent` are attributed), so
 * condition (b) is evaluated as "the current actor has logged at least one
 * `DoseEvent`". A user who has only joined a household that already has
 * active courses set up by somebody else fails (b) and is not prompted.
 */
async function hasExpressedIntent(): Promise<boolean> {
  const repo = getRepo();
  const courses = await repo.listCourses({ status: ["active"] });
  if (courses.length === 0) return false;
  const [actorId, events] = await Promise.all([repo.currentActorId(), repo.listDoseEvents({})]);
  return events.some((event) => event.actorId === actorId);
}

export function startNotifications(): void {
  const ledger = new AlertLedger();
  const deps: ActionDeps = { ledger, clock: getClock() };

  // Runs regardless of what happens below — even on an unsupported browser,
  // a Give that arrived via a cold-start URL still has to log.
  void silentlyAsync(() => drainPendingAction(deps));

  if (!notificationsSupported()) return;

  void silentlyAsync(async () => {
    await registerNotificationWorker();

    onNotificationAction((message) => {
      void silentlyAsync(async () => {
        if (message.action === "give") {
          await performGive(message.dose, deps);
        } else {
          await performSnooze(message.dose, deps);
        }
      });
    });

    armPermissionRequest({ hasExpressedIntent });

    const scheduler = createNotificationScheduler({
      clock: getClock(),
      ledger,
      show: showNotification,
      timers: { setTimeout: window.setTimeout, clearTimeout: window.clearTimeout },
      canNotify: canShowNotifications,
    });
    scheduler.start();
  });
}
