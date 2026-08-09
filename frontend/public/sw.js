// Slice 10 (notifications) service worker.
//
// Plain JS, no imports, no build step — `public/` is served and copied
// verbatim by Vite. The worker only DISPLAYS notifications and BROKERS
// action clicks back to the page; it never schedules anything (the page is
// the only thing that can decide "this dose is due now" without Web Push)
// and it never writes to IndexedDB (the Give write goes through the page's
// repository so the dedup guard and actor stamping apply). See
// `frontend/src/notifications/` for the why.
//
// The literals below are restated from `frontend/src/notifications/protocol.ts`
// (the source of truth) because this file cannot import from `src/`. Keep
// the two in lockstep by hand.
var MSG_ACTION = "petmeds/action";
var ACTION_PARAM = "petmeds_action";
var COURSE_PARAM = "petmeds_course";
var SCHEDULED_PARAM = "petmeds_scheduled";
var AMOUNT_PARAM = "petmeds_amount";

function buildActionUrl(origin, action, dose) {
  var url = new URL("/", origin);
  url.searchParams.set(ACTION_PARAM, action);
  url.searchParams.set(COURSE_PARAM, dose.courseId);
  url.searchParams.set(SCHEDULED_PARAM, dose.scheduledFor === null || dose.scheduledFor === undefined ? "-" : dose.scheduledFor);
  url.searchParams.set(AMOUNT_PARAM, String(dose.amount));
  return url.toString();
}

function noop() {}

// --- handlers ---------------------------------------------------------

function handleInstall(event) {
  self.skipWaiting();
  event.waitUntil(precacheShell());
}

function handleActivate(event) {
  event.waitUntil(Promise.all([self.clients.claim(), deleteStaleCaches()]));
}

/**
 * A client posted the ActionMessage rather than acting on it directly: the
 * write must happen in the page, through the repository, exactly like the
 * Today screen — never here.
 */
function postActionToClient(client, action, dose) {
  client.postMessage({ type: MSG_ACTION, action: action, dose: dose });
}

function handleNotificationClick(event) {
  var notification = event.notification;
  var action = event.action; // "give" | "snooze" | "" for a plain body click
  var dose = notification.data;
  notification.close();

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (clientList) {
        var client = clientList.length > 0 ? clientList[0] : null;

        if (action === "give" || action === "snooze") {
          if (client) {
            // Hand the action to the page; do NOT focus — an action button
            // should not yank the user into the app.
            postActionToClient(client, action, dose);
            return undefined;
          }
          // No page open — the normal case for a notification. Give still
          // has to log, so open one and let it drain the action from the
          // URL (see pendingAction.ts). Snooze with no client just closes:
          // a 30-minutes-later alert needs a live page or a push server,
          // and inventing a second ledger here would break the rule that
          // the ledger has exactly one enforcement point.
          if (action === "give") {
            return self.clients.openWindow(buildActionUrl(self.location.origin, "give", dose));
          }
          return undefined;
        }

        // Plain body click: bring the app forward, no action to report.
        if (client && typeof client.focus === "function") {
          return client.focus();
        }
        return undefined;
      })
      .catch(noop)
  );
}

// --- slice 11 (PWA & polish): offline app shell ------------------------
//
// The app's DATA already lives in IndexedDB and the app already renders
// with the network down (see `frontend/src/data/`) — this worker is not
// re-solving that. It only makes the SHELL (the HTML document, manifest
// and icons) available offline, so the page has something to boot from
// before IndexedDB and the rest of the JS bundle take over.
//
// `CACHE_NAME` is versioned by hand: bump the suffix when the precache
// list changes so `handleActivate` evicts the old shell instead of an
// install leaving two caches around.
var CACHE_NAME = "petmeds-shell-v2";

// Small, stable, hash-free — deliberately excludes `/assets/...` (Vite's
// content-hashed build output, handled by the cache-first branch of the
// fetch handler below) and excludes `/sw.js` itself.
var PRECACHE_URLS = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
  "/reduced-motion.css",
];

function precacheShell() {
  return self.caches
    .open(CACHE_NAME)
    .then(function (cache) {
      // Each asset is added independently: one missing/failing asset must
      // not reject the whole precache (and must not brick install).
      return Promise.all(
        PRECACHE_URLS.map(function (url) {
          return cache.add(url).catch(noop);
        }),
      );
    })
    .catch(noop);
}

