// Exercises the REAL route tree exported from `./router` — not a synthetic
// one — so this test covers exactly what a browser would have proven had it
// been reachable in this environment (backend requires DATABASE_URL;
// Playwright navigation was denied). Per the brief: don't modify router.ts,
// don't reuse renderWithProviders (it deliberately builds its own splat
// router to dodge the auth gate — the opposite of what this file needs to
// exercise).
//
// Each test builds its own `Router` instance from the SAME exported
// `routeTree` (`router.routeTree` — a public field on the singleton) rather
// than mutating the singleton `router` in place. Reusing the singleton
// across tests (swapping only its `history` via `router.update()`) was
// tried first and produced cross-test pollution: TanStack Router keeps a
// match cache alive across `update()` calls, and the guard's `beforeLoad`
// simply did not re-run on the second render — the previous test's
// resolved location won even though `fetch` had been remocked. A fresh
// `Router` per test (still the identical `routeTree` object, so still the
// real tree) sidesteps that entirely.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionUser } from "@pet-tracker/shared";
import type { Household, Pet, User } from "@/domain";
import { setRepo } from "@/data";
import { createMemoryRepo } from "@/data/memoryRepo";
import { getStoreOwner, isSessionEstablished, markSessionEstablished, setStoreOwner } from "@/shared/session";
import { router as appRouter } from "./router";
import { queryClient as appQueryClient } from "./queryClient";

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
 *
 * The tab bar would be the other natural anchor, but the design system's
 * `TabBar` (frozen this wave) marks its active tab with colour alone — no
 * `aria-selected`, no `aria-current` — so there is nothing to assert against.
 * That is worth fixing upstream in the DS; it is not fixable from here.
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
 *  reads `true` unconditionally regardless of `lastPushedAt` (design §D3b). */
function emptyDisposableRepo() {
  return createMemoryRepo({
    household: HOUSEHOLD,
    users: [selfUser()],
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
      <RouterProvider router={router} />
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

  describe("unauthenticated", () => {
    beforeEach(() => {
      mockUnauthenticated();
    });

    it("redirects /today to /sign-in", async () => {
      const { router } = renderApp("/today");

      await screen.findByText("Sign in");
      expect(router.state.location.pathname).toBe("/sign-in");
    });
  });

  describe("authenticated", () => {
    beforeEach(() => {
      mockAuthenticated();
    });

    it("redirects / to /today when the signed-in user already has a server-side household", async () => {
      const { router } = renderApp("/");

      await screen.findByText(TODAY_HEADING);
      expect(router.state.location.pathname).toBe("/today");
    });

    // SPEC §6.9 / defect 1: a freshly verified user (or an existing account
    // stranded with `household_id` null server-side) must land on the
    // first-run screen instead of an app whose sync 404s forever.
    it("redirects / to /welcome when the signed-in user has no server-side household", async () => {
      mockAuthenticated({ hasHousehold: false });
      const { router } = renderApp("/");

      await screen.findByText("What should we call you?");
      expect(router.state.location.pathname).toBe("/welcome");
    });

    // The household check must fail OPEN: an offline or flaky household
    // lookup must not trap an otherwise fully offline-capable user (SPEC §9)
    // on /welcome, and must not throw/hang the navigation.
    it("redirects / to /today when the household check cannot reach the network", async () => {
      mockAuthenticated({ householdNetworkError: true });
      const { router } = renderApp("/");

      await screen.findByText(TODAY_HEADING);
      expect(router.state.location.pathname).toBe("/today");
    });

    // /welcome itself carries no household guard — only "/" does — so
    // reaching it directly never redirect-loops back through the check.
    it("does not redirect away from /welcome (no household guard on ordinary navigation)", async () => {
      mockAuthenticated({ hasHousehold: false });
      const { router } = renderApp("/welcome");

      await screen.findByText("What should we call you?");
      expect(router.state.location.pathname).toBe("/welcome");
    });

    it("renders the Today screen at /today", async () => {
      renderApp("/today");

      const title = await screen.findByText(TODAY_HEADING);
      expect(title).toBeInTheDocument();
      expect(screen.queryByText("Pets", { selector: "div" })).not.toBeInTheDocument();
      expect(screen.queryByText("Supplies", { selector: "div" })).not.toBeInTheDocument();
    });

    it("renders the Pets stub at /pets", async () => {
      renderApp("/pets");

      const title = await screen.findByText("Pets", { selector: "div" });
      expect(title).toBeInTheDocument();
      expect(screen.queryByText("Today", { selector: "div" })).not.toBeInTheDocument();
      expect(screen.queryByText("Supplies", { selector: "div" })).not.toBeInTheDocument();
    });

    it("renders the Supplies stub at /supplies", async () => {
      renderApp("/supplies");

      const title = await screen.findByText("Supplies", { selector: "div" });
      expect(title).toBeInTheDocument();
      expect(screen.queryByText("Today", { selector: "div" })).not.toBeInTheDocument();
      expect(screen.queryByText("Pets", { selector: "div" })).not.toBeInTheDocument();
    });

    it("switches screens via the tab bar", async () => {
      const user = userEvent.setup();
      const { router } = renderApp("/today");
      await screen.findByText(TODAY_HEADING);

      const nav = screen.getByRole("navigation");

      // TabBar's tab button accessible name also picks up the icon's own
      // `aria-label` (e.g. "paw-print Pets"), so match by substring rather
      // than the exact visible label.
      await user.click(within(nav).getByRole("button", { name: /pets/i }));
      await screen.findByText("Pets", { selector: "div" });
      expect(router.state.location.pathname).toBe("/pets");

      await user.click(within(nav).getByRole("button", { name: /supplies/i }));
      await screen.findByText("Supplies", { selector: "div" });
      expect(router.state.location.pathname).toBe("/supplies");
    });
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
  });
});
