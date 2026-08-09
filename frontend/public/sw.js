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
}

function handleActivate(event) {
  event.waitUntil(self.clients.claim());
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

// --- registration -------------------------------------------------------

self.addEventListener("install", handleInstall);
self.addEventListener("activate", handleActivate);
self.addEventListener("notificationclick", handleNotificationClick);

// --- slice 11 (PWA & polish) extends here: precache list, install/activate
// cache steps, and a fetch listener for the offline shell. Nothing above
// needs to change. Any future code that shows a notification MUST go
// through the page's `AlertLedger.claim()` first (see
// `frontend/src/notifications/ledger.ts`) — never call
// `self.registration.showNotification(...)` directly from this worker. That
// was tried once (an unguarded `message` handler for a `petmeds/show`
// message) and removed because it was a second, unguarded call site sitting
// next to the one enforcement point the whole design depends on. ---
