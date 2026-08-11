// Reconciles a device's local "self" `User` id with the server-canonical
// account id — the fix for the identity bug an empirical cross-device test
// caught: a device's local self row got a locally-generated uuid the moment
// its IndexedDB was first opened (`idbRepo`/`memoryRepo`'s `currentActorId`),
// entirely independent of sign-in, so it was never reconciled with the id
// `/auth/me` actually vouches for. Every dose/course/stock event this device
// logs carries whichever id was live in `currentActorId()` at the time, so a
// mismatch here is what makes `displayNameFor` permanently fail on every
// OTHER device, which only ever learns this member under their canonical id
// (the roster, `MemberDto`, is built server-side from `users.id`, never from
// anything a client discloses).
//
// Two responsibilities, kept in one place because they're two halves of the
// same fix:
//   1. `Repo.reconcileSelfId` — make NEW writes on this device use the
//      canonical id, and keep the device's OWN local resolution of already
//      logged events working (via the old id landing in `aliasIds`).
//   2. `pushPendingSelfAliases` — tell the server about the old id too, so
//      OTHER devices' mirrors of this member's roster row also learn to
//      resolve it (see `POST /household/me/aliases` on the backend).
import type { Repo } from "@/data";
import { apiClient } from "@/shared/api";

/** Runs both halves of the reconciliation. Safe to call on every navigation — see each helper's own doc comment for why. */
export async function reconcileSelfIdentity(repo: Repo, canonicalId: string): Promise<void> {
  await repo.reconcileSelfId(canonicalId);
  await pushPendingSelfAliases(repo);
}

/**
 * Best-effort, retried opportunistically (not via a durable queue — the same
 * idiom `useRefreshMembers` already uses for the roster itself): diffs the
 * self user's current `aliasIds` against `meta.selfAliasIdsPushed` (the ids
 * already confirmed sent) and posts only what's missing. A network failure
 * here is swallowed — the next call (the next app-shell navigation) tries
 * again with the same diff, since nothing here is marked "pushed" until the
 * request actually succeeds.
 *
 * A device that logged doses under a stale id and then never comes back
 * online cannot run this — its aliases, and therefore any ALREADY-PUSHED
 * event it left behind, stay unresolvable on other devices. There is no way
 * around that without a device to run the disclosure from.
 */
export async function pushPendingSelfAliases(repo: Repo): Promise<void> {
  const self = await repo.getCurrentUser();
  const aliasIds = self.aliasIds ?? [];
  if (aliasIds.length === 0) return;

  const pushed = (await repo.getMeta("selfAliasIdsPushed")) ?? [];
  const pending = aliasIds.filter((id) => !pushed.includes(id));
  if (pending.length === 0) return;

  try {
    await apiClient("/household/me/aliases", {
      method: "POST",
      body: JSON.stringify({ ids: pending }),
    });
  } catch {
    return;
  }

  await repo.setMeta("selfAliasIdsPushed", [...pushed, ...pending]);
}
