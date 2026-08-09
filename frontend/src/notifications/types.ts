/**
 * Shared types for slice 10 (notifications).
 *
 * The page schedules and counts; the service worker only displays and brokers actions. See
 * `scheduler.ts` for the alerting rules and `ledger.ts` for the two-per-dose ceiling.
 */

export type AlertReason = "due" | "overdue" | "snooze";

/**
 * Everything a notification action needs in order to be performed later — possibly by a page that
 * was cold-started by the click. Small and serialisable, because it round-trips through a URL.
 */
export interface DoseRef {
  /** Engine `Occurrence.key`, i.e. `${courseId}|${scheduledFor ?? "-"}`. */
  occurrenceKey: string;
  courseId: string;
  /** IsoDateTime, or null for a `fromLastDose` occurrence. */
  scheduledFor: string | null;
  /** The engine's `Occurrence.doseAmount` at the moment of alerting. */
  amount: number;
}

export interface NotificationSpec {
  /** The entire copy. There is no body — SPEC §7 gives one factual line. */
  title: string;
  /** The occurrence key, so a re-alert replaces the earlier notification rather than stacking. */
  tag: string;
  reason: AlertReason;
  dose: DoseRef;
}

export interface AlertRecord {
  key: string;
  /** One entry per notification actually shown; `reasons.length` is the count that the ceiling caps. */
  reasons: AlertReason[];
  /** Epoch ms, or null when this dose is not snoozed. */
  snoozeUntil: number | null;
  /** Epoch ms, used only for pruning. */
  updatedAt: number;
}
