// SPEC §6.4 — Pet history: the full event log (doses + course lifecycle),
// filterable, grouped by day, with a summary strip and a text/CSV export.
// Transcribed from `ui_kits/petmeds-app/PetHistoryScreen.jsx` (the slice
// brief reproduces it in full) — layout, ordering, spacing and copy come
// from there; the data source, pagination and export picker are this
// slice's own, per the brief's explicit instructions.
import { useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Menu } from "@base-ui/react/menu";
import { Button, Card, Chip, IconButton, PetAvatar, SectionLabel } from "@/components/ds";
import {
  addLocalDays,
  displayNameLookup,
  localDayKey,
  parseLocalDay,
  startOfLocalDay,
} from "@/domain";
import { useNow } from "@/app/useNow";
import { buildLogEntries, filterEntries, groupByDay, summarise, type LogEntryStatus } from "./logModel";
import { exportAsCsv, exportAsText } from "./historyExport";
import { useCourseEventLog, useDoseEventLog, useUsers } from "./hooks";
import { useCourses, useMedications } from "@/features/courses/hooks";
import { usePet } from "@/features/pets/hooks";
import { speciesLabel } from "@/features/pets/format";
import { useTranslator } from "@/i18n";
import { renderDayHeading, renderDetail, renderLogTitle } from "@/i18n/history";

const DAYS_PER_PAGE = 30;

// Matches the accent-ghost look the hand-rolled `<Button variant="ghost" block>`
// menu items had, ported to a real `Menu.Item` (see the "Escape doesn't close
// the menu" accessibility fix below) — same treatment as the working pattern
// in `TodayDoseRow.tsx`'s `MENU_ITEM_STYLE`, just accent-coloured to match
// this menu's former ghost buttons.
const MENU_ITEM_STYLE = {
  display: "flex",
  alignItems: "center",
  minHeight: 44,
  padding: "0 16px",
  fontSize: 15,
  fontWeight: 600,
  color: "var(--accent)",
  cursor: "pointer",
  userSelect: "none",
} as const;

// Same dot/title mapping as the kit's `PM_DOT`, keyed by `LogEntryStatus`
// instead of the fixture's ad hoc status strings.
const PM_DOT: Record<LogEntryStatus, { dot: string; titleColor: string }> = {
  given: { dot: "var(--ok)", titleColor: "var(--ink-1)" },
  skipped: { dot: "var(--line-strong)", titleColor: "var(--ink-2)" },
  missed: { dot: "var(--alert)", titleColor: "var(--ink-1)" },
  course: { dot: "var(--accent)", titleColor: "var(--ink-1)" },
};

type Filter = "all" | "doses" | "courses";

/** Route adapter: reads the URL, renders the view. Not tested directly. */
export function HistoryPage() {
  const { petId } = useParams({ strict: false });
  return petId ? <HistoryView petId={petId} /> : null;
}

/**
 * Triggers a browser download. Guarded for `URL.createObjectURL` being
 * absent (jsdom does not implement it), the same technique `downloadBackup`
 * in `frontend/src/data/backupFile.ts` uses — not imported directly since
 * that file sits outside this slice's touchable set.
 */
