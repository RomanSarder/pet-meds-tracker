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
   * A member id to skip even if it appears in `members` — used by the `GET
   * /household` caller, which knows its own backend-side id (`state.self.id`)
   * and must not mirror it as a second local row alongside the real local
   * self row (`self.id` below already guards this from the OTHER direction:
   * the two ids are never equal, since the local self row is a device-minted
   * uuid — see `idbRepo`'s `currentActorId` — while `state.self.id` is the
   * backend auth identity). The `/sync/pull` caller omits this: the server
   * already excludes the caller's own row from `changes.users`
   * (`backend/src/sync/index.ts`'s `pullRoster`).
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
    if (member.id === opts.excludeId || member.id === self.id) {
      continue;
    }
    const local = byId.get(member.id);
    if (local?.isSelf) {
      continue;
    }
    // Skip the write when nothing the server owns has changed, so a poll on
    // every window focus / background sync tick does not churn `updatedAt`
    // on untouched rows — and, more importantly, does not report a change
    // that would re-invalidate every consumer's queries forever.
    if (local && local.displayName === member.displayName && local.tint === member.tint) {
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
    };
    await repo.upsertUser(user);
    changed = true;
  }

  return changed;
}
