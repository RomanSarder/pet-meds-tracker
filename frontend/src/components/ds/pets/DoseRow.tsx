import type { CSSProperties, MouseEvent } from "react";
import { Badge } from "../core/Badge";
import { Button } from "../core/Button";

/**
 * SPEC §3b-i's engine `capped` state, presentation half only. NOT wired to
 * the engine on this branch — a concurrent agent owns `capped`/`overMax`/
 * `maxPerDay` there; this is driven entirely by props so a later phase can
 * thread the real numbers in without touching this component again.
 */
export interface DoseRowCap {
  /** Already-localized "N of M max" pill text (`today.pill.cap`). Amber — replaces `countLabel` entirely, never sits beside it. */
  label: string;
  /** Already-localized ghost action label, e.g. "Give anyway". */
  giveAnywayLabel: string;
  onGiveAnyway: () => void;
}

export interface DoseRowProps {
  medication: string;
  /** Schedule and instructions, e.g. "08:00 · after food · day 3 of 7". */
  detail?: string;
  /** Clock time; shown instead of the button once given. */
  time?: string;
  /** overdue and due render a filled Give; later renders an outlined one. */
  state?: "overdue" | "due" | "later" | "given";
  /** Receives the click event; DoseRow already stops it propagating to a card wrapper. */
  onGive?: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Hairline separator above the row. */
  divider?: boolean;
  /** Button label. Defaults to "Give". */
  label?: string;
  /** Disables the Give button — e.g. while a log write for this course is already in flight. */
  disabled?: boolean;
  /**
   * Quiet "N of M doses" pill on the detail line (SPEC §4) — already
   * localized text (`today.pill.count`). Omitted (or overridden by `cap`,
   * see below) when there is nothing to count.
   */
  countLabel?: string;
  /** SPEC §3b-i's daily-maximum state — see `DoseRowCap`. Replaces `countLabel` and reveals a ghost **Give anyway** action when present. */
  cap?: DoseRowCap;
  style?: CSSProperties;
}

export function DoseRow({
  medication,
  detail,
  time,
  state = "later",
  onGive,
  divider,
  label,
  disabled,
  countLabel,
  cap,
  style,
}: DoseRowProps) {
  // Two count pills on one row is one number too many (SPEC §3b-i / §4): the
  // cap, when present, REPLACES the plain count rather than sitting beside it.
  const pillLabel = cap ? cap.label : countLabel;
  const given = state === "given";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "2px 0",
        opacity: given ? 0.55 : 1,
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
            textDecoration: given ? "line-through" : "none",
          }}
        >
          {medication}
        </div>
        {detail || pillLabel ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
              marginTop: 2,
            }}
          >
            {detail ? (
              <span style={{ fontSize: 13, color: "var(--ink-3)" }}>{detail}</span>
            ) : null}
            {pillLabel ? (
              <Badge tone={cap ? "low" : "neutral"} style={{ flexShrink: 0 }}>
                {pillLabel}
              </Badge>
            ) : null}
            {cap ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  cap.onGiveAnyway();
                }}
                style={{ height: 28, padding: "0 10px", fontSize: 12, flexShrink: 0 }}
              >
                {cap.giveAnywayLabel}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {given ? (
        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{time}</div>
      ) : (
        <Button
          size="sm"
          variant={state === "later" ? "secondary" : "primary"}
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            onGive?.(e);
          }}
        >
          {label ?? "Give"}
        </Button>
      )}
    </div>
  );
}
