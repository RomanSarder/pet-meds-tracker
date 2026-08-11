/**
 * The page-context scheduler (W10-CONTRACT.md "Architecture decision
 * (locked)"): the page decides "this dose is due now"; the service worker
 * only displays and brokers actions. This file must not reimplement any of
 * slice 3's time logic — occurrences come from `getOccurrences`, states from
 * `getDoseState`; the only arithmetic here is comparing epoch millis that
 * those functions (or the ledger) already handed us.
 *
 * The two-alerts-per-dose ceiling has exactly one enforcement point:
 * `AlertLedger.claim()`. `deps.show(...)` is called from exactly one place
 * in this file, guarded by an inverted claim check (`if (!ledger.claim(...))
 * continue;`) immediately above it — unreachable unless that claim just
 * succeeded.
 */
import type { Clock, Course } from "@/domain";
import { addLocalDays, localDayKey, MISSED_AFTER_HOURS } from "@/domain";
import { getRepo } from "@/data";
import { getDoseState, getOccurrences } from "@/engine";
import type { DoseState, EngineContext } from "@/engine";
import { buildTitle } from "./copy";
import type { AlertLedger } from "./ledger";
import { silently, silentlyAsync } from "./support";
import type { AlertReason, AlertRecord, DoseRef, NotificationSpec } from "./types";

export const POLL_INTERVAL_MS = 30_000;

const MISSED_AFTER_MS = MISSED_AFTER_HOURS * 60 * 60_000;

/**
 * Pure and exhaustively unit-tested. Rules, in this order (SPEC §7 +
 * W10-CONTRACT.md):
 *
 * 1. Snoozed (`record.snoozeUntil !== null`): `nowMs < snoozeUntil` ->
 *    suppressed entirely (`null`); `nowMs >= snoozeUntil` and `"snooze"` not
 *    already in `record.reasons` -> `"snooze"`.
 * 2. `state === "due"` and `nowMs >= dueAtMs` -> `"due"`. Deliberately NOT at
 *    `due - 30 min`: §4's `due` state opens half an hour early for the UI,
 *    but §7 says the notification fires AT the scheduled time.
 * 3. `state === "overdue"` -> `"overdue"`.
 * 4. Anything else (`given`, `skipped`, `later`, `upcoming`, `notStarted`) ->
 *    `null`.
 * 5. Staleness bound: once a candidate reason has been found above, if
 *    `nowMs - dueAtMs` exceeds the missed-dose threshold (`MISSED_AFTER_HOURS`
 *    from `domain/constants.ts`, reused rather than re-hardcoded), the result
 *    is `null` regardless of which reason rules 1-3 chose.
 */
export function decideAlert(input: {
  state: DoseState;
  dueAtMs: number;
  nowMs: number;
  record: AlertRecord | null;
}): AlertReason | null {
  const { state, dueAtMs, nowMs, record } = input;

  let reason: AlertReason | null = null;

  if (record !== null && record.snoozeUntil !== null) {
    if (nowMs < record.snoozeUntil) return null; // suppressed entirely while snoozed
    if (!record.reasons.includes("snooze")) {
      reason = "snooze";
    }
  }

  if (reason === null) {
    if (state === "due" && nowMs >= dueAtMs) {
      reason = "due";
    } else if (state === "overdue") {
      reason = "overdue";
    }
  }

  if (reason === null) return null;
  if (nowMs - dueAtMs > MISSED_AFTER_MS) return null;

  return reason;
}

export interface SchedulerDeps {
  clock: Clock;
  ledger: AlertLedger;
  show: (spec: NotificationSpec) => Promise<boolean>;
  timers: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
  canNotify?: () => boolean;
}

export function createNotificationScheduler(deps: SchedulerDeps): {
  start(): void;
  stop(): void;
  tick(): Promise<void>;
} {
  const canNotify = deps.canNotify ?? (() => true);
  let timerId: ReturnType<typeof deps.timers.setTimeout> | null = null;
  let started = false;

  async function runTick(): Promise<void> {
    const now = deps.clock.now();
    const nowMs = now.getTime();
    deps.ledger.prune(nowMs);

    if (!canNotify()) return;

    const repo = getRepo();
    const [courses, events, courseEvents, pets, medications] = await Promise.all([
      repo.listCourses(),
      repo.listDoseEvents({}),
      repo.listCourseEvents({}),
      repo.listPets(),
      repo.listMedications(),
    ]);
    // `EngineContext` (slice 3, widened for the forward-only schedule-edit
    // ledger fix) is `{ courses, events, courseEvents }` — pets/medications
    // are fetched separately, only for name lookups below.
    const ctx: EngineContext = { courses, events, courseEvents };

    const today = localDayKey(now);
    const yesterday = addLocalDays(today, -1);
    // A 23:00 dose is still in grace after midnight, so both days are read.
    const occurrences = [...getOccurrences(yesterday, ctx), ...getOccurrences(today, ctx)];

    const coursesById = new Map<string, Course>(courses.map((c) => [c.id, c]));
    const petNameById = new Map(pets.map((p) => [p.id, p.name]));
    const medicationNameById = new Map(medications.map((m) => [m.id, m.name]));

    for (const occ of occurrences) {
      if (occ.dueAt === null) continue;
      const dueAtMs = occ.dueAt.getTime();
      const state = getDoseState(occ, now);
      const record = deps.ledger.recordFor(occ.key);
      const reason = decideAlert({ state, dueAtMs, nowMs, record });
      if (reason === null) continue;

      // The ONLY gate: `show` must be unreachable except through a
      // successful `claim()`. This is the single `show` call site in the
      // whole scheduler.
      if (!deps.ledger.claim(occ.key, reason, nowMs)) continue;

      const course = coursesById.get(occ.courseId);
      const petName = course ? (petNameById.get(course.petId) ?? "") : "";
      const medicationName = course ? (medicationNameById.get(course.medicationId) ?? "") : "";
      const dose: DoseRef = {
        occurrenceKey: occ.key,
        courseId: occ.courseId,
        scheduledFor: occ.dueAt.toISOString(),
        amount: occ.doseAmount,
      };
      const title = buildTitle({
        petName,
        medicationName,
        amount: occ.doseAmount,
        unit: occ.doseUnit,
        state,
      });
      await deps.show({ title, tag: occ.key, reason, dose });
    }
  }

  async function tick(): Promise<void> {
    // A throwing tick must not kill the loop and must not log.
    await silentlyAsync(runTick);
  }

  function scheduleNext(): void {
    if (!started) return;
    timerId = deps.timers.setTimeout(() => {
      void tick().then(scheduleNext);
    }, POLL_INTERVAL_MS);
  }

  const target: Document | undefined = typeof document !== "undefined" ? document : undefined;

  function onVisibilityChange(): void {
    if ((silently(() => target?.visibilityState === "visible") ?? false)) {
      void tick();
    }
  }

  function start(): void {
    if (started) return;
    started = true;
    scheduleNext();
    silently(() => target?.addEventListener("visibilitychange", onVisibilityChange));
  }

  function stop(): void {
    started = false;
    if (timerId !== null) {
      deps.timers.clearTimeout(timerId);
      timerId = null;
    }
    silently(() => target?.removeEventListener("visibilitychange", onVisibilityChange));
  }

  return { start, stop, tick };
}
