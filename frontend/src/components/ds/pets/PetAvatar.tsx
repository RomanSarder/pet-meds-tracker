import type { ComponentProps, CSSProperties } from "react";

/** Identity tint, fixed per pet for the life of the account. Never reused. */
export type PetTint = 1 | 2 | 3 | 4;

export interface PetAvatarProps extends Omit<ComponentProps<"div">, "style"> {
  /** Pet name; the first letter is rendered. */
  name: string;
  tint?: PetTint;
  /** Diameter: 26 in dense lists, 46 in cards, 64 in headers. */
  size?: number;
  /** Grey out — used when the pet has nothing left to do today. */
  muted?: boolean;
  style?: CSSProperties;
}

export function PetAvatar({
  name = "",
  tint = 1,
  size = 46,
  muted,
  style,
  ...rest
}: PetAvatarProps) {
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  return (
    <div
      aria-label={name}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        flexShrink: 0,
        background: muted ? "var(--surface-sunk)" : `var(--pet-${tint}-bg)`,
        color: muted ? "var(--ink-3)" : `var(--pet-${tint}-ink)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-sans)",
        fontWeight: 700,
        fontSize: Math.round(size * 0.36),
        ...style,
      }}
      {...rest}
    >
      {initial}
    </div>
  );
}
