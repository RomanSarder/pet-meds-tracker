// SPEC §6.6: "Update stock" — every path here goes through
// `useSetStockOnHand` / `useAddPack`, which append a `StockAdjustment` via
// the repo. Nothing in this file ever writes `medication.stockUnits`
// directly, and nothing here ever passes an `actorId` — the repo stamps it
// itself.
//
// Structure, the `stopBubbling` guard and the popup/backdrop style objects
// are copied verbatim from `features/today/LogAtTimeDialog.tsx`, the house
// pattern for a dialog reached from a row.
import {
  useEffect,
  useId,
  useState,
  type ReactElement,
  type SyntheticEvent,
} from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Button } from "@/components/ds";
import type { Medication } from "@/domain";
import { useTranslator } from "@/i18n";
import { useAddPack, useSetStockOnHand } from "./hooks";
import {
  allowsCoarseFigure,
  coarseLevelLabel,
  coarseUnits,
  COARSE_LEVELS,
  type CoarseLevel,
} from "./stockOptions";

/**
 * Keeps the dialog's interactions inside the dialog. See
 * `features/today/LogAtTimeDialog.tsx`'s own `stopBubbling` for the reason:
 * React synthetic events propagate through the React tree, not the DOM
 * tree, so `Dialog.Portal` moving the markup to the end of `<body>` does not
 * stop a click or pointer-down inside the popup from bubbling to whatever
 * clickable row wrapper rendered this dialog.
 */
function stopBubbling(event: SyntheticEvent): void {
  event.stopPropagation();
}

export interface UpdateStockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medication: Medication;
}

export function UpdateStockDialog({
  open,
  onOpenChange,
  medication,
}: UpdateStockDialogProps): ReactElement {
  const [value, setValue] = useState(() => String(medication.stockUnits ?? ""));
  const inputId = useId();
  const tr = useTranslator();
  const { t } = tr;
  const setStockOnHand = useSetStockOnHand();
  const addPack = useAddPack();

  // Re-seed the field every time the dialog is opened, so a cancelled edit
  // is not still sitting in the input the next time the user reaches for it.
  useEffect(() => {
    if (open) setValue(String(medication.stockUnits ?? ""));
  }, [open, medication.stockUnits]);

  const units = Number(value);
  const saveDisabled = value.trim() === "" || !Number.isFinite(units) || units < 0;

  function save() {
    if (saveDisabled) return;
    setStockOnHand.mutate({ medicationId: medication.id, units });
    onOpenChange(false);
  }

  function addPurchasedPack() {
    if (medication.packSize === null) return;
    addPack.mutate({ medicationId: medication.id, deltaUnits: medication.packSize });
    onOpenChange(false);
  }

  function setCoarse(level: CoarseLevel) {
    if (medication.packSize === null) return;
    setStockOnHand.mutate({
      medicationId: medication.id,
      units: coarseUnits(medication.packSize, level),
    });
    onOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop
          onClick={stopBubbling}
          onPointerDown={stopBubbling}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.4)",
          }}
        />
        <Dialog.Popup
          onClick={stopBubbling}
          onPointerDown={stopBubbling}
          style={{
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
          }}
        >
          <Dialog.Title
            style={{ fontSize: 17, fontWeight: 600, color: "var(--ink-1)" }}
          >
            {t("supplies.updateStock.title")}
          </Dialog.Title>
          <Dialog.Description
            style={{ fontSize: 13, color: "var(--ink-3)", margin: 0 }}
          >
            {medication.name}
          </Dialog.Description>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label
              htmlFor={inputId}
              style={{ fontSize: 13, color: "var(--ink-2)" }}
            >
              {t("supplies.updateStock.unitsOnHand")}
            </label>
            <input
              id={inputId}
              type="number"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              style={{
                height: 44,
                padding: "0 12px",
                fontSize: 16,
                fontFamily: "var(--font-sans)",
                color: "var(--ink-1)",
                background: "var(--surface)",
                border: "1px solid var(--line-strong)",
                borderRadius: "var(--radius-md, 12px)",
              }}
            />
          </div>

          {medication.packSize !== null ? (
            <Button
              type="button"
              size="md"
              variant="secondary"
              onClick={addPurchasedPack}
            >
              {t("supplies.updateStock.addPack")}
            </Button>
          ) : null}

          {allowsCoarseFigure(medication) && medication.packSize !== null ? (
            <div style={{ display: "flex", gap: 8 }}>
              {COARSE_LEVELS.map((level) => (
                <Button
                  key={level}
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setCoarse(level)}
                >
                  {coarseLevelLabel(level, tr)}
                </Button>
              ))}
            </div>
          ) : null}

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              marginTop: 4,
            }}
          >
            <Dialog.Close
              render={
                <Button type="button" size="md" variant="secondary">
                  {t("supplies.updateStock.cancel")}
                </Button>
              }
            />
            <Button
              type="button"
              size="md"
              variant="primary"
              disabled={saveDisabled}
              onClick={save}
            >
              {t("supplies.updateStock.save")}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
