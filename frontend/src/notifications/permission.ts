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
 * Attaches `pointerup` and `keydown` listeners that stay armed and
 * re-evaluate on EVERY gesture until an actual ask happens — deliberately
 * not `{ once: true }`. A gesture that arrives before the user has an active
 * course (e.g. tapping around on first run) must not burn the one-shot: it
 * asks `Notification.requestPermission()` only if all of notifications are
 * supported, `permissionState() === "default"`, we have never asked before
 * (the persisted flag), and `await hasActiveCourse()` is true. Only once
 * `requestPermission()` is ABOUT to be called does it record the flag and
 * detach — whatever the answer turns out to be. Any other outcome (no active
 * course yet, already asked, unsupported, not "default") leaves the
 * listeners armed so a later gesture gets a fresh chance. It never asks more
 * than once in total.
 *
 * Rationale: the gesture requirement is what several browsers demand anyway
 * — calling `requestPermission()` outside a user gesture is silently
 * ignored or auto-denied in some engines — and the active-course condition
 * means we only ask a user who has actually set up a medication schedule,
 * the population for whom a reminder is the point. A user who has only
 * signed in is never asked, and — the point of this fix — is not
 * permanently disqualified from ever being asked either: the very next
 * gesture after they create their first course tries again.
 *
 * Every step is wrapped so nothing can throw or log. Returns a disarm
 * function that detaches the listeners early (e.g. on unmount).
 */
export function armPermissionRequest(opts: PermissionArmOptions): () => void {
  const target = opts.target ?? (typeof document !== "undefined" ? document : undefined);
  const storage = opts.storage ?? askedFlagStorage();
  let disarmed = false;
  // Synchronous re-entrancy guard: `hasActiveCourse()` is awaited, so a
  // second gesture arriving while the first is still mid-flight must not
  // race it into asking twice.
  let inFlight = false;

  const disarm = (): void => {
    if (disarmed) return;
    disarmed = true;
    silently(() => target?.removeEventListener("pointerup", onGesture));
    silently(() => target?.removeEventListener("keydown", onGesture));
  };

  const onGesture = (): void => {
    if (disarmed || inFlight) return;
    inFlight = true;

    void silentlyAsync(async () => {
      if (!notificationsSupported()) return;
      if (permissionState() !== "default") return;
      if (hasAskedBefore(storage)) return;
      const active = await opts.hasActiveCourse();
      if (!active) return;
      // An ask is actually about to happen: latch now, before awaiting the
      // prompt itself, so the flag reflects "we asked" rather than "we
      // merely considered it" and a concurrent gesture cannot slip through.
      disarm();
      markAsked(storage);
      await Notification.requestPermission();
    }).then(() => {
      inFlight = false;
    });
  };

  silently(() => target?.addEventListener("pointerup", onGesture));
  silently(() => target?.addEventListener("keydown", onGesture));

  return disarm;
}
