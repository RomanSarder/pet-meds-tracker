// SPEC §5.3 — Pet detail: today's schedule, active/paused courses, recent
// log, and an overflow menu for edit/archive. Transcribed from
// `<SCRATCH>/kit/PetDetailScreen.jsx` (CONTRACT.md §1); the only additions
// are the ones CONTRACT.md §4 and this slice's brief spell out explicitly.
import { useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Menu } from "@base-ui/react/menu";
import { Badge, Button, Card, IconButton, PetAvatar, SectionLabel } from "@/components/ds";
import { displayNameLookup, localDayKey, now } from "@/domain";
import { courseProgress, describeSchedule, getDoseState, getOccurrences } from "@/engine";
import { useCourses, useDoseEvents, useMedications } from "@/features/courses/hooks";
import { buildLogEntries } from "@/features/history/logModel";
import { useCourseEventLog, useUsers } from "@/features/history/hooks";
import { renderCourseProgress, renderSchedule } from "@/i18n/schedule";
import { renderDetail, renderLogTitle } from "@/i18n/history";
import { useTranslator } from "@/i18n";
import { ageLabel } from "./age";
import { doseRowPropsFor } from "./doseRow";
import { courseLabel, eventWhenLabel, joinMeta, speciesLabel, weightLabel } from "./format";
import { usePet, useSetPetArchived } from "./hooks";
import { ScheduleRow } from "./ScheduleRow";

// Same accent-ghost look the hand-rolled `<Button variant="ghost" block>`
// menu items had, ported to a real `Menu.Item` — see the "Escape doesn't
// close the menu" fix below, and `HistoryPage.tsx`'s identical constant.
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

/** Route adapter: reads the URL, renders the view. Not tested directly. */
export function PetDetailPage() {
  const { petId } = useParams({ strict: false });
  return petId ? <PetDetailView petId={petId} /> : null;
}

