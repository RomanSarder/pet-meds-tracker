/**
 * Capability detection and the silence seam. Every other module in this
 * package routes anything that touches a browser notification API through
 * `silently`/`silentlyAsync`, so a missing API, a denied permission, or a
 * throwing `localStorage` never surfaces as a console line, a thrown error
 * or an unhandled rejection. See W10-CONTRACT.md — "Silence is absolute."
 */

/** `Notification.permission`, widened with the "not available at all" case. */
export type NotificationPermissionState = "granted" | "denied" | "default" | "unsupported";

/**
 * True only when all three of the following hold, each guarded so a missing
 * global throws nothing: `Notification` exists, `navigator.serviceWorker`
 * exists, and `ServiceWorkerRegistration.prototype.showNotification` exists.
 * The third check is what actually matters — some browsers expose the first
 * two without full notification support — so all three are required.
 */
export function notificationsSupported(): boolean {
  return (
    silently(() => {
      if (typeof Notification === "undefined") return false;
      if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
      if (typeof ServiceWorkerRegistration === "undefined") return false;
      if (!("showNotification" in ServiceWorkerRegistration.prototype)) return false;
      return true;
    }) ?? false
  );
}

/** `"unsupported"` rather than throwing when `notificationsSupported()` is false. */
export function permissionState(): NotificationPermissionState {
  return (
    silently((): NotificationPermissionState => {
      if (!notificationsSupported()) return "unsupported";
      return Notification.permission;
    }) ?? "unsupported"
  );
}

export function canShowNotifications(): boolean {
  return (
    silently(() => notificationsSupported() && permissionState() === "granted") ?? false
  );
}

/** Runs `fn`, swallowing any synchronous throw. Returns `undefined` on failure. */
export function silently<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/** Runs `fn`, swallowing a synchronous throw or a rejected promise. */
export async function silentlyAsync<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}
