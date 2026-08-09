import { afterEach, describe, expect, it, vi } from "vitest";
import { armPermissionRequest } from "./permission";
import type { LedgerStorage } from "./ledger";

// Mirrors support.test.ts's approach: install exactly the globals this
// suite needs (Notification, navigator.serviceWorker,
// ServiceWorkerRegistration) and restore them afterwards.

const originalNotification = (globalThis as { Notification?: unknown }).Notification;
const originalServiceWorkerRegistration = (
  globalThis as { ServiceWorkerRegistration?: unknown }
).ServiceWorkerRegistration;
const originalServiceWorkerDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "serviceWorker",
);

function restoreAll(): void {
  (globalThis as { Notification?: unknown }).Notification = originalNotification;
  (globalThis as { ServiceWorkerRegistration?: unknown }).ServiceWorkerRegistration =
    originalServiceWorkerRegistration;
  if (originalServiceWorkerDescriptor) {
    Object.defineProperty(navigator, "serviceWorker", originalServiceWorkerDescriptor);
  } else {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  }
}

afterEach(() => {
  restoreAll();
});

/** Installs full notification support with a controllable
 *  Notification.permission and a spy-able requestPermission. */
function installSupport(permission: "default" | "granted" | "denied" = "default") {
  const requestPermission = vi.fn().mockResolvedValue("granted");
  (globalThis as { Notification?: unknown }).Notification = { permission, requestPermission };
  Object.defineProperty(navigator, "serviceWorker", {
    value: {},
    configurable: true,
    writable: true,
  });
  class FakeRegistration {
    showNotification(): void {}
  }
  (globalThis as { ServiceWorkerRegistration?: unknown }).ServiceWorkerRegistration =
    FakeRegistration;
  return requestPermission;
}

function memoryStorage(): LedgerStorage {
  let value: string | null = null;
  return {
    read: () => value,
    write: (v: string) => {
      value = v;
    },
  };
}

function gesture(target: EventTarget): void {
  target.dispatchEvent(new Event("pointerup"));
}

describe("armPermissionRequest", () => {
  it("requests nothing merely on arming", () => {
    const requestPermission = installSupport("default");
    const target = new EventTarget();
    armPermissionRequest({
      hasActiveCourse: () => Promise.resolve(true),
      target,
      storage: memoryStorage(),
    });
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("requests once on the first gesture when there is an active course and permission is default", async () => {
    const requestPermission = installSupport("default");
    const target = new EventTarget();
    armPermissionRequest({
      hasActiveCourse: () => Promise.resolve(true),
      target,
      storage: memoryStorage(),
    });

    gesture(target);
    // requestPermission is awaited inside the handler's async body.
    await vi.waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(1));
  });

  it("never requests again on a second gesture", async () => {
    const requestPermission = installSupport("default");
    const target = new EventTarget();
    armPermissionRequest({
      hasActiveCourse: () => Promise.resolve(true),
      target,
      storage: memoryStorage(),
    });

    gesture(target);
    await vi.waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(1));

    gesture(target);
    gesture(target);
    // Still exactly one call — the listener detached itself after the first.
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("does not request when there is no active course", async () => {
    const requestPermission = installSupport("default");
    const target = new EventTarget();
    const hasActiveCourse = vi.fn().mockResolvedValue(false);
    armPermissionRequest({ hasActiveCourse, target, storage: memoryStorage() });

    gesture(target);
    await vi.waitFor(() => expect(hasActiveCourse).toHaveBeenCalled());

    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("does not latch the asked flag on a gesture with no active course", async () => {
    const requestPermission = installSupport("default");
    const target = new EventTarget();
    const hasActiveCourse = vi.fn().mockResolvedValue(false);
    const storage = memoryStorage();
    armPermissionRequest({ hasActiveCourse, target, storage });

    gesture(target);
    await vi.waitFor(() => expect(hasActiveCourse).toHaveBeenCalledTimes(1));

    expect(requestPermission).not.toHaveBeenCalled();
    expect(storage.read()).toBeNull();
  });

  it("re-evaluates on a LATER gesture once an active course exists, and asks then", async () => {
    const requestPermission = installSupport("default");
    const target = new EventTarget();
    let active = false;
    const hasActiveCourse = vi.fn(() => Promise.resolve(active));
    const storage = memoryStorage();
    armPermissionRequest({ hasActiveCourse, target, storage });

    // First gesture: no course yet — proves the earlier refusal, so the
    // later success below is not vacuous.
    gesture(target);
    await vi.waitFor(() => expect(hasActiveCourse).toHaveBeenCalledTimes(1));
    expect(requestPermission).not.toHaveBeenCalled();
    // Let the handler's in-flight guard finish resetting (it clears on the
    // microtask following hasActiveCourse's resolution) before firing again.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // A course now exists; a later gesture gets a fresh chance because the
    // first one never latched the flag or detached the listener.
    active = true;
    gesture(target);
    await vi.waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(1));
    expect(storage.read()).toBe("1");

    // And a THIRD gesture, after the real ask, never asks again.
    gesture(target);
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("does not request when permission is already granted", async () => {
    const requestPermission = installSupport("granted");
    const target = new EventTarget();
    armPermissionRequest({
      hasActiveCourse: () => Promise.resolve(true),
      target,
      storage: memoryStorage(),
    });

    gesture(target);
    // Give any microtasks a chance to run.
    await Promise.resolve();
    await Promise.resolve();

    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("does not request when permission is already denied", async () => {
    const requestPermission = installSupport("denied");
    const target = new EventTarget();
    armPermissionRequest({
      hasActiveCourse: () => Promise.resolve(true),
      target,
      storage: memoryStorage(),
    });

    gesture(target);
    await Promise.resolve();
    await Promise.resolve();

    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("does not request when it has asked before (the persisted flag)", async () => {
    const requestPermission = installSupport("default");
    const target = new EventTarget();
    const storage = memoryStorage();
    storage.write("1"); // simulate a previous session having already asked

    armPermissionRequest({ hasActiveCourse: () => Promise.resolve(true), target, storage });

    gesture(target);
    await Promise.resolve();
    await Promise.resolve();

    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("proves the flag actually gates the request: without it, the same setup would have asked", async () => {
    const requestPermission = installSupport("default");
    const target = new EventTarget();
    const storage = memoryStorage(); // no pre-existing flag this time

    armPermissionRequest({ hasActiveCourse: () => Promise.resolve(true), target, storage });

    gesture(target);
    await vi.waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(1));
  });

  it("throws nothing when Notification is undefined", async () => {
    (globalThis as { Notification?: unknown }).Notification = undefined;
    const target = new EventTarget();

    expect(() =>
      armPermissionRequest({
        hasActiveCourse: () => Promise.resolve(true),
        target,
        storage: memoryStorage(),
      }),
    ).not.toThrow();

    expect(() => gesture(target)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });
});
