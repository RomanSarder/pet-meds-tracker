import type { ComponentProps, CSSProperties } from "react";
import { ICONS, type IconName } from "./icons";

export type { IconName };

export interface IconProps extends Omit<ComponentProps<"span">, "color" | "style"> {
  name: IconName;
  /** Pixel box. Default 20. */
  size?: number;
  /** Any CSS color; defaults to currentColor. */
  color?: string;
  style?: CSSProperties;
}

/**
 * Lucide glyphs inherit currentColor and are registered in ./icons.ts.
 *
 * Port note: the source system fetched each glyph from unpkg at runtime and
 * inlined the markup. This renders the repo's own lucide-react component instead
 * — no network request, and no frame where the icon is missing.
 *
 * Accessibility note (not in the source): by default the icon is its own
 * named `img` (`aria-label={name}`), because a bare icon can be the only
 * content of a control. Pass `aria-hidden` when the icon sits beside text
 * that already labels the control (a visible caption, or a label already on
 * the parent button) — a decorative icon must not also emit its own
 * `aria-label`, or a screen reader announces the raw glyph token alongside
 * the real label.
 */
export function Icon({
  name,
  size = 20,
  color = "currentColor",
  style,
  "aria-hidden": ariaHidden,
  ...rest
}: IconProps) {
  const Glyph = ICONS[name];
  const decorative = ariaHidden === true || ariaHidden === "true";
  return (
    <span
      {...(decorative ? { "aria-hidden": true as const } : { role: "img", "aria-label": name })}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        color,
        flexShrink: 0,
        ...style,
      }}
      {...rest}
    >
      <Glyph size={size} aria-hidden />
    </span>
  );
}
