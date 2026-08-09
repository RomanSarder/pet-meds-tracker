// The top-level acceptance tests for `startNotifications()` (W10-CONTRACT.md
// `index.ts`): it must never throw, never leave a promise rejected, never log,
// and — the whole point of "degrade silently" — the app must keep rendering
// and behaving normally regardless of what the browser supports.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { occurrenceKeyFor } from "@/domain";
import { setRepo, type Repo } from "@/data";
import { createMemoryRepo } from "@/data/memoryRepo";
import { renderWithProviders } from "@/test/renderWithProviders";
import { TodayPage } from "@/features/today/TodayPage";
import { startNotifications } from "./index";
import { buildActionUrl } from "./protocol";

const originalNotification = (globalThis as { Notification?: unknown }).Notification;
const originalServiceWorkerRegistration = (
  globalThis as { ServiceWorkerRegistration?: unknown }
).ServiceWorkerRegistration;
const originalServiceWorkerDescriptor = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
const originalLocation = window.location.href;

function restoreAll(): void {
  (globalThis as { Notification?: unknown }).Notification = originalNotification;
  (globalThis as { ServiceWorkerRegistration?: unknown }).ServiceWorkerRegistration =
    originalServiceWorkerRegistration;
  if (originalServiceWorkerDescriptor) {
    Object.defineProperty(navigator, "serviceWorker", originalServiceWorkerDescriptor);
  } else {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  }
  window.history.replaceState(null, "", originalLocation);
}

function setNotification(value: unknown): void {
  (globalThis as { Notification?: unknown }).Notification = value;
}

function setServiceWorkerRegistration(value: unknown): void {
  (globalThis as { ServiceWorkerRegistration?: unknown }).ServiceWorkerRegistration = value;
}

function setNavigatorServiceWorker(value: unknown): void {
  Object.defineProperty(navigator, "serviceWorker", { value, configurable: true, writable: true });
}

/** Full, working support: Notification, a service worker container capable
 *  of registering/listening, and a registration prototype with `showNotification`. */
function installFullSupport(permission: "default" | "granted" | "denied"): void {
  setNotification({ permission, requestPermission: vi.fn().mockResolvedValue(permission) });
  setNavigatorServiceWorker({
    register: vi.fn().mockResolvedValue({ scope: "/" }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    ready: Promise.resolve({ showNotification: vi.fn().mockResolvedValue(undefined) }),
  });
  class FakeRegistration {
    showNotification(): void {}
  }
  setServiceWorkerRegistration(FakeRegistration);
}

function spyConsole(): Array<ReturnType<typeof vi.spyOn>> {
  return [
    vi.spyOn(console, "error").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
    vi.spyOn(console, "log").mockImplementation(() => {}),
  ];
}

function assertSilent(spies: Array<ReturnType<typeof vi.spyOn>>): void {
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
}

async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

let repo: Repo;

beforeEach(() => {
  repo = createMemoryRepo();
  setRepo(repo);
});

afterEach(() => {
  restoreAll();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("startNotifications — silent degradation", () => {
  it("degrades silently when Notification is undefined", async () => {
    setNotification(undefined);
    const spies = spyConsole();

    expect(() => startNotifications()).not.toThrow();
    await flush();

    assertSilent(spies);
  });

  it("degrades silently when permission is denied", async () => {
    installFullSupport("denied");
    const spies = spyConsole();
    // Prevent the scheduler's real 30s poll timer from lingering past this test.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    try {
      expect(() => startNotifications()).not.toThrow();
      await flush();
    } finally {
      vi.clearAllTimers();
    }

    assertSilent(spies);
  });

  it("degrades silently when navigator.serviceWorker is absent", async () => {
    setNotification({ permission: "default", requestPermission: vi.fn() });
    setNavigatorServiceWorker(undefined);
    const spies = spyConsole();

    expect(() => startNotifications()).not.toThrow();
    await flush();

    assertSilent(spies);
  });

  it("the app still renders and behaves normally when Notification is undefined", async () => {
    setNotification(undefined);
    const spies = spyConsole();

    expect(() => startNotifications()).not.toThrow();
    await flush();

    renderWithProviders(<TodayPage />, { repo, route: "/today" });
    expect(await screen.findByRole("button", { name: "Open Clover" })).toBeInTheDocument();

    assertSilent(spies);
  });
});

describe("startNotifications — pending action always drains", () => {
  it("logs a Give that arrived by URL even when notifications are unsupported", async () => {
    setNotification(undefined);
    const courses = await repo.listCourses();
    const course = courses.find((c) => c.schedule.kind === "fixedTimes" && c.schedule.times.includes("08:00"))!;
    const scheduledFor = "2026-08-08T07:00:00.000Z";
    const dose = {
      occurrenceKey: occurrenceKeyFor(course.id, scheduledFor),
      courseId: course.id,
      scheduledFor,
      amount: course.doseAmount,
    };
    const url = buildActionUrl(window.location.origin, "give", dose);
    window.history.replaceState(null, "", new URL(url).pathname + new URL(url).search);

    const before = await repo.listDoseEvents({ courseId: course.id });
    startNotifications();
    await flush();

    const after = await repo.listDoseEvents({ courseId: course.id });
    expect(after).toHaveLength(before.length + 1);
    expect(window.location.search).toBe("");
  });
});
