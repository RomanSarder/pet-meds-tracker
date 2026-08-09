// `frontend/public/sw.js` is plain JS outside the TS project (no imports, no
// build step — see the file's own header). It is tested here by reading its
// source and evaluating it against a stubbed `self`/`clients`, so its
// handler LOGIC gets real coverage without adding a dependency or touching
// vitest.config.ts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MSG_ACTION, MSG_SHOW, parseActionUrl } from "./protocol";
import type { DoseRef } from "./types";

const SW_SOURCE = readFileSync(
  path.resolve(__dirname, "../../public/sw.js"),
  "utf-8",
);

interface FakeClient {
  postMessage: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
}

interface FakeSelf {
  skipWaiting: ReturnType<typeof vi.fn>;
  clients: {
    claim: ReturnType<typeof vi.fn>;
    matchAll: ReturnType<typeof vi.fn>;
    openWindow: ReturnType<typeof vi.fn>;
  };
  registration: { showNotification: ReturnType<typeof vi.fn> };
  location: { origin: string };
}

type Handler = (event: FakeEvent) => unknown;

interface FakeEvent {
  waitUntil: (p: Promise<unknown>) => void;
  data?: unknown;
  notification?: { data: unknown; close: ReturnType<typeof vi.fn> };
  action?: string;
  settled: Promise<unknown>;
}

function makeEvent(overrides: Partial<FakeEvent> = {}): FakeEvent {
  let capture: Promise<unknown> = Promise.resolve();
  const event = {
    waitUntil: (p: Promise<unknown>) => {
      capture = p;
    },
    ...overrides,
  } as FakeEvent;
  Object.defineProperty(event, "settled", { get: () => capture });
  return event;
}

/** Loads a fresh copy of the worker (its handlers are closures over this `self`). */
function loadWorker(matchAllResult: FakeClient[] = []): { self: FakeSelf; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const self: FakeSelf = {
    skipWaiting: vi.fn(),
    clients: {
      claim: vi.fn().mockResolvedValue(undefined),
      matchAll: vi.fn().mockResolvedValue(matchAllResult),
      openWindow: vi.fn().mockResolvedValue(undefined),
    },
    registration: { showNotification: vi.fn().mockResolvedValue(undefined) },
    location: { origin: "https://example.com" },
  };
  const fakeAddEventListener = (type: string, handler: Handler): void => {
    handlers.set(type, handler);
  };
  // eslint-disable-next-line no-new-func -- this is how a plain-JS, no-import
  // service worker file gets exercised without a build step.
  const run = new Function("self", SW_SOURCE) as (s: unknown) => void;
  run({ ...self, addEventListener: fakeAddEventListener });
  return { self, handlers };
}

let consoleSpies: Array<ReturnType<typeof vi.spyOn>>;

beforeEach(() => {
  consoleSpies = [
    vi.spyOn(console, "error").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
    vi.spyOn(console, "log").mockImplementation(() => {}),
  ];
});

afterEach(() => {
  vi.restoreAllMocks();
});

function assertSilent(): void {
  for (const spy of consoleSpies) {
    expect(spy).not.toHaveBeenCalled();
  }
}

const DOSE: DoseRef = {
  occurrenceKey: "course-1|2026-08-08T07:00:00.000Z",
  courseId: "course-1",
  scheduledFor: "2026-08-08T07:00:00.000Z",
  amount: 0.4,
};

describe("install / activate", () => {
  it("skips waiting and waits on clients.claim, without throwing or logging", async () => {
    const { self, handlers } = loadWorker();

    expect(() => handlers.get("install")!(makeEvent())).not.toThrow();
    expect(self.skipWaiting).toHaveBeenCalledTimes(1);

    const event = makeEvent();
    expect(() => handlers.get("activate")!(event)).not.toThrow();
    await event.settled;
    expect(self.clients.claim).toHaveBeenCalledTimes(1);
    assertSilent();
  });
});

