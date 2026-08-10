import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "../core/Icon";

export interface EmptyStateProps {
  /** Lucide icon name. */
  icon?: IconName;
  title: string;
  detail?: string;
  /** Optional Button node. */
  action?: ReactNode;
  style?: CSSProperties;
}

export function EmptyState({
  icon = "check",
  title,
  detail,
  action,
  style,
}: EmptyStateProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        padding: "40px 24px",
        textAlign: "center",
        fontFamily: "var(--font-sans)",
        ...style,
      }}
    >
      <span
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          background: "var(--surface-sunk)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink-3)",
        }}
      >
        <Icon name={icon} size={22} aria-hidden />
      </span>
      <div style={{ fontSize: 17, fontWeight: 600, color: "var(--ink-1)" }}>
        {title}
      </div>
      {detail ? (
        <div style={{ fontSize: 14, color: "var(--ink-3)", maxWidth: 260 }}>
          {detail}
        </div>
      ) : null}
      {action}
    </div>
  );
}
