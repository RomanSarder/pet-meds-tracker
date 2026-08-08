import type { CSSProperties } from "react";
import { Outlet, useLocation, useMatches, useNavigate } from "@tanstack/react-router";
import { DsRoot, TabBar } from "@/components/ds";
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

  const hideChrome = matches.some((m) => m.staticData?.chrome === "none");
  // TabBar's tab values (today/pets/supplies) are already identical to the
  // route path segments, so no mapping table is needed.
  const activeTab = location.pathname.split("/")[1] || "today";

  return (
    <DsRoot style={rootStyle}>
      <ToastProvider>
        <div style={contentStyle}>
          <Outlet />
        </div>
        {hideChrome ? null : (
          <TabBar
            value={activeTab}
            onChange={(v) => navigate({ to: `/${v}` })}
            style={tabBarStyle}
          />
        )}
      </ToastProvider>
    </DsRoot>
  );
}
