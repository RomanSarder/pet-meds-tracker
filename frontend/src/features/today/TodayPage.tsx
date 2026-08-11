// The Today dashboard (SPEC §5.1) — assembly only.
//
// Every decision this screen appears to make has already been made elsewhere:
// occurrence generation and dose states are `@/engine`'s, the arrangement and
// every string are `buildTodayView`'s, the optimistic flip and undo toast are
// `useLogDose`'s, and the layout is the design kit's `TodayScreen`. What is
// left here is wiring, plus the two things only the page can own: the
// `keepResolved` set, and which gestures navigate.
//
// THE GOVERNING PRODUCT RULE (SPEC §5.1): "Give logs the dose at the current
// time. The row animates to its given state in place. The tap must not
// navigate." So of everything below, exactly two callbacks route — the header's
// plus, and the row menu's *Open course* — plus the card-body tap that SPEC
// asks to open Pet detail. Give, Skip, *Log at a different time*, **Start
// course** and the banner's Log all end in `logDose.mutate` and nothing else.
import {
  useCallback,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertBanner, Card, EmptyState, PetCard, ScreenHeader } from "@/components/ds";
import { localDayKey } from "@/domain";
import { describeSchedule } from "@/engine";
import { useNow } from "@/app/useNow";
import { useTranslator } from "@/i18n";
import { renderSchedule } from "@/i18n/schedule";
import { EarlyGiveConfirmDialog } from "./EarlyGiveConfirmDialog";
import { TodayDoseRow } from "./TodayDoseRow";
import { buildTodayView, greetingFor, scheduledForOf } from "./todayModel";
import type { LogAtTimeContext, TodayDose, TodayPetGroup } from "./types";
import { useDailySweep } from "./useDailySweep";
import { useLogDose, type EarlyGiveConflict, type LogDoseVars } from "./useLogDose";
import { useTodayQuery } from "./useTodayData";

const SCREEN_STYLE = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
} as const;

const LIST_STYLE = {
  flex: 1,
  overflowY: "auto",
  padding: "0 22px 22px",
  display: "flex",
  flexDirection: "column",
  gap: 14,
} as const;

const COMING_UP_STYLE = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  fontSize: 14,
  color: "var(--ink-2)",
} as const;

/**
 * The half of `LogDoseVars` that is a pure function of the dose.
 *
 * `occurrenceKey` and `scheduledFor` are read off the SAME occurrence, so
 * `occurrenceKeyFor(courseId, scheduledFor)` reproduces `key` by construction —
 * the engine builds the key from the due instant. They must agree: the
 * optimistic flip matches the cached occurrence by key, and the missed-dose
 * sweep dedupes on the key it would derive from `scheduledFor`. Deriving one of
 * them from anything other than this occurrence is how those two silently drift.
 */
function identityOf(dose: TodayDose): Pick<
  LogDoseVars,
  "occurrenceKey" | "courseId" | "amount" | "scheduledFor" | "medicationName"
> {
  return {
    occurrenceKey: dose.key,
    courseId: dose.courseId,
    amount: dose.occurrence.doseAmount,
    scheduledFor: scheduledForOf(dose.occurrence),
    medicationName: dose.medicationName,
  };
}

