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
 */
export function Icon({
  name,
  size = 20,
  color = "currentColor",
  style,
  ...rest
}: IconProps) {
  const Glyph = ICONS[name];
  return (
    <span
      role="img"
      aria-label={name}
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
