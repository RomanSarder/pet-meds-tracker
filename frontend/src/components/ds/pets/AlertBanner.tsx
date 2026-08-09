import type { CSSProperties } from "react";

export interface AlertBannerProps {
  title: string;
  detail?: string;
  /** Label of the inline text action, e.g. "Log". */
  action?: string;
  onAction?: () => void;
  /** Merged with the action button's own `.ds-hit-44` class — see Chip.tsx's className handling. */
  actionClassName?: string;
  style?: CSSProperties;
}

export function AlertBanner({
  title,
  detail,
  action,
  onAction,
  actionClassName,
  style,
}: AlertBannerProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 16px",
        borderRadius: "var(--radius-md)",
        background: "var(--alert-tint)",
        border: "1px solid var(--alert-line)",
        fontFamily: "var(--font-sans)",
        ...style,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          background: "var(--alert)",
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{ fontSize: 14, fontWeight: 600, color: "var(--alert-deep)" }}
        >
          {title}
        </div>
        {detail ? (
          <div
            style={{
              fontSize: 13,
              color: "var(--alert-quiet)",
              marginTop: 1,
            }}
          >
            {detail}
          </div>
        ) : null}
      </div>
      {action ? (
        <button
          onClick={onAction}
          // SPEC §10: this bare-text button has no height/padding, so its
          // painted box (~18px tall, label-width wide) is well under the
          // 44px tap-target minimum on both axes. `.ds-hit-44` grows the
          // pointer target only — see ds.css — the same mechanism used by
          // Chip and IconButton.
          className={["ds-hit-44", actionClassName].filter(Boolean).join(" ")}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--alert-deep)",
          }}
        >
          {action}
        </button>
      ) : null}
    </div>
  );
}
