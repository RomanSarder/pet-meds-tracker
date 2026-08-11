import { createRouter, createRoute, createRootRoute, Outlet, redirect } from "@tanstack/react-router";
import type { SessionUser } from "@pet-tracker/shared";
import { qk } from "@/domain";
import { apiClient, ApiError } from "./shared/api";
import {
  clearSessionEstablished,
  getStoreOwner,
  isSessionEstablished,
  markSessionEstablished,
  setStoreOwner,
} from "./shared/session";
import { getRepo, localStoreIsDisposable } from "./data";
import { queryClient } from "./queryClient";
import { startBackgroundSync } from "./sync";
import { AppShell } from "./app/AppShell";
import { SignInPage } from "./auth/SignInPage";
import { VerifyPage } from "./auth/VerifyPage";
import { AccountSwitchPage } from "./features/account/AccountSwitchPage";
import { TodayPage } from "./features/today/TodayPage";
import { PetsPage } from "./features/pets/PetsPage";
import { PetDetailPage } from "./features/pets/PetDetailPage";
import { PetFormPage } from "./features/pets/PetFormPage";
import { CourseFormPage } from "./features/courses/CourseFormPage";
import { SuppliesPage } from "./features/supplies/SuppliesPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { HistoryPage } from "./features/history/HistoryPage";
import { HouseholdPage } from "./features/household/HouseholdPage";
import { JoinHouseholdPage } from "./features/household/JoinHouseholdPage";
import { pushPendingSelfAliases } from "./features/household/selfIdentity";
import { FirstRunPage } from "./features/onboarding/FirstRunPage";

// Marks routes that should not render the tab bar / app chrome (full-screen
// forms). Augments the router's own (empty by default) staticData shape, so
// every other route keeps `staticData` optional.
declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    chrome?: "none";
  }
}

const rootRoute = createRootRoute({ component: Outlet });

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  component: SignInPage,
});

const verifyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth/verify",
  component: VerifyPage,
});

// Top-level sibling of /sign-in and /auth/verify — deliberately OUTSIDE
// appLayoutRoute, so rendering it can never re-run appLayoutRoute's
// beforeLoad and there is no possibility of a redirect loop (design §D4).
const accountSwitchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/account-switch",
  component: AccountSwitchPage,
});

// Pathless layout route: no `path`, so children keep top-level paths
// (`/today`, not `/app/today`). Every route under it is gated by the same
// session check, run exactly once per navigation into the app shell.
//
// Three-way guard (design §D4). The `/auth/me` fetch either: succeeds (the
// server vouches for this session right now); fails with a 401 (the server
// actively revokes it); or fails any other way — NetworkError, a 5xx
// ApiError, a thrown non-ApiError — which is an ABSENCE of information about
// this session, not a statement about it, and must never revoke anything.
//
// The success branch (including its own `redirect` to /account-switch) is
// built OUTSIDE the try/catch below, on purpose: TanStack Router signals a
// redirect by throwing it, and a try/catch wrapped around that branch would
// swallow it and crash into the ErrorBoundary instead of navigating.
const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: AppShell,
  beforeLoad: async () => {
    let user: SessionUser | undefined;
    let sessionError: unknown;
    try {
      user = await queryClient.ensureQueryData({
        queryKey: qk.session(),
        // Explicit retry:false — react-query's default is 3 retries with
        // 1s/2s/4s backoff, so without this an offline cold start would
        // block ~7s inside beforeLoad before entering. SPEC §10 requires an
        // interactive Today under 1.5s.
        queryFn: () => apiClient<SessionUser>("/auth/me"),
        retry: false,
      });
    } catch (err) {
      sessionError = err;
    }

    if (sessionError !== undefined) {
      if (sessionError instanceof ApiError && sessionError.status === 401) {
        clearSessionEstablished();
        throw redirect({ to: "/sign-in" });
      }
      // NetworkError, a non-401 ApiError (5xx, etc.), or anything else: an
      // absence of information about this session. Enter offline on
      // whatever was already established; otherwise there is nothing to
      // offer but sign-in. A first-ever offline load has no `established`
      // flag and so cannot enter the app.
      if (isSessionEstablished()) return;
      throw redirect({ to: "/sign-in" });
    }

    // `user` is guaranteed set here: `ensureQueryData` either resolved it or
    // this branch was never reached (the catch above sets `sessionError` and
    // returns/redirects before falling through).
    const signedInUser = user!;

    if (getStoreOwner() !== signedInUser.id) {
      if (getStoreOwner() === null) {
        // Legacy install / first run on this device: no prior owner recorded,
        // so there is nothing to lose by claiming it.
        setStoreOwner(signedInUser.id);
      } else {
        // A different account previously owned this device's local store.
        // Wrap the repo calls, but do NOT fall back to `isSessionEstablished()`
        // here the way the outer offline branch does: that fallback is only
        // justified when we do not know who the user is. In THIS branch we
        // DO know — `/auth/me` already succeeded ONLINE and identified user
        // B, and `getStoreOwner()` is already known to be a DIFFERENT user A
        // (that is the only way this branch is reached).
        // `isSessionEstablished()` being true only means SOME session (A's)
        // was once live on this device; it says nothing about B. Returning
        // here would enter the app shell without resetting and without
        // blocking, and AppShell/TodayPage/PetsPage read IndexedDB directly
        // (SPEC §9) — so B would see A's rows. A repo failure in this branch
        // must therefore FAIL CLOSED to the blocking screen, not fail open
        // into the app: it neither destroys data nor exposes it, and
        // /account-switch still offers the sign-out path when the repo is
        // broken.
        let disposable: boolean;
        try {
          disposable = await localStoreIsDisposable(getRepo());
        } catch {
          throw redirect({ to: "/account-switch" });
        }

        if (disposable) {
          try {
            await getRepo().resetLocalHousehold();
          } catch {
            throw redirect({ to: "/account-switch" });
          }
          setStoreOwner(signedInUser.id);
          queryClient.clear();
        } else {
          // Unsynced data on this device belongs to the previous account.
          // Block: never enter the app, never touch the store.
          throw redirect({ to: "/account-switch" });
        }
      }
    }

    // Reconciles this device's local self id with the id `/auth/me` just
    // vouched for — see `features/household/selfIdentity.ts`'s header
    // comment for the bug this closes. Awaited: it is a local IndexedDB
    // write only (fast), and it must complete before anything on this
    // navigation can log a dose or course event under a stale id. The
    // alias disclosure half is NOT awaited — it is a network call, is
    // usually a no-op (nothing pending), and is safe to retry on the next
    // navigation if it fails or the device is offline right now.
    await getRepo().reconcileSelfId(signedInUser.id);
    void pushPendingSelfAliases(getRepo());

    markSessionEstablished();
    // The session is confirmed as of right now, so background sync may run.
    // Boot-time `startBackgroundSync()` is a no-op for a first-ever sign-in
    // (nothing was established yet when main.tsx ran); this is what turns it
    // on without a reload. Idempotent on every later navigation.
    startBackgroundSync();
  },
});