/** All the behaviour. This is what the tests render. */
export function PetDetailView({ petId }: { petId: string }) {
  const navigate = useNavigate();
  const tr = useTranslator();
  const [menuOpen, setMenuOpen] = useState(false);

  const nowDate = now();
  const today = localDayKey(nowDate);

  const pet = usePet(petId);
  const courses = useCourses({ petId, status: ["active", "paused"] });
  const medications = useMedications();
  // Passing the course ids straight through means the filter yields nothing
  // (an empty `courseIds` array) until `courses.data` resolves, rather than
  // firing an unfiltered query in the meantime.
  const courseIds = courses.data?.map((c) => c.id) ?? [];
  const events = useDoseEvents({ courseIds, limit: 10, newestFirst: true });
  // Recent (SPEC §6.3) widened to the same event-log model History (§6.4)
  // uses, so a course pause/resume with no DoseEvent still shows up here.
  // Bounding each source query to the last 10 and letting `buildLogEntries`
  // merge+sort them is safe: any entry within the true merged top 10 can
  // have at most 9 same-kind entries ranked above it, so it is necessarily
  // within its own kind's top 10 too.
  const courseEventsForRecent = useCourseEventLog({ courseIds, limit: 10, newestFirst: true });
  const users = useUsers();
  const setPetArchived = useSetPetArchived();

  if (!pet.data) return null;

  // Fix 4a: `occurrences` below is derived from `courses.data` and
  // `events.data` — while either is still loading, every occurrence
  // resolves through `getDoseState` on data that hasn't arrived yet (an
  // `event: null` that isn't really "no event", just "not fetched yet"),
  // which is what let a dose given late render as transiently "Overdue".
  // Recorded here, read at the Schedule block below, so it never renders a
  // state derived from data that hasn't arrived.
  const scheduleLoading = courses.isLoading || events.isLoading;

  const activeCourses = courses.data ?? [];
  const medicationList = medications.data ?? [];
  const recentEvents = events.data ?? [];
  const nameFor = displayNameLookup(users.data ?? []);
  const recentLog = buildLogEntries({
    courses: activeCourses,
    medications: medicationList,
    doseEvents: recentEvents,
    courseEvents: courseEventsForRecent.data ?? [],
  }).slice(0, 10);

  // `getOccurrences` decides which courses generate occurrences (it skips
  // non-`active` ones) — the context below hands it this pet's courses and
  // events; the pet filter after the call is CONTRACT.md's belt-and-braces.
  const occurrences = getOccurrences(today, {
    courses: activeCourses,
    events: recentEvents,
  }).filter((o) => o.petId === petId);

  function medicationName(medicationId: string): string {
    return medicationList.find((m) => m.id === medicationId)?.name ?? "";
  }

  function handleArchive() {
    setPetArchived.mutate(
      { id: petId, archived: true },
      { onSuccess: () => navigate({ to: "/pets" }) },
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/*
        Overflow menu, converted from a hand-rolled `{open ? <div role="menu">…}`
        toggle to Base UI's `Menu` — the same primitive `TodayDoseRow.tsx`
        already uses successfully. The hand-rolled version had no keydown
        handler, roving focus, or click-outside dismissal, so Escape left it
        open; `Menu` gets all three (plus focus return to the trigger) for
        free. `Menu.Root` has to wrap both the trigger and the portal, so it
        wraps this whole header row rather than just the button.
      */}
      <Menu.Root open={menuOpen} onOpenChange={(open) => setMenuOpen(open)}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 22px 12px" }}>
          <button
            onClick={() => navigate({ to: "/pets" })}
            aria-label={tr.t("pets.back")}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 22,
              color: "var(--ink-2)",
              // SPEC §10: >= 44x44 hit area. The glyph itself (measured ~5.7
              // x 33px before this fix) stays the same size — only the box
              // grows, via an explicit 44x44 box centred on the glyph and
              // pulled back with a negative margin (half of each dimension's
              // growth) so neither the glyph's position nor the header's
              // height/width shifts. `position: relative` + `zIndex: 1` keeps
              // the enlarged box clickable across its full area even where it
              // now overlaps the (non-interactive) "Pets" label to its right.
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
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-2)" }}>
            {tr.t("pets.pageTitle")}
          </span>
          <Menu.Trigger
            render={
              <IconButton
                icon="ellipsis"
                variant="plain"
                label={tr.t("pets.moreActions")}
                size={44}
                style={{ marginLeft: "auto" }}
              />
            }
          />
        </div>

        <Menu.Portal>
          <Menu.Positioner sideOffset={4} align="end">
            <Menu.Popup
              // `DsRoot` mounts inside `#root`, but `Menu.Portal` moves this
              // popup to the end of `<body>` — outside `.ds-root`. Every DS
              // token is declared on `.ds-root`, never `:root`
              // (`components/ds/tokens/colors.css`), so without this class
              // `var(--surface)` and `var(--line-quiet)` below resolve to
              // nothing (transparent popup, no border) and `var(--accent)` on
              // the items falls through to the shadcn layer's near-white
              // `--foreground`. The menu then rendered as invisible text on
              // the cream page and read as a dead three-dot button. Same fix,
              // same reason, as `LogAtTimeSheet.tsx`'s `Dialog.Popup`.
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
              <Menu.Item
                style={MENU_ITEM_STYLE}
                onClick={() => navigate({ to: "/pets/$petId/edit", params: { petId } })}
              >
                {tr.t("pets.editPet")}
              </Menu.Item>
              <Menu.Item style={MENU_ITEM_STYLE} onClick={handleArchive}>
                {tr.t("pets.archivePet")}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      <div style={{ padding: "0 22px 16px", display: "flex", alignItems: "center", gap: 14 }}>
        <PetAvatar name={pet.data.name} tint={pet.data.tint} size={64} />
        <div>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.01em", color: "var(--ink-1)" }}>
            {pet.data.name}
          </div>
          <div style={{ fontSize: 14, color: "var(--ink-3)", marginTop: 2 }}>
            {joinMeta([
              speciesLabel(pet.data.species, tr),
              ageLabel(pet.data.birthdate, today, tr),
              weightLabel(pet.data.weightGrams, tr),
            ])}
          </div>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "0 22px 22px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <SectionLabel trailing={tr.t("pets.schedule.countToday", { count: occurrences.length })}>
          {tr.t("pets.schedule")}
        </SectionLabel>
        {/*
          Fix 4a: while `courses` or `events` hasn't resolved yet, every
          occurrence's `event` looks like "no event" rather than "not fetched
          yet", so `getDoseState` falls into `overdue` for doses that are
          really `given`. Render no rows (and no state) until both queries
          have data — the label and card stay put so the screen doesn't
          jump, and `aria-busy` marks the region as still settling.
        */}
        <Card aria-busy={scheduleLoading}>
          {scheduleLoading
            ? null
            : occurrences.map((o, i) => {
                const course = activeCourses.find((c) => c.id === o.courseId);
                const state = getDoseState(o, nowDate);
                const rowProps = doseRowPropsFor({
                  occurrence: o,
                  state,
                  medicationName: medicationName(o.medicationId),
                  instructions: o.instructions,
                  progress: course ? renderCourseProgress(courseProgress(course, today), tr) : "",
                  tr,
                });
                // Read-only (SPEC §5.3): no `onGive`, and never the DS
                // `DoseRow` itself — it hard-codes a "Give" `Button` for
                // every non-`given` state regardless of whether a handler is
                // passed, which reads as a false affordance here (SPEC §9).
                // `ScheduleRow` is the locally-composed, always-inert
                // replacement: same layout and tokens as `DoseRow`, but
                // every state (including `notStarted`, whose SPEC §3b
                // "Start course" action belongs to Today, which already
                // owns it) renders as information only.
                return (
                  <ScheduleRow
                    key={o.key}
                    state={state}
                    medication={rowProps.medication}
                    detail={rowProps.detail}
                    time={rowProps.time}
                    divider={i > 0}
                  />
                );
              })}
        </Card>

        <SectionLabel>{tr.t("pets.courses")}</SectionLabel>
        {activeCourses.map((c) => {
          const label = courseLabel(medicationName(c.medicationId), c.doseAmount, c.doseUnit, tr);
          return (
            <Card
              key={c.id}
              role="button"
              tabIndex={0}
              aria-label={tr.t("pets.openCourse", { label })}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
                cursor: "pointer",
              }}
              onClick={() => navigate({ to: "/courses/$courseId", params: { courseId: c.id } })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigate({ to: "/courses/$courseId", params: { courseId: c.id } });
                }
              }}
            >
              <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: "var(--ink-1)" }}>{label}</div>
                <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 2 }}>
                  {renderSchedule(describeSchedule(c.schedule), tr)}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                {c.status === "paused" ? (
                  <Badge tone="neutral" style={{ whiteSpace: "nowrap" }}>
                    {tr.t("pets.courseStatus.paused")}
                  </Badge>
                ) : null}
                <Badge tone={c.endDate ? "accent" : "neutral"} style={{ whiteSpace: "nowrap" }}>
                  {renderCourseProgress(courseProgress(c, today), tr)}
                </Badge>
              </div>
            </Card>
          );
        })}

        <SectionLabel
          trailing={
            <button
              onClick={() => navigate({ to: "/pets/$petId/history", params: { petId } })}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: "var(--accent)",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {tr.t("pets.seeAllHistory")}
            </button>
          }
        >
          {tr.t("pets.recent")}
        </SectionLabel>
        <Card tone="quiet" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {recentLog.map((entry) => {
            // "Skipped"/"Missed" are reused verbatim from the History
            // catalogue (`history.detail.*`) rather than duplicated here —
            // same word, same concept, in both languages.
            const suffix =
              entry.status === "skipped"
                ? ` · ${tr.t("history.detail.skipped")}`
                : entry.status === "missed"
                  ? ` · ${tr.t("history.detail.missed")}`
                  : entry.status === "course"
                    ? ` · ${renderDetail(entry.detail, tr)}`
                    : "";
            return (
              <div
                key={entry.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  fontSize: 14,
                  color: "var(--ink-2)",
                }}
              >
                <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                  {renderLogTitle(entry.title, tr)}
                  {suffix}
                </span>
                <span style={{ color: "var(--ink-3)", fontSize: 13, marginLeft: "auto" }}>
                  {tr.t("pets.recent.attribution", {
                    when: eventWhenLabel(new Date(entry.at), today, tr),
                    actor: nameFor(entry.actorId),
                  })}
                </span>
              </div>
            );
          })}
        </Card>

        <Button
          variant="ink"
          size="lg"
          block
          icon="plus"
          onClick={() => navigate({ to: "/courses/new", search: { petId } })}
        >
          {tr.t("pets.addMedication")}
        </Button>
      </div>
    </div>
  );
}
