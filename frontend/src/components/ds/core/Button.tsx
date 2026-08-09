import type { ComponentProps, CSSProperties } from "react";
import { Icon, type IconName } from "./Icon";

const SIZES = {
  sm: { height: 36, pad: "0 16px", font: 14 },
  md: { height: 44, pad: "0 20px", font: 15 },
  lg: { height: 52, pad: "0 24px", font: 16 },
} as const;

export interface ButtonProps extends Omit<ComponentProps<"button">, "style"> {
  /** primary = the one action on screen. ink = full-width confirm bars. */
  variant?: "primary" | "secondary" | "ink" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  /** Lucide icon name rendered before the label. */
  icon?: IconName;
  /** Stretch to the container width — used for bottom confirm bars. */
  block?: boolean;
  style?: CSSProperties;
}

export function Button({
  variant = "primary",
  size = "md",
  icon,
  disabled,
  block,
  children,
  style,
  className,
  ...rest
}: ButtonProps) {
  const s = SIZES[size] ?? SIZES.md;
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: s.height,
    padding: s.pad,
    fontSize: s.font,
    fontWeight: 600,
    fontFamily: "var(--font-sans)",
    borderRadius: "var(--radius-pill)",
    border: "1px solid transparent",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.4 : 1,
    width: block ? "100%" : undefined,
    transition:
      "transform var(--dur-fast) var(--ease), background var(--dur) var(--ease)",
    whiteSpace: "nowrap",
  };
  const variants: Record<NonNullable<ButtonProps["variant"]>, CSSProperties> = {
    primary: { background: "var(--accent)", color: "var(--ink-inverse)" },
    secondary: {
      background: "transparent",
      color: "var(--ink-2)",
      borderColor: "var(--line-strong)",
    },
    ink: { background: "var(--ink-1)", color: "var(--ink-inverse)" },
    ghost: { background: "transparent", color: "var(--accent)" },
    danger: { background: "var(--alert)", color: "var(--ink-inverse)" },
  };
  return (
    <button
      disabled={disabled}
      onMouseDown={(e) => {
        if (!disabled) e.currentTarget.style.transform = "scale(0.97)";
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = "none";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "none";
      }}
      // SPEC §10: only size="sm" (36px tall) is below the 44px tap-target
      // minimum — "md" (44px) and "lg" (52px) already pass, so the hit-area
      // class (see ds.css) is applied to "sm" only.
      className={
        size === "sm" ? ["ds-hit-44", className].filter(Boolean).join(" ") : className
      }
      style={{ ...base, ...variants[variant], ...style }}
      {...rest}
    >
      {icon ? <Icon name={icon} size={s.font + 2} /> : null}
      {children}
    </button>
  );
}
