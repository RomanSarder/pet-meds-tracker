// A5: this file was entirely missing before — the response swallow, the
// pending/pushed diff, and the mark-only-on-200 behaviour were uncovered.
// Mocks `globalThis.fetch` directly (the same layer `router.test.tsx` mocks)
// since `pushPendingSelfAliases` calls `apiClient` — never a `SyncTransport`
// fake — this is not part of the push/pull sync cycle.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRepo } from "@/data/memoryRepo";
import type { Repo } from "@/data";
import { mergeSelfAliasIds } from "@/sync/mirrorMembers";
import { pushPendingSelfAliases, reconcileSelfIdentity } from "./selfIdentity";

const CANONICAL_ID = "c0000000-0000-4000-8000-0000000000ca";

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as Response;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** A repo whose self row already carries `aliasIds`, bypassing `reconcileSelfId` so each test controls the pending set directly. */
async function repoWithAliases(aliasIds: string[]): Promise<Repo> {
  const repo = createMemoryRepo({
    pets: [],
    medications: [],
    courses: [],
    doseEvents: [],
    stockAdjustments: [],
    joinCodes: [],
  });
  await repo.reconcileSelfId(CANONICAL_ID);
  const self = await repo.getCurrentUser();
  await repo.upsertUser({ ...self, aliasIds });
  return repo;
}

describe("pushPendingSelfAliases", () => {
  it("does nothing (no network call) when the self user has no aliasIds", async () => {
    const repo = await repoWithAliases([]);
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    await pushPendingSelfAliases(repo);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing (no network call) when every aliasId is already recorded as pushed", async () => {
    const OLD_ID = "d0000000-0000-4000-8000-0000000000d1";
    const repo = await repoWithAliases([OLD_ID]);
    await repo.setMeta("selfAliasIdsPushed", [OLD_ID]);
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    await pushPendingSelfAliases(repo);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends only the ids not yet recorded as pushed — the diff, not the whole aliasIds array", async () => {
    const ALREADY_PUSHED = "d0000000-0000-4000-8000-0000000000d1";
    const NEWLY_PENDING = "d0000000-0000-4000-8000-0000000000d2";
    const repo = await repoWithAliases([ALREADY_PUSHED, NEWLY_PENDING]);
    await repo.setMeta("selfAliasIdsPushed", [ALREADY_PUSHED]);
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ aliasIds: [ALREADY_PUSHED, NEWLY_PENDING] }));
    globalThis.fetch = fetchMock;

    await pushPendingSelfAliases(repo);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.ids).toEqual([NEWLY_PENDING]);
  });

  it("marks an id pushed only if the server's response actually echoes it back — the decisive A1 fix", async () => {
    const ACCEPTED = "d0000000-0000-4000-8000-0000000000e1";
    const DROPPED = "d0000000-0000-4000-8000-0000000000e2"; // e.g. lost to a lost update, a collision, or cap eviction
    const repo = await repoWithAliases([ACCEPTED, DROPPED]);
    // The server only confirms ACCEPTED — DROPPED silently did not make it in.
    globalThis.fetch = vi.fn().mockResolvedValue(okResponse({ aliasIds: [ACCEPTED] }));

    await pushPendingSelfAliases(repo);

    const pushed = await repo.getMeta("selfAliasIdsPushed");
    expect(pushed).toEqual([ACCEPTED]);
    expect(pushed).not.toContain(DROPPED);
  });

  it("retries a previously-dropped id on the next call once the server confirms it", async () => {
    const ACCEPTED = "d0000000-0000-4000-8000-0000000000e1";
    const LATER_ACCEPTED = "d0000000-0000-4000-8000-0000000000e2";
    const repo = await repoWithAliases([ACCEPTED, LATER_ACCEPTED]);
    globalThis.fetch = vi.fn().mockResolvedValue(okResponse({ aliasIds: [ACCEPTED] }));
    await pushPendingSelfAliases(repo);
    expect(await repo.getMeta("selfAliasIdsPushed")).toEqual([ACCEPTED]);

    // Second round: the server now confirms the previously-dropped id too.
    globalThis.fetch = vi.fn().mockResolvedValue(okResponse({ aliasIds: [ACCEPTED, LATER_ACCEPTED] }));
    await pushPendingSelfAliases(repo);
    expect(await repo.getMeta("selfAliasIdsPushed")).toEqual([ACCEPTED, LATER_ACCEPTED]);
  });

  it("swallows a network failure and leaves the pending set untouched for the next retry", async () => {
    const PENDING = "d0000000-0000-4000-8000-0000000000f1";
    const repo = await repoWithAliases([PENDING]);
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("network error"));

    await expect(pushPendingSelfAliases(repo)).resolves.toBeUndefined();

    expect(await repo.getMeta("selfAliasIdsPushed")).toBeNull();
  });

  it("does not crash and marks nothing pushed when the server's response body is not shaped like SelfAliasesDto", async () => {
    const PENDING = "d0000000-0000-4000-8000-0000000000f2";
    const repo = await repoWithAliases([PENDING]);
    // A malformed/unexpected 200 body — no `aliasIds` field at all.
    globalThis.fetch = vi.fn().mockResolvedValue(okResponse({ id: "unrelated", email: "x@example.com" }));

    await expect(pushPendingSelfAliases(repo)).resolves.toBeUndefined();

    expect(await repo.getMeta("selfAliasIdsPushed")).toBeNull();
  });

  it("does not crash on a genuinely empty response body (204-shaped)", async () => {
    const PENDING = "d0000000-0000-4000-8000-0000000000f3";
    const repo = await repoWithAliases([PENDING]);
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" } as Response);

    await expect(pushPendingSelfAliases(repo)).resolves.toBeUndefined();

    expect(await repo.getMeta("selfAliasIdsPushed")).toBeNull();
  });
});

