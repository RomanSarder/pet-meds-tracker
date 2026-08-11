// The other half of symptom A's fix: `sync/engine.ts`'s `syncOnce()` writing
// to IndexedDB was never enough on its own — nothing told React Query's
// `staleTime: 0` queries to refetch, so a screen that had already rendered
// (empty, since it mounted before the first background sync cycle finished)
// stayed exactly as it was until a manual reload or window refocus. This
// proves `sync/index.ts` closes that gap: a cycle that actually applies
// changes invalidates the query cache; a cycle that applies nothing does not.
//
// Same `vi.resetModules()`-per-test pattern as `sessionGate.test.ts`, and for
// the same reason: `sync/index.ts` keeps a module-level scheduler singleton,
// and `@/queryClient` must be the SAME fresh module instance that singleton
// closes over, or spying on a different copy would observe nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRepo } from "@/data/memoryRepo";
import { clearSessionEstablished, markSessionEstablished } from "@/shared/session";

function emptyPullResponse() {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify({ changes: {}, cursor: "0", hasMore: false })),
  };
}

function pullResponseWithAPet() {
  const pet = {
    id: "10000000-0000-0000-0000-000000000099",
    name: "Synced Pet",
    species: "rabbit",
    birthdate: null,
    weightGrams: null,
    tint: 1,
    archived: false,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    deletedAt: null,
  };
  return {
    ok: true,
    status: 200,
    text: () =>
      Promise.resolve(JSON.stringify({ changes: { pets: [pet] }, cursor: "1", hasMore: false })),
  };
}

function pushResponse() {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify({ accepted: 0, cursor: "0" })),
  };
}

async function loadSync() {
  vi.resetModules();
  const { setRepo: setRepoFresh } = await import("@/data");
  setRepoFresh(createMemoryRepo({ pets: [], medications: [], courses: [], doseEvents: [], stockAdjustments: [], joinCodes: [] }));
  const { queryClient } = await import("@/queryClient");
  const sync = await import("../index");
  return { ...sync, queryClient };
}

describe("a sync cycle that changes local data invalidates the query cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearSessionEstablished();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearSessionEstablished();
  });

  it("invalidates every query after a cycle that pulls a real change", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes("/sync/push")) return Promise.resolve(pushResponse());
      return Promise.resolve(pullResponseWithAPet());
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { startBackgroundSync, stopBackgroundSync, queryClient } = await loadSync();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    markSessionEstablished();
    startBackgroundSync();
    await vi.advanceTimersByTimeAsync(0);

    expect(invalidateSpy).toHaveBeenCalled();
    stopBackgroundSync();
  });

  it("does not invalidate anything when a cycle pulls nothing new", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes("/sync/push")) return Promise.resolve(pushResponse());
      return Promise.resolve(emptyPullResponse());
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { startBackgroundSync, stopBackgroundSync, queryClient } = await loadSync();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    markSessionEstablished();
    startBackgroundSync();
    await vi.advanceTimersByTimeAsync(0);

    expect(invalidateSpy).not.toHaveBeenCalled();
    stopBackgroundSync();
  });
});
