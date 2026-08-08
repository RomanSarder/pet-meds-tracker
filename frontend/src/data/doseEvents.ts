// The shared live-event resolution rule (SPEC §8): among the DoseEvents that
// share an `occurrenceKey`, exactly one — if any — is "live". Both the engine
// (W2) and the Today screen (W4) need this, so it lives here as a pure
// function over an array rather than being reimplemented per caller.
import type { DoseEvent } from "@/domain";

/** Ties on `loggedAt` are broken by `id` (lexicographically greatest wins) —
 *  an arbitrary but deterministic rule, since two rows for the same
 *  occurrence can't otherwise be ordered. */
function isNewer(a: DoseEvent, b: DoseEvent): boolean {
  if (a.loggedAt !== b.loggedAt) return a.loggedAt > b.loggedAt;
  return a.id > b.id;
}

function supersededIds(events: DoseEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const e of events) {
    if (e.deletedAt !== null) continue;
    if (e.supersedesId !== null) ids.add(e.supersedesId);
  }
  return ids;
}

/**
 * Among events sharing an occurrenceKey, the live one is the newest by
 * `loggedAt` that no other event supersedes. Ignores soft-deleted rows.
 */
export function liveDoseEvent(events: DoseEvent[], occurrenceKey: string): DoseEvent | null {
  const superseded = supersededIds(events);
  let live: DoseEvent | null = null;
  for (const e of events) {
    if (e.deletedAt !== null) continue;
    if (e.occurrenceKey !== occurrenceKey) continue;
    if (superseded.has(e.id)) continue;
    if (!live || isNewer(e, live)) live = e;
  }
  return live;
}

/** One live event per occurrenceKey. */
export function liveDoseEvents(events: DoseEvent[]): DoseEvent[] {
  const superseded = supersededIds(events);
  const byKey = new Map<string, DoseEvent>();
  for (const e of events) {
    if (e.deletedAt !== null) continue;
    if (superseded.has(e.id)) continue;
    const current = byKey.get(e.occurrenceKey);
    if (!current || isNewer(e, current)) byKey.set(e.occurrenceKey, e);
  }
  return Array.from(byKey.values());
}