describe("message (MSG_SHOW)", () => {
  it("calls showNotification with the spec's title, tag, data and the two actions", async () => {
    const { self, handlers } = loadWorker();
    const spec = {
      title: "Clover · Metacam 0.4 ml due now",
      tag: DOSE.occurrenceKey,
      reason: "due",
      dose: DOSE,
    };
    const event = makeEvent({ data: { type: MSG_SHOW, spec } });

    handlers.get("message")!(event);
    await event.settled;

    expect(self.registration.showNotification).toHaveBeenCalledWith(spec.title, {
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

  it("ignores a malformed message without throwing", async () => {
    const { self, handlers } = loadWorker();

    expect(() => handlers.get("message")!(makeEvent({ data: { type: "something/else" } }))).not.toThrow();
    expect(() => handlers.get("message")!(makeEvent({ data: null }))).not.toThrow();
    expect(() => handlers.get("message")!(makeEvent({}))).not.toThrow();

    expect(self.registration.showNotification).not.toHaveBeenCalled();
    assertSilent();
  });
});

describe("notificationclick", () => {
  it("closes the notification for every action variant", async () => {
    for (const action of ["give", "snooze", ""]) {
      const { handlers } = loadWorker([]);
      const notification = { data: DOSE, close: vi.fn() };
      const event = makeEvent({ notification, action });

      handlers.get("notificationclick")!(event);
      await event.settled;

      expect(notification.close).toHaveBeenCalledTimes(1);
    }
    assertSilent();
  });

  it("with a client open, posts the ActionMessage and does NOT focus, for an action button", async () => {
    for (const action of ["give", "snooze"] as const) {
      const client: FakeClient = { postMessage: vi.fn(), focus: vi.fn() };
      const { handlers } = loadWorker([client]);
      const notification = { data: DOSE, close: vi.fn() };
      const event = makeEvent({ notification, action });

      handlers.get("notificationclick")!(event);
      await event.settled;

      expect(client.postMessage).toHaveBeenCalledWith({ type: MSG_ACTION, action, dose: DOSE });
      expect(client.focus).not.toHaveBeenCalled();
    }
    assertSilent();
  });

  it("with a client open, focuses (and does not postMessage) for a plain body click", async () => {
    const client: FakeClient = { postMessage: vi.fn(), focus: vi.fn() };
    const { handlers } = loadWorker([client]);
    const notification = { data: DOSE, close: vi.fn() };
    const event = makeEvent({ notification, action: "" });

    handlers.get("notificationclick")!(event);
    await event.settled;

    expect(client.focus).toHaveBeenCalledTimes(1);
    expect(client.postMessage).not.toHaveBeenCalled();
    assertSilent();
  });

  it("with no client and action give, calls openWindow with a URL that parses back to the same dose", async () => {
    const { self, handlers } = loadWorker([]);
    const notification = { data: DOSE, close: vi.fn() };
    const event = makeEvent({ notification, action: "give" });

    handlers.get("notificationclick")!(event);
    await event.settled;

    expect(self.clients.openWindow).toHaveBeenCalledTimes(1);
    const url = self.clients.openWindow.mock.calls[0][0] as string;
    const parsed = parseActionUrl(new URL(url).search);
    expect(parsed).toEqual({ action: "give", dose: DOSE });
    assertSilent();
  });

  it("with no client and action snooze, opens nothing", async () => {
    const { self, handlers } = loadWorker([]);
    const notification = { data: DOSE, close: vi.fn() };
    const event = makeEvent({ notification, action: "snooze" });

    handlers.get("notificationclick")!(event);
    await event.settled;

    expect(self.clients.openWindow).not.toHaveBeenCalled();
    assertSilent();
  });

  it("with no client and a plain body click, opens nothing and does not throw", async () => {
    const { self, handlers } = loadWorker([]);
    const notification = { data: DOSE, close: vi.fn() };
    const event = makeEvent({ notification, action: "" });

    expect(() => handlers.get("notificationclick")!(event)).not.toThrow();
    await event.settled;

    expect(self.clients.openWindow).not.toHaveBeenCalled();
    assertSilent();
  });
});
