// SPEC §3b's early-give confirm: "Allow, but confirm when early." Reached
// only when a `logDose` write collides with the schedule's grace window AND
// the occurrence being given was not yet due (`useLogDose.ts`'s `earlyGive`
// routing) — every other collision keeps the flat duplicate-toast rejection.
//
// Structure, the `stopBubbling` guard and the popup/backdrop style objects
// are copied verbatim from `features/household/HouseholdPage.tsx`'s confirm
// dialogs — the house pattern for a plain Title/Description/Cancel/action
// confirm reached from a row, as opposed to `LogAtTimeSheet.tsx`'s
// form-carrying sheet (which this is deliberately NOT: it asks one yes/no
// question, not a time).
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
            "Already given by Marta at 07:12" / "Already skipped by Marta at
            07:12" — the SAME strings the flat-rejection toast uses
            (`useLogDose.ts`'s `onError`), reused verbatim rather than
            reworded: this dialog exists only to add a choice on top of
            exactly that fact, not to restate it differently.
          */}
          <Dialog.Description style={DESCRIPTION_STYLE}>
            {conflict
              ? conflict.status === "skipped"
                ? t("today.toast.duplicateSkipped", { name: conflict.name, time: conflict.time })
                : t("today.toast.duplicateGiven", { name: conflict.name, time: conflict.time })
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
            <Button type="button" size="md" variant="primary" onClick={onConfirm}>
              {t("today.earlyGive.confirm")}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
