// SPEC §6.4 — Pet history: the full event log (doses + course lifecycle),
// filterable, grouped by day, with a summary strip and a text/CSV export.
// Transcribed from `ui_kits/petmeds-app/PetHistoryScreen.jsx` (the slice
// brief reproduces it in full) — layout, ordering, spacing and copy come
// from there; the data source, pagination and export picker are this
// slice's own, per the brief's explicit instructions.
import { useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
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

const DAYS_PER_PAGE = 30;

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
  const [filter, setFilter] = useState<Filter>("all");
  const [pages, setPages] = useState(1);
  const [exportOpen, setExportOpen] = useState(false);

  // `useNow()`, not `now()` directly: a bare `now()` call in the render body
  // returns a fresh millisecond-precision Date on every render, which feeds
  // `to` below and therefore the event-log query keys — so the key would
  // never stabilise long enough for a fetch to land before the next render
  // discarded it for a newer one. `useNow()` memoises the value in state so
  // it only ticks on its own interval (see `@/app/useNow`), the same pattern
  // `TodayPage`/`SuppliesPage` use for the same reason.
  const nowDate = useNow();
  const today = localDayKey(nowDate);
  // Backwards-only pagination: widen a single range rather than appending
  // pages, so a row at the previous window's boundary can never be fetched
  // twice and rendered twice.
  const windowStartDay = addLocalDays(today, -(DAYS_PER_PAGE * pages - 1));
  const from = startOfLocalDay(parseLocalDay(windowStartDay)).toISOString();
  const to = nowDate.toISOString();

  const pet = usePet(petId);
  // Every status, not just active/paused — a stopped or finished course's
  // lifecycle events still belong in its pet's history.
  const courses = useCourses({ petId });
  const medications = useMedications();
  const users = useUsers();
  // Passing the course ids straight through means the filter yields nothing
  // until `courses.data` resolves, rather than firing an unfiltered query.
  const courseIds = courses.data?.map((c) => c.id) ?? [];

  const doseEvents = useDoseEventLog({ courseIds, from, to });
  const courseEvents = useCourseEventLog({ courseIds, from, to });

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
      kind === "text" ? exportAsText(allEntries, exportCtx) : exportAsCsv(allEntries, exportCtx);
    const ext = kind === "text" ? "txt" : "csv";
    const mime = kind === "text" ? "text/plain" : "text/csv";
    downloadText(`${petData.name}-history-${today}.${ext}`, content, mime);
  }

  function stat(n: number, label: string, color: string) {
    return (
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 19, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{n}</div>
        <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{label}</div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 22px 12px" }}>
        <button
          onClick={() => navigate({ to: "/pets/$petId", params: { petId } })}
          aria-label="Back"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 22,
            color: "var(--ink-2)",
            padding: 0,
          }}
        >
          ‹
        </button>
        <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-2)" }}>{petData.name}</span>
      </div>

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
            <div
              style={{
                fontSize: 28,
                fontWeight: 800,
                letterSpacing: "-0.01em",
                lineHeight: 1.1,
                color: "var(--ink-1)",
              }}
            >
              History
            </div>
            <div style={{ fontSize: 14, color: "var(--ink-3)", marginTop: 3 }}>
              {speciesLabel(petData.species)} · {activeCourseCount} active courses
            </div>
          </div>
        </div>
        <IconButton
          icon="ellipsis"
          label="Export history"
          size={44}
          aria-expanded={exportOpen}
          onClick={() => setExportOpen((v) => !v)}
        />
      </div>

      {exportOpen ? (
        <Card
          role="menu"
          style={{ margin: "0 22px 12px", display: "flex", flexDirection: "column", gap: 10 }}
        >
          <Button role="menuitem" variant="ghost" size="md" block onClick={() => handleExport("text")}>
            Plain text
          </Button>
          <Button role="menuitem" variant="ghost" size="md" block onClick={() => handleExport("csv")}>
            CSV
          </Button>
        </Card>
      ) : null}

      <div style={{ padding: "0 22px 14px", display: "flex", gap: 8 }}>
        <Chip selected={filter === "all"} onClick={() => setFilter("all")}>
          All
        </Chip>
        <Chip selected={filter === "doses"} onClick={() => setFilter("doses")}>
          Doses
        </Chip>
        <Chip selected={filter === "courses"} onClick={() => setFilter("courses")}>
          Courses
        </Chip>
      </div>

      <div style={{ padding: "0 22px 14px" }}>
        <Card tone="quiet" pad={14}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, textAlign: "center" }}>
            {stat(stats.given, "Given", "var(--ok)")}
            <div style={{ width: 1, background: "var(--line)" }}></div>
            {stat(stats.skipped, "Skipped", "var(--ink-2)")}
            <div style={{ width: 1, background: "var(--line)" }}></div>
            {stat(stats.missed, "Missed", "var(--alert)")}
          </div>
        </Card>
      </div>

      <div
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
            <SectionLabel
              trailing={`${group.entries.length}${group.entries.length === 1 ? " event" : " events"}`}
            >
              {group.label}
            </SectionLabel>
            <Card pad={0}>
              {group.entries.map((entry, i) => {
                const d = PM_DOT[entry.status] ?? PM_DOT.given;
                return (
                  <div
                    key={entry.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
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
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: d.titleColor }}>{entry.title}</div>
                      <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 2 }}>{entry.detail}</div>
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--ink-3)",
                        whiteSpace: "nowrap",
                        paddingTop: 2,
                      }}
                    >
                      by {nameFor(entry.actorId)}
                    </div>
                  </div>
                );
              })}
            </Card>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "center", padding: "4px 0 8px" }}>
          <Button variant="secondary" size="sm" onClick={() => setPages((p) => p + 1)}>
            Load earlier
          </Button>
        </div>
      </div>
    </div>
  );
}
