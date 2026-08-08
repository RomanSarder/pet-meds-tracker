import type { CSSProperties } from "react";

export interface AlertBannerProps {
  title: string;
  detail?: string;
  /** Label of the inline text action, e.g. "Log". */
  action?: string;
  onAction?: () => void;
  style?: CSSProperties;
}

export function AlertBanner({
  title,
  detail,
  action,
  onAction,
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
