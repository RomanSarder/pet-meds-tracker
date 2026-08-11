// Background sync must be silent for a visitor who has never had a session,
// and must give up rather than back off when the server says the session is
// gone. Before this lock, `main.tsx` started the scheduler unconditionally at
// module load, so a signed-out visitor sitting on /sign-in produced a stream
// of `/api/sync/pull` requests that could only ever 401.
//
// The module singleton in `sync/index.ts` is per-module-instance state, so
// every test here re-imports it under `vi.resetModules()` rather than sharing
// one instance across cases.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRepo } from "@/data/memoryRepo";
import { clearSessionEstablished, markSessionEstablished } from "@/shared/session";

function pullResponse() {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify({ changes: {}, cursor: "cursor-1", hasMore: false })),
  };
}

function unauthorizedResponse() {
  return {
    ok: false,
    status: 401,
    statusText: "Unauthorized",
    json: () => Promise.resolve({ error: "Unauthorized" }),
  };
}

function pullCalls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => url.includes("/sync/"));
}

/**
 * `vi.resetModules()` gives every test its own copy of `sync/index.ts` (and
 * of everything it imports), so the repo must be registered on THAT copy of
 * `@/data` — a `setRepo` called on this file's static import would land on a
 * different module instance and leave `getRepo()` unset inside the scheduler.
 */
async function loadSync() {
  vi.resetModules();
  const { setRepo: setRepoFresh } = await import("@/data");
  setRepoFresh(createMemoryRepo());
  return import("../index");
}

describe("background sync is gated on a session", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    clearSessionEstablished();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    clearSessionEstablished();
  });

  it("issues no sync request at all when no session has ever been established", async () => {
    const fetchMock = vi.fn().mockResolvedValue(pullResponse());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { startBackgroundSync } = await loadSync();
    startBackgroundSync();

    // A full poll interval and then some: not one request, not a delayed one.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pullCalls(fetchMock)).toEqual([]);
  });

  it("starts polling once a session is established", async () => {
    const fetchMock = vi.fn().mockResolvedValue(pullResponse());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { startBackgroundSync, stopBackgroundSync } = await loadSync();
    markSessionEstablished();
    startBackgroundSync();

    await vi.advanceTimersByTimeAsync(0);
    expect(pullCalls(fetchMock).length).toBeGreaterThan(0);

    stopBackgroundSync();
  });

  it("stops for good on a 401 instead of retrying it on backoff", async () => {
    const fetchMock = vi.fn().mockResolvedValue(unauthorizedResponse());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { startBackgroundSync } = await loadSync();
    markSessionEstablished();
    startBackgroundSync();

    await vi.advanceTimersByTimeAsync(0);
    const afterFirstCycle = pullCalls(fetchMock).length;
    expect(afterFirstCycle).toBe(1);

    // Past the whole backoff ladder (1s → 2s → … → 5 min cap) and a tab
    // focus on top: a revoked session is not a transient failure, so none of
    // these may produce another request.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(pullCalls(fetchMock).length).toBe(afterFirstCycle);
  });

  it("resumes after a fresh sign-in following a 401 stop", async () => {
    const fetchMock = vi.fn().mockResolvedValue(unauthorizedResponse());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { startBackgroundSync, stopBackgroundSync } = await loadSync();
    markSessionEstablished();
    startBackgroundSync();
    await vi.advanceTimersByTimeAsync(0);
    const afterRevoke = pullCalls(fetchMock).length;

    // What the router guard does the moment /auth/me succeeds again.
    fetchMock.mockResolvedValue(pullResponse());
    startBackgroundSync();
    await vi.advanceTimersByTimeAsync(0);

    expect(pullCalls(fetchMock).length).toBeGreaterThan(afterRevoke);
    stopBackgroundSync();
  });
});
