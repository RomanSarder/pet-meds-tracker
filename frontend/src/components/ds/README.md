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

## Known deviations still outstanding (not fixed here)

Measured in a real browser via the accessibility tree; all are upstream work, deliberately
deferred rather than patched locally because fixing them changes appearance, size or position:

- **Tap targets below SPEC §10's 44px minimum**: `TabBar` items measure 56×43.5, `IconButton`'s
  default `size` is 40×40, `Button` at `size="md"` is 36px tall, `Chip` is 34px tall.
- **No screen has an `<h1>`.** `ScreenHeader` renders its title as a `<div>`, not a heading
  element.

## Conventions the components assume

Voice is plain and factual — no emoji, no encouragement. Times are 24-hour with a leading
zero (`08:00`), dates are day-month (`Wed 12 Aug`), and facts are joined with a spaced middle
dot (`Clover · 2× daily`). Interval doses always carry "from last dose" in their detail line.
Section labels are uppercase; everything else is sentence case. Terracotta `--accent` is for
actions and the active tab only — status has its own colour family. Cards carry a hairline,
never a shadow.

The full rationale lives in the source project's `readme.md` and `SPEC.md`.
