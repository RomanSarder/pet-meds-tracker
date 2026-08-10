import type { CSSProperties, ReactNode } from "react";
import { Card } from "../core/Card";
import { Icon } from "../core/Icon";
import { PetAvatar, type PetTint } from "./PetAvatar";

export interface PetCardProps {
  /** Pet name. */
  pet: string;
  tint?: PetTint;
  /** Sub-line: "Next at 09:00", "Overdue since 08:00", "All done · Ivermectin at 07:12". */
  status?: string;
  /** Tints the header berry and switches the card border. */
  overdue?: boolean;
  /** Collapsed, greyed variant for a pet with nothing left today. */
  done?: boolean;
  /** Right-aligned progress, e.g. "1 of 2 today". */
  count?: string;
  /** DoseRow children. */
  children?: ReactNode;
  style?: CSSProperties;
}

export function PetCard({
  pet,
  tint = 1,
  status,
  overdue,
  done,
  count,
  children,
  style,
}: PetCardProps) {
  if (done) {
    return (
      <Card
        tone="quiet"
        style={{ display: "flex", alignItems: "center", gap: 12, ...style }}
      >
        <PetAvatar name={pet} tint={tint} muted />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: "var(--ink-2)" }}>
            {pet}
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 2 }}>
            {status}
          </div>
        </div>
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            background: "var(--ok)",
            color: "var(--ink-inverse)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="check" size={14} aria-hidden />
        </span>
      </Card>
    );
  }
  return (
    <Card tone={overdue ? "alert" : "default"} pad={0} style={style}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "16px 16px 12px",
          background: overdue ? "var(--alert-tint)" : "transparent",
        }}
      >
        <PetAvatar name={pet} tint={tint} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: "var(--ink-1)" }}>
            {pet}
          </div>
          <div
            style={{
              fontSize: 13,
              marginTop: 2,
              fontWeight: overdue ? 500 : 400,
              color: overdue ? "var(--alert-deep)" : "var(--ink-3)",
            }}
          >
            {status}
          </div>
        </div>
        {count ? (
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{count}</div>
        ) : null}
      </div>
      <div
        style={{
          padding: "12px 16px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {children}
      </div>
    </Card>
  );
}
