import type { CSSProperties, MouseEvent } from "react";
import { Button } from "../core/Button";

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
  style?: CSSProperties;
}

export function DoseRow({
  medication,
  detail,
  time,
  state = "later",
  onGive,
  divider,
  style,
}: DoseRowProps) {
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
        {detail ? (
          <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 2 }}>
            {detail}
          </div>
        ) : null}
      </div>
      {given ? (
        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{time}</div>
      ) : (
        <Button
          size="sm"
          variant={state === "later" ? "secondary" : "primary"}
          onClick={(e) => {
            e.stopPropagation();
            onGive?.(e);
          }}
        >
          Give
        </Button>
      )}
    </div>
  );
}
