// `frontend/public/sw.js` is plain JS outside the TS project (no imports, no
// build step — see the file's own header). It is tested here by reading its
// source and evaluating it against a stubbed `self`/`clients`, so its
// handler LOGIC gets real coverage without adding a dependency or touching
// vitest.config.ts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MSG_ACTION, parseActionUrl } from "./protocol";
import type { DoseRef } from "./types";

const SW_SOURCE = readFileSync(
  path.resolve(__dirname, "../../public/sw.js"),
  "utf-8",
);

interface FakeClient {
  postMessage: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
}

interface FakeResponse {
  status: number;
  type: string;
  clone: () => FakeResponse;
}

/** A minimal same-origin, successful `Response` stand-in — the shape `sw.js` inspects. */
function makeResponse(overrides: Partial<Omit<FakeResponse, "clone">> = {}): FakeResponse {
  const response: FakeResponse = {
    status: 200,
    type: "basic",
    clone: () => makeResponse(overrides),
    ...overrides,
  };
  return response;
}

interface FakeCache {
  match: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  add: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

interface FakeCacheStorage {
  open: ReturnType<typeof vi.fn>;
  match: ReturnType<typeof vi.fn>;
  keys: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

function cacheKeyFor(requestOrUrl: string | { url: string }): string {
  return typeof requestOrUrl === "string" ? requestOrUrl : requestOrUrl.url;
}

/**
 * An in-memory stand-in for the CacheStorage/Cache API: `store` maps cache
 * name -> (url -> response). `failAddUrls` lets a test simulate a single
 * precache asset failing without the whole `cache.add` chain rejecting.
 */
function makeFakeCaches(options: { failAddUrls?: string[] } = {}): {
  caches: FakeCacheStorage;
  store: Map<string, Map<string, FakeResponse>>;
} {
  const store = new Map<string, Map<string, FakeResponse>>();
  const failAdd = new Set(options.failAddUrls ?? []);

  function mapFor(name: string): Map<string, FakeResponse> {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name)!;
  }

  function makeCache(name: string): FakeCache {
    const map = mapFor(name);
    return {
      match: vi.fn((req: string | { url: string }) => Promise.resolve(map.get(cacheKeyFor(req)))),
      put: vi.fn((req: string | { url: string }, res: FakeResponse) => {
        map.set(cacheKeyFor(req), res);
        return Promise.resolve(undefined);
      }),
      add: vi.fn((req: string | { url: string }) => {
        const key = cacheKeyFor(req);
        if (failAdd.has(key)) return Promise.reject(new Error(`precache failed: ${key}`));
        map.set(key, makeResponse());
        return Promise.resolve(undefined);
      }),
      delete: vi.fn((req: string | { url: string }) => Promise.resolve(map.delete(cacheKeyFor(req)))),
    };
  }

  const caches: FakeCacheStorage = {
    open: vi.fn((name: string) => Promise.resolve(makeCache(name))),
    match: vi.fn((req: string | { url: string }) => {
      for (const map of store.values()) {
        const hit = map.get(cacheKeyFor(req));
        if (hit) return Promise.resolve(hit);
      }
      return Promise.resolve(undefined);
    }),
    keys: vi.fn(() => Promise.resolve(Array.from(store.keys()))),
    delete: vi.fn((name: string) => Promise.resolve(store.delete(name))),
  };

