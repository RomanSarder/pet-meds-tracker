// Owned by the Notifications wave. Every user-facing literal from
// `notifications/copy.ts` (`buildTitle`'s state word) and
// `notifications/bridge.ts` (the OS notification action-button labels) lives
// here. Both modules run outside React (SPEC: notification copy is built by
// a plain module, sometimes from a service-worker message handler), so they
// read `currentTranslator()` rather than receiving a `Translator` prop —
// see I18N-DESIGN.md §2.5.
import type { Formatters } from "../formatters";

export interface NotificationsMessages {
  /** SPEC §7: "Clover · Metacam 0.4 ml due now" — the trailing state word. */
  "notifications.stateDueNow": () => string;
  /** SPEC §7: "Clover · Metacam 0.4 ml overdue" — the trailing state word. */
  "notifications.stateOverdue": () => string;
  /** The OS notification's primary action button. */
  "notifications.action.give": () => string;
  /** The OS notification's secondary action button. */
  "notifications.action.snooze": () => string;
}

// `f` is unused by this domain today but kept in the signature so every
// domain factory has the same shape (`(f: Formatters) => <Domain>Messages`).
export const enNotifications = (_f: Formatters): NotificationsMessages => ({
  "notifications.stateDueNow": () => "due now",
  "notifications.stateOverdue": () => "overdue",
  "notifications.action.give": () => "Give",
  "notifications.action.snooze": () => "Snooze 30 min",
});

export const ukNotifications = (_f: Formatters): NotificationsMessages => ({
  // "час приймати" ("time to give it") reads naturally as the trailing word
  // of a notification title, mirroring the terse, factual English "due now".
  "notifications.stateDueNow": () => "час приймати",
  "notifications.stateOverdue": () => "прострочено",
  "notifications.action.give": () => "Дати",
  "notifications.action.snooze": () => "Відкласти на 30 хв",
});
