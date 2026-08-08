import type { ComponentProps, CSSProperties } from "react";

const TONES = {
  default: { background: "var(--surface)", border: "1px solid var(--line)" },
  alert: { background: "var(--surface)", border: "1px solid var(--alert-line)" },
  quiet: { background: "var(--surface-sunk)", border: "1px solid var(--line)" },
  dashed: { background: "transparent", border: "1px dashed var(--line-strong)" },
} as const;

export interface CardProps extends Omit<ComponentProps<"div">, "style"> {
  tone?: keyof typeof TONES;
  /** Padding in px; pass 0 when the card has its own tinted header. */
  pad?: number | string;
  radius?: string;
  style?: CSSProperties;
}

export function Card({
  tone = "default",
  pad = 16,
  radius = "var(--radius-xl)",
  children,
  style,
  ...rest
}: CardProps) {
  return (
    <div
      style={{
        borderRadius: radius,
        padding: pad,
        overflow: "hidden",
        fontFamily: "var(--font-sans)",
        ...TONES[tone],
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
