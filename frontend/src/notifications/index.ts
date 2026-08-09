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
 *   5. `armPermissionRequest`, with `hasActiveCourse` reading active courses
 *      from the repo.
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

/** SPEC §6.9 / permission.ts: only ask a user who has actually set up a course. */
async function hasActiveCourse(): Promise<boolean> {
  const courses = await getRepo().listCourses({ status: ["active"] });
  return courses.length > 0;
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

    armPermissionRequest({ hasActiveCourse });

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
