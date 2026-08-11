/**
 * Performing Give and Snooze in the page (SPEC §7's two notification
 * actions). Both run here — never in the service worker — because the Give
 * write must go through the repository's dedup guard and actor stamping
 * exactly like the Today screen (see `useLogDose.ts`), and because the
 * two-alerts-per-dose ceiling has exactly one enforcement point: the ledger,
 * which lives in the page (see `ledger.ts`).
 */
import type { Clock } from "@/domain";
import { localDayKey } from "@/domain";
import { getRepo } from "@/data";
import { getOccurrences } from "@/engine";
import type { EngineContext } from "@/engine";
import type { AlertLedger } from "./ledger";
import { silentlyAsync } from "./support";
import type { DoseRef } from "./types";

export interface ActionDeps {
  ledger: AlertLedger;
  clock: Clock;
}

/**
 * The engine's occurrence for `dose` may have moved since the alert was
 * shown (a course edit, a re-generation) — resolve its amount fresh rather
 * than trust the value the notification was built with, falling back to
 * that stale value only when the occurrence can no longer be found.
 */
async function resolveFreshAmount(dose: DoseRef, clock: Clock): Promise<number> {
  const repo = getRepo();
  const [courses, events, courseEvents] = await Promise.all([
    repo.listCourses(),
    repo.listDoseEvents({ courseId: dose.courseId }),
    repo.listCourseEvents({ courseId: dose.courseId }),
  ]);
  const ctx: EngineContext = { courses, events, courseEvents };
  const day = dose.scheduledFor !== null ? localDayKey(new Date(dose.scheduledFor)) : localDayKey(clock.now());
  const occurrence = getOccurrences(day, ctx).find((occ) => occ.key === dose.occurrenceKey);
  return occurrence ? occurrence.doseAmount : dose.amount;
}

/**
 * Logs a real dose through the repository — exactly the shape the Today
 * screen uses (`getRepo().logDose(...)`). Never constructs a `DoseEvent`,
 * never sets `actorId` or `givenAt` (the repo stamps both), never touches
 * IndexedDB directly, so the data layer's dedup guard applies unchanged.
 */
export async function performGive(dose: DoseRef, deps: ActionDeps): Promise<void> {
  await silentlyAsync(async () => {
    const amount = await resolveFreshAmount(dose, deps.clock);
    await getRepo().logDose({
      courseId: dose.courseId,
      status: "given",
      scheduledFor: dose.scheduledFor,
      amount,
    });
  });
}

/**
 * Records a snooze via the ledger and does nothing else. A `false` return
 * from `ledger.snooze` (the dose already used its alert budget) is silently
 * ignored — the ceiling wins over a snooze request.
 */
export async function performSnooze(dose: DoseRef, deps: ActionDeps): Promise<void> {
  await silentlyAsync(async () => {
    deps.ledger.snooze(dose.occurrenceKey, deps.clock.now().getTime());
  });
}
