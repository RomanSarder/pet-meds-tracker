// One dose line on the Today screen, with the gestures SPEC §5.1 puts on it.
//
// WHY THIS WRAPPER EXISTS. SPEC §5.1 loads three gestures onto a single
// surface: the card body opens Pet detail, the row's Give button logs the dose,
// and a long-press (or the row's overflow) opens a three-item menu. The design
// system's `DoseRow` is deliberately narrower than that — its own prompt says
// "the Give button is the only tap target — the row itself is not clickable" —
// and the DS is frozen for this wave. So the gestures live out here, composed
// *around* an untouched `DoseRow`.
//
// TWO THINGS THIS FILE MUST NOT DO.
//  1. Navigate. Every gesture raises a callback; the page decides what a tap
//     means. A component that routed would make this row unusable anywhere but
//     the Today screen.
//  2. Re-guard the Give button. `DoseRow` already calls `e.stopPropagation()`
//     on it (components/ds/pets/DoseRow.tsx:67), which is precisely what keeps
//     a Give tap from bubbling to the card wrapper and navigating. A second
//     guard here would duplicate that contract in two files and let them drift.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import { Menu } from "@base-ui/react/menu";
import { Button, DoseRow, IconButton } from "@/components/ds";
import { formatHHMM, now } from "@/domain";
import { LogAtTimeDialog } from "./LogAtTimeDialog";
import type { TodayDose } from "./types";

/** SPEC §5.1's long-press, and the slop a real thumb needs before it counts as a drag. */
const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;

export interface TodayDoseRowProps {
  dose: TodayDose;
  divider?: boolean;
  onGive: () => void;
  onSkip: () => void;
  /** `givenAt` is a local Date chosen by the user. */
  onLogAtTime: (givenAt: Date) => void;
  onOpenCourse: () => void;
  onStartCourse: () => void;
}

function prefersReducedMotionNow(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  // The test setup installs an inert stub, so treat anything falsy or absent
  // as "motion is fine" rather than assuming a well-formed MediaQueryList.
  return Boolean(window.matchMedia("(prefers-reduced-motion: reduce)")?.matches);
}

/** SPEC §9: respect `prefers-reduced-motion` by dropping the press-scale and cross-fade. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotionNow);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!mql || typeof mql.addEventListener !== "function") return;
    const onChange = () => setReduced(Boolean(mql.matches));
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * SPEC §3b: a `fromLastDose` course with no `given` event yet "shows 'not
 * started'". The phrase has to be readable, not implied by a missing time, so
 * it is folded into the detail line unless the caller already said it.
 */
function notStartedDetail(detail: string): string {
  if (!detail) return "Not started";
  return /not started/i.test(detail) ? detail : `Not started · ${detail}`;
}

const MENU_ITEM_STYLE = {
  display: "flex",
  alignItems: "center",
  minHeight: 44,
  padding: "0 16px",
  fontSize: 15,
  color: "var(--ink-1)",
  cursor: "pointer",
  userSelect: "none",
} as const;

