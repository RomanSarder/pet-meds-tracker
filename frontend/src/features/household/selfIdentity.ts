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
import type { SelfAliasesDto } from "@pet-tracker/shared";
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
 * A1: marks an id "pushed" only if the server's response actually echoes it
 * back in `aliasIds` — never on a bare 200. A prior version marked every
 * `pending` id as pushed on ANY success response, which silently hid two
 * failure modes: the server dropping an id (a collision with a real
 * account, or — see the eviction-cap comment on the route — the cap
 * evicting it before this round-trip even landed), and, before the route's
 * own atomic-append fix, a lost update from a concurrent request from
 * another of this account's devices. Either way the id would then never be
 * retried, permanently defeating the very reconciliation this exists for.
 * Checking the echo makes this self-correcting: whatever the server didn't
 * actually keep stays in the pending set and is retried next time.
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

  let response: SelfAliasesDto;
  try {
    response = await apiClient<SelfAliasesDto>("/household/me/aliases", {
      method: "POST",
      body: JSON.stringify({ ids: pending }),
    });
  } catch {
    return;
  }

  // Defensive against a response that parsed as JSON but isn't shaped like
  // `SelfAliasesDto` (a proxy, a version-skewed deploy, a captive-portal
  // page that still 200s) — `apiClient`'s generic parameter is a type
  // assertion, not a runtime check. Treating a malformed body as "nothing
  // confirmed" is exactly the same safe fallback as a network failure
  // above: retried next time, never crashes this best-effort, fire-and-
  // forget call into an unhandled rejection.
  const confirmedIds = Array.isArray(response?.aliasIds) ? response.aliasIds : [];
  const confirmed = pending.filter((id) => confirmedIds.includes(id));
  if (confirmed.length === 0) return;
  await repo.setMeta("selfAliasIdsPushed", [...pushed, ...confirmed]);
}
