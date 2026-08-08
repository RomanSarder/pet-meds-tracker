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

## Conventions the components assume

Voice is plain and factual — no emoji, no encouragement. Times are 24-hour with a leading
zero (`08:00`), dates are day-month (`Wed 12 Aug`), and facts are joined with a spaced middle
dot (`Clover · 2× daily`). Interval doses always carry "from last dose" in their detail line.
Section labels are uppercase; everything else is sentence case. Terracotta `--accent` is for
actions and the active tab only — status has its own colour family. Cards carry a hairline,
never a shadow.

The full rationale lives in the source project's `readme.md` and `SPEC.md`.
