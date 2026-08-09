// W9-DESIGN §D2/§D6 — `syncOnce()`: collect local changes → push → pull from
// `syncCursor` → `repo.applyRemoteChanges()` → advance `syncCursor` and
// `lastPushedAt`. Every instant comes from the injected `clock`; nothing
// here calls `new Date()`.
import type { Repo } from "@/data";
import type { Clock, DoseEvent, Timestamped } from "@/domain";
import { RETRACT_GRACE_MS, UNDO_WINDOW_MS } from "@/domain";
import { domainToPayload, payloadToRemoteChanges } from "./mapping";
import type { SyncEngine, SyncTransport } from "./types";

/**
 * §D2's push quarantine: `retractDoseEvent` hard-deletes inside this window,
 * and insert-if-absent union-on-id has no tombstone to stop a resurrection.
 * A dose event is not eligible for push until it has aged past this.
 */
const PUSH_QUARANTINE_MS = UNDO_WINDOW_MS + RETRACT_GRACE_MS;

export interface CreateSyncEngineOptions {
  repo: Repo;
  transport: SyncTransport;
  clock: Clock;
}

function isPushable(row: Timestamped, lastPushedAt: string | null): boolean {
  return lastPushedAt === null || row.updatedAt > lastPushedAt;
}

function isQuarantined(event: DoseEvent, nowMs: number): boolean {
  return nowMs - new Date(event.loggedAt).getTime() <= PUSH_QUARANTINE_MS;
}

export function createSyncEngine({ repo, transport, clock }: CreateSyncEngineOptions): SyncEngine {
  async function syncOnce(): Promise<void> {
    const lastPushedAt = await repo.getMeta("lastPushedAt");
    const backup = await repo.exportHousehold();
    const nowMs = clock.now().getTime();

    const candidateDoseEvents = backup.doseEvents.filter((e) => isPushable(e, lastPushedAt));
    const quarantined = candidateDoseEvents.filter((e) => isQuarantined(e, nowMs));
    const pushableDoseEvents = candidateDoseEvents.filter((e) => !isQuarantined(e, nowMs));

    const pushPayload = domainToPayload({
      pets: backup.pets.filter((r) => isPushable(r, lastPushedAt)),
      medications: backup.medications.filter((r) => isPushable(r, lastPushedAt)),
      courses: backup.courses.filter((r) => isPushable(r, lastPushedAt)),
      doseEvents: pushableDoseEvents,
      stockAdjustments: backup.stockAdjustments.filter((r) => isPushable(r, lastPushedAt)),
      courseEvents: (backup.courseEvents ?? []).filter((r) => isPushable(r, lastPushedAt)),
    });

    if (Object.keys(pushPayload).length > 0) {
      await transport.push(pushPayload);
    }

    // Advance the watermark only when nothing was held back by quarantine:
    // a quarantined row's `updatedAt` is still greater than `lastPushedAt`
    // (that is *why* it was a push candidate), so advancing past it would
    // permanently drop it from every future push once it does age out. When
    // nothing is quarantined, everything eligible this round was included
    // in `pushPayload` (or already past `lastPushedAt` from an earlier
    // round), so it is safe to move the watermark up to now — a re-scan of
    // already-pushed rows next round is harmless, since push is idempotent.
    if (quarantined.length === 0) {
      await repo.setMeta("lastPushedAt", clock.now().toISOString());
    }

    const householdId = await repo.currentHouseholdId();
    let cursor = await repo.getMeta("syncCursor");

    for (;;) {
      const result = await transport.pull(cursor);
      // The cursor advances only after a successful apply, so a crash
      // mid-apply re-delivers this page rather than skipping it.
      await repo.applyRemoteChanges(payloadToRemoteChanges(result.changes, householdId));
      cursor = result.cursor;
      await repo.setMeta("syncCursor", cursor);
      if (!result.hasMore) break;
    }
  }

  return { syncOnce };
}
