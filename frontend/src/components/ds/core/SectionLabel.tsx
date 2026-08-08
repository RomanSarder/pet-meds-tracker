import type { CSSProperties, ReactNode } from "react";

export interface SectionLabelProps {
  tone?: "muted" | "alert" | "accent";
  /** Hairline rule filling the remaining width. Default true. */
  rule?: boolean;
  /** Right-aligned count or hint. */
  trailing?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
}

export function SectionLabel({
  tone = "muted",
  rule = true,
  trailing,
  children,
  style,
}: SectionLabelProps) {
  const color =
    tone === "alert"
      ? "var(--alert)"
      : tone === "accent"
        ? "var(--accent)"
        : "var(--ink-3)";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily: "var(--font-sans)",
        ...style,
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color,
        }}
      >
        {children}
      </span>
      {rule ? (
        <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
      ) : null}
      {trailing ? (
        <span style={{ fontSize: 13, color: "var(--ink-3)" }}>{trailing}</span>
      ) : null}
    </div>
  );
}
