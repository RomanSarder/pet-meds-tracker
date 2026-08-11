// SPEC §5's give confirm: nothing refuses a dose, so every heuristic guard
// ends up here. Reached when a `logDose` write lands within the schedule's
// grace window of a DIFFERENT occurrence, or within `EARLY_GIVE_FLOOR_MIN` of
// any live dose on the course. The only collision that does NOT reach here is
// the same-occurrence hard block (a double-tap of one row), which has nothing
// to ask about — see `useLogDose.ts`'s `onError`.
//
// The description is COMPOSED from whole sentences rather than selected from
// one key per case: reason × given/skipped × early-or-not is eight
// permutations, and eight near-identical strings per locale rot the moment
// one of them is edited. Each fragment is a complete sentence, so the
// composition survives a locale whose clause order differs.
//
// The `stopBubbling` guard and the popup/backdrop style objects are copied
// from `features/household/HouseholdPage.tsx`'s confirm dialogs — the house
// pattern for a plain Title/Description/Cancel/action confirm reached from a
// row, as opposed to `LogAtTimeSheet.tsx`'s form-carrying sheet (which this
// is deliberately NOT: it asks one yes/no question, not a time). NOT copied
// from there: the affirmative action's variant. The house dialogs use
// `danger` for their destructive affirmative (removing a member, leaving a
// household) — this one used `primary` until the F3 fix below, which is
// wrong for the same reason theirs is `danger`: logging a second dose close
// to the last one is the same class of action, and deserves the same weight.
import type { CSSProperties, ReactElement, SyntheticEvent } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Button } from "@/components/ds";
import { useT } from "@/i18n";
import type { GiveConflict } from "./useLogDose";

/**
 * Keeps the dialog's interactions inside the dialog. See
 * `features/supplies/UpdateStockDialog.tsx`'s identical `stopBubbling` for
 * the reason: React synthetic events propagate through the React tree, not
 * the DOM tree, so `Dialog.Portal` moving the markup to the end of `<body>`
 * does not stop a click or pointer-down inside the popup from bubbling to
 * the card wrapper the triggering row renders inside — which would both
 * confirm/cancel AND navigate to Pet detail underneath it.
 */
function stopBubbling(event: SyntheticEvent): void {
  event.stopPropagation();
}

const BACKDROP_STYLE: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.4)",
};

const POPUP_STYLE: CSSProperties = {
  position: "fixed",
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  width: "min(340px, calc(100vw - 32px))",
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 20,
  background: "var(--surface)",
  border: "1px solid var(--line-quiet)",
  borderRadius: "var(--radius-lg, 16px)",
  fontFamily: "var(--font-sans)",
};

const TITLE_STYLE: CSSProperties = { fontSize: 17, fontWeight: 600, color: "var(--ink-1)" };
const DESCRIPTION_STYLE: CSSProperties = {
  fontSize: 13,
  color: "var(--ink-3)",
  margin: 0,
  lineHeight: 1.5,
};
const ACTIONS_STYLE: CSSProperties = { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 };

export interface EarlyGiveConfirmDialogProps {
  /** `null` closes the dialog. One instance lives at the page level, not per row. */
  conflict: GiveConflict | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function EarlyGiveConfirmDialog({
  conflict,
  onOpenChange,
  onConfirm,
}: EarlyGiveConfirmDialogProps): ReactElement {
  const t = useT();

  /**
   * Sentence 1 — what this collides with. The floor guard (`tooSoon`) knows
   * no actor, so it gets the impersonal form rather than a "Someone" that
   * would imply the app looked and found a person it could not name.
   */
  function collisionSentence(c: GiveConflict): string {
    const sinceLast = t("history.detail.lateDuration", c.sinceLast);
    if (c.reason === "tooSoon" || c.name === null) {
      return t("today.giveConfirm.lastDose", { sinceLast });
    }
    return c.status === "skipped"
      ? t("today.giveConfirm.lastSkipped", { name: c.name, sinceLast })
      : t("today.giveConfirm.lastGiven", { name: c.name, sinceLast });
  }

  /**
   * Which action this dialog is confirming — the one being ATTEMPTED
   * (`vars.status`), never `conflict.status`, which describes the dose already
   * on record. Getting those two the wrong way round would title a skip with
   * give words whenever the thing it collided with was a give.
   */
  function isSkip(c: GiveConflict): boolean {
    return c.vars.status === "skipped";
  }

  function description(c: GiveConflict): string {
    const parts = [collisionSentence(c)];
    if (c.early !== null) {
      parts.push(t("today.giveConfirm.notDueYet", { early: t("history.detail.lateDuration", c.early) }));
    }
    parts.push(t(isSkip(c) ? "today.giveConfirm.questionSkip" : "today.giveConfirm.question"));
    return parts.join(" ");
  }

  return (
    <Dialog.Root open={conflict !== null} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop onClick={stopBubbling} onPointerDown={stopBubbling} style={BACKDROP_STYLE} />
        {/*
          `Dialog.Portal` moves this popup outside `.ds-root`, where every DS
          token is declared — see `LogAtTimeSheet.tsx`'s `Dialog.Popup` and
          `HouseholdPage.tsx`'s confirm dialogs for the same fix, same reason.
          Without this class `var(--surface)`/`var(--line-quiet)` below
          resolve to nothing and the dialog paints as bare text over the page.
        */}
        <Dialog.Popup
          onClick={stopBubbling}
          onPointerDown={stopBubbling}
          className="ds-root"
          style={POPUP_STYLE}
        >
          <Dialog.Title style={TITLE_STYLE}>
            {t(
              conflict && isSkip(conflict)
                ? "today.giveConfirm.titleSkip"
                : "today.giveConfirm.title",
              { medicationName: conflict?.vars.medicationName ?? "" },
            )}
          </Dialog.Title>
          {/*
            Dedicated dialog copy, not the flat-rejection toast's "Already
            given by Marta at 07:12" reused verbatim — that phrasing is
            accurate for the toast (the dose just attempted IS the one on
            record) but false here, where the collision is BY CONSTRUCTION a
            different occurrence, or no occurrence at all. States the facts
            that actually let someone decide, as durations pre-rendered via
            `history.detail.lateDuration` ("40 min" / "1 h 30 min"), never a
            wall-clock time to subtract.
          */}
          <Dialog.Description style={DESCRIPTION_STYLE}>
            {conflict ? description(conflict) : ""}
          </Dialog.Description>
          <div style={ACTIONS_STYLE}>
            <Dialog.Close
              render={
                <Button type="button" size="md" variant="secondary">
                  {t("today.giveConfirm.cancel")}
                </Button>
              }
            />
            {/* F3: `danger`, matching the house dialogs' affirmative — see the header comment. */}
            <Button type="button" size="md" variant="danger" onClick={onConfirm}>
              {t(
                conflict && isSkip(conflict)
                  ? "today.giveConfirm.confirmSkip"
                  : "today.giveConfirm.confirm",
              )}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
