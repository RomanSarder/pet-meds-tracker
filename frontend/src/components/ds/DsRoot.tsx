import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Scope for the Pet Meds design system's tokens.
 *
 * Every design-system component reads var(--*) tokens that are declared on
 * .ds-root, not :root — so they resolve to nothing outside this wrapper. Render
 * design-system UI inside it (usually once, around a whole screen).
 *
 * The scoping exists because this app already carries a shadcn token layer that
 * declares --font-sans and --radius-sm/md/lg on :root. Hoisting the design
 * system's values to :root would silently restyle every existing screen.
 */
export function DsRoot({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("ds-root", className)} {...props} />;
}
