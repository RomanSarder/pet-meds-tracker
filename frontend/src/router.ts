import { createRouter, createRoute, createRootRoute, Outlet, redirect } from "@tanstack/react-router";
import type { SessionUser } from "@pet-tracker/shared";
import { qk } from "@/domain";
import { apiClient, ApiError } from "./shared/api";
import { queryClient } from "./queryClient";
import { AppShell } from "./app/AppShell";
import { SignInPage } from "./auth/SignInPage";
import { VerifyPage } from "./auth/VerifyPage";
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

// Pathless layout route: no `path`, so children keep top-level paths
// (`/today`, not `/app/today`). Every route under it is gated by the same
// session check, run exactly once per navigation into the app shell.
const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: AppShell,
  beforeLoad: async () => {
    try {
      await queryClient.ensureQueryData({
        queryKey: qk.session(),
        queryFn: () => apiClient<SessionUser>("/auth/me"),
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        throw redirect({ to: "/sign-in" });
      }
      throw err;
    }
  },
});

const appIndexRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/today" });
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

const routeTree = rootRoute.addChildren([signInRoute, verifyRoute, appRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
