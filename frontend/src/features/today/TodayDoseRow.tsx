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
//
// WHAT THIS FILE MUST GUARD: EVERYTHING THAT IS NOT THE GIVE BUTTON.
// `TodayPage` renders each card inside a clickable wrapper that opens Pet
// detail. React synthetic events propagate through the REACT tree, not the DOM
// tree, so a portal is not an escape hatch: `Menu.Portal` and the sheet's own
// portal are React children of that wrapper, and a click on a menu item or
// anywhere in the sheet reaches the card handler and navigates away —
// breaking SPEC §5.1's rule that logging a dose never leaves the dashboard. So
// the guard is on three surfaces, not one:
//   * `Menu.Trigger`,
//   * the `Menu.Popup` subtree (click AND pointer-down: the card handler can be
//     reached through either path independently),
//   * the sheet's popup and backdrop, guarded inside `LogAtTimeSheet`.
// The long-press has the same problem from a different direction — releasing
// the hold makes the browser synthesise a click on the row text — so the timer
// sets `suppressClickRef` and `onClickCapture` swallows exactly that one click.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import { Menu } from "@base-ui/react/menu";
import { Button, DoseRow, IconButton } from "@/components/ds";
import { useT } from "@/i18n";
import type { T } from "@/i18n";
import { LogAtTimeSheet } from "./LogAtTimeSheet";
import type { LogAtTimeContext, TodayDose } from "./types";

/** SPEC §5.1's long-press, and the slop a real thumb needs before it counts as a drag. */
const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;

