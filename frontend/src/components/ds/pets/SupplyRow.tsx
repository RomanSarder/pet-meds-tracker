import type { CSSProperties, ReactNode } from "react";
import { Card } from "../core/Card";
import { ProgressBar } from "../core/ProgressBar";

export interface SupplyRowProps {
  name: string;
  /** Who it is for and how often, e.g. "Clover · 2× daily". */
  forWhom?: string;
  /** Stock on hand, e.g. "1 bottle", "54 tabs". */
  stock?: string;
  tone?: "good" | "low" | "out";
  /** 0–100 remaining coverage; omit to hide the bar. */
  percent?: number;
  /** Projection line, e.g. "Runs out Wed 12 Aug · need 1 more bottle". */
  note?: string;
  /** Trailing action node, usually a ghost Button. */
  action?: ReactNode;
  style?: CSSProperties;
}

export function SupplyRow({
  name,
  forWhom,
  stock,
  tone = "good",
  percent,
  note,
  action,
  style,
}: SupplyRowProps) {
  return (
    <Card
      style={{ display: "flex", flexDirection: "column", gap: 12, ...style }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 17, fontWeight: 600, color: "var(--ink-1)" }}>
            {name}
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 2 }}>
            {forWhom}
          </div>
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: "nowrap",
            color:
              tone === "out"
                ? "var(--alert)"
                : tone === "low"
                  ? "var(--warn)"
                  : "var(--ok)",
          }}
        >
          {stock}
        </div>
      </div>
      {typeof percent === "number" ? (
        <ProgressBar value={percent} tone={tone} />
      ) : null}
      {note || action ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{note}</span>
          {action}
        </div>
      ) : null}
    </Card>
  );
}
