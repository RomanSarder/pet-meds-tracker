// The page side of the worker. Every failure path here must degrade in
// total silence (SPEC §6.9 / support.ts's "silence is absolute") — each
// `it` that exercises a failure spies on console.error/warn/log and asserts
// none of them fired.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerNotificationWorker, showNotification, onNotificationAction } from "./bridge";
import { MSG_ACTION } from "./protocol";
import type { DoseRef } from "./types";

const DOSE: DoseRef = {
  occurrenceKey: "course-1|2026-08-08T07:00:00.000Z",
  courseId: "course-1",
  scheduledFor: "2026-08-08T07:00:00.000Z",
  amount: 0.4,
};

let originalServiceWorker: ServiceWorkerContainer | undefined;
let consoleSpies: Array<ReturnType<typeof vi.spyOn>>;

beforeEach(() => {
  originalServiceWorker = (navigator as unknown as { serviceWorker?: ServiceWorkerContainer })
    .serviceWorker;
  consoleSpies = [
    vi.spyOn(console, "error").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
    vi.spyOn(console, "log").mockImplementation(() => {}),
  ];
});

afterEach(() => {
  Object.defineProperty(navigator, "serviceWorker", {
    value: originalServiceWorker,
    configurable: true,
  });
  vi.restoreAllMocks();
});

function setServiceWorker(value: unknown): void {
  Object.defineProperty(navigator, "serviceWorker", { value, configurable: true });
}

function assertSilent(): void {
  for (const spy of consoleSpies) {
    expect(spy).not.toHaveBeenCalled();
  }
}

describe("registerNotificationWorker", () => {
  it("returns undefined and does not throw when navigator.serviceWorker is absent", async () => {
    setServiceWorker(undefined);

    await expect(registerNotificationWorker()).resolves.toBeUndefined();
    assertSilent();
  });

  it("returns undefined and does not throw when register rejects", async () => {
    setServiceWorker({
      register: vi.fn().mockRejectedValue(new Error("registration failed")),
    });

    await expect(registerNotificationWorker()).resolves.toBeUndefined();
    assertSilent();
  });

  it("resolves the registration on success", async () => {
    const registration = { scope: "/" };
    const register = vi.fn().mockResolvedValue(registration);
    setServiceWorker({ register });

    await expect(registerNotificationWorker()).resolves.toBe(registration);
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    assertSilent();
  });
});

describe("showNotification", () => {
  const spec = {
    title: "Clover · Metacam 0.4 ml due now",
    tag: DOSE.occurrenceKey,
    reason: "due" as const,
    dose: DOSE,
  };

  it("passes the exact title, tag, data and the two actions, and returns true", async () => {
    const showNotificationFn = vi.fn().mockResolvedValue(undefined);
    setServiceWorker({ ready: Promise.resolve({ showNotification: showNotificationFn }) });

    await expect(showNotification(spec)).resolves.toBe(true);
    expect(showNotificationFn).toHaveBeenCalledWith(spec.title, {
      tag: spec.tag,
      data: spec.dose,
      requireInteraction: false,
      actions: [
        { action: "give", title: "Give" },
        { action: "snooze", title: "Snooze 30 min" },
      ],
    });
    assertSilent();
  });

  it("returns false without throwing when the registration is missing", async () => {
    setServiceWorker({ ready: Promise.resolve(undefined) });

    await expect(showNotification(spec)).resolves.toBe(false);
    assertSilent();
  });

  it("returns false without throwing when showNotification throws", async () => {
    setServiceWorker({
      ready: Promise.resolve({
        showNotification: vi.fn().mockRejectedValue(new Error("nope")),
      }),
    });

    await expect(showNotification(spec)).resolves.toBe(false);
    assertSilent();
  });

  it("returns false without throwing when serviceWorker is absent", async () => {
    setServiceWorker(undefined);

    await expect(showNotification(spec)).resolves.toBe(false);
    assertSilent();
  });
});

describe("onNotificationAction", () => {
  it("delivers a valid message, ignores an invalid one, and unsubscribe stops delivery", async () => {
    const listeners: Array<(event: MessageEvent) => void> = [];
    setServiceWorker({
      addEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
        if (type === "message") listeners.push(listener);
      }),
      removeEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
        if (type === "message") {
          const idx = listeners.indexOf(listener);
          if (idx >= 0) listeners.splice(idx, 1);
        }
      }),
    });

    const handler = vi.fn();
    const unsubscribe = onNotificationAction(handler);

    const validMessage = { type: MSG_ACTION, action: "give" as const, dose: DOSE };
    listeners.forEach((l) => l({ data: validMessage } as MessageEvent));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(validMessage);

    listeners.forEach((l) => l({ data: { garbage: true } } as MessageEvent));
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(listeners).toHaveLength(0);
    assertSilent();
  });

  it("returns a no-op unsubscribe and does not throw when serviceWorker is absent", async () => {
    setServiceWorker(undefined);

    const unsubscribe = onNotificationAction(vi.fn());
    expect(() => unsubscribe()).not.toThrow();
    assertSilent();
  });
});
