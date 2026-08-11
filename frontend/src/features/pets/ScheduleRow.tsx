// Pet detail's Schedule block (SPEC §5.3) is read-only: "today's occurrences
// with their states, read-only." The DS `DoseRow` (frontend/src/components/ds
// — frozen, ported from upstream) hard-codes a "Give" `Button` for every
// non-`given` state regardless of whether an `onGive` handler is passed, so
// it can never be made read-only by omission alone. This component is the
// locally-composed replacement: same layout and tokens as `DoseRow`, but the
// trailing slot is always text, never a `Button`, for every `DoseState`.
//
// Presentation follows SPEC §4's table exactly:
//   given     — 55% opacity, strikethrough, the logged time
//   skipped   — 55% opacity, "Skipped" in place of the time
//   overdue   — the literal word "Overdue" (SPEC §9: state is never
//               colour-only; a berry tint alone would not satisfy this for a
//               screen reader or a colour-blind user)
//   due       — its due time
//   later     — its due time
//   notStarted— "Not started"
// `upcoming` DOES occur here now: an anchored `fromLastDose` chain's next
// dose can be reachable a day or more before it is actually due (SPEC §3b;
// `occurrences.ts` emits it starting the anchor's own day, not only the day
// `dueAt` lands on). It maps like `later` — the DS has no dedicated variant,
// and `later`'s outlined, not-yet-due presentation is the accurate one; the
// day-word `doseRowPropsFor` adds to `detail` is what tells the two apart.
import type { CSSProperties } from "react";
import type { DoseState } from "@/engine";
import { useT } from "@/i18n";

export interface ScheduleRowProps {
  state: DoseState;
  medication: string;
  /** Schedule and instructions, e.g. "08:00 · after food · day 3 of 7". */
  detail?: string;
  /** Clock time, or the state's literal word ("Skipped" / "Not started"). */
  time?: string;
  /** Hairline separator above the row. */
  divider?: boolean;
  style?: CSSProperties;
}

export function ScheduleRow({ state, medication, detail, time, divider, style }: ScheduleRowProps) {
  const t = useT();
  const dimmed = state === "given" || state === "skipped";
  const struckThrough = state === "given";
  const overdue = state === "overdue";
  // The due time is already part of `detail` (via `doseRowPropsFor`'s
  // `joinMeta`), so trading the trailing slot's due time for the literal
  // word here doesn't lose information — it adds the word SPEC §9 requires.
  const trailing = overdue ? t("pets.schedule.overdue") : time;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "2px 0",
        opacity: dimmed ? 0.55 : 1,
        borderTop: divider ? "1px solid var(--line-quiet)" : "none",
        paddingTop: divider ? 12 : 2,
        fontFamily: "var(--font-sans)",
        ...style,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: "var(--ink-1)",
            textDecoration: struckThrough ? "line-through" : "none",
          }}
        >
          {medication}
        </div>
        {detail ? (
          <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 2 }}>{detail}</div>
        ) : null}
      </div>
      <div
        style={{
          fontSize: 13,
          color: overdue ? "var(--alert-deep)" : "var(--ink-3)",
          fontWeight: overdue ? 500 : 400,
        }}
      >
        {trailing}
      </div>
    </div>
  );
}
