/**
 * The page/worker message contract (slice 10).
 *
 * `sw.js` is plain JS served straight out of `public/` — it cannot `import`
 * from `src/`, so it restates these same string literals with a comment
 * naming this file as the source of truth. Keep the two in lockstep by hand.
 */
import { occurrenceKeyFor } from "@/domain";
import type { DoseRef } from "./types";

/** worker -> page: `{ type, action, dose }` */
export const MSG_ACTION = "petmeds/action";

export type NotificationAction = "give" | "snooze";

export interface ActionMessage {
  type: typeof MSG_ACTION;
  action: NotificationAction;
  dose: DoseRef;
}

function isNotificationAction(v: unknown): v is NotificationAction {
  return v === "give" || v === "snooze";
}

function isDoseRef(v: unknown): v is DoseRef {
  if (v === null || typeof v !== "object") return false;
  const d = v as Record<string, unknown>;
  if (typeof d.occurrenceKey !== "string" || d.occurrenceKey.trim().length === 0) return false;
  if (typeof d.courseId !== "string" || d.courseId.trim().length === 0) return false;
  if (d.scheduledFor !== null && typeof d.scheduledFor !== "string") return false;
  if (typeof d.amount !== "number" || !Number.isFinite(d.amount)) return false;
  return true;
}

/** Full runtime validation — never trusts a `postMessage` payload's declared type. */
export function isActionMessage(v: unknown): v is ActionMessage {
  if (v === null || typeof v !== "object") return false;
  const msg = v as Record<string, unknown>;
  if (msg.type !== MSG_ACTION) return false;
  if (!isNotificationAction(msg.action)) return false;
  if (!isDoseRef(msg.dose)) return false;
  return true;
}

/** Cold-start URL encoding — used by `sw.js`'s `clients.openWindow` and parsed by `pendingAction.ts`. */
export const ACTION_PARAM = "petmeds_action";
export const COURSE_PARAM = "petmeds_course";
/** IsoDateTime, or `"-"` for a `fromLastDose` occurrence with `scheduledFor === null`. */
export const SCHEDULED_PARAM = "petmeds_scheduled";
export const AMOUNT_PARAM = "petmeds_amount";

function isWellFormedIso(v: string): boolean {
  return v.length > 0 && !Number.isNaN(new Date(v).getTime());
}

export function buildActionUrl(origin: string, action: NotificationAction, dose: DoseRef): string {
  const url = new URL("/", origin);
  url.searchParams.set(ACTION_PARAM, action);
  url.searchParams.set(COURSE_PARAM, dose.courseId);
  url.searchParams.set(SCHEDULED_PARAM, dose.scheduledFor ?? "-");
  url.searchParams.set(AMOUNT_PARAM, String(dose.amount));
  return url.toString();
}

/** Validates everything and returns `null` on anything malformed. Never throws. */
export function parseActionUrl(search: string): { action: NotificationAction; dose: DoseRef } | null {
  try {
    if (typeof search !== "string" || search.length === 0) return null;
    const params = new URLSearchParams(search);

    const actionRaw = params.get(ACTION_PARAM);
    if (!isNotificationAction(actionRaw)) return null;

    const courseId = params.get(COURSE_PARAM);
    if (courseId === null || courseId.trim().length === 0) return null;

    const scheduledRaw = params.get(SCHEDULED_PARAM);
    if (scheduledRaw === null) return null;
    if (scheduledRaw !== "-" && !isWellFormedIso(scheduledRaw)) return null;
    const scheduledFor = scheduledRaw === "-" ? null : scheduledRaw;

    const amountRaw = params.get(AMOUNT_PARAM);
    if (amountRaw === null || amountRaw.trim().length === 0) return null;
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount)) return null;

    const occurrenceKey = occurrenceKeyFor(courseId, scheduledFor);
    return { action: actionRaw, dose: { occurrenceKey, courseId, scheduledFor, amount } };
  } catch {
    return null;
  }
}