export interface TodayDoseRowProps {
  dose: TodayDose;
  divider?: boolean;
  /** Everything §6.1a's sheet needs beyond `dose` itself — forwarded verbatim as its `context`. */
  logAtTime: LogAtTimeContext;
  onGive: () => void;
  onSkip: () => void;
  /** `givenAt` is a local Date chosen by the user. */
  onLogAtTime: (givenAt: Date) => void;
  onOpenCourse: () => void;
  onStartCourse: () => void;
  /**
   * A `logDose` write is already in flight somewhere on the page. Disables
   * Give/Start course so a second tap cannot land while `onMutate`'s async
   * prefix (`cancelQueries` then `currentActorId()`) still has the row
   * showing its pre-write button — the window a double-tap used to log two
   * events for the same give (F2 fix).
   */
  giving?: boolean;
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
 *
 * The "already said it" test is a case-insensitive search for the *localized*
 * phrase, not for the English words: `buildTodayView` leads a `notStarted`
 * dose's detail with the same `today.notStarted` entry, so the two always
 * agree whatever the language.
 */
function notStartedDetail(detail: string, t: T): string {
  const phrase = t("today.notStarted");
  if (!detail) return phrase;
  return detail.toLowerCase().includes(phrase.toLowerCase())
    ? detail
    : `${phrase} · ${detail}`;
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
  logAtTime,
  onGive,
  onSkip,
  onLogAtTime,
  onOpenCourse,
  onStartCourse,
  giving,
}: TodayDoseRowProps): ReactElement {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  const rowRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  // Set when the long-press timer fires, cleared by the next press or by the
  // click it exists to swallow. See `handleClickCapture`.
  const suppressClickRef = useRef(false);

  const cancelLongPress = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    originRef.current = null;
  }, []);

  useEffect(() => cancelLongPress, [cancelLongPress]);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // Every new press starts a new gesture, so the previous one's suppression
    // is spent. Cleared ahead of the guards below, not after them: a press that
    // lands on a button returns early, and a flag left set there would swallow
    // the next ordinary tap on the card body instead.
    suppressClickRef.current = false;
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
      // The hold has become a long-press, so the click the browser will
      // synthesise when the finger lifts is part of THIS gesture, not a tap.
      suppressClickRef.current = true;
      setMenuOpen(true);
    }, LONG_PRESS_MS);
  }

  /**
   * SPEC §5.1 grants navigation to "tapping the card body (not a button)". A
   * long-press is a distinct gesture, so the click its release synthesises must
   * not reach the card wrapper — otherwise the menu opens and Pet detail opens
   * underneath it. Capture phase, so it is stopped before anything acts on it;
   * and one click only, so the very next tap navigates normally.
   */
  function handleClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.stopPropagation();
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
    setSheetOpen(true);
  }

  const resolved = dose.state === "given" || dose.state === "skipped";
  const rowStyle = {
    transition: reducedMotion
      ? undefined
      : "opacity var(--dur, 200ms) var(--ease, ease)",
  };

  let body: ReactElement;
  if (dose.state === "notStarted") {
    // Not a `DoseRow`: SPEC §3b wants **Start course** here, and that is a
    // different control from Give rather than a relabelled one. Composed from
    // DS primitives to match `DoseRow`'s layout without re-porting its source.
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
            {notStartedDetail(dose.detail, t)}
          </div>
        </div>
        <Button
          size="sm"
          variant="primary"
          disabled={giving}
          onClick={(e) => {
            e.stopPropagation();
            onStartCourse();
          }}
        >
          {t("today.startCourse")}
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
        time={dose.state === "skipped" ? t("today.skipped") : (dose.time ?? "")}
        // A resolved row shows its time, not a button, so `label` never
        // renders here — passed anyway so neither call site relies on the DS
        // default's English (I18N-DESIGN.md ADDENDUM A1).
        label={t("today.give")}
        style={rowStyle}
      />
    );
  } else {
    body = (
      <DoseRow
        medication={dose.title}
        detail={dose.detail}
        // TODO(max-per-day wiring): SPEC §3b-i's `capped` state (amber "N of
        // M max" pill, ghost "Give anyway") has no presentation here yet —
        // this line is a compile-only placeholder (same fallback already
        // used for `upcoming`) added solely to keep `npm run typecheck`
        // green after `DoseState` gained the `capped` member; it is not the
        // real wiring, which is a separate, later change to this file.
        state={dose.state === "upcoming" || dose.state === "capped" ? "later" : dose.state}
        onGive={onGive}
        // SPEC §5.1's one-tap control. The DS default is the English "Give";
        // this is the translated one (I18N-DESIGN.md ADDENDUM A1).
        label={t("today.give")}
        disabled={giving}
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
            ? dose.state === "skipped"
              ? t("today.row.skippedLabel", { title: dose.title })
              : t("today.row.givenLabel", { title: dose.title })
            : dose.title
        }
        onClickCapture={handleClickCapture}
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
        {/* SPEC §6.1: "The overflow is hidden once the dose is `given`." Literally
            `given` only — a `skipped` row keeps it, because logging a dose
            previously marked skipped is a legitimate recovery path. The
            long-press machinery below is untouched by this: it still opens the
            same menu on a `given` row, only the tap target for it is gone. */}
        {dose.state !== "given" ? (
          <Menu.Trigger
            onClick={(e) => e.stopPropagation()}
            render={
              <IconButton
                icon="ellipsis"
                variant="plain"
                size={40}
                // SPEC §9: every tap target ≥ 44px.
                style={{ minWidth: 44, minHeight: 44, flexShrink: 0 }}
                label={t("today.moreOptions", {
                  medicationName: dose.medicationName,
                })}
              />
            }
          />
        ) : null}
      </div>

      <Menu.Portal>
        <Menu.Positioner anchor={rowRef} sideOffset={4} align="end">
          <Menu.Popup
            // The popup is a DOM portal but a REACT child of the card wrapper,
            // so without these every item would log its dose *and* navigate to
            // Pet detail. Both handlers are needed: the card is reachable
            // through the click and through the pointer-down independently.
            // Stopping here rather than on each item keeps the three callbacks
            // below — which run first, on the item — untouched.
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            // `Menu.Portal` moves this popup to the end of `<body>` — outside
            // the `.ds-root` wrapper it renders under. Every DS token is
            // declared on `.ds-root`, never `:root`
            // (`components/ds/tokens/colors.css`), so without this class the
            // `var(--surface)` and `var(--line-quiet)` below resolve to
            // nothing and the menu paints as bare text over the page. Same
            // fix, same reason, as `PetDetailPage.tsx` and `LogAtTimeSheet.tsx`.
            className="ds-root"
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
              {t("today.menu.logAtTime")}
            </Menu.Item>
            <Menu.Item style={MENU_ITEM_STYLE} onClick={onSkip}>
              {t("today.menu.skip")}
            </Menu.Item>
            <Menu.Item style={MENU_ITEM_STYLE} onClick={onOpenCourse}>
              {t("today.menu.openCourse")}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>

      <LogAtTimeSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        dose={dose}
        context={logAtTime}
        // Closes before logging, mirroring `LogAtTimeDialog.tsx`'s own
        // `confirm()` (`onConfirm(...); onOpenChange(false);`) and the
        // sheet's own `handleSkip`: the write is async and can still fail
        // (SPEC §5's duplicate guard), but the sheet itself is done the
        // moment the user commits, and `useLogDose.onError` surfaces the
        // rejection back on Today rather than behind a lingering sheet.
        onConfirm={(givenAt) => {
          setSheetOpen(false);
          onLogAtTime(givenAt);
        }}
        onSkipInstead={onSkip}
      />
    </Menu.Root>
  );
}
