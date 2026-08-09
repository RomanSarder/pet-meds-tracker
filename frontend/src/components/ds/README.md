# Pet Meds design system

Ported from the **Pet Meds Design System** project on claude.ai/design. The components
are the ones authored there; this is a translation to TypeScript, not a reinterpretation.

## Using it

Design-system components read `var(--*)` tokens declared on `.ds-root`, so they must be
rendered inside `DsRoot`:

```tsx
import { DsRoot, ScreenHeader, PetCard, DoseRow, TabBar } from "@/components/ds";

<DsRoot className="min-h-dvh">
  <ScreenHeader title="Today" subtitle="3 doses left today · 1 overdue" action="plus" />
  <PetCard pet="Clover" tint={1} overdue status="Overdue since 08:00" count="1 of 3 today">
    <DoseRow medication="Metacam 0.4 ml" detail="08:00 · after food · day 3 of 7" state="overdue" />
  </PetCard>
  <TabBar value="today" />
</DsRoot>
```

Outside `DsRoot` the tokens do not resolve and components render unstyled.

## Layout

| Path | What it is |
| --- | --- |
| `ds.css` | Entry point — imports every token file, defines `.ds-root` |
| `tokens/` | `fonts`, `colors`, `typography`, `spacing`, `shape` |
| `core/` | Icon, Button, IconButton, Badge, Chip, SegmentedControl, Card, SectionLabel, ProgressBar |
| `pets/` | PetAvatar, DoseRow, PetCard, SupplyRow, AlertBanner, ScreenHeader, TabBar, EmptyState |
| `core/icons.ts` | Lucide glyph registry |

`ds.css` is imported once from `src/index.css`.

## Deliberate differences from the source

- **Tokens are scoped to `.ds-root`, not `:root`.** The app already declares `--font-sans`
  and `--radius-sm/md/lg` at `:root` for its shadcn primitives. Hoisting the design system's
  values would silently restyle every existing screen.
- **Icons are statically registered** in `core/icons.ts` rather than fetched from a CDN at
  runtime. Adding a glyph is one import plus one line. Lucide's dynamic loader was measured
  as an alternative and rejected: it emits a chunk per glyph (~1,700 chunks, 7 MB) plus a
  ~200 kB import map.
- **`IconName` is a union, not `string`**, so an unregistered glyph is a compile error rather
  than a blank space.
- **Nunito still loads from Google Fonts**, as in the source. The rest of the app self-hosts
  via `@fontsource-variable/geist`; to match, `npm i @fontsource/nunito` and swap the import
  in `tokens/fonts.css`. The `--font-sans` contract does not change.
- **`TabBar`'s active tab carries `aria-current="page"`.** SPEC §10 requires state to never
  be colour-only; the source only distinguished the active tab by `color: var(--accent)` vs
  `var(--ink-3)`, which is invisible to a screen reader. `TabBar` is a `<nav>` of `<button>`s
  (not a tablist), so `aria-current="page"` is the correct role for "the current destination"
  rather than `aria-selected`/`aria-pressed`. Zero-pixel change; should upstream.
- **`Icon` accepts `aria-hidden` and, when set, stops emitting `role="img"`/`aria-label={name}`.**
  Needed because `Icon` defaulted to `aria-label={name}` — the raw lucide token — even when a
  visible label sits right next to it, so a screen reader announced e.g. "calendar-check Today"
  on `TabBar`'s tabs. Any call site can now mark its icon decorative when adjacent text already
  names the control; call sites that render an icon with no other label are unaffected (the
  labelled-`img` default is unchanged). `TabBar` now renders its icon this way. Zero-pixel
  change (an `aria-*` attribute); should upstream. Note: `IconButton` does **not** need the same
  treatment. It sets `aria-label` on the `<button>` itself, and an explicit `aria-label` replaces
  the element's contents for naming, so its inner `Icon` never reaches the accessible name — a
  browser audit confirmed `IconButton` controls already announce correctly ("More options for
  Rimadyl", "Export history"). `TabBar` was different only because its label is a sibling
  `<span>` inside the button rather than an `aria-label` on it, so both text nodes concatenated.
- **`SegmentedControl` sets `aria-pressed` on each `Chip` it renders.** The selected option was
  colour-only (SPEC §10), like TabBar's active tab. `SegmentedControl` already knows which
  option is selected, so it sets `aria-pressed={v === value}` itself — no caller change needed.
  Zero-pixel change; should upstream.
- **`ScreenHeader` takes an optional `actionLabel` prop**, forwarded to the trailing
  `IconButton`'s `label`. Previously `ScreenHeader` never forwarded a label, so the button fell
  back to `IconButton`'s glyph-token default (e.g. "plus" is not an accessible name — it's the
  lucide token). `actionLabel` is optional and additive; screens that pass no `action` at all
  are unaffected. Zero-pixel change; should upstream, together with real copy for every
  `ScreenHeader` call site that has an action.
