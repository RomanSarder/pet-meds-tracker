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

    // Every ledger row newer than the watermark is pushed, regardless of
    // whose `actorId` it carries — including one this device merely
    // learned about via merge-mode `importHousehold` (which legitimately
    // brings in ANOTHER member's own dose/course/stock history, preserving
    // their `actorId` verbatim; see `Repo.applyRemoteChanges`'s doc
    // comment). An earlier version of this filtered such rows out before
    // push, on the theory that the server would otherwise reattribute them
    // to whoever pushes — true at the time, but it meant a row whose true
    // author's own device never comes back online was stranded in this
    // device's IndexedDB forever, invisible to the rest of the household.
    // For a medication tracker that is worse than the mis-attribution it
    // avoided: a dose nobody can see was given invites a duplicate.
    // `backend/src/sync/index.ts`'s `pushTable` now resolves this the other
    // way — it trusts a client-supplied `actorId` verbatim whenever it
    // names a member of the CALLER's OWN household (by canonical id or
    // disclosed alias), computed server-side from the session, and only
    // overrides an id naming nobody in that household (garbage, or a
    // different household's member — the cross-household spoofing hole
    // stays closed). So every row this device holds is safe to push
    // exactly as logged: no filter needed here at all.
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
      // A5: the same field, read the other way round — as the server's
      // authoritative answer to "which of my aliases do you actually hold?".
      // `selfAliasIdsPushed` used to be a grow-only LOCAL claim that nothing
      // ever checked, so an id recorded as pushed that the server never kept
      // was never retried, and the doses this device logged under that stale
      // id read "Someone" on every other device forever. Overwriting the
      // claim with the truth puts exactly those ids back in
      // `pushPendingSelfAliases`'s pending set, where A1's existing "retried
      // until the server actually confirms it" rule takes over. Absent means
      // the server holds none — the route omits the field rather than
      // sending `[]`.
      const serverAliasIds = result.selfAliasIds ?? [];
      const claimed = (await repo.getMeta("selfAliasIdsPushed")) ?? [];
      const claimIsStale =
        claimed.length !== serverAliasIds.length || claimed.some((id) => !serverAliasIds.includes(id));
      if (claimIsStale) {
        // Deliberately NOT `changedAnything`: this writes no user-visible
        // row, and flipping it would invalidate every query on a cycle that
        // only corrected bookkeeping.
        await repo.setMeta("selfAliasIdsPushed", serverAliasIds);
      }
      cursor = result.cursor;
      await repo.setMeta("syncCursor", cursor);
      if (!result.hasMore) break;
    }

    return changedAnything;
  }

  return { syncOnce };
}
