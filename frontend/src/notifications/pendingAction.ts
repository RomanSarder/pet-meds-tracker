/**
 * Cold start: a notification click with no page open lands here via
 * `clients.openWindow(<action URL>)` (see `sw.js`). The booting page drains
 * whatever action the URL carries and performs it exactly as it would have
 * if a live page had received the worker's message.
 */
import { ACTION_PARAM, AMOUNT_PARAM, COURSE_PARAM, parseActionUrl, SCHEDULED_PARAM } from "./protocol";
import { performGive, performSnooze, type ActionDeps } from "./actions";
import { silently, silentlyAsync } from "./support";

/** Removes only the notification's own params, preserving anything else in the query string. */
function stripActionParams(win: Window): void {
  silently(() => {
    const params = new URLSearchParams(win.location.search);
    params.delete(ACTION_PARAM);
    params.delete(COURSE_PARAM);
    params.delete(SCHEDULED_PARAM);
    params.delete(AMOUNT_PARAM);
    const query = params.toString();
    const nextUrl = `${win.location.pathname}${query ? `?${query}` : ""}${win.location.hash}`;
    win.history.replaceState(null, "", nextUrl);
  });
}

/**
 * Reads `window.location.search`, and if it carries a notification action,
 * strips the params BEFORE performing it — so a refresh (or a second call)
 * can never double-log — then performs it. Runs even when notifications are
 * unsupported or denied: a Give that arrived by URL still has to log.
 */
export async function drainPendingAction(deps: ActionDeps, win: Window = window): Promise<void> {
  await silentlyAsync(async () => {
    const parsed = parseActionUrl(win.location.search);
    if (parsed === null) return;

    stripActionParams(win);

    if (parsed.action === "give") {
      await performGive(parsed.dose, deps);
    } else {
      await performSnooze(parsed.dose, deps);
    }
  });
}
