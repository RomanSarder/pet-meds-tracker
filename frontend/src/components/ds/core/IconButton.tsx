import type { ComponentProps, CSSProperties } from "react";
import { Icon, type IconName } from "./Icon";

export interface IconButtonProps extends Omit<ComponentProps<"button">, "style"> {
  /** Lucide icon name. */
  icon: IconName;
  /** Diameter in px. Never below 40 on touch surfaces. */
  size?: number;
  variant?: "outline" | "plain" | "accent";
  /** Accessible label; falls back to the icon name. */
  label?: string;
  style?: CSSProperties;
}

export function IconButton({
  icon,
  size = 40,
  variant = "outline",
  label,
  style,
  ...rest
}: IconButtonProps) {
  const variants: Record<NonNullable<IconButtonProps["variant"]>, CSSProperties> = {
    outline: {
      background: "var(--surface)",
      border: "1px solid var(--line-strong)",
      color: "var(--ink-2)",
    },
    plain: {
      background: "transparent",
      border: "1px solid transparent",
      color: "var(--ink-2)",
    },
    accent: {
      background: "var(--accent)",
      border: "1px solid var(--accent)",
      color: "var(--ink-inverse)",
    },
  };
  return (
    <button
      aria-label={label || icon}
      style={{
        width: size,
        height: size,
        borderRadius: "var(--radius-pill)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        ...variants[variant],
        ...style,
      }}
      {...rest}
    >
      <Icon name={icon} size={Math.round(size * 0.5)} />
    </button>
  );
}
