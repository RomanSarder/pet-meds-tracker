// W-session-lifecycle (design §D3b): the guard `resetLocalHousehold()` answers
// to — a reset is only safe once the local store has nothing left to lose.
import type { Timestamped } from "@/domain";
import type { Repo } from "./repo.types";

/**
 * True when discarding the local store cannot lose anything: either it holds no
 * domain rows at all, or every row it holds has already been accepted by a
 * successful push (`updatedAt <= lastPushedAt`).
 *
 * Conservative by construction. `lastPushedAt` only advances after a push the
 * server acknowledged AND only when nothing was held back by the engine's push
 * quarantine (`sync/engine.ts`), so a row still inside the quarantine window
 * has `updatedAt > lastPushedAt` and correctly reads as unsynced.
 */
export async function localStoreIsDisposable(repo: Repo): Promise<boolean> {
  const backup = await repo.exportHousehold();
  // `households`/`users` are deliberately excluded from the row count — a
  // bare provisioned household with no pets is not user data.
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
