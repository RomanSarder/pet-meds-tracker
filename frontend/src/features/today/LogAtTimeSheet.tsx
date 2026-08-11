// SPEC §6.1a "Log at a different time" — a bottom sheet over Today, for a
// dose that was given before it was logged. Replaces `LogAtTimeDialog.tsx`,
// which offered a single `<input type="time">`; this sheet is the design's
// real surface, composed only from `logAtTimeModel.ts` (frozen, computes
// everything) and existing `components/ds` primitives — no new DS component.
//
// PURITY BOUNDARY. Every instant, duration and discriminator on screen comes
// from a `logAtTimeModel` call; this file resolves each one through the
// catalogue and lays out DOM. It performs no scheduling arithmetic of its
// own — see `logAtTimeModel.ts`'s own header for why that split matters.
import { useEffect, useState, type ReactElement, type SyntheticEvent } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Button, Card, Chip, IconButton, PetAvatar } from "@/components/ds";
import { addLocalDays, formatHHMM, localDayKey, now } from "@/domain";
import { useNow } from "@/app/useNow";
import { useTranslator } from "@/i18n";
import {
  atOffset,
  boundsFor,
  canConfirm,
  canStepEarlier,
  canStepLater,
  consequenceFor,
  DEFAULT_OFFSET_MIN,
  elapsedSince,
  helperFor,
  isBelowFloor,
  OFFSET_CHOICES_MIN,
  scheduledChoice,
  stepBy,
  STEP_MIN,
} from "./logAtTimeModel";
import type { LogAtTimeContext, TodayDose } from "./types";

export interface LogAtTimeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dose: TodayDose;
  context: LogAtTimeContext;
  onConfirm: (givenAt: Date) => void;
  onSkipInstead: () => void;
}

/**
 * Keeps the sheet's interactions inside the sheet.
 *
 * Carried over verbatim from `LogAtTimeDialog.tsx` (and `ShoppingListDialog.tsx`
 * after it): the sheet renders from inside `TodayPage`'s clickable pet-card
 * wrapper and `TodayDoseRow`'s own overflow menu, both of which navigate or
 * act on a plain click. React synthetic events propagate through the REACT
 * tree, not the DOM tree, so `Dialog.Portal` moving the markup to the end of
 * `<body>` does not stop a click or pointer-down inside the sheet from
 * reaching either wrapper — without this, tapping a chip, the stepper, or
 * Confirm would also log/skip/navigate on the row underneath. Pointer-down is
 * stopped alongside click because the wrapper is reachable through either
 * path independently.
 */
function stopBubbling(event: SyntheticEvent): void {
  event.stopPropagation();
}

/** A whole-minute duration into `{hours, minutes}`, for `history.detail.lateDuration`. */
function toHoursMinutes(totalMinutes: number): { hours: number; minutes: number } {
  const abs = Math.abs(totalMinutes);
  return { hours: Math.floor(abs / 60), minutes: abs % 60 };
}

type Source =
  | { kind: "offset"; minutes: number }
  | { kind: "scheduled" }
  | { kind: "exact" };

const SCHEDULED_ROW_STYLE = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  textAlign: "left" as const,
  padding: "13px 16px",
  borderRadius: "var(--radius-md)",
  width: "100%",
  cursor: "pointer",
  fontFamily: "var(--font-sans)",
};

