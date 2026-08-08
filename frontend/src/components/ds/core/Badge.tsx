import type { ComponentProps, CSSProperties } from "react";

const TONES = {
  neutral: { bg: "var(--surface-sunk)", fg: "var(--ink-2)" },
  accent: { bg: "var(--accent-tint)", fg: "var(--accent-ink)" },
  overdue: { bg: "var(--alert-tint)", fg: "var(--alert-deep)" },
  low: { bg: "var(--warn-tint)", fg: "var(--warn)" },
  good: { bg: "var(--ok-tint)", fg: "var(--ok)" },
} as const;

export interface BadgeProps extends Omit<ComponentProps<"span">, "style"> {
  tone?: keyof typeof TONES;
  /** Show a leading status dot. */
  dot?: boolean;
  style?: CSSProperties;
}

export function Badge({
  tone = "neutral",
  dot,
  children,
  style,
  ...rest
}: BadgeProps) {
  const t = TONES[tone] ?? TONES.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        borderRadius: "var(--radius-pill)",
        background: t.bg,
        color: t.fg,
        fontSize: 12,
        fontWeight: 600,
        fontFamily: "var(--font-sans)",
        ...style,
      }}
      {...rest}
    >
      {dot ? (
        <span
          style={{ width: 6, height: 6, borderRadius: 3, background: t.fg }}
        />
      ) : null}
      {children}
    </span>
  );
}
