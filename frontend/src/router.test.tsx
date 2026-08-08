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

function mockAuthenticated() {
  globalThis.fetch = vi.fn().mockResolvedValue(okResponse(SESSION_USER));
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

    it("redirects / to /today", async () => {
      const { router } = renderApp("/");

      await screen.findByText("Today", { selector: "div" });
      expect(router.state.location.pathname).toBe("/today");
    });

    it("renders the Today stub at /today", async () => {
      renderApp("/today");

      const title = await screen.findByText("Today", { selector: "div" });
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
      await screen.findByText("Today", { selector: "div" });

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
});
