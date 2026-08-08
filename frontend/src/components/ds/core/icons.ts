import {
  ArrowLeft,
  Bell,
  CalendarCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock,
  Droplet,
  Ellipsis,
  Package,
  PawPrint,
  Pencil,
  Pill,
  Plus,
  ShoppingCart,
  Syringe,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

/**
 * The design system's icon registry.
 *
 * Lucide is a flagged substitution — the brand has no icon set of its own. The
 * source system took a bare `string` name and fetched the glyph from a CDN at
 * runtime. Here the glyphs are imported statically instead, which keeps them out
 * of the network path and lets the bundler drop the ones nobody uses.
 *
 * Registering explicitly rather than importing Lucide's dynamic loader is
 * deliberate: that loader emits a per-glyph chunk for all ~1,700 icons (7 MB of
 * output) plus a ~200 kB import map, which a phone-sized app should not carry.
 *
 * To use another Lucide glyph, import it above and add one line here — the key is
 * the kebab-case Lucide name, so callers keep the source system's naming. If a
 * licensed icon set is adopted later, this file is the only thing that changes.
 */
export const ICONS = {
  "arrow-left": ArrowLeft,
  bell: Bell,
  "calendar-check": CalendarCheck,
  check: Check,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "circle-check": CircleCheck,
  clock: Clock,
  droplet: Droplet,
  ellipsis: Ellipsis,
  package: Package,
  "paw-print": PawPrint,
  pencil: Pencil,
  pill: Pill,
  plus: Plus,
  "shopping-cart": ShoppingCart,
  syringe: Syringe,
  "trash-2": Trash2,
  "triangle-alert": TriangleAlert,
  x: X,
} as const;

/** Kebab-case Lucide glyph name, e.g. "pill", "paw-print", "calendar-check". */
export type IconName = keyof typeof ICONS;
