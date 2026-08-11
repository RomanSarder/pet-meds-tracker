// The top-level acceptance tests for `startNotifications()` (W10-CONTRACT.md
// `index.ts`): it must never throw, never leave a promise rejected, never log,
// and — the whole point of "degrade silently" — the app must keep rendering
// and behaving normally regardless of what the browser supports.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { occurrenceKeyFor } from "@/domain";
import type { Course, DoseEvent, Household, User } from "@/domain";
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
  window.localStorage.clear();
}

/**
 * `armPermissionRequest` attaches its `pointerup`/`keydown` listeners to
 * `document` (the default target `startNotifications()` uses — it has no
 * way to inject another one), and never detaches them unless an ask
 * actually happens. Left alone, a test whose gate never fires an ask (e.g.
 * "not prompted") leaks its listener onto the shared jsdom `document` for
 * every later test in this file, which would then also react to THEIR
 * `gesture()` dispatches. This captures exactly the listeners a block of
 * code attaches to `document` and removes them again, so each test's
 * `startNotifications()` call is fully self-contained.
 */
function captureDocumentGestureListeners(): () => void {
  const captured: Array<{ type: string; listener: EventListenerOrEventListenerObject }> = [];
  const realAdd = document.addEventListener.bind(document);
  const addSpy = vi
    .spyOn(document, "addEventListener")
    .mockImplementation((type, listener, options) => {
      if ((type === "pointerup" || type === "keydown") && listener) {
        captured.push({ type, listener: listener as EventListenerOrEventListenerObject });
      }
      realAdd(type, listener as EventListenerOrEventListenerObject, options);
    });
  return () => {
    addSpy.mockRestore();
    for (const { type, listener } of captured) {
      document.removeEventListener(type, listener);
    }
  };
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
function installFullSupport(
  permission: "default" | "granted" | "denied",
): ReturnType<typeof vi.fn> {
  const requestPermission = vi.fn().mockResolvedValue(permission);
  setNotification({ permission, requestPermission });
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
  return requestPermission;
}

/** `armPermissionRequest` defaults its listener target to `document` when
 *  `startNotifications()` calls it (no explicit `target` is passed). */
function gesture(): void {
  document.dispatchEvent(new Event("pointerup"));
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
    const releaseListeners = captureDocumentGestureListeners();

    try {
      expect(() => startNotifications()).not.toThrow();
      await flush();
    } finally {
      vi.clearAllTimers();
      releaseListeners();
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

describe("startNotifications — Fix 4: the permission gate requires expressed intent", () => {
  const HOUSEHOLD: Household = {
    id: "hh-fix4",
    name: "Home",
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-06-01T09:00:00.000Z",
    deletedAt: null,
  };

  function selfUser(): User {
    return {
      id: "u-self",
      householdId: HOUSEHOLD.id,
      email: null,
      displayName: "Newcomer",
      tint: 1,
      isSelf: true,
      joinedAt: "2026-08-01T09:00:00.000Z",
      createdAt: "2026-08-01T09:00:00.000Z",
      updatedAt: "2026-08-01T09:00:00.000Z",
      deletedAt: null,
    };
  }

  function activeCourse(): Course {
    return {
      id: "c-fix4",
      petId: "p-fix4",
      medicationId: "m-fix4",
      doseAmount: 1,
      doseUnit: "ml",
      instructions: null,
      schedule: { kind: "fixedTimes", times: ["08:00"] },
      startDate: "2026-08-01",
      endDate: null,
      status: "active",
      notes: null,
      resumedAt: null,
      createdAt: "2026-08-01T09:00:00.000Z",
      updatedAt: "2026-08-01T09:00:00.000Z",
      deletedAt: null,
    };
  }

  /** Someone ELSE in the household set this course up and has been logging
   *  it — the current actor has never written anything. */
  function otherActorsDoseEvent(): DoseEvent {
    return {
      id: "d-fix4",
      courseId: "c-fix4",
      scheduledFor: null,
      status: "given",
      loggedAt: "2026-08-08T06:00:00.000Z",
      givenAt: "2026-08-08T06:00:00.000Z",
      amount: 1,
      note: null,
      occurrenceKey: "c-fix4|-",
      supersedesId: null,
      actorId: "u-someone-else",
      createdAt: "2026-08-08T06:00:00.000Z",
      updatedAt: "2026-08-08T06:00:00.000Z",
      deletedAt: null,
    };
  }

  function fix4Repo(): Repo {
    return createMemoryRepo({
      household: HOUSEHOLD,
      users: [selfUser()],
      pets: [],
      medications: [],
      courses: [activeCourse()],
      doseEvents: [otherActorsDoseEvent()],
      stockAdjustments: [],
      joinCodes: [],
    });
  }

  it("does NOT prompt a user with an active course but no writes of their own, however many gestures they make", async () => {
    const fix4RepoInstance = fix4Repo();
    setRepo(fix4RepoInstance);
    const requestPermission = installFullSupport("default");
    const releaseListeners = captureDocumentGestureListeners();

    try {
      startNotifications();
      await flush();

      // Several gestures, not just one — proves this is not a timing fluke.
      for (let i = 0; i < 4; i += 1) {
        gesture();
        await flush();
      }

      expect(requestPermission).not.toHaveBeenCalled();
    } finally {
      releaseListeners();
    }
  });

  it("prompts on the next gesture right after this actor logs their first dose", async () => {
    const fix4RepoInstance = fix4Repo();
    setRepo(fix4RepoInstance);
    const requestPermission = installFullSupport("default");
    const releaseListeners = captureDocumentGestureListeners();

    try {
      startNotifications();
      await flush();

      // Not prompted yet — same refusal as above, so the success below is
      // not vacuous.
      gesture();
      await flush();
      expect(requestPermission).not.toHaveBeenCalled();

      // The actor logs their own first dose against the existing course.
      // `scheduledFor` distinct from `otherActorsDoseEvent()`'s own (also
      // `null`) — the dedup guard now keys on `scheduledFor` unconditionally
      // including `null`, so two `null` events on the same course would
      // otherwise collide as the same occurrence regardless of `givenAt`.
      // Irrelevant to what this test actually checks (permission-prompt
      // timing), so any distinct value does.
      await fix4RepoInstance.logDose({
        courseId: "c-fix4",
        status: "given",
        scheduledFor: "2026-08-08T07:00:00.000Z",
        amount: 1,
      });

      gesture();
      await flush();

      expect(requestPermission).toHaveBeenCalledTimes(1);
    } finally {
      releaseListeners();
    }
  });
});
