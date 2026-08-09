import type { CSSProperties } from "react";
import { IconButton } from "../core/IconButton";
import type { IconName } from "../core/Icon";

export interface ScreenHeaderProps {
  title: string;
  /** One factual line: "3 doses left today · 1 overdue". */
  subtitle?: string;
  /** Lucide icon name for the trailing IconButton. */
  action?: IconName;
  /**
   * Accessible label for the trailing IconButton, describing what it does
   * (e.g. "Add a course"), not the glyph. Forwarded to `IconButton`'s
   * `label`; when omitted, `IconButton` falls back to the glyph token.
   */
  actionLabel?: string;
  onAction?: () => void;
  style?: CSSProperties;
}

export function ScreenHeader({
  title,
  subtitle,
  action,
  actionLabel,
  onAction,
  style,
}: ScreenHeaderProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 12,
        padding: "14px 22px 16px",
        fontFamily: "var(--font-sans)",
        ...style,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: "-0.01em",
            lineHeight: 1.1,
            color: "var(--ink-1)",
          }}
        >
          {title}
        </div>
        {subtitle ? (
          <div style={{ fontSize: 14, color: "var(--ink-3)", marginTop: 4 }}>
            {subtitle}
          </div>
        ) : null}
      </div>
      {action ? <IconButton icon={action} label={actionLabel} onClick={onAction} /> : null}
    </div>
  );
}
