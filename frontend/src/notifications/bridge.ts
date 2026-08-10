/**
 * The page side of the worker: registering it, asking it to show a
 * notification, and listening for the action it reports back.
 *
 * Nothing here consults the ledger — `showNotification` is a dumb pipe.
 * `scheduler.ts`'s `ledger.claim()` is the one call site that decides
 * whether a notification is shown at all (see `ledger.ts`).
 */
import { silently, silentlyAsync } from "./support";
import { isActionMessage, type ActionMessage } from "./protocol";
import type { NotificationSpec } from "./types";
import { currentTranslator } from "@/i18n/current";

/**
 * TS's bundled `lib.dom.d.ts` does not type `NotificationOptions.actions` (or
 * a `NotificationAction` interface) even though every browser that supports
 * notification action buttons accepts it — see
 * https://github.com/microsoft/TypeScript/issues/28633. `actions` is ignored
 * by browsers that do not support it, which is fine and must not be worked
 * around some other way.
 */
interface NotificationOptionsWithActions extends NotificationOptions {
  actions?: Array<{ action: string; title: string }>;
}

export async function registerNotificationWorker(): Promise<ServiceWorkerRegistration | undefined> {
  return silentlyAsync(async () => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return undefined;
    return navigator.serviceWorker.register("/sw.js", { scope: "/" });
  });
}

export async function showNotification(spec: NotificationSpec): Promise<boolean> {
  const shown = await silentlyAsync(async () => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
    const registration = await navigator.serviceWorker.ready;
    if (!registration || typeof registration.showNotification !== "function") return false;
    // Spoken by the OS, so fully user-facing (COMMON brief). Built outside
    // React, hence `currentTranslator()` rather than a `Translator` param —
    // same rule as `notifications/copy.ts`.
    const tr = currentTranslator();
    const options: NotificationOptionsWithActions = {
      tag: spec.tag,
      data: spec.dose,
      requireInteraction: false,
      actions: [
        { action: "give", title: tr.t("notifications.action.give") },
        { action: "snooze", title: tr.t("notifications.action.snooze") },
      ],
    };
    await registration.showNotification(spec.title, options);
    return true;
  });
  return shown ?? false;
}

export function onNotificationAction(handler: (m: ActionMessage) => void): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return () => {};
  }

  const listener = (event: MessageEvent): void => {
    silently(() => {
      if (isActionMessage(event.data)) {
        handler(event.data);
      }
    });
  };

  const attached = silently(() => {
    navigator.serviceWorker.addEventListener("message", listener);
    return true;
  });
  if (!attached) return () => {};

  return () =>
    silently(() => {
      navigator.serviceWorker.removeEventListener("message", listener);
    });
}