  return { caches, store };
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
  caches: FakeCacheStorage;
  fetch: ReturnType<typeof vi.fn>;
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

interface LoadWorkerOptions {
  caches?: FakeCacheStorage;
  fetch?: ReturnType<typeof vi.fn>;
}

/** Loads a fresh copy of the worker (its handlers are closures over this `self`). */
function loadWorker(
  matchAllResult: FakeClient[] = [],
  options: LoadWorkerOptions = {},
): { self: FakeSelf; handlers: Map<string, Handler> } {
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
    caches: options.caches ?? makeFakeCaches().caches,
    fetch: options.fetch ?? vi.fn().mockResolvedValue(makeResponse()),
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

interface FakeRequest {
  method: string;
  mode?: string;
  url: string;
}

interface FakeFetchEvent {
  request: FakeRequest;
  respondWith: ReturnType<typeof vi.fn>;
}

/** Mirrors `makeEvent`, but for the `fetch` event's `respondWith(promise)` contract. */
function makeFetchEvent(request: FakeRequest): { event: FakeFetchEvent; responded: () => Promise<unknown> | undefined } {
  let capture: Promise<unknown> | undefined;
  const respondWith = vi.fn((p: Promise<unknown>) => {
    capture = p;
  });
  const event: FakeFetchEvent = { request, respondWith };
  return { event, responded: () => capture };
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

const CACHE_NAME = "petmeds-shell-v2";
const PRECACHE_URLS = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/apple-touch-icon.png", "/reduced-motion.css"];

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

describe("install: precache the app shell", () => {
  it("opens the versioned cache and adds every precache URL", async () => {
    const { caches, store } = makeFakeCaches();
    const { self, handlers } = loadWorker([], { caches });
    const event = makeEvent();

    handlers.get("install")!(event);
    await event.settled;

    expect(self.caches.open).toHaveBeenCalledWith(CACHE_NAME);
    const cached = store.get(CACHE_NAME);
    expect(cached).toBeDefined();
    for (const url of PRECACHE_URLS) {
      expect(cached!.has(url)).toBe(true);
    }
    assertSilent();
  });

  it("a single failing precache asset does not reject install", async () => {
    const { caches, store } = makeFakeCaches({ failAddUrls: ["/icon-512.png"] });
    const { handlers } = loadWorker([], { caches });
    const event = makeEvent();

    expect(() => handlers.get("install")!(event)).not.toThrow();
    // If precacheShell's rejection weren't swallowed, this await would throw.
    await event.settled;

    const cached = store.get(CACHE_NAME);
    expect(cached?.has("/icon-512.png")).toBe(false);
    expect(cached?.has("/")).toBe(true);
    assertSilent();
  });
});

describe("activate: evicts stale caches", () => {
  it("deletes every cache whose name is not CACHE_NAME, keeps the current one", async () => {
    const { caches, store } = makeFakeCaches();
    store.set(CACHE_NAME, new Map());
    store.set("petmeds-shell-v0", new Map());
    store.set("some-other-cache", new Map());
    const { handlers } = loadWorker([], { caches });
    const event = makeEvent();

    handlers.get("activate")!(event);
    await event.settled;

    expect(store.has(CACHE_NAME)).toBe(true);
    expect(store.has("petmeds-shell-v0")).toBe(false);
    expect(store.has("some-other-cache")).toBe(false);
    assertSilent();
  });
});

describe("fetch: strategy", () => {
  it("ignores non-GET requests entirely", () => {
    const { self, handlers } = loadWorker();
    const { event, responded } = makeFetchEvent({ method: "POST", url: "https://example.com/api/doses" });

    handlers.get("fetch")!(event as unknown as FakeEvent);

    expect(event.respondWith).not.toHaveBeenCalled();
    expect(responded()).toBeUndefined();
    expect(self.fetch).not.toHaveBeenCalled();
    assertSilent();
  });

  it("ignores cross-origin requests", () => {
    const { handlers } = loadWorker();
    const { event } = makeFetchEvent({ method: "GET", url: "https://cdn.other.com/thing.js" });

    handlers.get("fetch")!(event as unknown as FakeEvent);

    expect(event.respondWith).not.toHaveBeenCalled();
    assertSilent();
  });

  it("never handles /api requests", () => {
    const { handlers } = loadWorker();
    const { event } = makeFetchEvent({ method: "GET", url: "https://example.com/api/doses", mode: "same-origin" });

    handlers.get("fetch")!(event as unknown as FakeEvent);

    expect(event.respondWith).not.toHaveBeenCalled();
    assertSilent();
  });

  it("navigation: network-first — a successful fetch is served and refreshes the cache", async () => {
    const { caches, store } = makeFakeCaches();
    const response = makeResponse({ status: 200, type: "basic" });
    const fetchMock = vi.fn().mockResolvedValue(response);
    const { self, handlers } = loadWorker([], { caches, fetch: fetchMock });
    const { event, responded } = makeFetchEvent({ method: "GET", url: "https://example.com/", mode: "navigate" });

    handlers.get("fetch")!(event as unknown as FakeEvent);
    const result = await responded();

    expect(self.fetch).toHaveBeenCalledTimes(1);
    expect(result).toBe(response);
    await Promise.resolve(); // let the un-awaited cache.put chain settle
    await Promise.resolve();
    expect(store.get(CACHE_NAME)?.get("https://example.com/")).toBeDefined();
    assertSilent();
  });

  it("navigation: falls back to the cached shell document when the network rejects", async () => {
    const { caches, store } = makeFakeCaches();
    const shellResponse = makeResponse({ status: 200, type: "basic" });
    store.set(CACHE_NAME, new Map([["/", shellResponse]]));
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    const { handlers } = loadWorker([], { caches, fetch: fetchMock });
    const { event, responded } = makeFetchEvent({ method: "GET", url: "https://example.com/", mode: "navigate" });

    handlers.get("fetch")!(event as unknown as FakeEvent);
    const result = await responded();

    expect(result).toBe(shellResponse);
    assertSilent();
  });

  it("hashed /assets/... requests: cache-first, serving the cached copy without touching the network", async () => {
    const { caches, store } = makeFakeCaches();
    const cachedAsset = makeResponse({ status: 200, type: "basic" });
    store.set(CACHE_NAME, new Map([["https://example.com/assets/index-abc123.js", cachedAsset]]));
    const fetchMock = vi.fn();
    const { self, handlers } = loadWorker([], { caches, fetch: fetchMock });
    const { event, responded } = makeFetchEvent({ method: "GET", url: "https://example.com/assets/index-abc123.js", mode: "same-origin" });

    handlers.get("fetch")!(event as unknown as FakeEvent);
    const result = await responded();

    expect(result).toBe(cachedAsset);
    expect(self.fetch).not.toHaveBeenCalled();
    assertSilent();
  });

  it("hashed /assets/... requests: on a cache miss, fetches and populates the cache", async () => {
    const { caches, store } = makeFakeCaches();
    const response = makeResponse({ status: 200, type: "basic" });
    const fetchMock = vi.fn().mockResolvedValue(response);
    const { handlers } = loadWorker([], { caches, fetch: fetchMock });
    const url = "https://example.com/assets/index-def456.css";
    const { event, responded } = makeFetchEvent({ method: "GET", url, mode: "same-origin" });

    handlers.get("fetch")!(event as unknown as FakeEvent);
    const result = await responded();

    expect(result).toBe(response);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.get(CACHE_NAME)?.get(url)).toBeDefined();
    assertSilent();
  });

  it("never caches a non-200 or non-basic response", async () => {
    const { caches, store } = makeFakeCaches();
    const opaqueResponse = makeResponse({ status: 0, type: "opaque" });
    const fetchMock = vi.fn().mockResolvedValue(opaqueResponse);
    const { handlers } = loadWorker([], { caches, fetch: fetchMock });
    const url = "https://example.com/assets/index-ghi789.css";
    const { event, responded } = makeFetchEvent({ method: "GET", url, mode: "same-origin" });

    handlers.get("fetch")!(event as unknown as FakeEvent);
    await responded();
    await Promise.resolve();
    await Promise.resolve();

    expect(store.get(CACHE_NAME)?.get(url)).toBeUndefined();
    assertSilent();
  });

  // Regression: precaching a shell asset is useless on its own. These URLs
  // are not under `/assets/` and are not navigations, so before
  // `isPrecachedAsset` existed the fetch handler let them straight through to
  // the network — precached, but never served from the cache, so they still
  // failed with the network down.
  it.each(["/manifest.webmanifest", "/reduced-motion.css", "/icon-192.png"])(
    "precached shell asset %s is served from the cache without touching the network",
    async (pathname) => {
      const { caches, store } = makeFakeCaches();
      const url = `https://example.com${pathname}`;
      const cached = makeResponse({ status: 200, type: "basic" });
      store.set(CACHE_NAME, new Map([[url, cached]]));
      const fetchMock = vi.fn();
      const { self, handlers } = loadWorker([], { caches, fetch: fetchMock });
      const { event, responded } = makeFetchEvent({ method: "GET", url, mode: "same-origin" });

      handlers.get("fetch")!(event as unknown as FakeEvent);
      const result = await responded();

      expect(result).toBe(cached);
      expect(self.fetch).not.toHaveBeenCalled();
      assertSilent();
    },
  );

  it("the precached document itself stays network-first: '/' is not diverted to cache-first", async () => {
    const { caches, store } = makeFakeCaches();
    const stale = makeResponse({ status: 200, type: "basic" });
    store.set(CACHE_NAME, new Map([["https://example.com/", stale]]));
    const fresh = makeResponse({ status: 200, type: "basic" });
    const fetchMock = vi.fn().mockResolvedValue(fresh);
    const { handlers } = loadWorker([], { caches, fetch: fetchMock });
    const { event, responded } = makeFetchEvent({ method: "GET", url: "https://example.com/", mode: "navigate" });

    handlers.get("fetch")!(event as unknown as FakeEvent);
    const result = await responded();

    // The network copy wins, not the cached one — otherwise an update could
    // never reach a user whose cache already holds a document.
    expect(result).toBe(fresh);
    assertSilent();
  });

  it("leaves everything not GET/same-origin/navigate/hashed-asset untouched (no respondWith)", () => {
    const { handlers } = loadWorker();
    const { event } = makeFetchEvent({ method: "GET", url: "https://example.com/some/other/page", mode: "same-origin" });

    handlers.get("fetch")!(event as unknown as FakeEvent);

    expect(event.respondWith).not.toHaveBeenCalled();
    assertSilent();
  });
});

describe("slice 10 invariant still holds after slice 11's fetch handler", () => {
  it("registers no \"message\" handler and never calls showNotification, even once fetch handling exists", async () => {
    const { self, handlers } = loadWorker();

    expect(handlers.has("message")).toBe(false);
    expect(handlers.has("fetch")).toBe(true);

    const { event, responded } = makeFetchEvent({ method: "GET", url: "https://example.com/", mode: "navigate" });
    handlers.get("fetch")!(event as unknown as FakeEvent);
    await responded();

    expect(self.registration.showNotification).not.toHaveBeenCalled();
    assertSilent();
  });
});

describe("message handling (Fix 3 — removed)", () => {
  it("registers no \"message\" handler at all: showNotification is unreachable from a worker message", () => {
    const { self, handlers } = loadWorker();

    // The worker used to have an unguarded `petmeds/show` message handler
    // that called `self.registration.showNotification(...)` directly — a
    // second, unguarded call site next to the one enforcement point
    // (`AlertLedger.claim()` in the page) the whole design depends on.
    // Nothing ever sent that message (`bridge.ts` calls
    // `registration.showNotification` from the page itself), so it was dead
    // code and has been deleted. Prove it stays deleted: no "message"
    // listener is registered at all.
    expect(handlers.has("message")).toBe(false);
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