export function TodayDoseRow({
  dose,
  divider,
  onGive,
  onSkip,
  onLogAtTime,
  onOpenCourse,
  onStartCourse,
}: TodayDoseRowProps): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Captured when the dialog opens, not read on every render: the field seeds
  // itself from this, and a value that moved under the user mid-edit would be
  // a bug rather than a refresh.
  const [dialogTime, setDialogTime] = useState(dose.time ?? "");
  const reducedMotion = usePrefersReducedMotion();

  const rowRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);

  const cancelLongPress = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    originRef.current = null;
  }, []);

  useEffect(() => cancelLongPress, [cancelLongPress]);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // The long-press belongs to the text region only. A press that starts on a
    // button (Give, Start course, the overflow trigger) is that button's.
    const target = event.target;
    if (target instanceof Element && target.closest("button")) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    cancelLongPress();
    originRef.current = { x: event.clientX, y: event.clientY };
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      originRef.current = null;
      setMenuOpen(true);
    }, LONG_PRESS_MS);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const origin = originRef.current;
    if (!origin || timerRef.current === null) return;
    const moved =
      Math.abs(event.clientX - origin.x) > MOVE_TOLERANCE_PX ||
      Math.abs(event.clientY - origin.y) > MOVE_TOLERANCE_PX;
    if (moved) cancelLongPress();
  }

  function openLogAtTime() {
    // `now()` is the injected clock (SPEC §9), never `new Date()`, so a fixed
    // clock in a test produces a deterministic default.
    setDialogTime(dose.time ?? formatHHMM(now()));
    setDialogOpen(true);
  }

  const resolved = dose.state === "given" || dose.state === "skipped";
  const rowStyle = {
    transition: reducedMotion
      ? undefined
      : "opacity var(--dur, 200ms) var(--ease, ease)",
  };

  let body: ReactElement;
  if (dose.state === "notStarted") {
    // Not a `DoseRow`: its button label is the hard-coded string "Give", and
    // SPEC §3b wants **Start course** here. Composed from DS primitives to
    // match `DoseRow`'s layout without re-porting its source.
    body = (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "2px 0",
          fontFamily: "var(--font-sans)",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--ink-1)" }}>
            {dose.title}
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 2 }}>
            {notStartedDetail(dose.detail)}
          </div>
        </div>
        <Button
          size="sm"
          variant="primary"
          onClick={(e) => {
            e.stopPropagation();
            onStartCourse();
          }}
        >
          Start course
        </Button>
      </div>
    );
  } else if (dose.state === "given" || dose.state === "skipped") {
    // SPEC §4 gives `skipped` the same 55% opacity as `given` with the word
    // "Skipped" where the time goes. The DS has no `skipped` variant and is
    // frozen, so `state="given"` is how that presentation is reached — the
    // word itself, not the opacity, is what carries the state (SPEC §9).
    body = (
      <DoseRow
        medication={dose.title}
        detail={dose.detail}
        state="given"
        time={dose.state === "skipped" ? "Skipped" : (dose.time ?? "")}
        style={rowStyle}
      />
    );
  } else {
    body = (
      <DoseRow
        medication={dose.title}
        detail={dose.detail}
        state={dose.state === "upcoming" ? "later" : dose.state}
        onGive={onGive}
        style={rowStyle}
      />
    );
  }

  return (
    <Menu.Root open={menuOpen} onOpenChange={(open) => setMenuOpen(open)} modal={false}>
      <div
        ref={rowRef}
        role="group"
        aria-label={
          resolved
            ? `${dose.title}, ${dose.state === "skipped" ? "skipped" : "given"}`
            : dose.title
        }
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={cancelLongPress}
        onPointerLeave={cancelLongPress}
        onPointerCancel={cancelLongPress}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          // The hairline lives on the wrapper rather than on `DoseRow`, so it
          // spans the overflow trigger too instead of stopping short of it.
          borderTop: divider ? "1px solid var(--line-quiet)" : "none",
          paddingTop: divider ? 12 : 0,
          touchAction: "manipulation",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>{body}</div>
        <Menu.Trigger
          onClick={(e) => e.stopPropagation()}
          render={
            <IconButton
              icon="ellipsis"
              variant="plain"
              size={40}
              // SPEC §9: every tap target ≥ 44px.
              style={{ minWidth: 44, minHeight: 44, flexShrink: 0 }}
              label={`More options for ${dose.medicationName}`}
            />
          }
        />
      </div>

      <Menu.Portal>
        <Menu.Positioner anchor={rowRef} sideOffset={4} align="end">
          <Menu.Popup
            style={{
              minWidth: 220,
              padding: "6px 0",
              background: "var(--surface)",
              border: "1px solid var(--line-quiet)",
              borderRadius: "var(--radius-md, 12px)",
              fontFamily: "var(--font-sans)",
            }}
          >
            <Menu.Item style={MENU_ITEM_STYLE} onClick={openLogAtTime}>
              Log at a different time
            </Menu.Item>
            <Menu.Item style={MENU_ITEM_STYLE} onClick={onSkip}>
              Skip this dose
            </Menu.Item>
            <Menu.Item style={MENU_ITEM_STYLE} onClick={onOpenCourse}>
              Open course
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>

      <LogAtTimeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        day={dose.occurrence.day}
        defaultTime={dialogTime}
        medicationName={dose.medicationName}
        onConfirm={onLogAtTime}
      />
    </Menu.Root>
  );
}