function deleteStaleCaches() {
  return self.caches
    .keys()
    .then(function (names) {
      return Promise.all(
        names
          .filter(function (name) {
            return name !== CACHE_NAME;
          })
          .map(function (name) {
            return self.caches.delete(name);
          }),
      );
    })
    .catch(noop);
}

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isApiPath(url) {
  return url.pathname === "/api" || url.pathname.indexOf("/api/") === 0;
}

function isHashedAsset(url) {
  return url.pathname.indexOf("/assets/") === 0;
}

/**
 * A precached shell asset other than the document itself (the manifest, the
 * icons, the reduced-motion stylesheet). These are NOT under `/assets/`, so
 * without this they would fall through the fetch handler untouched and go
 * straight to the network — precached but never served from the cache, which
 * makes them fail offline despite being in `PRECACHE_URLS`. `/` is excluded
 * because navigations are handled network-first above.
 */
function isPrecachedAsset(url) {
  return url.pathname !== "/" && PRECACHE_URLS.indexOf(url.pathname) !== -1;
}

/** Never cache anything but a normal, successful same-origin response. */
function isCacheable(response) {
  return !!response && response.status === 200 && response.type === "basic";
}

/**
 * A real Response for the "offline and not cached" case. Without this the
 * strategies below resolve to `undefined`, and `event.respondWith(undefined)`
 * is invalid — the browser reports it as an opaque network error, which is a
 * worse and harder-to-diagnose failure than an explicit 504. Guarded because
 * the worker is also evaluated in tests against a stubbed `self`.
 */
function offlineFallback() {
  if (typeof self.Response === "function") {
    return new self.Response("", { status: 504, statusText: "Offline" });
  }
  return undefined;
}

function putInCache(request, response) {
  self.caches
    .open(CACHE_NAME)
    .then(function (cache) {
      cache.put(request, response);
    })
    .catch(noop);
}

/**
 * Navigations are network-first: a stale cached document must never pin a
 * user to a dead build once the network is back. The cached shell is only
 * a fallback for when the network fetch itself fails.
 */
function handleNavigation(request) {
  return self
    .fetch(request)
    .then(function (response) {
      if (isCacheable(response)) {
        putInCache(request, response.clone());
      }
      return response;
    })
    .catch(function () {
      return self.caches.match("/").then(function (cached) {
        if (cached) return cached;
        return self.caches.match(request).then(function (exact) {
          return exact || offlineFallback();
        });
      });
    })
    .catch(offlineFallback);
}

/**
 * Cache-first. Safe for hashed `/assets/...` URLs because they are immutable,
 * and for the precached shell assets because they are scoped to `CACHE_NAME`
 * and evicted wholesale by `handleActivate` when that version is bumped.
 */
function handleCacheFirst(request) {
  return self.caches
    .match(request)
    .then(function (cached) {
      if (cached) {
        return cached;
      }
      return self.fetch(request).then(function (response) {
        if (isCacheable(response)) {
          putInCache(request, response.clone());
        }
        return response;
      });
    })
    .catch(offlineFallback);
}

function handleFetch(event) {
  var request = event.request;
  if (request.method !== "GET") {
    return;
  }

  var url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }

  if (!isSameOrigin(url) || isApiPath(url)) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (isHashedAsset(url) || isPrecachedAsset(url)) {
    event.respondWith(handleCacheFirst(request));
  }
}

// --- registration -------------------------------------------------------

self.addEventListener("install", handleInstall);
self.addEventListener("activate", handleActivate);
self.addEventListener("notificationclick", handleNotificationClick);
self.addEventListener("fetch", handleFetch);

// Any future code that shows a notification MUST go through the page's
// `AlertLedger.claim()` first (see `frontend/src/notifications/ledger.ts`)
// — never call `self.registration.showNotification(...)` directly from
// this worker, and never add a `message` handler. That was tried once (an
// unguarded `message` handler for a `petmeds/show` message) and removed
// because it was a second, unguarded call site sitting next to the one
// enforcement point the whole design depends on.
