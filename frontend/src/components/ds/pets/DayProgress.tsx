import type { CSSProperties } from "react";

/**
 * Above this many scheduled doses the pip track degrades to a continuous bar
 * (SPEC §6.1). Pips exist to make the day countable rather than estimated —
 * past this density they stop being individually countable at a glance,
 * which is exactly what the fallback is for.
 */
const PIP_LIMIT = 14;

const PIP_COLORS = {
  given: "var(--ok)",
  overdue: "var(--alert)",
  pending: "var(--line-strong)",
} as const;

export interface DayProgressProps {
  /** Doses already resolved today (`given` or `skipped`), across every pet. */
  given: number;
  /** Every scheduled dose today, across every pet — the pip count. */
  total: number;
  /** How many of the still-open doses are overdue — colours the berry segment/pips. */
  overdue: number;
  /** "<given> of <total> given today" — already localized, large and tabular (SPEC §6.1). */
  headline: string;
  /** "N overdue" | "next HH:MM" | "all done" — already localized trailing note. */
  note: string;
  /** Colours `note` berry instead of quiet ink — set when it names the overdue count. */
  noteAlert?: boolean;
  style?: CSSProperties;
}

/**
 * SPEC §6.1's day progress block: the glanceable "how much of today is
 * done", directly under the header. Exactly one of these renders per screen
 * (`TodayPage`) — per-pet progress stays in `PetCard`'s own `count` slot.
 *
 * Purely presentational: every number and every word arrives pre-computed
 * and pre-localized (I18N-DESIGN.md's PURITY RULE — this component holds no
 * scheduling logic and no user-facing literal of its own).
 */
export function DayProgress({
  given,
  total,
  overdue,
  headline,
  note,
  noteAlert,
  style,
}: DayProgressProps) {
  const pending = Math.max(0, total - given - overdue);
  const useBar = total > PIP_LIMIT;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        fontFamily: "var(--font-sans)",
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <span
          style={{
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: "-0.01em",
            color: "var(--ink-1)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {headline}
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: "nowrap",
            fontVariantNumeric: "tabular-nums",
            color: noteAlert ? "var(--alert-deep)" : "var(--ink-3)",
          }}
        >
          {note}
        </span>
      </div>

      {total > 0 ? (
        // Decorative: `headline` and `note` already state every fact this
        // draws (SPEC §9 — state is never colour-only), so the track itself
        // carries no independent information a screen reader needs.
        <div aria-hidden="true">
          {useBar ? (
            <div
              style={{
                display: "flex",
                height: 6,
                borderRadius: 3,
                overflow: "hidden",
                background: PIP_COLORS.pending,
              }}
            >
              {given > 0 ? (
                <div style={{ width: `${(given / total) * 100}%`, background: PIP_COLORS.given }} />
              ) : null}
              {overdue > 0 ? (
                <div
                  style={{ width: `${(overdue / total) * 100}%`, background: PIP_COLORS.overdue }}
                />
              ) : null}
            </div>
          ) : (
            <div style={{ display: "flex", gap: 3 }}>
              {Array.from({ length: given }, (_, i) => (
                <span
                  key={`given-${i}`}
                  style={{ flex: 1, height: 6, borderRadius: 3, background: PIP_COLORS.given }}
                />
              ))}
              {Array.from({ length: overdue }, (_, i) => (
                <span
                  key={`overdue-${i}`}
                  style={{ flex: 1, height: 6, borderRadius: 3, background: PIP_COLORS.overdue }}
                />
              ))}
              {Array.from({ length: pending }, (_, i) => (
                <span
                  key={`pending-${i}`}
                  style={{ flex: 1, height: 6, borderRadius: 3, background: PIP_COLORS.pending }}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
