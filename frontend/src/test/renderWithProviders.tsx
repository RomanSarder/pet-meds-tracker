// The most-shared file on this branch: every UI-facing component test in the
// app renders through this harness rather than assembling providers by hand.
//
// THE LOAD-BEARING PROPERTY — do not weaken it: this harness installs the
// active repo through `setRepo()` (see `@/data`), and every call site in the
// app reads storage through `getRepo()` — never `new MemoryRepo()` or
// `new IdbRepo()` directly. That indirection means a UI worker's test written
// *before* the real IndexedDB repo exists keeps passing *after* it lands: the
// component under test never knows which `Repo` implementation it is talking
// to, only that `renderWithProviders` put one there before it rendered. Do
// not "simplify" this by having callers construct or pass a repo directly to
// the component tree.
import { type ReactElement } from "react";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DsRoot } from "@/components/ds";
import { ToastProvider } from "@/app/Toast";
import { FIXTURE_NOW, fixedClock, setClock } from "@/domain";
import { setRepo } from "@/data";
import { createMemoryRepo } from "@/data/memoryRepo";
import type { Repo } from "@/data/repo.types";
import { LocaleProvider, LOCALE_STORAGE_KEY, type Locale } from "@/i18n";

export { userEvent };

/**
 * Builds a standalone memory router local to this harness, instead of
 * importing `@/router`.
 *
 * `@/router`'s real route tree is auth-gated by a pathless layout route whose
 * `beforeLoad` calls `/auth/me` over the network. Reusing it here would make
 * every component test depend on a fake (or mocked) network round-trip
 * before anything rendered. Instead this harness builds its own minimal
 * tree: a root route plus a single splat/catch-all child (`path: "$"`) whose
 * `component` renders whatever `ui` the caller passed. A splat route matches
 * any path string, so it works for `"/"`, `"/today"`, `"/pets/abc-123"`, or
 * anything else a caller supplies as `opts.route` — see
 * `renderWithProviders.test.tsx` for those three cases exercised directly.
 *
 * Consequence, documented rather than hidden: because this tree has no
 * `/pets/$petId`-shaped route, a component that calls
 * `useParams({ from: "/pets/$petId" })` will not resolve against this router
 * — that typed lookup only works inside the real app tree. Tests for such
 * components should pass the id in as a prop, or stub the hook, rather than
 * rely on this harness to parse it out of the URL. That is a deliberate
 * trade: this harness buys freedom from the auth gate at the cost of typed
 * route params.
 */
function createTestRouter(ui: ReactElement, route: string) {
  const rootRoute = createRootRoute({ component: Outlet });
  const catchAllRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "$",
    component: () => ui,
  });
  const routeTree = rootRoute.addChildren([catchAllRoute]);
  const history = createMemoryHistory({ initialEntries: [route] });
  return createRouter({ routeTree, history });
}

export function renderWithProviders(
  ui: ReactElement,
  opts?: { repo?: Repo; now?: string; route?: string; locale?: Locale },
): RenderResult & { repo: Repo; queryClient: QueryClient } {
  // Install the repo and clock BEFORE anything renders, so the very first
  // effect/render pass already sees them.
  const repo = opts?.repo ?? createMemoryRepo();
  setRepo(repo);
  setClock(fixedClock(opts?.now ?? FIXTURE_NOW));

  // Reset locale state so no test leaks a language into the next one. Pinned
  // to English by default — the 963 pre-i18n tests assert English copy and
  // must keep meaning what they meant; pass `{ locale: "uk" }` to opt into
  // Ukrainian coverage deliberately.
  const locale = opts?.locale ?? "en";
  try {
    localStorage.removeItem(LOCALE_STORAGE_KEY);
  } catch {
    // private mode / storage disabled — nothing to reset.
  }
  document.documentElement.lang = locale;

  const queryClient = new QueryClient({
    // Silence query-error console noise: without this, a component under
    // test that hits a rejected query prints a stack trace to the vitest
    // reporter even when the test itself asserts on the resulting UI state.
    queryCache: new QueryCache({ onError: () => {} }),
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  const router = createTestRouter(ui, opts?.route ?? "/");

  const result = render(
    <QueryClientProvider client={queryClient}>
      <LocaleProvider initialLocale={locale}>
        <DsRoot>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </DsRoot>
      </LocaleProvider>
    </QueryClientProvider>,
  );

  return { ...result, repo, queryClient };
}
