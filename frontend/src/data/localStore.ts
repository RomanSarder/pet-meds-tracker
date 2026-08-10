// W-session-lifecycle (design §D3b): the guard `resetLocalHousehold()` answers
// to — a reset is only safe once the local store has nothing left to lose.
import type { Timestamped } from "@/domain";
import { DEFAULT_SELF_DISPLAY_NAME } from "@/domain";
import type { Repo } from "./repo.types";

/**
 * True when discarding the local store cannot lose anything: either it holds no
 * domain rows at all, or every row it holds has already been accepted by a
 * successful push (`updatedAt <= lastPushedAt`) — AND the store holds no
 * user-entered identity content either (see below).
 *
 * Conservative by construction. `lastPushedAt` only advances after a push the
 * server acknowledged AND only when nothing was held back by the engine's push
 * quarantine (`sync/engine.ts`), so a row still inside the quarantine window
 * has `updatedAt > lastPushedAt` and correctly reads as unsynced.
 *
 * `users`/`households` are excluded from the row count above (a bare
 * provisioned household with no pets is not user data) but are NOT ignored
 * outright: sync never pushes or pulls either table (see the `RemoteChanges`
 * doc comment in `repo.types.ts` and `sync/mapping.ts`/`sync/engine.ts`, which
 * only ever move pets/medications/courses/doseEvents/stockAdjustments/
 * courseEvents), so `User.displayName` and `Household.name` are LOCAL-ONLY
 * and can never be recovered from the server. A device where the current
 * user set their display name — or named the household — but added no pets
 * would otherwise report `disposable: true`, and `resetLocalHousehold()`
 * would then destroy that name silently. So the store is also non-disposable
 * when it holds:
 *   - any non-soft-deleted `users` row whose `displayName` differs from
 *     `DEFAULT_SELF_DISPLAY_NAME`, or
 *   - a `households` row with a non-null, non-empty `name`.
 * These are unconditional signals — the `lastPushedAt` watermark does NOT
 * apply to them, because they are never pushed at all. A default-named user
 * in an unnamed household is still disposable (that is what keeps the
 * silent-reset path usable on a genuinely fresh device); any name a human
 * typed is not. `exportHousehold()` already includes `households`/`users` in
 * the backup, so the /account-switch export path preserves this content
 * regardless of how this function answers.
 */
export async function localStoreIsDisposable(repo: Repo): Promise<boolean> {
  const backup = await repo.exportHousehold();

  const hasCustomisedIdentity =
    (backup.users ?? []).some(
      (user) => user.deletedAt === null && user.displayName !== DEFAULT_SELF_DISPLAY_NAME,
    ) ||
    (backup.households ?? []).some(
      (household) => household.name !== null && household.name !== "",
    );
  if (hasCustomisedIdentity) return false;

  const rows: Timestamped[] = [
    ...backup.pets,
    ...backup.medications,
    ...backup.courses,
    ...backup.doseEvents,
    ...backup.stockAdjustments,
    ...(backup.courseEvents ?? []),
  ];
  if (rows.length === 0) return true;

  const lastPushedAt = await repo.getMeta("lastPushedAt");
  if (lastPushedAt === null) return false;

  return rows.every((row) => row.updatedAt <= lastPushedAt);
}
