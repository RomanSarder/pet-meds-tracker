import type { CSSProperties } from "react";
import { Outlet, useLocation, useMatches, useNavigate } from "@tanstack/react-router";
import { DsRoot, TabBar, type TabBarTab } from "@/components/ds";
import { useT } from "@/i18n";
import { ToastProvider } from "./Toast";

const rootStyle: CSSProperties = {
  minHeight: "100dvh",
  display: "flex",
  flexDirection: "column",
  background: "var(--paper)",
};

const contentStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  paddingTop: "env(safe-area-inset-top, 0px)",
};

const tabBarStyle: CSSProperties = {
  paddingBottom: "calc(30px + env(safe-area-inset-bottom, 0px))",
};

/**
 * Mounts `DsRoot` once, here — not in `main.tsx` — because `/sign-in` and
 * `/auth/verify` are shadcn-styled and must stay outside the DS token scope
 * (see `components/ds/README.md`). Every route under the pathless `app`
 * layout route renders inside this shell via `<Outlet />`.
 */
export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const matches = useMatches();
  const t = useT();

  const hideChrome = matches.some((m) => m.staticData?.chrome === "none");
  // TabBar's tab values (today/pets/supplies) are already identical to the
  // route path segments, so no mapping table is needed.
  const activeTab = location.pathname.split("/")[1] || "today";

  // TabBar (frozen, in components/ds) falls back to its own hard-coded
  // English DEFAULT_TABS when no `tabs` prop is passed. Build the localized
  // array here instead, at the call site, using the same value/icon triples.
  const tabs: TabBarTab[] = [
    { value: "today", label: t("nav.today"), icon: "calendar-check" },
    { value: "pets", label: t("nav.pets"), icon: "paw-print" },
    { value: "supplies", label: t("nav.supplies"), icon: "package" },
  ];

  return (
    <DsRoot style={rootStyle}>
      <ToastProvider>
        <div style={contentStyle}>
          <Outlet />
        </div>
        {hideChrome ? null : (
          <TabBar
            tabs={tabs}
            value={activeTab}
            onChange={(v) => navigate({ to: `/${v}` })}
            style={tabBarStyle}
          />
        )}
      </ToastProvider>
    </DsRoot>
  );
}
