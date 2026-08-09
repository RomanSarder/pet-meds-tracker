import type { CSSProperties } from "react";
import { Icon, type IconName } from "../core/Icon";

export interface TabBarTab {
  value: string;
  label: string;
  icon: IconName;
}

export interface TabBarProps {
  tabs?: TabBarTab[];
  value?: string;
  onChange?: (value: string) => void;
  style?: CSSProperties;
}

/** Three destinations, never more. */
const DEFAULT_TABS: TabBarTab[] = [
  { value: "today", label: "Today", icon: "calendar-check" },
  { value: "pets", label: "Pets", icon: "paw-print" },
  { value: "supplies", label: "Supplies", icon: "package" },
];

export function TabBar({
  tabs = DEFAULT_TABS,
  value = "today",
  onChange,
  style,
}: TabBarProps) {
  return (
    <nav
      style={{
        borderTop: "1px solid var(--line)",
        background: "var(--surface)",
        padding: "12px 34px 30px",
        display: "flex",
        justifyContent: "space-between",
        fontFamily: "var(--font-sans)",
        ...style,
      }}
    >
      {tabs.map((t) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            onClick={() => onChange && onChange(t.value)}
            aria-current={on ? "page" : undefined}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 5,
              minWidth: 56,
              color: on ? "var(--accent)" : "var(--ink-3)",
            }}
          >
            <Icon name={t.icon} size={22} aria-hidden />
            <span style={{ fontSize: 11, fontWeight: 600 }}>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
