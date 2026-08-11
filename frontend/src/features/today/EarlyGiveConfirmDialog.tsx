// SPEC §3b's early-give confirm: "Allow, but confirm when early." Reached
// only when a `logDose` write collides with the schedule's grace window on a
// DIFFERENT occurrence (F2 — never the same one; see `useLogDose.ts`'s
// `onError`) AND the occurrence being given was not yet due (`earlyGive`
// routing) — every other collision keeps the flat duplicate-toast rejection.
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
import type { EarlyGiveConflict } from "./useLogDose";

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
  conflict: EarlyGiveConflict | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function EarlyGiveConfirmDialog({
  conflict,
  onOpenChange,
  onConfirm,
}: EarlyGiveConfirmDialogProps): ReactElement {
  const t = useT();

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
            {t("today.earlyGive.title", { medicationName: conflict?.vars.medicationName ?? "" })}
          </Dialog.Title>
          {/*
            F4: dedicated dialog copy, not the flat-rejection toast's
            "Already given by Marta at 07:12" reused verbatim — that phrasing
            is accurate for the toast (the dose just attempted IS the one on
            record) but false here, where the collision is BY CONSTRUCTION a
            DIFFERENT occurrence. States the two facts that actually let
            someone decide: how long ago the other dose was given/skipped,
            and how far ahead of ITS OWN due instant this one would land —
            both pre-rendered by `useLogDose.ts` via `history.detail.lateDuration`
            ("40 min" / "1 h 30 min"), never a wall-clock time to subtract.
          */}
          <Dialog.Description style={DESCRIPTION_STYLE}>
            {conflict
              ? t(
                  conflict.status === "skipped" ? "today.earlyGive.detailSkipped" : "today.earlyGive.detailGiven",
                  {
                    name: conflict.name,
                    sinceLast: t("history.detail.lateDuration", conflict.sinceLast),
                    early: t("history.detail.lateDuration", conflict.early),
                  },
                )
              : ""}
          </Dialog.Description>
          <div style={ACTIONS_STYLE}>
            <Dialog.Close
              render={
                <Button type="button" size="md" variant="secondary">
                  {t("today.earlyGive.cancel")}
                </Button>
              }
            />
            {/* F3: `danger`, matching the house dialogs' affirmative — see the header comment. */}
            <Button type="button" size="md" variant="danger" onClick={onConfirm}>
              {t("today.earlyGive.confirm")}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
