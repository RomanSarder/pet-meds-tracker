// "Edit time" on a past dose — a bottom sheet over Pet history, for a dose
// that was recorded at the wrong time and noticed later.
//
// WHY THIS IS NOT `LogAtTimeSheet`. That sheet answers "when did I give the
// dose I am logging now?", and SPEC §4 scopes it deliberately to the current
// day ("a dose remembered after midnight is corrected from history instead" —
// this sheet is that "instead"). Its whole frame is wrong here: its bounds are
// `[00:00 today, now]`, its chips are offsets from `now`, and it writes a new
// DoseEvent. This one edits a row that already exists, days old, and its
// bounds come from the doses either side of it — which is what makes the edit
// unable to shift anything unless the dose is the last one (see
// `editTimeModel.ts`'s header).
//
// PURITY BOUNDARY, as in `LogAtTimeSheet.tsx`: every instant, duration and
// discriminator on screen comes from an `editTimeModel` call; this file
// resolves each one through the catalogue and lays out DOM. No scheduling
// arithmetic of its own.
import { useEffect, useMemo, useState, type ReactElement, type SyntheticEvent } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Button, Card, Chip, IconButton, PetAvatar } from "@/components/ds";
import type { Course, DoseEvent, Pet } from "@/domain";
import { addLocalDays, formatHHMM, localDayKey, now } from "@/domain";
import { useNow } from "@/app/useNow";
import { useTranslator } from "@/i18n";
import {
  atDelta,
  boundsForEdit,
  canStepEarlier,
  canStepLater,
  clampToBounds,
  consequenceFor,
  hasChange,
  OFFSET_CHOICES_MIN,
  stepBy,
  STEP_MIN,
  type EditBounds,
} from "./editTimeModel";

export interface EditDoseTimeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pet: Pet;
  course: Course;
  /** The row being edited. */
  event: DoseEvent;
  /** Every dose event of `course` — unfiltered; the neighbours may be weeks old. */
  events: DoseEvent[];
  /** "Metacam 0.4 ml" — ALREADY LOCALIZED by the caller (`renderLogTitle`). */
  title: string;
  /** `givenAt` is a local Date chosen by the user. */
  onConfirm: (givenAt: Date) => void;
}

/** Keeps the sheet's interactions inside the sheet — see `LogAtTimeSheet.tsx`'s own note. */
function stopBubbling(event: SyntheticEvent): void {
  event.stopPropagation();
}

/** A whole-minute duration into `{hours, minutes}`, for `history.detail.lateDuration`. */
function toHoursMinutes(totalMinutes: number): { hours: number; minutes: number } {
  const abs = Math.abs(totalMinutes);
  return { hours: Math.floor(abs / 60), minutes: abs % 60 };
}

type Source = { kind: "offset"; minutes: number } | { kind: "exact" };