// SPEC §6.9: a freshly verified user must land on the first-run screen, not
// straight into an app whose sync 404s forever because no server-side
// household exists yet (defect confirmed live: a brand-new sign-in landed on
// /today with no household provisioned). This key is deliberately not in the
// shared `qk` factory (frozen for this wave) — it only needs to be unique and
// stable within this file.
const householdExistsQueryKey = ["household", "server-exists"] as const;

const appIndexRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/",
  // `/` is only ever hit right after auth (VerifyPage's `navigate({ to: "/"
  // })`) or an explicit deep link to it — never as part of ordinary in-app
  // navigation between /today, /pets, /supplies, etc. — so this is the one
  // place a "does this user have a server-side household yet" check can run
  // without becoming a second blocking network call on every navigation the
  // way adding it to `appLayoutRoute`'s beforeLoad (which DOES run on every
  // navigation, since it guards the session for the whole app shell) would.
  //
  // Fails OPEN to /today on anything but a definitive "no household" (404):
  // offline, a flaky network, or an unexpected server error must not trap an
  // otherwise fully offline-capable user (SPEC §9) on /welcome. There is no
  // redirect-loop risk either way — this beforeLoad only ever fires once per
  // visit to "/" and always resolves to one of two terminal siblings
  // (/today, /welcome), neither of which re-enters it.
  beforeLoad: async () => {
    const hasHousehold = await queryClient.ensureQueryData({
      queryKey: householdExistsQueryKey,
      queryFn: async () => {
        try {
          await apiClient("/household");
          return true;
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) return false;
          return true;
        }
      },
      staleTime: 0,
      retry: false,
    });
    throw redirect({ to: hasHousehold ? "/today" : "/welcome" });
  },
});

const todayRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/today",
  component: TodayPage,
});

const petsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/pets",
  component: PetsPage,
});

const petsNewRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/pets/new",
  component: PetFormPage,
  staticData: { chrome: "none" },
});

const petDetailRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/pets/$petId",
  component: PetDetailPage,
});

const petEditRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/pets/$petId/edit",
  component: PetFormPage,
  staticData: { chrome: "none" },
});

const petHistoryRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/pets/$petId/history",
  component: HistoryPage,
});

interface CourseFormSearch {
  petId?: string;
}

const courseNewRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/courses/new",
  component: CourseFormPage,
  staticData: { chrome: "none" },
  validateSearch: (search: Record<string, unknown>): CourseFormSearch => ({
    petId: typeof search.petId === "string" ? search.petId : undefined,
  }),
});

const courseDetailRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/courses/$courseId",
  component: CourseFormPage,
  staticData: { chrome: "none" },
});

const suppliesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/supplies",
  component: SuppliesPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/settings",
  component: SettingsPage,
});

const householdRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/household",
  component: HouseholdPage,
});

const householdJoinRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/household/join",
  component: JoinHouseholdPage,
  staticData: { chrome: "none" },
});

const welcomeRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/welcome",
  component: FirstRunPage,
  staticData: { chrome: "none" },
});

const appRoute = appLayoutRoute.addChildren([
  appIndexRoute,
  todayRoute,
  petsRoute,
  petsNewRoute,
  petDetailRoute,
  petEditRoute,
  petHistoryRoute,
  courseNewRoute,
  courseDetailRoute,
  suppliesRoute,
  settingsRoute,
  householdRoute,
  householdJoinRoute,
  welcomeRoute,
]);

const routeTree = rootRoute.addChildren([signInRoute, verifyRoute, accountSwitchRoute, appRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