- **Tap targets below SPEC §10's 44px minimum now hit 44px, without moving any visible pixel.**
  Re-measured in source rather than trusting the prior numbers, which turned out to be
  half-wrong: `TabBar` items are 56×43.5, `IconButton`'s default `size` is 40×40, and `Chip`
  (also used by `SegmentedControl`, unchanged) is 34px tall — all confirmed. `Button` at
  `size="md"` is **44px tall already** (`SIZES.md.height` is 44, not 36); the real violation is
  `size="sm"` at 36px. Two mechanisms, chosen per control:
  - `TabBar`'s tab `<button>` paints no background/border, so its box is invisible — growing the
    box itself costs nothing visually. Each tab now carries `padding: "4px 0"` matched by
    `margin: "-4px 0"`: the padding grows the border box (and so the pointer target) to 51.5px
    tall, and the equal negative margin pulls it back out of flow, so the `<nav>`'s height and
    every glyph/label position are pixel-identical to before. (`AppShell`, frozen, overrides the
    `<nav>`'s `paddingBottom`, which is why the fix lives on the tab buttons and not the `<nav>`.)
  - `IconButton`, `Chip`, and `Button` at `size="sm"` each paint a visible background or border
    on their own box, so padding would enlarge what's drawn. Instead each carries a shared
    `.ds-hit-44` class (`ds.css`): a `::after` pseudo-element, centred via
    `position: relative` + `top/left: 50%` + `transform: translate(-50%, -50%)`, sized
    `max(100%, 44px)` square. It paints nothing, sits outside layout, and hit-tests as the
    control — a true no-op on any control already ≥44px, which is why `Button` at `size="md"`/
    `"lg"` and any caller-supplied `IconButton` `size` ≥44 are untouched. Each component merges
    this class with a caller-supplied `className` rather than clobbering it. Visual sizes are
    unchanged: `IconButton`'s default is still 40×40, `Chip` is still 34px tall, and no `SIZES`
    entry in `Button.tsx` changed. Pointer targets are now 44×44 (`IconButton`, `Chip`, `Button`
    `size="sm"`) or 56×51.5 (`TabBar`). Zero-pixel change; should upstream.
- **`ScreenHeader`'s title is an `<h1>`**, not a `<div>`. It is the only heading-shaped element on
  any screen that uses `ScreenHeader`, so promoting it gives those screens their first `<h1>`.
  Semantic only: font-size, font-weight and letter-spacing are the same inline values as before,
  with `margin: 0` now explicit (the DS has no reset that would otherwise zero a heading's
  default margin, so leaving it implicit would have shifted layout). No class, wrapper or copy
  changed. Zero-pixel change; should upstream.

## Known deviations still outstanding (not fixed here)

Measured in a real browser via the accessibility tree; all are upstream work, deliberately
deferred rather than patched locally because fixing them changes appearance, size or position:

- **Several screens still have no `<h1>`.** `ScreenHeader`'s title is now one, but
  `HistoryPage`, `PetDetailPage`, `PetFormPage` and `CourseFormPage` render their own headers
  outside `ScreenHeader` and were not touched here — they live under `features/`, not `ds/`.
  (`HistoryPage` already hand-rolls its own `<h1>` at the call site; `PetDetailPage`,
  `PetFormPage` and `CourseFormPage` still render a plain, non-heading title.)

## Conventions the components assume

Voice is plain and factual — no emoji, no encouragement. Times are 24-hour with a leading
zero (`08:00`), dates are day-month (`Wed 12 Aug`), and facts are joined with a spaced middle
dot (`Clover · 2× daily`). Interval doses always carry "from last dose" in their detail line.
Section labels are uppercase; everything else is sentence case. Terracotta `--accent` is for
actions and the active tab only — status has its own colour family. Cards carry a hairline,
never a shadow.

The full rationale lives in the source project's `readme.md` and `SPEC.md`.
