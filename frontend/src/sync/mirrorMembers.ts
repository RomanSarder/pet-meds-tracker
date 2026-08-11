// Merges a household roster — wire `MemberDto[]`, sourced from either `GET
// /household` (`features/household/hooks.ts`'s `useRefreshMembers`, gated on
// the Household screen mounting) or the generic `/sync/pull`'s `changes.users`
// (`sync/engine.ts`, running in the background on every device regardless of
// which screen is open) — into the local `users` store.
//
// Extracted to one place so the two delivery paths cannot disagree about what
// "changed" means, and so `sync/engine.ts` (which must stay free of React —
// see `sync/types.ts`'s header) never has to import from the household
// feature layer to get this logic.
import type { MemberDto } from "@pet-tracker/shared";
import type { Repo } from "@/data";
import type { User } from "@/domain";
import { now } from "@/domain";

export interface MirrorMembersOptions {
  /**
   * A member id to treat as the caller's own even if `self.id` (below)
   * somehow disagrees — used by the `GET /household` caller, which knows
   * its own backend-side id (`state.self.id`) directly. In practice the two
   * are the same id once `reconcileSelfId` has run (both derive from the
   * same canonical account), so this mostly exists as a defensive second
   * source of truth for the entry-is-self check just below.
   */
  excludeId?: string;
}

/**
 * Additive only. A local member missing from `members` is left alone rather
 * than soft-deleted: removal has its own explicit path (`Repo.removeUser`),
 * and a local row the server does not (yet, or no longer) know about is just
 * as likely to be a name restored from a backup, which SPEC §12 needs kept so
 * their past events still render a name.
 *
 * Resolves to whether anything was actually written, so a caller (a React
 * Query hook, or the sync engine) can invalidate only when the roster
 * genuinely changed — never on every poll of an unchanged household.
 */
export async function mirrorMembers(
  repo: Repo,
  members: readonly MemberDto[],
  opts: MirrorMembersOptions = {},
): Promise<boolean> {
  if (members.length === 0) return false;

  const householdId = await repo.currentHouseholdId();
  const self = await repo.getCurrentUser();
  const existing = await repo.listUsers({ includeRemoved: true });
  const byId = new Map(existing.map((u) => [u.id, u]));
  const ts = now().toISOString();
  let changed = false;

  for (const member of members) {
    // The entry describing the caller's own account, when the server sent
    // one (`GET /household`'s `members` includes the caller; `/sync/pull`'s
    // `changes.users` never does — see `pullRoster`'s comment). This used
    // to be a bare `continue` — skipped entirely — which is exactly what
    // let a member's OWN pre-fix aliases (disclosed from one of their OWN
    // devices) never reach any of their OTHER devices: `displayNameFor`
    // could never resolve their own history anywhere but the one device
    // that ran the disclosure. Still never upserted as a normal member row
    // below: that would `put()` a `isSelf: false` copy over the real local
    // self row (both share the same id) and silently unflag it. Only its
    // `aliasIds` are worth anything here — displayName/tint/id for the
    // LOCAL self row are already authoritative on this device.
    if (member.id === opts.excludeId || member.id === self.id) {
      if (await mergeSelfAliasIds(repo, self, member.aliasIds ?? [])) {
        changed = true;
      }
      continue;
    }
    const local = byId.get(member.id);
    if (local?.isSelf) {
      continue;
    }
    const memberAliasIds = member.aliasIds ?? [];
    const localAliasIds = local?.aliasIds ?? [];
    const aliasIdsChanged =
      memberAliasIds.length !== localAliasIds.length ||
      memberAliasIds.some((id) => !localAliasIds.includes(id));

    // Skip the write when nothing the server owns has changed, so a poll on
    // every window focus / background sync tick does not churn `updatedAt`
    // on untouched rows — and, more importantly, does not report a change
    // that would re-invalidate every consumer's queries forever. `aliasIds`
    // is included: a member disclosing a stale id via `POST
    // /household/me/aliases` after this device already mirrored them once
    // must still reach this device, or a dose they logged before that
    // disclosure would keep resolving to "Someone" here forever.
    if (
      local &&
      local.displayName === member.displayName &&
      local.tint === member.tint &&
      !aliasIdsChanged
    ) {
      continue;
    }
    const user: User = {
      id: member.id,
      householdId,
      email: null,
      displayName: member.displayName,
      tint: member.tint,
      isSelf: false,
      joinedAt: member.joinedAt,
      createdAt: local?.createdAt ?? member.joinedAt,
      updatedAt: ts,
      deletedAt: local?.deletedAt ?? null,
      aliasIds: memberAliasIds,
    };
    await repo.upsertUser(user);
    changed = true;
  }

  return changed;
}

/**
 * Unions `incomingAliasIds` (learned from the server, about the CALLER's own
 * account) into the local self row's own `aliasIds` — never touching `id`,
 * `isSelf`, `displayName` or `tint`, which stay whatever this device already
 * has for itself. Exported (not folded into the loop above) because
 * `sync/engine.ts` needs it too, for `SyncPullResult.selfAliasIds` — the
 * channel `/sync/pull` uses to deliver the caller's own aliases, since
 * `pullRoster` never includes the caller's own row in `changes.users`.
 *
 * Resolves to whether anything changed, for the same cache-invalidation
 * reason `mirrorMembers` itself does.
 */
export async function mergeSelfAliasIds(
  repo: Repo,
  self: User,
  incomingAliasIds: readonly string[],
): Promise<boolean> {
  if (incomingAliasIds.length === 0) return false;
  const current = self.aliasIds ?? [];
  const missing = incomingAliasIds.filter((id) => !current.includes(id));
  if (missing.length === 0) return false;
  await repo.upsertUser({ ...self, aliasIds: [...current, ...missing], updatedAt: now().toISOString() });
  return true;
}
