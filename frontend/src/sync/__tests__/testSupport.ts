// Shared fixtures for the sync test suite: a fake in-memory server that
// implements the same push/pull semantics as `backend/src/sync/index.ts`
// (W9-DESIGN §D5) against a `SyncTransport`, and a controllable clock that
// both a `Repo`'s stamps and a `SyncEngine`'s quarantine math can share a
// single, live source of truth for — no `msw`, no `new Date()`.
import { cloneFixtures } from "@/domain";
import type { Clock, FixtureData } from "@/domain";
import type {
  MemberDto,
  SyncPayload,
  SyncPullResult,
  SyncPushResult,
} from "@pet-tracker/shared";
import type { SyncTransport } from "../types";

type TableKey = keyof SyncPayload;

const TABLE_KEYS: TableKey[] = [
  "pets",
  "medications",
  "courses",
  "doseEvents",
  "stockAdjustments",
  "courseEvents",
];

const LEDGER_KEYS = new Set<TableKey>(["doseEvents", "stockAdjustments", "courseEvents"]);

interface StoredRow {
  __seq: number;
  id: string;
  updatedAt: string;
  [key: string]: unknown;
}

/**
 * A fake single-household server: same rules as `backend/src/sync/index.ts`
 * — mutable tables upsert on `id` only when `updatedAt` is strictly newer,
 * ledgers insert-if-absent, and the pull cursor pages by an ever-increasing
 * `sync_seq`. `pullLimit` defaults far above anything a test needs, and can
 * be lowered to exercise `hasMore` pagination.
 */
export function createFakeServer(opts?: { pullLimit?: number; roster?: MemberDto[] }) {
  const pullLimit = opts?.pullLimit ?? 500;
  // Mirrors `backend/src/sync/index.ts`'s `pullRoster`: not cursor-gated,
  // just the current full list attached to every pull response. Mutable so a
  // test can grow the household mid-scenario via `setRoster`.
  let roster = opts?.roster ?? [];
  let seq = 0;
  const tables = new Map<TableKey, Map<string, StoredRow>>(TABLE_KEYS.map((k) => [k, new Map()]));

  function push(changes: SyncPayload): SyncPushResult {
    let accepted = 0;
    let maxSeq = 0;
    for (const key of TABLE_KEYS) {
      const rows = changes[key];
      if (!rows || rows.length === 0) continue;
      const table = tables.get(key)!;
      const ledger = LEDGER_KEYS.has(key);
      for (const row of rows as Array<{ id: string; updatedAt: string }>) {
        const existing = table.get(row.id);
        if (ledger) {
          if (existing) continue; // insert-if-absent, never overwritten
        } else if (existing && !(row.updatedAt > existing.updatedAt)) {
          continue; // LWW: only a strictly newer `updatedAt` wins
        }
        seq += 1;
        table.set(row.id, { ...row, __seq: seq });
        accepted += 1;
        maxSeq = Math.max(maxSeq, seq);
      }
    }
    return { accepted, cursor: String(maxSeq) };
  }

  function pull(cursorParam: string | null): SyncPullResult {
    const cursor = cursorParam ? Number(cursorParam) : 0;
    const changes: SyncPayload = {};
    let anyRows = false;
    let anyTruncated = false;
    let overallMax = cursor;
    let truncatedMin = Number.POSITIVE_INFINITY;

    for (const key of TABLE_KEYS) {
      const table = tables.get(key)!;
      const rows = Array.from(table.values())
        .filter((r) => r.__seq > cursor)
        .sort((a, b) => a.__seq - b.__seq)
        .slice(0, pullLimit);
      if (rows.length === 0) continue;

      anyRows = true;
      const maxSeq = rows.reduce((m, r) => Math.max(m, r.__seq), 0);
      overallMax = Math.max(overallMax, maxSeq);
      (changes as Record<string, unknown[]>)[key] = rows.map(({ __seq: _seq, ...rest }) => rest);

      if (rows.length >= pullLimit) {
        anyTruncated = true;
        truncatedMin = Math.min(truncatedMin, maxSeq);
      }
    }

    const nextCursor = anyTruncated ? truncatedMin : anyRows ? overallMax : cursor;
    if (roster.length > 0) {
      changes.users = roster;
    }
    return { changes, cursor: String(nextCursor), hasMore: anyTruncated };
  }

  const transport: SyncTransport = {
    push: async (changes) => push(changes),
    pull: async (cursor) => pull(cursor),
  };

  return { transport, setRoster: (next: MemberDto[]) => (roster = next) };
}

/** Wraps a transport so its `push`/`pull` reject until `failures` calls have been made. */
export function withFailures(transport: SyncTransport, failures: number): SyncTransport {
  let remaining = failures;
  function maybeFail<T>(fn: () => Promise<T>): Promise<T> {
    if (remaining > 0) {
      remaining -= 1;
      return Promise.reject(new Error("network unavailable"));
    }
    return fn();
  }
  return {
    push: (changes) => maybeFail(() => transport.push(changes)),
    pull: (cursor) => maybeFail(() => transport.pull(cursor)),
  };
}

/** A `Clock` whose `now()` reads a variable this helper's `set()` can move — one
 *  live source of truth a test can hand to both `setClock` (repo stamps) and
 *  `createSyncEngine` (push quarantine / `lastPushedAt`) without them drifting apart. */
export function createControllableClock(initialIso: string): Clock & { set(iso: string): void; advance(ms: number): void } {
  let current = new Date(initialIso);
  return {
    now: () => current,
    set(iso: string) {
      current = new Date(iso);
    },
    advance(ms: number) {
      current = new Date(current.getTime() + ms);
    },
  };
}

/** Fixture data re-homed so `displayName` is the local device's self user —
 *  simulates a second household member's own device without inventing a
 *  parallel fixture set. */
export function seedAs(displayName: string): Partial<FixtureData> {
  const data = cloneFixtures();
  data.users = data.users.map((u) => ({ ...u, isSelf: u.displayName === displayName }));
  return data;
}
