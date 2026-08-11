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

/**
 * Pinned to the bottom of the viewport so the three destinations are always
 * reachable. The root is `minHeight: 100dvh`, not a fixed height, so on any
 * screen taller than the viewport it is the DOCUMENT that scrolls — and the
 * tab bar, as the last child of a column as tall as the page, used to scroll
 * away with it. On a pet with a few courses that left it around a thousand
 * pixels below the fold.
 *
 * `sticky`, not `fixed`, and this is the whole reason the layout above is
 * left alone: a sticky element still occupies its space at the end of the
 * flow, so scrolled to the bottom the tabs sit after the content rather than
 * covering it. `fixed` would take them out of flow and permanently hide
 * whatever ended up underneath — every screen would then need bottom padding
 * the height of the bar.
 *
 * The alternative — bounding the root to `100dvh` and letting each screen
 * scroll internally — is what the page roots are written for
 * (`flex: 1; overflow: hidden` with their own scroller), but it is not a
 * layout change this app can absorb yet: with a bounded root, list children
 * that default to `flex-shrink: 1` compress instead of scrolling (measured on
 * Supplies: rows collapsed from 129px to 34px). That is a per-screen
 * `min-height: 0` / `flex-shrink: 0` sweep, not a tab-bar fix.
 *
 * NO `z-index`, deliberately. `position: sticky` already paints this above
 * ordinary in-flow content, and being the last child of `.ds-root` wins it
 * every tie against other auto-index positioned elements. Giving it a real
 * index instead put it above the portalled sheets and dialogs, which set no
 * index of their own and rely on being later in `<body>`: measured with the
 * "log at a different time" sheet open, the topmost element over the bottom
 * band was the Pets tab, and the sheet's own "Log at …" button sat under it,
 * covered and untappable. Any positive index reintroduces that, because a
 * positioned element with `z-index: auto` cannot beat one with a number no
 * matter how much later it appears in the DOM.
 *
 * The screens' `z-index: 1` tap targets do not conflict: those are header
 * controls, which scroll up and away from this band, never toward it.
 */
const tabBarStyle: CSSProperties = {
  position: "sticky",
  bottom: 0,
  flexShrink: 0,
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
