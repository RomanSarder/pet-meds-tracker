/**
 * Asking for notification permission at the right moment, and never before.
 * SPEC §6.9: "no permission prompts before they are needed." There is no
 * prompt on load — only `armPermissionRequest` below, wired up from
 * `index.ts`.
 */
import type { LedgerStorage } from "./ledger";
import { notificationsSupported, permissionState, silently, silentlyAsync } from "./support";

const ASKED_KEY = "petmeds.notifications.asked";

/** Same read/write shape as `LedgerStorage`, but keyed for the one-shot
 *  "have we ever asked" flag rather than the alert ledger. */
function askedFlagStorage(): LedgerStorage {
  return {
    read(): string | null {
      return silently(() => window.localStorage.getItem(ASKED_KEY)) ?? null;
    },
    write(value: string): void {
      silently(() => window.localStorage.setItem(ASKED_KEY, value));
    },
  };
}

function hasAskedBefore(storage: LedgerStorage): boolean {
  return (silently(() => storage.read()) ?? null) === "1";
}

function markAsked(storage: LedgerStorage): void {
  silently(() => storage.write("1"));
}

export interface PermissionArmOptions {
  hasActiveCourse: () => Promise<boolean>;
  /** Defaults to `document`. */
  target?: EventTarget;
  /** For the "already asked" flag. Defaults to `localStorage`. */
  storage?: LedgerStorage;
}

/**
 * Attaches one-shot `pointerup` and `keydown` listeners. On the first
 * gesture — ever, whichever fires first — it asks
 * `Notification.requestPermission()` only if all of: notifications are
 * supported, `permissionState() === "default"`, we have never asked before
 * (the persisted flag), and `await hasActiveCourse()` is true. It then
 * records the flag and detaches, whatever the answer. It never asks twice.
 *
 * Rationale: the gesture requirement is what several browsers demand anyway
 * — calling `requestPermission()` outside a user gesture is silently
 * ignored or auto-denied in some engines — and the active-course condition
 * means we only ask a user who has actually set up a medication schedule,
 * the population for whom a reminder is the point. A user who has only
 * signed in is never asked.
 *
 * Every step is wrapped so nothing can throw or log. Returns a disarm
 * function that detaches the listeners early (e.g. on unmount).
 */
export function armPermissionRequest(opts: PermissionArmOptions): () => void {
  const target = opts.target ?? (typeof document !== "undefined" ? document : undefined);
  const storage = opts.storage ?? askedFlagStorage();
  let disarmed = false;

  const disarm = (): void => {
    if (disarmed) return;
    disarmed = true;
    silently(() => target?.removeEventListener("pointerup", onGesture));
    silently(() => target?.removeEventListener("keydown", onGesture));
  };

  const onGesture = (): void => {
    // One-shot: detach immediately so a second gesture can never re-enter
    // this handler, regardless of what the checks below decide.
    disarm();

    void silentlyAsync(async () => {
      if (!notificationsSupported()) return;
      if (permissionState() !== "default") return;
      if (hasAskedBefore(storage)) return;
      const active = await opts.hasActiveCourse();
      if (!active) return;
      await Notification.requestPermission();
    }).then(() => markAsked(storage));
  };

  silently(() => target?.addEventListener("pointerup", onGesture, { once: true }));
  silently(() => target?.addEventListener("keydown", onGesture, { once: true }));

  return disarm;
}