export function LogAtTimeSheet({
  open,
  onOpenChange,
  dose,
  context,
  onConfirm,
  onSkipInstead,
}: LogAtTimeSheetProps): ReactElement {
  const { t, fmt } = useTranslator();
  // Ticks so "today · N ago" advances and a sheet left open long enough
  // sees the rolling 24 h floor move (SPEC §9). Event handlers below read `now()` fresh
  // instead of closing over this value — see `readNow` for why.
  const nowTick = useNow();
  // The latest instant any handler has actually observed. See `effectiveNow`.
  const [handlerNow, setHandlerNow] = useState<Date>(() => now());

  const [chosen, setChosen] = useState<Date>(() => atOffset(DEFAULT_OFFSET_MIN, now()));
  const [source, setSource] = useState<Source>({ kind: "offset", minutes: DEFAULT_OFFSET_MIN });

  /**
   * The clock read every handler makes, recorded so the render that follows
   * agrees with it.
   *
   * A handler must NOT close over `nowTick`: `useNow()` repaints at most every
   * 30 s, so an offset measured from it would make "Just now" up to 30 s stale
   * — `TodayDoseRow.tsx` (~line 202) makes the identical point, and the
   * committed `givenAt` is the value that staleness would corrupt.
   *
   * But a fresh read alone put the two out of order: tapping *Just now* set
   * `chosen = freshNow`, which is strictly LATER than the last painted
   * `nowTick`, so the very next render read the headline as in the future —
   * berry text, disabled Confirm, `+ 5 min` dead — for up to 30 s, on the
   * sheet's most obvious action. Recording the read fixes the ordering at its
   * source rather than papering over it at each comparison.
   */
  function readNow(): Date {
    const fresh = now();
    setHandlerNow(fresh);
    return fresh;
  }

  // Time only moves forward, so the later of the two reads is the one closer
  // to the truth, and taking the max can never invent an instant that has not
  // happened yet: both are past reads of the same injected clock. Every
  // render-time comparison below uses this, never `nowTick` — a check that
  // disagreed with the handler that set `chosen` is the bug above.
  const effectiveNow =
    handlerNow.getTime() > nowTick.getTime() ? handlerNow : nowTick;
  const floorMs = boundsFor(effectiveNow).floor.getTime();

  // Re-seed on EVERY open — a cancelled edit must not persist into the next
  // time this sheet is reached. Carried over from `LogAtTimeDialog.tsx`'s own
  // `useEffect` on `open`.
  useEffect(() => {
    if (!open) return;
    const seedNow = now();
    setHandlerNow(seedNow);
    setChosen(atOffset(DEFAULT_OFFSET_MIN, seedNow));
    setSource({ kind: "offset", minutes: DEFAULT_OFFSET_MIN });
  }, [open]);

  // The floor MOVES continuously under an open sheet (SPEC §9, now a rolling
  // 24 h window rather than a local-midnight jump): left up long enough,
  // `boundsFor(...).floor` slides forward and an old `chosen` eventually falls
  // out of range. `canConfirm` refuses it correctly, but with no explanation
  // the user is left staring at a dead footer under a value this very sheet
  // offered. Re-clamping to the new floor keeps the sheet in a confirmable
  // state and SHOWS the change: the headline, the "N ago" label and the
  // Confirm button all read the new time before anything is written.
  useEffect(() => {
    if (!open) return;
    setChosen((current) => (current.getTime() < floorMs ? new Date(floorMs) : current));
  }, [open, floorMs]);

  // Withdrawn once it falls before the floor, for the same reason:
  // `scheduledChoice` only checks the occurrence's OWN day, so once the
  // rolling 24 h floor has passed a stale `dueAt` it would keep happily
  // offering it as a one-tap row that could only ever be re-clamped away. A
  // FUTURE `scheduledAt` is still offered untouched — that berry-headline
  // case is deliberate (SPEC §6.1a).
  const rawScheduledAt = scheduledChoice(dose.occurrence);
  const scheduledAt =
    rawScheduledAt !== null && !isBelowFloor(rawScheduledAt, effectiveNow) ? rawScheduledAt : null;
  const isFuture = chosen.getTime() > effectiveNow.getTime();
  const confirmDisabled = !canConfirm(chosen, effectiveNow);

  function selectOffset(minutes: number) {
    setChosen(atOffset(minutes, readNow()));
    setSource({ kind: "offset", minutes });
  }

  function selectScheduled() {
    if (scheduledAt === null) return;
    readNow();
    setChosen(new Date(scheduledAt.getTime()));
    setSource({ kind: "scheduled" });
  }

  function step(deltaMin: number) {
    const freshNow = readNow();
    setChosen((current) => stepBy(current, deltaMin, freshNow));
    setSource({ kind: "exact" });
  }

  function handleConfirm() {
    const freshNow = readNow();
    // SPEC §12's invariant as a property of the component, not of a
    // `disabled` attribute — the old dialog's `if (!value) return;` in the
    // same spirit.
    if (!canConfirm(chosen, freshNow)) return;
    onConfirm(chosen);
  }

  function handleSkip() {
    // Close first so the undo toast is not rendered behind a dismissing sheet.
    onOpenChange(false);
    onSkipInstead();
  }

  const ago = t("today.logAtTime.ago", {
    duration: t("history.detail.lateDuration", elapsedSince(chosen, effectiveNow)),
  });
  // The rolling 24 h floor (COMMON §6 item 4) means `chosen` can genuinely
  // fall on the previous LOCAL day, not just be "many hours ago" — compared
  // by calendar day, never by an hour threshold, so a value one minute past
  // local midnight still reads "yesterday" and one minute before it still
  // reads "today".
  const chosenIsYesterday = localDayKey(chosen) !== localDayKey(effectiveNow);
  const agoLabel = t(
    chosenIsYesterday ? "today.logAtTime.yesterdayAgo" : "today.logAtTime.todayAgo",
    { ago },
  );

  const helper = helperFor(chosen, scheduledAt, effectiveNow);
  const helperText =
    helper.kind === "futureCap"
      ? t("today.logAtTime.helper.future")
      : helper.kind === "dayCheck"
        ? t("today.logAtTime.helper.dayCheck", { hours: helper.hours })
        : t("today.logAtTime.helper.range");

  const consequence = consequenceFor({
    course: context.course,
    events: context.events,
    courseEvents: context.courseEvents,
    occurrence: dose.occurrence,
    chosen,
  });

  return (
    <Dialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop
          onClick={stopBubbling}
          onPointerDown={stopBubbling}
          // `ds-root` re-establishes the whole DS token set at the portal
          // root — see the CRITICAL FIX comment on `Dialog.Popup` below.
          className="ds-root"
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--scrim)",
          }}
        />
        <Dialog.Popup
          onClick={stopBubbling}
          onPointerDown={stopBubbling}
          // CRITICAL FIX (not present in the old dialog): `DsRoot` mounts
          // inside `#root`, but `Dialog.Portal` moves this markup to the end
          // of `<body>` — outside `.ds-root`. Every DS token is declared on
          // `.ds-root`, never `:root` (`components/ds/tokens/colors.css`), so
          // without this class every `var(--surface)`, `var(--ink-*)`,
          // `var(--radius-*)` etc. below resolves to nothing wherever the
          // portal lands. The old dialog had this exact bug — unnoticed
          // because its backdrop was hard-coded `rgba(0,0,0,0.4)` and
          // `--font-sans`/`--radius-*` happen to also exist on `:root` via the
          // shadcn layer. One class re-establishes the entire token set.
          className="ds-root"
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            flexDirection: "column",
            background: "var(--surface)",
            borderTopLeftRadius: "var(--radius-lg)",
            borderTopRightRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-sheet)",
            maxHeight: "92%",
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 2px" }}>
            <div
              style={{
                width: 38,
                height: 4,
                borderRadius: 2,
                background: "var(--line-strong)",
              }}
            />
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 22px 14px",
            }}
          >
            <PetAvatar name={context.pet.name} tint={context.pet.tint} size={40} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Dialog.Title
                style={{ fontSize: 17, fontWeight: 700, color: "var(--ink-1)", margin: 0 }}
              >
                {dose.title}
              </Dialog.Title>
              <Dialog.Description
                style={{
                  fontSize: 13,
                  color: "var(--ink-3)",
                  marginTop: 2,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {t("today.logAtTime.subline", {
                  petName: context.pet.name,
                  // `dueAt` is null only for an unanchored `fromLastDose`
                  // chain (SPEC §3b: no `given` event yet) — a state this
                  // sheet is not reachable from in practice, since that
                  // course has no Give/overflow yet either. Falling back to
                  // the live clock rather than crashing keeps this a pure
                  // rendering choice, not a scheduling one.
                  time: formatHHMM(dose.occurrence.dueAt ?? effectiveNow),
                  schedule: context.scheduleSummary,
                })}
              </Dialog.Description>
            </div>
            <Dialog.Close
              render={
                <IconButton
                  icon="x"
                  variant="plain"
                  size={40}
                  label={t("today.logAtTime.close")}
                />
              }
            />
          </div>

          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "0 22px 4px",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
              <div
                // `data-testid` only — the value box below shows the same
                // formatted time, so tests need an unambiguous target for
                // the headline specifically.
                data-testid="log-at-time-headline"
                // SPEC §9: tapping a chip moves the headline, the "N ago"
                // label, the helper line and the consequence card while focus
                // stays on the chip — silently, for a screen-reader user.
                // ONLY the headline is live: the other three are derived from
                // it, and four regions firing at once would queue four
                // overlapping utterances for one tap. The element itself is
                // stable across every re-render (same position, no key), so
                // React mutates its text rather than replacing the node —
                // which is what makes a polite announcement fire at all.
                aria-live="polite"
                aria-atomic="true"
                style={{
                  fontSize: 52,
                  fontWeight: 800,
                  letterSpacing: "-0.02em",
                  lineHeight: 1,
                  fontVariantNumeric: "tabular-nums",
                  color: isFuture ? "var(--alert)" : "var(--ink-1)",
                }}
              >
                {formatHHMM(chosen)}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-3)" }}>
                {agoLabel}
              </div>
            </div>

            {/*
              A hand-rolled one-of-N row rather than `SegmentedControl`, which
              is the DS component for exactly this: its wrapper is a plain
              non-scrolling flex row and it passes no per-Chip style, so the
              chips here would lose `flex: "0 0 auto"` and start shrinking
              instead of scrolling at 360px. What `SegmentedControl` really
              contributes is `aria-pressed` on each Chip — taken directly,
              below, the same way `HistoryPage.tsx`'s filter row takes it.
              Without it a screen reader reads five identical buttons and the
              selection is carried by colour alone, which SPEC §9 forbids.
            */}
            <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2, scrollbarWidth: "none" }}>
              {OFFSET_CHOICES_MIN.map((minutes) => (
                <Chip
                  key={minutes}
                  selected={source.kind === "offset" && source.minutes === minutes}
                  aria-pressed={source.kind === "offset" && source.minutes === minutes}
                  style={{ flex: "0 0 auto" }}
                  onClick={() => selectOffset(minutes)}
                >
                  {minutes === 0
                    ? t("today.logAtTime.justNow")
                    : minutes < 60
                      ? t("today.logAtTime.offsetMinutes", { minutes })
                      : t("today.logAtTime.offsetHours", { hours: minutes / 60 })}
                </Chip>
              ))}
            </div>

            {scheduledAt !== null ? (
              <button
                type="button"
                onClick={selectScheduled}
                // Same SPEC §9 point as the chips: selected is `--accent-tint`
                // plus an `--accent` border and nothing else, so without this
                // the state is colour-only.
                aria-pressed={source.kind === "scheduled"}
                style={{
                  ...SCHEDULED_ROW_STYLE,
                  background:
                    source.kind === "scheduled" ? "var(--accent-tint)" : "var(--surface-sunk)",
                  border:
                    source.kind === "scheduled"
                      ? "1px solid var(--accent)"
                      : "1px solid var(--line)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-1)" }}>
                    {t("today.logAtTime.atScheduled")}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 2 }}>
                    {t("today.logAtTime.atScheduledHelper")}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                    color: "var(--ink-1)",
                  }}
                >
                  {formatHHMM(scheduledAt)}
                </div>
              </button>
            ) : null}

            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)", marginBottom: 8 }}>
                {t("today.logAtTime.exactLabel")}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  style={{ flex: 1 }}
                  disabled={!canStepEarlier(chosen, effectiveNow)}
                  onClick={() => step(-STEP_MIN)}
                >
                  {t("today.logAtTime.earlier", { minutes: STEP_MIN })}
                </Button>
                <div
                  style={{
                    flex: "0 0 96px",
                    height: 44,
                    borderRadius: "var(--radius-md)",
                    background: "var(--surface-sunk)",
                    border: "1px solid var(--line)",
                    fontSize: 18,
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--ink-1)",
                  }}
                >
                  {formatHHMM(chosen)}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  style={{ flex: 1 }}
                  disabled={!canStepLater(chosen, effectiveNow)}
                  onClick={() => step(STEP_MIN)}
                >
                  {t("today.logAtTime.later", { minutes: STEP_MIN })}
                </Button>
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 8 }}>{helperText}</div>
            </div>

            <ConsequenceCard
              consequence={consequence}
              now={effectiveNow}
              chosen={chosen}
              t={t}
              weekdayDayMonth={fmt.weekdayDayMonth}
            />
          </div>

          <div
            style={{
              padding: "12px 22px 22px",
              borderTop: "1px solid var(--line)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <Button
              type="button"
              variant="ink"
              size="lg"
              block
              disabled={confirmDisabled}
              onClick={handleConfirm}
            >
              {t("today.logAtTime.confirm", { time: formatHHMM(chosen) })}
            </Button>
            <Button type="button" variant="ghost" size="sm" block onClick={handleSkip}>
              {t("today.logAtTime.skipInstead")}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The `when` clause inside `next.stays`/`next.moves` — mirrors `todayModel.ts`'s
 * `formatNextDose`.
 *
 * TWO PARALLEL KEY FAMILIES, ONE SHAPE. The params are identical and English
 * renders both families the same way, so this is pure routing — but the
 * families are not interchangeable. Ukrainian's «залишається» ("stays") takes
 * the locative «о», while «переноситься» ("moves") takes the allative «на», and
 * that preposition lives in the FRAGMENT rather than in the `next.*` template
 * (which is where a "stays at tomorrow at 08:00" double preposition would come
 * from otherwise). So each consequence branch must ask for its own family:
 * `stays` → `when.*`, `moves` → `whenMoves.*`. Written as two explicit
 * branches rather than an interpolated key so the catalogue's literal key
 * types keep checking every call.
 */
type WhenVariant = "when" | "whenMoves";

function whenFor(
  next: Date,
  now: Date,
  t: ReturnType<typeof useTranslator>["t"],
  weekdayDayMonth: (d: Date) => string,
  variant: WhenVariant,
): string {
  const today = localDayKey(now);
  const day = localDayKey(next);
  const time = formatHHMM(next);
  const isToday = day === today;
  const isTomorrow = day === addLocalDays(today, 1);

  if (variant === "whenMoves") {
    if (isToday) return t("today.logAtTime.whenMoves.today", { time });
    if (isTomorrow) return t("today.logAtTime.whenMoves.tomorrow", { time });
    return t("today.logAtTime.whenMoves.onDate", { date: weekdayDayMonth(next), time });
  }
  if (isToday) return t("today.logAtTime.when.today", { time });
  if (isTomorrow) return t("today.logAtTime.when.tomorrow", { time });
  return t("today.logAtTime.when.onDate", { date: weekdayDayMonth(next), time });
}

function ConsequenceCard(props: {
  consequence: ReturnType<typeof consequenceFor>;
  now: Date;
  chosen: Date;
  t: ReturnType<typeof useTranslator>["t"];
  weekdayDayMonth: (d: Date) => string;
}): ReactElement {
  const { consequence, now: nowVal, t, weekdayDayMonth } = props;

  if (consequence.kind === "none") {
    return (
      <Card tone="dashed" pad={14}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              marginTop: 6,
              flexShrink: 0,
              background: "var(--line-strong)",
            }}
          />
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-1)" }}>
            {t("today.logAtTime.next.none")}
          </div>
        </div>
      </Card>
    );
  }

  if (consequence.kind === "moves") {
    const when = whenFor(consequence.next, nowVal, t, weekdayDayMonth, "whenMoves");
    // `deltaMin === 0` is the model's "no planned time to compare against"
    // sentinel (an unanchored chain) — render the title only, per
    // `logAtTimeModel.ts`'s own comment on `consequenceFor`.
    const detail =
      consequence.deltaMin === 0
        ? null
        : t(
            consequence.deltaMin > 0
              ? "today.logAtTime.next.movesDetailLater"
              : "today.logAtTime.next.movesDetailEarlier",
            { delta: t("history.detail.lateDuration", toHoursMinutes(consequence.deltaMin)) },
          );
    return (
      <Card tone="quiet" pad={14}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              marginTop: 6,
              flexShrink: 0,
              background: "var(--accent)",
            }}
          />
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-1)" }}>
              {t("today.logAtTime.next.moves", { when })}
            </div>
            {detail !== null ? (
              <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 3, lineHeight: 1.5 }}>
                {detail}
              </div>
            ) : null}
          </div>
        </div>
      </Card>
    );
  }

  // "stays"
  const when = whenFor(consequence.next, nowVal, t, weekdayDayMonth, "when");
  const late =
    consequence.lateMin === null
      ? null
      : t("history.detail.givenLate", {
          late: t("history.detail.lateDuration", toHoursMinutes(consequence.lateMin)),
        });
  return (
    <Card tone="dashed" pad={14}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            marginTop: 6,
            flexShrink: 0,
            background: "var(--line-strong)",
          }}
        />
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-1)" }}>
            {t("today.logAtTime.next.stays", { when })}
          </div>
          {late !== null ? (
            <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 3, lineHeight: 1.5 }}>
              {t("today.logAtTime.next.staysDetail", { late })}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