export function EditDoseTimeSheet({
  open,
  onOpenChange,
  pet,
  course,
  event,
  events,
  title,
  onConfirm,
}: EditDoseTimeSheetProps): ReactElement {
  const { t, fmt } = useTranslator();
  // Only the last dose's ceiling is `now`, but for that dose the ceiling moves
  // under an open sheet exactly as `LogAtTimeSheet`'s does, so the same tick
  // applies. Everything else here is anchored to instants days old and does
  // not care.
  const nowTick = useNow();
  const [handlerNow, setHandlerNow] = useState<Date>(() => now());

  const [chosen, setChosen] = useState<Date>(() => new Date(event.givenAt));
  const [source, setSource] = useState<Source>({ kind: "offset", minutes: 0 });

  /** See `LogAtTimeSheet.tsx#readNow` — same reasoning, same ordering hazard. */
  function readNow(): Date {
    const fresh = now();
    setHandlerNow(fresh);
    return fresh;
  }

  const effectiveNow = handlerNow.getTime() > nowTick.getTime() ? handlerNow : nowTick;

  // Recomputed from `effectiveNow` so a sheet held open on the last dose keeps
  // gaining ceiling rather than freezing at its mount instant.
  const bounds: EditBounds = useMemo(
    () => boundsForEdit(event, events, course, effectiveNow),
    [event, events, course, effectiveNow],
  );

  // Re-seed on EVERY open — a cancelled edit must not persist into the next
  // time this sheet is reached, and `event` may be a different row entirely.
  useEffect(() => {
    if (!open) return;
    setHandlerNow(now());
    setChosen(new Date(event.givenAt));
    setSource({ kind: "offset", minutes: 0 });
  }, [open, event]);

  function selectOffset(minutes: number) {
    readNow();
    setChosen(atDelta(event, minutes, bounds));
    setSource({ kind: "offset", minutes });
  }

  function step(deltaMin: number) {
    readNow();
    setChosen((current) => stepBy(current, deltaMin, bounds));
    setSource({ kind: "exact" });
  }

  function handleConfirm() {
    readNow();
    // The invariant as a property of the component, not of a `disabled`
    // attribute — `LogAtTimeSheet#handleConfirm` makes the same move.
    const safe = clampToBounds(chosen, bounds);
    if (!hasChange(safe, event)) return;
    onConfirm(safe);
  }

  const originalAt = new Date(event.givenAt);
  const consequence = consequenceFor({ course, events, event, chosen });

  const helperText =
    bounds.previousAt === null
      ? bounds.nextAt === null
        ? t("history.editTime.helper.upToNow")
        : t("history.editTime.helper.beforeNext", { to: formatHHMM(bounds.nextAt) })
      : bounds.nextAt === null
        ? t("history.editTime.helper.afterPrevious", { from: formatHHMM(bounds.previousAt) })
        : t("history.editTime.helper.between", {
            from: formatHHMM(bounds.previousAt),
            to: formatHHMM(bounds.nextAt),
          });

  function offsetLabel(minutes: number): string {
    if (minutes === 0) return t("history.editTime.original");
    const duration = t("history.detail.lateDuration", toHoursMinutes(minutes));
    return minutes < 0
      ? t("history.editTime.earlierBy", { duration })
      : t("history.editTime.laterBy", { duration });
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop
          onClick={stopBubbling}
          onPointerDown={stopBubbling}
          // `ds-root` re-establishes the DS token set at the portal root —
          // every token is declared on `.ds-root`, never `:root`, and the
          // portal lands outside it. See `LogAtTimeSheet.tsx` for the full note.
          className="ds-root"
          style={{ position: "fixed", inset: 0, background: "var(--scrim)" }}
        />
        <Dialog.Popup
          onClick={stopBubbling}
          onPointerDown={stopBubbling}
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
            <div style={{ width: 38, height: 4, borderRadius: 2, background: "var(--line-strong)" }} />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 22px 14px" }}>
            <PetAvatar name={pet.name} tint={pet.tint} size={40} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Dialog.Title style={{ fontSize: 17, fontWeight: 700, color: "var(--ink-1)", margin: 0 }}>
                {title}
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
                {t("history.editTime.subline", {
                  date: fmt.weekdayDayMonth(originalAt),
                  time: formatHHMM(originalAt),
                })}
              </Dialog.Description>
            </div>
            <Dialog.Close
              render={<IconButton icon="x" variant="plain" size={40} label={t("history.editTime.close")} />}
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
                data-testid="edit-dose-time-headline"
                // SPEC §9: tapping a chip moves the headline, the helper line
                // and the consequence card while focus stays on the chip.
                // ONLY the headline is live — see `LogAtTimeSheet.tsx` for why
                // announcing all three would queue overlapping utterances.
                aria-live="polite"
                aria-atomic="true"
                style={{
                  fontSize: 52,
                  fontWeight: 800,
                  letterSpacing: "-0.02em",
                  lineHeight: 1,
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--ink-1)",
                }}
              >
                {formatHHMM(chosen)}
              </div>
              {/* The day, spelled out: the bounds can straddle midnight, so a
                  bare "23:50" would not say which day it landed on. */}
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-3)" }}>
                {fmt.weekdayDayMonth(chosen)}
              </div>
            </div>

            {/* Hand-rolled one-of-N row rather than `SegmentedControl`, for the
                reason `LogAtTimeSheet.tsx` states: the chips need
                `flex: "0 0 auto"` so they scroll instead of shrinking at
                360px. `aria-pressed` is taken from it directly — without it a
                screen reader reads five identical buttons and the selection is
                carried by colour alone (SPEC §9). */}
            <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2, scrollbarWidth: "none" }}>
              {OFFSET_CHOICES_MIN.map((minutes) => (
                <Chip
                  key={minutes}
                  selected={source.kind === "offset" && source.minutes === minutes}
                  aria-pressed={source.kind === "offset" && source.minutes === minutes}
                  style={{ flex: "0 0 auto" }}
                  onClick={() => selectOffset(minutes)}
                >
                  {offsetLabel(minutes)}
                </Chip>
              ))}
            </div>

            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)", marginBottom: 8 }}>
                {t("history.editTime.exactLabel")}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  style={{ flex: 1 }}
                  disabled={!canStepEarlier(chosen, bounds)}
                  onClick={() => step(-STEP_MIN)}
                >
                  {t("history.editTime.stepEarlier", { minutes: STEP_MIN })}
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
                  disabled={!canStepLater(chosen, bounds)}
                  onClick={() => step(STEP_MIN)}
                >
                  {t("history.editTime.stepLater", { minutes: STEP_MIN })}
                </Button>
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 8 }}>{helperText}</div>
            </div>

            <ConsequenceCard
              consequence={consequence}
              now={effectiveNow}
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
              disabled={!hasChange(chosen, event)}
              onClick={handleConfirm}
            >
              {t("history.editTime.save", { time: formatHHMM(chosen) })}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The `when` clause inside `next.moves`.
 *
 * Reuses `today.logAtTime.whenMoves.*` rather than a parallel family of its
 * own: the fragment is chosen by the VERB that governs it — «переноситься»
 * takes the allative «на», which is why that family exists at all — and this
 * sheet's headline uses the same verb as §6.1a's. A second copy would be a
 * second place to get that agreement wrong.
 */
