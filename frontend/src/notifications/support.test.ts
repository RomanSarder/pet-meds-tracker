import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canShowNotifications,
  notificationsSupported,
  permissionState,
  silently,
  silentlyAsync,
} from "./support";

// jsdom does not implement Notification, navigator.serviceWorker or
// ServiceWorkerRegistration at all by default, so every test here installs
// exactly the globals it needs and restores the originals afterwards —
// nothing leaks between tests or into other test files in this suite.

const originalNotification = (globalThis as { Notification?: unknown }).Notification;
const originalServiceWorkerRegistration = (
  globalThis as { ServiceWorkerRegistration?: unknown }
).ServiceWorkerRegistration;
const originalServiceWorkerDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "serviceWorker",
);

function setNotification(value: unknown): void {
  (globalThis as { Notification?: unknown }).Notification = value;
}

function setServiceWorkerRegistration(value: unknown): void {
  (globalThis as { ServiceWorkerRegistration?: unknown }).ServiceWorkerRegistration = value;
}

function setNavigatorServiceWorker(value: unknown): void {
  Object.defineProperty(navigator, "serviceWorker", {
    value,
    configurable: true,
    writable: true,
  });
}

function restoreAll(): void {
  setNotification(originalNotification);
  setServiceWorkerRegistration(originalServiceWorkerRegistration);
  if (originalServiceWorkerDescriptor) {
    Object.defineProperty(navigator, "serviceWorker", originalServiceWorkerDescriptor);
  } else {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  }
}

/** Installs a fully-supported trio of globals: Notification, a
 *  navigator.serviceWorker and a ServiceWorkerRegistration whose prototype
 *  carries showNotification. Individual tests then knock one out. */
function installFullSupport(permission: "default" | "granted" | "denied" = "default"): void {
  setNotification({ permission, requestPermission: vi.fn() });
  setNavigatorServiceWorker({});
  class FakeRegistration {
    showNotification(): void {}
  }
  setServiceWorkerRegistration(FakeRegistration);
}

afterEach(() => {
  restoreAll();
});

describe("notificationsSupported", () => {
  it("is true when Notification, navigator.serviceWorker and ServiceWorkerRegistration.prototype.showNotification are all present", () => {
    installFullSupport();
    expect(notificationsSupported()).toBe(true);
  });

  it("is false when Notification is undefined", () => {
    installFullSupport();
    setNotification(undefined);
    expect(notificationsSupported()).toBe(false);
  });

  it("is false when navigator has no serviceWorker", () => {
    installFullSupport();
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    expect(notificationsSupported()).toBe(false);
  });

  it("is false when ServiceWorkerRegistration.prototype has no showNotification", () => {
    installFullSupport();
    class BareRegistration {}
    setServiceWorkerRegistration(BareRegistration);
    expect(notificationsSupported()).toBe(false);
  });
});

describe("permissionState", () => {
  it("returns 'unsupported' rather than throwing when support is missing", () => {
    setNotification(undefined);
    expect(() => permissionState()).not.toThrow();
    expect(permissionState()).toBe("unsupported");
  });

  it("returns Notification.permission when supported", () => {
    installFullSupport("granted");
    expect(permissionState()).toBe("granted");
  });
});

describe("canShowNotifications", () => {
  it("is true only when supported and permission is granted", () => {
    installFullSupport("granted");
    expect(canShowNotifications()).toBe(true);
  });

  it("is false when supported but permission is default", () => {
    installFullSupport("default");
    expect(canShowNotifications()).toBe(false);
  });

  it("is false when unsupported", () => {
    setNotification(undefined);
    expect(canShowNotifications()).toBe(false);
  });
});

describe("silently / silentlyAsync — silence is absolute", () => {
  it("silently swallows a throw and returns undefined, without logging", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Prove the non-throwing path first: fn's return value passes through.
    expect(silently(() => 42)).toBe(42);

    expect(
      silently(() => {
        throw new Error("boom");
      }),
    ).toBeUndefined();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("silentlyAsync swallows a synchronous throw inside the async fn, without logging", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      silentlyAsync(async () => {
        throw new Error("boom");
      }),
    ).resolves.toBeUndefined();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("silentlyAsync swallows a rejected promise, without logging", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Prove the non-rejecting path first: the resolved value passes through.
    await expect(silentlyAsync(() => Promise.resolve("ok"))).resolves.toBe("ok");

    await expect(silentlyAsync(() => Promise.reject(new Error("nope")))).resolves.toBeUndefined();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });
});
