// Covers the session-lifecycle guard in `router.ts` (WA-DESIGN §D4): the
// offline cold start, the 401-vs-NetworkError divergence in what happens to
// `sessionEstablished`, and account switching when the local store's owner
// no longer matches the signed-in user.
//
// Kept out of `router.test.tsx` on purpose. That file asserts on rendered
// screen content (headings, tab labels) and is under concurrent edit for a
// heading-markup change; this file instead asserts on the guard's own
// `beforeLoad` behaviour (redirects, `sessionEstablished`, store ownership).
// Living apart means the two files never touch the same lines.
//
// Self-contained: nothing here is imported from router.test.tsx. Shared
// helpers (the `TODAY_HEADING` matcher, response builders, the "build a
// fresh Router from the shared routeTree per test" harness) are duplicated
// rather than imported, matching router.test.tsx's own header comment on why
// each test builds its own `Router` from `router.routeTree` instead of
// mutating the singleton: TanStack Router keeps a match cache alive across
// `router.update()` calls, so reusing the singleton across tests let a prior
// test's resolved location leak into the next one.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import type { SessionUser } from "@pet-tracker/shared";
import type { Household, Pet, User } from "@/domain";
import { DEFAULT_SELF_DISPLAY_NAME } from "@/domain";
import { setRepo } from "@/data";
import { createMemoryRepo } from "@/data/memoryRepo";
import { getStoreOwner, isSessionEstablished, markSessionEstablished, setStoreOwner } from "@/shared/session";
import { router as appRouter } from "./router";
import { queryClient as appQueryClient } from "./queryClient";
import { LocaleProvider } from "@/i18n";

/**
 * How this file recognises that the Today screen is mounted.
 *
 * It used to look for the literal text "Today", which was the heading of the
 * W0 route stub (`<EmptyState title="Today" />`). SPEC §5.1 requires that
 * heading to be the time-of-day greeting instead, so slice 5 removed the word
 * "Today" from the screen — the assertion was pinning a stub, not a
 * requirement, and failed precisely because the code became correct.
 *
 * The regex covers all three greetings because these tests run on the system
 * clock, not an injected one. Anchored with `^…$` so it matches the heading
 * itself and not a longer string containing it. Every one of these tests also
 * asserts `router.state.location.pathname`, which is the stable, slice-proof
 * half of the check.
 */
const TODAY_HEADING = /^Good (morning|afternoon|evening)$/;

const SESSION_USER: SessionUser = { id: "user-1", email: "owner@example.com" };
const originalFetch = globalThis.fetch;

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function unauthorizedResponse(): Response {
  return {
    ok: false,
    status: 401,
    statusText: "Unauthorized",
    json: async () => ({ message: "Not signed in" }),
    text: async () => JSON.stringify({ message: "Not signed in" }),
  } as Response;
}

function notFoundResponse(): Response {
  return {
    ok: false,
    status: 404,
    statusText: "Not Found",
    json: async () => ({ message: "Not Found" }),
    text: async () => JSON.stringify({ message: "Not Found" }),
  } as Response;
}

/**
 * `hasHousehold` controls what `GET /household` answers (200 vs 404), which
 * is exactly what `appIndexRoute`'s beforeLoad reads to choose between
 * /today and /welcome. `householdNetworkError` models the household check
 * itself being unreachable (offline, a dropped connection) — distinct from
 * `mockUnauthenticated`, which models no session at all.
 */
function mockAuthenticated(opts?: { hasHousehold?: boolean; householdNetworkError?: boolean }) {
  const hasHousehold = opts?.hasHousehold ?? true;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/auth/me")) {
      return okResponse(SESSION_USER);
    }
    if (url.endsWith("/household")) {
      if (opts?.householdNetworkError) {
        throw new TypeError("network error");
      }
      return hasHousehold ? okResponse({}) : notFoundResponse();
    }
    return okResponse(SESSION_USER);
  });
}

