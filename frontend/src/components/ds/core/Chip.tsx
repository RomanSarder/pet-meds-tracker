import type { ComponentProps, CSSProperties } from "react";

export interface ChipProps extends Omit<ComponentProps<"button">, "style"> {
  selected?: boolean;
  style?: CSSProperties;
}

export function Chip({ selected, children, style, className, ...rest }: ChipProps) {
  return (
    <button
      // SPEC §10: Chip's 34px height is below the 44px tap-target minimum.
      // `.ds-hit-44` grows the pointer target only — see ds.css.
      className={["ds-hit-44", className].filter(Boolean).join(" ")}
      style={{
        height: 34,
        padding: "0 14px",
        borderRadius: "var(--radius-pill)",
        fontSize: 13,
        fontWeight: 600,
        fontFamily: "var(--font-sans)",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        background: selected ? "var(--ink-1)" : "transparent",
        color: selected ? "var(--ink-inverse)" : "var(--ink-2)",
        border: selected
          ? "1px solid var(--ink-1)"
          : "1px solid var(--line-strong)",
        transition: "all var(--dur) var(--ease)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