describe("reconcileSelfIdentity", () => {
  it("runs both halves: the local id rewrite, then the alias disclosure", async () => {
    const repo = createMemoryRepo({
      pets: [],
      medications: [],
      courses: [],
      doseEvents: [],
      stockAdjustments: [],
      joinCodes: [],
    });
    const localId = await repo.currentActorId();
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      return okResponse({ aliasIds: body.ids });
    });
    globalThis.fetch = fetchMock;

    await reconcileSelfIdentity(repo, CANONICAL_ID);

    expect(await repo.currentActorId()).toBe(CANONICAL_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await repo.getMeta("selfAliasIdsPushed")).toEqual([localId]);
  });

  it("is a no-op on the alias-disclosure network call once already reconciled and already pushed", async () => {
    const repo = createMemoryRepo({
      pets: [],
      medications: [],
      courses: [],
      doseEvents: [],
      stockAdjustments: [],
      joinCodes: [],
    });
    await repo.reconcileSelfId(CANONICAL_ID);
    const self = await repo.getCurrentUser();
    await repo.setMeta("selfAliasIdsPushed", self.aliasIds ?? []);
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    await reconcileSelfIdentity(repo, CANONICAL_ID);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// Sanity check that this file's `repoWithAliases` helper produces exactly
// what `mergeSelfAliasIds` (G1's own helper, exercised end to end in
// `sync/__tests__/memberSync.test.ts`) expects to consume — not duplicate
// coverage, just confirms the two files' fixtures agree on shape.
describe("mergeSelfAliasIds (sanity, full coverage lives in mirrorMembers/engine tests)", () => {
  it("unions into the self row without touching id/isSelf/displayName", async () => {
    const repo = await repoWithAliases(["existing-alias"]);
    const self = await repo.getCurrentUser();

    const changed = await mergeSelfAliasIds(repo, self, ["existing-alias", "new-alias"]);

    expect(changed).toBe(true);
    const after = await repo.getCurrentUser();
    expect(after.aliasIds).toEqual(["existing-alias", "new-alias"]);
    expect(after.id).toBe(self.id);
    expect(after.isSelf).toBe(true);
  });
});
