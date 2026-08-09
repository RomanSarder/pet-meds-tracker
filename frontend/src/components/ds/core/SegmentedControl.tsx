import type { CSSProperties } from "react";
import { Chip } from "./Chip";

export interface SegmentedControlProps {
  options: Array<string | { value: string; label: string }>;
  value?: string;
  onChange?: (value: string) => void;
  style?: CSSProperties;
}

/** A thin composition of Chip: an exclusive one-of-N control. */
export function SegmentedControl({
  options = [],
  value,
  onChange,
  style,
}: SegmentedControlProps) {
  return (
    <div style={{ display: "flex", gap: 8, ...style }}>
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        const l = typeof o === "string" ? o : o.label;
        return (
          <Chip
            key={v}
            selected={v === value}
            aria-pressed={v === value}
            onClick={() => onChange && onChange(v)}
          >
            {l}
          </Chip>
        );
      })}
    </div>
  );
}