function mockUnauthenticated() {
  globalThis.fetch = vi.fn().mockResolvedValue(unauthorizedResponse());
}

/** Models a transport-level failure on every request — offline, DNS failure,
 *  connection reset — the same raw `fetch` rejection `apiClient` wraps into a
 *  `NetworkError` (shared/api.ts). Distinct from `mockUnauthenticated`, which
 *  models the server actively answering 401. */
function mockNetworkError() {
  globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
}

const HOUSEHOLD: Household = {
  id: "hh-1",
  name: "Home",
  createdAt: "2026-06-01T09:00:00.000Z",
  updatedAt: "2026-06-01T09:00:00.000Z",
  deletedAt: null,
};

function selfUser(overrides: Partial<User> = {}): User {
  return {
    id: "u-previous",
    householdId: HOUSEHOLD.id,
    email: null,
    displayName: "Previous Owner",
    tint: 1,
    isSelf: true,
    joinedAt: "2026-06-12T09:00:00.000Z",
    createdAt: "2026-06-12T09:00:00.000Z",
    updatedAt: "2026-06-12T09:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function seedPet(overrides: Partial<Pet> = {}): Pet {
  return {
    id: "pet-1",
    name: "Biscuit",
    species: "rabbit",
    birthdate: null,
    weightGrams: null,
    tint: 1,
    archived: false,
    householdId: HOUSEHOLD.id,
    createdAt: "2026-07-01T09:00:00.000Z",
    updatedAt: "2026-07-01T09:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

/** An empty local store: no domain rows at all, so `localStoreIsDisposable`
 *  reads `true` unconditionally regardless of `lastPushedAt` (design §D3b).
 *  Overrides `HOUSEHOLD`'s given name to `null` and the self user's display
 *  name to the default: a customised name on either would make the store
 *  non-disposable regardless of domain rows (localStore.ts's identity-content
 *  check), which is not what this fixture is testing. */
function emptyDisposableRepo() {
  return createMemoryRepo({
    household: { ...HOUSEHOLD, name: null },
    users: [selfUser({ displayName: DEFAULT_SELF_DISPLAY_NAME })],
    pets: [],
    medications: [],
    courses: [],
    doseEvents: [],
    stockAdjustments: [],
    joinCodes: [],
  });
}

/** A local store holding one unsynced pet row with `lastPushedAt` still
 *  null — never disposable (design §D3b: `lastPushedAt === null` -> `false`). */
function unsyncedRepo() {
  return createMemoryRepo({
    household: HOUSEHOLD,
    users: [selfUser()],
    pets: [seedPet()],
    medications: [],
    courses: [],
    doseEvents: [],
    stockAdjustments: [],
    joinCodes: [],
  });
}

/**
 * Renders the real app at `initialEntry`, wired through providers by hand
 * (AppShell mounts its own DsRoot/ToastProvider, so this harness must not
 * add another layer). The guard's `beforeLoad` reads the app's own
 * `queryClient` singleton (imported directly by router.ts, not via
 * context) — that singleton's cache is cleared before every render so a
 * prior test's cached session (or error) can never leak into this one.
 * `testQueryClient` only stands in for a component that might call
 * `useQueryClient()`; nothing here currently does.
 *
 * `LocaleProvider` is included because `main.tsx` wraps the real
 * `RouterProvider` in one — `AppShell` calls `useT()` and throws outside a
 * provider, so this hand-built stack must mirror that wrapping to render the
 * real tree at all. Defaults to English, same as `renderWithProviders`.
 */
function renderApp(initialEntry: string) {
  appQueryClient.clear();
  const router = createRouter({
    routeTree: appRouter.routeTree,
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  const testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={testQueryClient}>
      <LocaleProvider initialLocale="en">
        <RouterProvider router={router} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return { ...result, router };
}

describe("router", () => {
  beforeEach(() => {
    // The two client-side session records (shared/session.ts) must never
    // leak between tests — each case below sets up exactly the localStorage
    // state its scenario needs.
    localStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // WA-DESIGN §D4's three-way guard: only a 401 revokes `sessionEstablished`;
  // a `NetworkError` (or any other non-401 failure) is an absence of
  // information and must never revoke or crash; and the store-owner check
  // must never destroy unsynced data without a human choosing to.
  describe("session guard (design §D4)", () => {
    it("established=true, fetch rejects (NetworkError) -> lands on /today, not the ErrorBoundary", async () => {
      markSessionEstablished();
      mockNetworkError();

      const { router } = renderApp("/today");

      await screen.findByText(TODAY_HEADING);
      expect(router.state.location.pathname).toBe("/today");
      // Never revoked: a NetworkError is an absence of information, not the
      // server saying no.
      expect(isSessionEstablished()).toBe(true);
    });

    it("401 redirects to /sign-in AND clears sessionEstablished — the two paths diverge from the same guard", async () => {
      markSessionEstablished();
      mockUnauthenticated();

      const { router } = renderApp("/today");

      await screen.findByText("Sign in");
      expect(router.state.location.pathname).toBe("/sign-in");
      expect(isSessionEstablished()).toBe(false);
    });

    // The test above still passes even if the router guard's own 401 branch
    // is broken: `queryClient.ts`'s global `QueryCache.onError` ALSO clears
    // `sessionEstablished` on any 401 (design §D6), so on a broken guard the
    // non-401 fallback would find nothing established and redirect to
    // /sign-in anyway — same outcome, wrong code path. That interlock is
    // legitimate defence in depth, not a bug, but it means the test above
    // does not isolate what it claims to. This test neutralises the global
    // handler for its own duration so a 401 can ONLY be handled by the
    // guard's dedicated branch, proving that branch redirects and clears the
    // flag on its own.
    it("401 redirects to /sign-in via the guard's own branch, with the global QueryCache handler neutralised", async () => {
      const originalOnError = appQueryClient.getQueryCache().config.onError;
      appQueryClient.getQueryCache().config.onError = undefined;
      try {
        markSessionEstablished();
        mockUnauthenticated();

        const { router } = renderApp("/today");

        await screen.findByText("Sign in");
        expect(router.state.location.pathname).toBe("/sign-in");
        expect(isSessionEstablished()).toBe(false);
      } finally {
        appQueryClient.getQueryCache().config.onError = originalOnError;
      }
    });

    it("first-ever load offline, no prior session -> redirects to /sign-in, does not enter the app", async () => {
      expect(isSessionEstablished()).toBe(false); // nothing established yet
      mockNetworkError();

      const { router } = renderApp("/today");

      await screen.findByText("Sign in");
      expect(router.state.location.pathname).toBe("/sign-in");
      expect(isSessionEstablished()).toBe(false);
    });

    it("owner mismatch + disposable store: resets the local store, claims ownership for the new user, and lets them in", async () => {
      setStoreOwner("u-previous");
      const repo = emptyDisposableRepo();
      const resetSpy = vi.spyOn(repo, "resetLocalHousehold");
      setRepo(repo);
      mockAuthenticated(); // SESSION_USER.id = "user-1", different from "u-previous"

      const { router } = renderApp("/today");

      await screen.findByText(TODAY_HEADING);
      expect(router.state.location.pathname).toBe("/today");
      expect(resetSpy).toHaveBeenCalledTimes(1);
      expect(getStoreOwner()).toBe(SESSION_USER.id);
    });

    it("owner mismatch + NON-disposable (unsynced) store: blocks at /account-switch, and resetLocalHousehold is never called", async () => {
      setStoreOwner("u-previous");
      const repo = unsyncedRepo();
      const resetSpy = vi.spyOn(repo, "resetLocalHousehold");
      setRepo(repo);
      mockAuthenticated(); // SESSION_USER.id = "user-1", different from "u-previous"

      const { router } = renderApp("/today");

      await screen.findByText("Another account's data is on this device");
      expect(router.state.location.pathname).toBe("/account-switch");
      expect(resetSpy).not.toHaveBeenCalled();
      // Nothing destroyed, and the new user was never granted the store —
      // both survive the blocked navigation intact.
      expect(getStoreOwner()).toBe("u-previous");
      expect(await repo.listPets()).toHaveLength(1);
    });

    // The two cases below pin the FAIL-CLOSED rule on the owner-mismatch
    // branch's error paths, which the two tests above do not reach.
    //
    // Why this needs its own coverage: the outer guard deliberately fails
    // OPEN on a repo/network failure (`if (isSessionEstablished()) return`),
    // because there it does not know who the user is and an absence of
    // information must not revoke a session. Inside the owner-mismatch
    // branch that reasoning inverts. By the time it runs, `/auth/me` has
    // already succeeded ONLINE and identified user B, and `getStoreOwner()`
    // is already known to be a DIFFERENT user A — that is the only way the
    // branch is reached. `isSessionEstablished()` being true there only
    // means SOME session (A's) was once live on this device; it says nothing
    // about B. Falling open would enter the app shell without resetting and
    // without blocking, and AppShell/TodayPage/PetsPage read IndexedDB
    // directly (SPEC §9) — so B would see A's rows.
    //
    // That is precisely the defect found in review of 4bfd9ce and fixed in
    // 20b37ce. The source is correct today; these tests exist so a future
    // refactor cannot quietly reintroduce it.

    it("owner mismatch + the disposability check THROWS: fails closed to /account-switch, never enters the app", async () => {
      setStoreOwner("u-previous");
      const repo = unsyncedRepo();
      // `localStoreIsDisposable` reads the store through `exportHousehold`
      // (data/localStore.ts) and does not catch — so a storage failure there
      // surfaces as a rejection out of the disposability check itself, which
      // is the condition under test. Models a real IndexedDB failure: a
      // QuotaExceededError, a version-change block, or a transient abort on
      // the wide multi-store read it opens.
      const exportSpy = vi
        .spyOn(repo, "exportHousehold")
        .mockRejectedValue(new Error("IndexedDB unavailable"));
      const resetSpy = vi.spyOn(repo, "resetLocalHousehold");
      setRepo(repo);
      markSessionEstablished(); // the fail-open fallback's precondition — must NOT rescue this branch
      mockAuthenticated(); // SESSION_USER.id = "user-1", different from "u-previous"

      const { router } = renderApp("/today");

      await screen.findByText("Another account's data is on this device");
      expect(router.state.location.pathname).toBe("/account-switch");
      expect(exportSpy).toHaveBeenCalled();
      // Neither destroyed nor handed over: the store is untouched and still
      // belongs to the previous account, and A's rows were never rendered.
      expect(resetSpy).not.toHaveBeenCalled();
      expect(getStoreOwner()).toBe("u-previous");
      expect(screen.queryByText(TODAY_HEADING)).toBeNull();
    });

    it("owner mismatch + resetLocalHousehold THROWS after disposability said true: fails closed to /account-switch, never enters the app", async () => {
      setStoreOwner("u-previous");
      const repo = emptyDisposableRepo(); // disposability resolves true, so the reset is attempted
      const resetSpy = vi
        .spyOn(repo, "resetLocalHousehold")
        .mockRejectedValue(new Error("IndexedDB transaction aborted"));
      setRepo(repo);
      markSessionEstablished(); // again: must NOT rescue this branch into the app
      mockAuthenticated();

      const { router } = renderApp("/today");

      await screen.findByText("Another account's data is on this device");
      expect(router.state.location.pathname).toBe("/account-switch");
      // The reset was genuinely attempted and genuinely failed — so the store
      // may be in a half-cleared state, which is exactly why entering the app
      // here is unsafe and ownership must not transfer.
      expect(resetSpy).toHaveBeenCalledTimes(1);
      expect(getStoreOwner()).toBe("u-previous");
      expect(screen.queryByText(TODAY_HEADING)).toBeNull();
    });
  });
});
