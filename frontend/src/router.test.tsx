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
      expect(screen.queryByRole("heading", { level: 1, name: "Pets" })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { level: 1, name: "Supplies" })).not.toBeInTheDocument();
    });

    it("renders the Pets stub at /pets", async () => {
      renderApp("/pets");

      const title = await screen.findByRole("heading", { level: 1, name: "Pets" });
      expect(title).toBeInTheDocument();
      expect(screen.queryByRole("heading", { level: 1, name: "Today" })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { level: 1, name: "Supplies" })).not.toBeInTheDocument();
    });

    it("renders the Supplies stub at /supplies", async () => {
      renderApp("/supplies");

      const title = await screen.findByRole("heading", { level: 1, name: "Supplies" });
      expect(title).toBeInTheDocument();
      expect(screen.queryByRole("heading", { level: 1, name: "Today" })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { level: 1, name: "Pets" })).not.toBeInTheDocument();
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
      await screen.findByRole("heading", { level: 1, name: "Pets" });
      expect(router.state.location.pathname).toBe("/pets");

      await user.click(within(nav).getByRole("button", { name: /supplies/i }));
      await screen.findByRole("heading", { level: 1, name: "Supplies" });
      expect(router.state.location.pathname).toBe("/supplies");
    });
  });
});
