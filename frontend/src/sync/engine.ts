// W9-DESIGN §D2/§D6 — `syncOnce()`: collect local changes → push → pull from
// `syncCursor` → `repo.applyRemoteChanges()` → advance `syncCursor` and
// `lastPushedAt`. Every instant comes from the injected `clock`; nothing
// here calls `new Date()`.
import type { Repo } from "@/data";
import type { Clock, DoseEvent, Timestamped } from "@/domain";
import { RETRACT_GRACE_MS, UNDO_WINDOW_MS } from "@/domain";
import { domainToPayload, payloadToRemoteChanges } from "./mapping";
import { mergeSelfAliasIds, mirrorMembers } from "./mirrorMembers";
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
  async function syncOnce(): Promise<boolean> {
    const lastPushedAt = await repo.getMeta("lastPushedAt");
    const backup = await repo.exportHousehold();
    const nowMs = clock.now().getTime();

    // A3: the server now stamps every pushed ledger row's `actorId` from
    // THIS device's own session (`backend/src/sync/index.ts`'s `pushTable`)
    // — correct for a row this device actually logged, but that
    // justification ("the pusher and the logger are always the same
    // person") does not hold for a row this device merely learned about
    // via `importHousehold` (merge OR replace mode round-trips whatever
    // this device already has, and `adoptJoinedHousehold`'s replace-mode
    // round-trip is safe by construction, but merge-mode import can
    // legitimately bring in ANOTHER member's own dose/course/stock history,
    // preserving their `actorId` verbatim — see `Repo.applyRemoteChanges`'s
    // doc comment). Pushing one of those would let the server's stamping
    // silently reattribute a genuinely-someone-else's-event to whoever
    // happens to push it next. A ledger row is only ever "this device's to
    // push" when its `actorId` is the local self id or one of self's own
    // disclosed aliases — a row that fails that check is simply never
    // included; if the row's true author's own device comes back online,
    // IT pushes it correctly (or, per `Repo.reconcileSelfId`'s doc comment,
    // it stays unremediated if that device never does — the same
    // already-documented residual gap, not a new one).
    const self = await repo.getCurrentUser();
    const ownIds = new Set<string>([self.id, ...(self.aliasIds ?? [])]);
    const isOwn = (row: { actorId: string }): boolean => ownIds.has(row.actorId);

    const candidateDoseEvents = backup.doseEvents.filter((e) => isPushable(e, lastPushedAt) && isOwn(e));
    const quarantined = candidateDoseEvents.filter((e) => isQuarantined(e, nowMs));
    const pushableDoseEvents = candidateDoseEvents.filter((e) => !isQuarantined(e, nowMs));

    const pushPayload = domainToPayload({
      pets: backup.pets.filter((r) => isPushable(r, lastPushedAt)),
      medications: backup.medications.filter((r) => isPushable(r, lastPushedAt)),
      courses: backup.courses.filter((r) => isPushable(r, lastPushedAt)),
      doseEvents: pushableDoseEvents,
      stockAdjustments: backup.stockAdjustments.filter((r) => isPushable(r, lastPushedAt) && isOwn(r)),
      courseEvents: (backup.courseEvents ?? []).filter((r) => isPushable(r, lastPushedAt) && isOwn(r)),
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
    let changedAnything = false;

    for (;;) {
      const result = await transport.pull(cursor);
      // The cursor advances only after a successful apply, so a crash
      // mid-apply re-delivers this page rather than skipping it.
      const report = await repo.applyRemoteChanges(payloadToRemoteChanges(result.changes, householdId));
      if (Object.values(report.applied).some((count) => count > 0)) {
        changedAnything = true;
      }
      // `changes.users` is the household roster (packages/shared/src/sync.ts,
      // backend/src/sync/index.ts's `pullRoster`) — not part of
      // `RemoteChanges`/`applyRemoteChanges` (that contract deliberately
      // excludes `users`, same as `HouseholdBackup`'s merge always has), so
      // it is mirrored separately through the same helper `useRefreshMembers`
      // uses for `GET /household`.
      if (result.changes.users && result.changes.users.length > 0) {
        const membersChanged = await mirrorMembers(repo, result.changes.users);
        if (membersChanged) changedAnything = true;
      }
      // G1: `pullRoster` never includes the caller's own row in
      // `changes.users` (see that function's comment), so a second device
      // signed into the SAME account would otherwise never learn its own
      // account's disclosed aliases through the background sync cycle at
      // all — the exact "still 'Someone' for my own pre-fix dose on another
      // device of mine" defect. `selfAliasIds` is the separate channel for
      // it; see `SyncPullResult.selfAliasIds`'s doc comment.
      if (result.selfAliasIds && result.selfAliasIds.length > 0) {
        const self = await repo.getCurrentUser();
        const selfChanged = await mergeSelfAliasIds(repo, self, result.selfAliasIds);
        if (selfChanged) changedAnything = true;
      }
      cursor = result.cursor;
      await repo.setMeta("syncCursor", cursor);
      if (!result.hasMore) break;
    }

    return changedAnything;
  }

  return { syncOnce };
}
