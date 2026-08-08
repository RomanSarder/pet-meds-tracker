import type { CSSProperties } from "react";

const TONES = {
  good: "var(--ok)",
  low: "var(--warn)",
  out: "var(--alert)",
  accent: "var(--accent)",
} as const;

export interface ProgressBarProps {
  /** 0–100. Represents remaining stock, not progress through a course. */
  value: number;
  tone?: keyof typeof TONES;
  height?: number;
  style?: CSSProperties;
}

export function ProgressBar({
  value = 0,
  tone = "good",
  height = 6,
  style,
}: ProgressBarProps) {
  return (
    <div
      style={{
        height,
        borderRadius: height / 2,
        background: "var(--line-quiet)",
        overflow: "hidden",
        ...style,
      }}
    >
      <div
        style={{
          width: `${Math.max(0, Math.min(100, value))}%`,
          height: "100%",
          background: TONES[tone] ?? TONES.good,
          transition: "width var(--dur) var(--ease)",
        }}
      />
    </div>
  );
}