export function TodayPage(): ReactElement {
  const navigate = useNavigate();
  const now = useNow();
  const day = localDayKey(now);
  // The whole screen's wording, injected once. `tr` is the memoized
  // per-locale translator, so it is a stable `useMemo` dependency below.
  const tr = useTranslator();
  const t = tr.t;

  useDailySweep(now);
  const { data: snapshot, isPending } = useTodayQuery(day);

  // SPEC §3b: "Allow, but confirm when early." A give that collides with the
  // grace window AND was not yet due (`earlyGive`, set below) lands here
  // instead of the flat duplicate toast — `EarlyGiveConfirmDialog` below is
  // the single instance for the whole page, not one per row.
  const [earlyGiveConflict, setEarlyGiveConflict] = useState<EarlyGiveConflict | null>(null);
  const logDose = useLogDose(day, { onEarlyGiveConflict: setEarlyGiveConflict });

  // Occurrence keys resolved while this screen has been mounted. Only ever
  // added to: an undone dose loses its event and comes back as pending on its
  // own, so a key left behind by an undo is inert rather than wrong. See the
  // `body` doc comment in types.ts for why the set exists at all.
  const [keepResolved, setKeepResolved] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const view = useMemo(
    () => (snapshot ? buildTodayView(snapshot, now, tr, { keepResolved }) : null),
    [snapshot, now, tr, keepResolved],
  );

  // Looked up once per snapshot rather than scanned per row: §6.1a's sheet
  // needs each dose's `Course` (for `scheduleSummary` and the consequence
  // block), and `renderCard` walks every pending dose on every render.
  const coursesById = useMemo(
    () => new Map((snapshot?.courses ?? []).map((c) => [c.id, c])),
    [snapshot],
  );

  const log = useCallback(
    (vars: LogDoseVars) => {
      setKeepResolved((prev) =>
        prev.has(vars.occurrenceKey)
          ? prev
          : new Set(prev).add(vars.occurrenceKey),
      );
      logDose.mutate(vars);
    },
    [logDose],
  );

  const give = useCallback(
    (dose: TodayDose) =>
      log({
        ...identityOf(dose),
        status: "given",
        toastMessage: t("today.toast.logged", {
          medicationName: dose.medicationName,
        }),
        // SPEC §3b: only a dose that is not yet due (`later`/`upcoming`) is
        // eligible for the early-give confirm dialog on a grace-window
        // collision — an on-time or overdue collision is a genuine "someone
        // already gave this" and keeps the flat rejection (`useLogDose.ts`).
        earlyGive: dose.state === "later" || dose.state === "upcoming",
      }),
    [log, t],
  );

  const confirmEarlyGive = useCallback(() => {
    if (!earlyGiveConflict) return;
    const { vars } = earlyGiveConflict;
    setEarlyGiveConflict(null);
    log({ ...vars, allowWithinGrace: true });
  }, [earlyGiveConflict, log]);

  const skip = useCallback(
    (dose: TodayDose) =>
      log({
        ...identityOf(dose),
        status: "skipped",
        toastMessage: t("today.toast.skipped", {
          medicationName: dose.medicationName,
        }),
      }),
    [log, t],
  );

  // SPEC §4: "the user can always log a past dose with a corrected `givenAt`".
  // A fresh log, not a `correctDose` — there is no earlier event to supersede.
  const logAtTime = useCallback(
    (dose: TodayDose, givenAt: Date) =>
      log({
        ...identityOf(dose),
        status: "given",
        givenAt: givenAt.toISOString(),
        toastMessage: t("today.toast.logged", {
          medicationName: dose.medicationName,
        }),
      }),
    [log, t],
  );

  // SPEC §3b: starting a `fromLastDose` course logs its first dose now. The
  // chain has no scheduled instant yet, so `scheduledFor` is null — but that is
  // read off the occurrence by `scheduledForOf`, never asserted here. Writing
  // `scheduledFor: null` over `identityOf` would restate a scheduling rule
  // locally, which SPEC §10 puts out of this slice's reach, and would break
  // `identityOf`'s invariant that the key and `scheduledFor` come from the same
  // occurrence the moment the engine ever gives a notStarted one an instant.
  const startCourse = useCallback(
    (dose: TodayDose) =>
      log({
        ...identityOf(dose),
        status: "given",
        toastMessage: t("today.toast.logged", {
          medicationName: dose.medicationName,
        }),
      }),
    [log, t],
  );

  const openPet = useCallback(
    (petId: string) => {
      void navigate({ to: "/pets/$petId", params: { petId } });
    },
    [navigate],
  );

  const onCardKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>, petId: string) => {
      // A key pressed on an inner button is that button's. Without this, Enter
      // on Give would both log the dose and navigate away from the screen —
      // exactly what the governing rule forbids.
      if (event.target !== event.currentTarget) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openPet(petId);
    },
    [openPet],
  );

  const onAddCourse = useCallback(() => {
    void navigate({ to: "/courses/new" });
  }, [navigate]);

  function renderCard(group: TodayPetGroup): ReactElement {
    const { pet } = group;
    // `group.done` alone would collapse the card the instant its last pending
    // dose is tapped — taking the row, and the `X of Y today` counter, away at
    // exactly the moment SPEC §5.1 says the row "animates to its given state in
    // place". So the collapsed variant needs the body to be empty as well: a
    // pet that was already finished when the screen loaded collapses (its
    // resolved doses are not in `keepResolved`), and a pet you have just
    // finished stays expanded, showing what you did, until the screen remounts.
    const collapsed = group.done && group.body.length === 0;
    return (
      // A wrapper rather than a prop on `PetCard`: the DS is frozen and its
      // card is not clickable. `role`/`tabIndex`/`aria-label` are what make
      // SPEC §5.1's "tapping the card body opens Pet detail" reachable by
      // keyboard and nameable by a screen reader (SPEC §9).
      <div
        key={pet.id}
        role="button"
        tabIndex={0}
        aria-label={t("today.openPet", { petName: pet.name })}
        onClick={() => openPet(pet.id)}
        onKeyDown={(event) => onCardKeyDown(event, pet.id)}
        style={{ cursor: "pointer" }}
      >
        <PetCard
          pet={pet.name}
          tint={pet.tint}
          overdue={group.hasOverdue}
          done={collapsed}
          status={group.status}
          count={group.counterLabel || undefined}
        >
          {collapsed
            ? null
            : group.body.map((dose, i) => {
                // Every dose in `group.body` came from `buildTodayView`, which
                // only emits a `TodayDose` when `coursesById.get(occ.courseId)`
                // resolved (see `todayModel.ts`'s `toDose` loop) — `coursesById`
                // above is built from that same `snapshot.courses`, so the
                // lookup here can never miss.
                const course = coursesById.get(dose.courseId)!;
                const doseContext: LogAtTimeContext = {
                  pet,
                  course,
                  events: snapshot?.events ?? [],
                  // Same reasoning as `events` above: `renderCard` only runs
                  // once `view` is non-null, which only happens once
                  // `snapshot` is non-null (see the `!view` early return), so
                  // this fallback is structurally unreachable — not a live
                  // default of the ledger to empty.
                  courseEvents: snapshot?.courseEvents ?? [],
                  // The SAME pairing `todayModel.detailFor` uses for an interval
                  // course's clause, so the schedule is never worded twice.
                  scheduleSummary: renderSchedule(describeSchedule(course.schedule), tr),
                };
                return (
                  <TodayDoseRow
                    key={dose.key}
                    dose={dose}
                    divider={i > 0}
                    logAtTime={doseContext}
                    onGive={() => give(dose)}
                    onSkip={() => skip(dose)}
                    onLogAtTime={(givenAt) => logAtTime(dose, givenAt)}
                    onOpenCourse={() => {
                      void navigate({
                        to: "/courses/$courseId",
                        params: { courseId: dose.courseId },
                      });
                    }}
                    onStartCourse={() => startCourse(dose)}
                  />
                );
              })}
        </PetCard>
      </div>
    );
  }

  // SPEC §9 wants Today interactive fast, so the loading pass is the real
  // header over an empty list rather than a spinner covering the screen.
  if (!view) {
    return (
      <div style={SCREEN_STYLE}>
        <ScreenHeader
          title={greetingFor(now, tr)}
          subtitle={isPending ? t("today.loadingDoses") : undefined}
          action="plus"
          actionLabel={t("today.addCourse")}
          onAction={onAddCourse}
        />
        <div style={LIST_STYLE} />
      </div>
    );
  }

  const { count, earliest, petName } = view.overdue;

  return (
    <div style={SCREEN_STYLE}>
      <ScreenHeader
        title={view.greeting}
        subtitle={view.subtitle}
        action="plus"
        actionLabel={t("today.addCourse")}
        onAction={onAddCourse}
      />

      {count > 0 && earliest ? (
        <div style={{ padding: "0 22px 14px" }}>
          <AlertBanner
            title={t("today.banner.overdueCount", { count })}
            detail={t("today.banner.detail", {
              // `petName` is null only when there is no earliest dose, and
              // this branch has one. The empty string keeps the interpolation
              // total rather than printing "null".
              petName: petName ?? "",
              medicationName: earliest.medicationName,
              time: earliest.time ?? "",
            })}
            action={t("today.log")}
            // Exactly the dose the engine named as earliest, and nothing else.
            onAction={() => give(earliest)}
          />
        </div>
      ) : null}

      <div style={LIST_STYLE}>
        {view.isEmpty ? (
          <EmptyState
            icon="calendar-check"
            title={t("today.emptyTitle")}
            detail={view.emptyDetail ?? undefined}
          />
        ) : null}

        {/* `view.groups` is already in SPEC §5.1's order — overdue pets, then
            pending by earliest due, then done. Rendered as given, never
            re-sorted here. */}
        {view.groups.map(renderCard)}

        {view.comingUp ? (
          <Card tone="dashed" pad={14} style={COMING_UP_STYLE}>
            <span>{view.comingUp.label}</span>
            <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
              {view.comingUp.when}
            </span>
          </Card>
        ) : null}
      </div>

      <EarlyGiveConfirmDialog
        conflict={earlyGiveConflict}
        onOpenChange={(open) => {
          if (!open) setEarlyGiveConflict(null);
        }}
        onConfirm={confirmEarlyGive}
      />
    </div>
  );
}