function downloadText(filename: string, content: string, mime: string): void {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return;
  }
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** All the behaviour. This is what the tests render. */
export function HistoryView({ petId }: { petId: string }) {
  const navigate = useNavigate();
  const tr = useTranslator();
  const t = tr.t;
  const [filter, setFilter] = useState<Filter>("all");
  const [pages, setPages] = useState(1);
  const [exportOpen, setExportOpen] = useState(false);

  // `useNow()`, not `now()` directly: a bare `now()` call in the render body
  // returns a fresh millisecond-precision Date on every render. Holding the
  // value in state instead means it only ticks on its own interval (see
  // `@/app/useNow`), so a burst of unrelated renders can't churn it.
  //
  // That still isn't enough on its own: `useNow()` re-emits a fresh Date
  // every 30s, and if that instant flowed straight into the event-log query
  // keys below, the key would change every 30s too — never sitting still
  // long enough for a fetch to land before the next tick discarded it for a
  // newer one, dropping the screen to `pending` (and 0/0/0) on a loop. So
  // `to` is derived from `today` — a "YYYY-MM-DD" day key, via
  // `localDayKey` — rather than from `nowDate.toISOString()` directly: the
  // query key then changes only at local midnight, exactly when a
  // day-granular value is supposed to change, and exactly why
  // `TodayPage`/`SuppliesPage` key their own queries on `localDayKey(now)`
  // rather than an instant. Incidentally, `to` now means "the end of today"
  // rather than "the instant this component mounted", so an event logged
  // after mount is no longer excluded from the visible range by a `to`
  // frozen at mount time.
  const nowDate = useNow();
  const today = localDayKey(nowDate);
  // Backwards-only pagination: widen a single range rather than appending
  // pages, so a row at the previous window's boundary can never be fetched
  // twice and rendered twice.
  const windowStartDay = addLocalDays(today, -(DAYS_PER_PAGE * pages - 1));
  const from = startOfLocalDay(parseLocalDay(windowStartDay)).toISOString();
  // Inclusive end of `today` (repos filter `loggedAt <= to`/`at <= to`), not
  // `nowDate.toISOString()` — see the `useNow()` comment above.
  const to = new Date(parseLocalDay(addLocalDays(today, 1)).getTime() - 1).toISOString();

  const pet = usePet(petId);
  // Every status, not just active/paused — a stopped or finished course's
  // lifecycle events still belong in its pet's history.
  const courses = useCourses({ petId });
  const medications = useMedications();
  const users = useUsers();
  // Passing the course ids straight through means the filter yields nothing
  // until `courses.data` resolves, rather than firing an unfiltered query.
  const courseIds = courses.data?.map((c) => c.id) ?? [];
  // Gate the event-log queries on `courses` having resolved: firing them
  // early with `courseIds: []` would resolve to zero rows and paint a false
  // "no history" before the correctly-filtered fetch replaces it.
  const coursesReady = courses.data !== undefined;

  const doseEvents = useDoseEventLog({ courseIds, from, to }, { enabled: coursesReady });
  const courseEvents = useCourseEventLog({ courseIds, from, to }, { enabled: coursesReady });

  // Busy vs genuinely-empty (SPEC §10 — state is never colour-only, and
  // `aria-busy` is the mechanism for a state with no dedicated copy): while
  // any of these five have not yet produced data, the summary strip must not
  // paint 0/0/0 as if it were the answer.
  const isBusy =
    !coursesReady ||
    medications.data === undefined ||
    users.data === undefined ||
    doseEvents.data === undefined ||
    courseEvents.data === undefined;

  if (!pet.data) return null;
  const petData = pet.data;

  const activeCourseCount = (courses.data ?? []).filter(
    (c) => c.status === "active" || c.status === "paused",
  ).length;

  const nameFor = displayNameLookup(users.data ?? []);

  // Unfiltered over the visible range — drives the summary strip and the
  // export, exactly like the kit's `count(s)` reads from the full `PM_LOG`
  // rather than the chip-narrowed `rows`.
  const allEntries = buildLogEntries({
    courses: courses.data ?? [],
    medications: medications.data ?? [],
    doseEvents: doseEvents.data ?? [],
    courseEvents: courseEvents.data ?? [],
  });
  const rows = filterEntries(allEntries, filter);
  const groups = groupByDay(rows, today);
  const stats = summarise(allEntries);

  function handleExport(kind: "text" | "csv") {
    setExportOpen(false);
    const exportCtx = { petName: petData.name, from: windowStartDay, to: today, nameFor };
    const content =
      kind === "text"
        ? exportAsText(allEntries, exportCtx, tr)
        : exportAsCsv(allEntries, exportCtx, tr);
    const ext = kind === "text" ? "txt" : "csv";
    const mime = kind === "text" ? "text/plain" : "text/csv";
    downloadText(`${petData.name}-history-${today}.${ext}`, content, mime);
  }

  // `n === null` (busy) renders no digit at all rather than a misleading "0"
  // — see `isBusy` above.
  function stat(n: number | null, label: string, color: string) {
    return (
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 19, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>
          {n === null ? null : n}
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{label}</div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 22px 12px" }}>
        <button
          onClick={() => navigate({ to: "/pets/$petId", params: { petId } })}
          aria-label={t("history.back")}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 22,
            color: "var(--ink-2)",
            // SPEC §10: >= 44x44 hit area. The glyph itself (measured ~5.7 x
            // 33px before this fix) stays the same size — only the box grows,
            // via an explicit 44x44 box centred on the glyph and pulled back
            // with a negative margin (half of each dimension's growth) so
            // neither the glyph's position nor the header's height/width
            // shifts. `position: relative` + `zIndex: 1` keeps the enlarged
            // box clickable across its full area even where it now overlaps
            // the (non-interactive) pet name label to its right.
            width: 44,
            height: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "-5.5px -19.15px",
            position: "relative",
            zIndex: 1,
          }}
        >
          ‹
        </button>
        <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-2)" }}>{petData.name}</span>
      </div>

      {/*
        Export menu, converted from a hand-rolled `{open ? <div role="menu">…}`
        toggle to Base UI's `Menu` — the same primitive `TodayDoseRow.tsx`
        already uses successfully. The hand-rolled version had no keydown
        handler, roving focus, or click-outside dismissal, so Escape left it
        open; `Menu` gets all three (plus focus return to the trigger) for
        free. `Menu.Root` has to wrap both the trigger and the portal, so it
        wraps this whole header row rather than just the button.
      */}
      <Menu.Root open={exportOpen} onOpenChange={(open) => setExportOpen(open)}>
        <div
          style={{
            padding: "0 22px 16px",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <PetAvatar name={petData.name} tint={petData.tint} size={52} />
            <div>
              <h1
                style={{
                  fontSize: 28,
                  fontWeight: 800,
                  letterSpacing: "-0.01em",
                  lineHeight: 1.1,
                  color: "var(--ink-1)",
                  margin: 0,
                }}
              >
                {t("history.title")}
              </h1>
              <div style={{ fontSize: 14, color: "var(--ink-3)", marginTop: 3 }}>
                {t("history.subtitle", {
                  species: speciesLabel(petData.species, tr),
                  courses: activeCourseCount,
                })}
              </div>
            </div>
          </div>
          <Menu.Trigger
            render={<IconButton icon="ellipsis" label={t("history.export.action")} size={44} />}
          />
        </div>

        <Menu.Portal>
          <Menu.Positioner sideOffset={4} align="end">
            <Menu.Popup
              // `Menu.Portal` moves this popup to the end of `<body>` —
              // outside the `.ds-root` wrapper it renders under. Every DS
              // token is declared on `.ds-root`, never `:root`
              // (`components/ds/tokens/colors.css`), so without this class the
              // `var(--surface)` and `var(--line-quiet)` below resolve to
              // nothing and the menu paints as bare text over the page. Same
              // fix, same reason, as `PetDetailPage.tsx` and `LogAtTimeSheet.tsx`.
              className="ds-root"
              style={{
                minWidth: 180,
                padding: "6px 0",
                background: "var(--surface)",
                border: "1px solid var(--line-quiet)",
                borderRadius: "var(--radius-md, 12px)",
                fontFamily: "var(--font-sans)",
              }}
            >
              <Menu.Item style={MENU_ITEM_STYLE} onClick={() => handleExport("text")}>
                {t("history.export.plainText")}
              </Menu.Item>
              <Menu.Item style={MENU_ITEM_STYLE} onClick={() => handleExport("csv")}>
                {t("history.export.csv")}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      <div style={{ padding: "0 22px 14px", display: "flex", gap: 8 }}>
        {/*
          `Chip` styles its selected state with colour alone, so the selection
          has to be exposed programmatically too (SPEC §10). `Chip` spreads
          its rest props onto the <button>, so the caller supplies this — the
          frozen DS component is not changed.
        */}
        <Chip aria-pressed={filter === "all"} selected={filter === "all"} onClick={() => setFilter("all")}>
          {t("history.filter.all")}
        </Chip>
        <Chip aria-pressed={filter === "doses"} selected={filter === "doses"} onClick={() => setFilter("doses")}>
          {t("history.filter.doses")}
        </Chip>
        <Chip aria-pressed={filter === "courses"} selected={filter === "courses"} onClick={() => setFilter("courses")}>
          {t("history.filter.courses")}
        </Chip>
      </div>

      <div style={{ padding: "0 22px 14px" }} aria-busy={isBusy}>
        <Card tone="quiet" pad={14}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, textAlign: "center" }}>
            {stat(isBusy ? null : stats.given, t("history.stat.given"), "var(--ok)")}
            <div style={{ width: 1, background: "var(--line)" }}></div>
            {stat(isBusy ? null : stats.skipped, t("history.stat.skipped"), "var(--ink-2)")}
            <div style={{ width: 1, background: "var(--line)" }}></div>
            {stat(isBusy ? null : stats.missed, t("history.stat.missed"), "var(--alert)")}
          </div>
        </Card>
      </div>

      <div
        aria-busy={isBusy}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "0 22px 22px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {groups.map((group) => (
          <div key={group.key} style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <SectionLabel trailing={t("history.eventCount", { count: group.entries.length })}>
              {renderDayHeading(group.heading, tr)}
            </SectionLabel>
            <Card pad={0}>
              {group.entries.map((entry, i) => {
                const d = PM_DOT[entry.status] ?? PM_DOT.given;
                return (
                  // SPEC §10a: "nothing is truncated to fit". At narrow widths
                  // (measured broken at 360px, Ukrainian) the trailing
                  // attribution's own text can be longer than the space left
                  // beside the title once the time/dot column is accounted
                  // for, and it cannot shrink below its content width (its
                  // flex-basis is auto). Rather than let it crush the
                  // title/detail column down to a near-single-word sliver,
                  // `flexWrap: "wrap"` lets the attribution drop to its own
                  // full-width line — no overlap, no truncation, at any width
                  // from 360px up.
                  //
                  // The title/detail column below MUST use `flex: "1 1 auto"`,
                  // not the bare `flex: 1` shorthand. `flex: 1` expands to
                  // `flex: 1 1 0%` — flex-basis zero — and flex line-wrapping
                  // is decided from each item's hypothetical main size (its
                  // flex-basis), not its post-grow rendered size. With basis
                  // 0 the title column contributes nothing to that
                  // calculation, so the row (time 46 + dot 8 + title 0 +
                  // attribution 150.5 + gaps 36 = 240.5px) never exceeds the
                  // ~284px content box and `flexWrap: "wrap"` never fires —
                  // free space just gets handed to the title via flex-grow,
                  // squeezing it to a measured 41.5px-wide, 153.5px-tall
                  // sliver of near-single-character lines while the
                  // attribution stays on the same line. `flex: "1 1 auto"`
                  // gives the column a content-derived basis so the row's
                  // hypothetical size correctly exceeds 360px and the wrap
                  // triggers. Do not "simplify" this back to `flex: 1`.
                  <div
                    key={entry.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      flexWrap: "wrap",
                      gap: 12,
                      padding: "13px 16px",
                      borderTop: i > 0 ? "1px solid var(--line-quiet)" : "none",
                    }}
                  >
                    <div
                      style={{
                        width: 46,
                        flexShrink: 0,
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--ink-3)",
                        fontVariantNumeric: "tabular-nums",
                        paddingTop: 1,
                      }}
                    >
                      {entry.time}
                    </div>
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        marginTop: 6,
                        flexShrink: 0,
                        background: d.dot,
                      }}
                    ></div>
                    <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: d.titleColor, overflowWrap: "anywhere" }}>
                        {renderLogTitle(entry.title, tr)}
                      </div>
                      <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 2 }}>
                        {renderDetail(entry.detail, tr)}
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--ink-3)",
                        marginLeft: "auto",
                        overflowWrap: "anywhere",
                        textAlign: "right",
                        paddingTop: 2,
                      }}
                    >
                      {t("history.byActor", { name: nameFor(entry.actorId) })}
                    </div>
                  </div>
                );
              })}
            </Card>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "center", padding: "4px 0 8px" }}>
          <Button variant="secondary" size="sm" onClick={() => setPages((p) => p + 1)}>
            {t("history.loadEarlier")}
          </Button>
        </div>
      </div>
    </div>
  );
}