function whenMovesFor(
  next: Date,
  nowVal: Date,
  t: ReturnType<typeof useTranslator>["t"],
  weekdayDayMonth: (d: Date) => string,
): string {
  const today = localDayKey(nowVal);
  const day = localDayKey(next);
  const time = formatHHMM(next);
  if (day === today) return t("today.logAtTime.whenMoves.today", { time });
  if (day === addLocalDays(today, 1)) return t("today.logAtTime.whenMoves.tomorrow", { time });
  return t("today.logAtTime.whenMoves.onDate", { date: weekdayDayMonth(next), time });
}

function ConsequenceCard(props: {
  consequence: ReturnType<typeof consequenceFor>;
  now: Date;
  t: ReturnType<typeof useTranslator>["t"];
  weekdayDayMonth: (d: Date) => string;
}): ReactElement {
  const { consequence, now: nowVal, t, weekdayDayMonth } = props;

  if (consequence.kind === "unchanged") {
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
              {t("history.editTime.next.unchanged")}
            </div>
            <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 3, lineHeight: 1.5 }}>
              {t("history.editTime.next.unchangedDetail")}
            </div>
          </div>
        </div>
      </Card>
    );
  }

  const when = whenMovesFor(consequence.next, nowVal, t, weekdayDayMonth);
  // `deltaMin === 0` is the model's "nothing to compare against" sentinel —
  // render the headline only, exactly as §6.1a's card does.
  const detail =
    consequence.deltaMin === 0
      ? null
      : t(
          consequence.deltaMin > 0
            ? "history.editTime.next.movesDetailLater"
            : "history.editTime.next.movesDetailEarlier",
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
            {t("history.editTime.next.moves", { when })}
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
