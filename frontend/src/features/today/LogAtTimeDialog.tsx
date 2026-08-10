// SPEC §4: "the user can always log a past dose with a corrected `givenAt`".
//
// This dialog is that path, reached from the row's overflow menu. It is a
// *fresh* log with an explicit `givenAt`, not an edit of an existing event and
// not a correction of the schedule — SPEC §3b is explicit that logging early or
// late shifts the chain on purpose, so nothing here tries to "fix" anything.
//
// The only arithmetic in the file is `atLocalTime(day, value)`. The instant is
// never assembled by hand and never routed through UTC: `atLocalTime` builds it
// with the wall-clock `new Date(y, m, d, hh, mm)` constructor, which is what
// keeps a dose logged at 08:00 on a DST-shift day mean 08:00 local (SPEC §3d).
import {
  useEffect,
  useId,
  useState,
  type ReactElement,
  type SyntheticEvent,
} from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Button } from "@/components/ds";
import { atLocalTime, type LocalDate } from "@/domain";
import { useT } from "@/i18n";

/**
 * Keeps the dialog's interactions inside the dialog.
 *
 * The caller renders this from inside `TodayPage`'s clickable pet-card wrapper.
 * React synthetic events propagate through the REACT tree, not the DOM tree, so
 * `Dialog.Portal` moving the markup to the end of `<body>` changes nothing:
 * without this, typing in the time field, pressing Cancel, dismissing the
 * backdrop or confirming with Log each bubble to that wrapper and navigate to
 * Pet detail — with the dialog left floating over the wrong screen. Pointer-down
 * is stopped alongside click because the card handler is reachable through
 * either path on its own.
 */
function stopBubbling(event: SyntheticEvent): void {
  event.stopPropagation();
}

export interface LogAtTimeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Local day the dose belongs to, "YYYY-MM-DD". */
  day: LocalDate;
  /** Pre-fills the field. */
  defaultTime: string;
  medicationName: string;
  onConfirm: (givenAt: Date) => void;
}

export function LogAtTimeDialog({
  open,
  onOpenChange,
  day,
  defaultTime,
  medicationName,
  onConfirm,
}: LogAtTimeDialogProps): ReactElement {
  const t = useT();
  const [value, setValue] = useState(defaultTime);
  const inputId = useId();

  // Re-seed the field every time the dialog is opened, so a cancelled edit is
  // not still sitting in the input the next time the user reaches for it.
  useEffect(() => {
    if (open) setValue(defaultTime);
  }, [open, defaultTime]);

  function confirm() {
    if (!value) return;
    onConfirm(atLocalTime(day, value));
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
            {t("today.logAtTime.title")}
          </Dialog.Title>
          <Dialog.Description
            style={{ fontSize: 13, color: "var(--ink-3)", margin: 0 }}
          >
            {/* A medication name is DATA (SPEC §10a) — rendered verbatim. */}
            {medicationName}
          </Dialog.Description>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label
              htmlFor={inputId}
              style={{ fontSize: 13, color: "var(--ink-2)" }}
            >
              {t("today.logAtTime.timeGiven")}
            </label>
            <input
              id={inputId}
              type="time"
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
                  {t("today.cancel")}
                </Button>
              }
            />
            <Button
              type="button"
              size="md"
              variant="primary"
              disabled={!value}
              onClick={confirm}
            >
              {t("today.log")}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
