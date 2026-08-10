// SPEC §6.6: "Bottom bar: Shopping list · N items → a plain, shareable list
// (name, quantity needed, which pets), copyable as text."
//
// Structure, the `stopBubbling` guard and the popup/backdrop style objects
// are copied verbatim from `features/today/LogAtTimeSheet.tsx`, the house
// pattern for a dialog reached from this screen. The list text itself is
// never assembled here — `shoppingListText` (pure, in `./shoppingList.ts`)
// already owns the "name · quantity · pets" formatting.
import { type ReactElement, type SyntheticEvent } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Button, EmptyState } from "@/components/ds";
import { useTranslator } from "@/i18n";
import { shoppingListText } from "./shoppingList";
import type { SupplyItem } from "./model";

/**
 * Keeps the dialog's interactions inside the dialog. See
 * `features/today/LogAtTimeSheet.tsx`'s own `stopBubbling` for the reason:
 * React synthetic events propagate through the React tree, not the DOM tree,
 * so `Dialog.Portal` moving the markup to the end of `<body>` does not stop a
 * click or pointer-down inside the popup from bubbling to whatever clickable
 * row wrapper rendered this dialog.
 */
function stopBubbling(event: SyntheticEvent): void {
  event.stopPropagation();
}

export interface ShoppingListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: SupplyItem[];
}

export function ShoppingListDialog({
  open,
  onOpenChange,
  items,
}: ShoppingListDialogProps): ReactElement {
  const tr = useTranslator();
  const { t } = tr;
  const text = shoppingListText(items, tr);

  function copy() {
    // jsdom has no clipboard by default, and a real browser can still refuse
    // (permissions, insecure context) — guard the API and swallow a
    // rejection rather than let either surface as an unhandled error.
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
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
          <Dialog.Title style={{ fontSize: 17, fontWeight: 600, color: "var(--ink-1)" }}>
            {t("supplies.shoppingList.dialogTitle")}
          </Dialog.Title>

          {items.length === 0 ? (
            <EmptyState
              icon="shopping-cart"
              title={t("supplies.shoppingList.countLabel", { count: 0 })}
            />
          ) : (
            <>
              <pre
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  fontFamily: "var(--font-sans)",
                  fontSize: 14,
                  color: "var(--ink-2)",
                }}
              >
                {text}
              </pre>
              <Button type="button" variant="primary" onClick={copy}>
                {t("supplies.shoppingList.copy")}
              </Button>
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
