# TaurEye design system

Dark terminal identity, but readable and premium. Every screen follows these
rules; shared primitives live in `mobile/src/ui.tsx`, tokens in
`mobile/src/theme.ts`.

## Typography
- **Sans** (the system font — i.e. NO `fontFamily`) for labels, headings,
  body copy, buttons, empty states.
- **Mono** (`theme.mono`) ONLY for data: prices, symbols, numbers, table
  cells, the brand word. This contrast is the look.
- Sizes from `theme.fs`: body/labels `sm(12)`–`md(14)`, table cells `sm–md`,
  section headers `xs+1` uppercase +letter-spacing, screen titles `xl(20)`
  bold. Nothing below 10px ever; 9px is banned.

## Colour
- Hierarchy comes from elevation (`bg → surface → surface2 → surface3`) and
  type, not colour. Accent stays white.
- Green/red only for price/P&L direction and semantic state. Never decorative.

## Rhythm
- Spacing from `theme.sp` (4/8/12/16/24). Screen padding `lg(16)`.
- Table rows ≥ 44px tall on touch surfaces; header rows sticky-feel
  (surface2 background, top border).
- Cards: `Card` primitive (surface, 1px border, radius.md, padding lg).

## Components (use these, don't re-invent)
- `ScreenTitle` — top of every screen: sans title + muted sub.
- `SectionTitle` — uppercase micro-header between blocks.
- `Btn` (primary/ghost/danger), `ChipBtn` (pill; filled-white when active).
- `StatTile` — dashboard-style stat with label/value/sub.
- `EmptyState` — icon + one-line title + hint; never a bare "No data".
- `Loading` — spinner + label; use instead of a lone ActivityIndicator.

## Interaction
- Every touchable: `activeOpacity={0.75}` (or the primitive, which sets it).
- Loading states: skeleton/`Loading` with a label saying what's loading.
- Errors: human sentence + what to do next, never a raw exception string.

## Navigation
- Desktop: brand bar → ticker → pages bar (8 groups):
  Dashboard · Screener · Universe · Terminal · Analysis · Charts · Lists · Tools.
  Active page = white text + 2px white underline (not a filled block).
- Mobile: 5 tabs — Dashboard, Screener, Terminal, Analysis, More.
- Sub-pages (Backtest, TradingView, Portfolio, Calculator, Indices, Holidays…)
  live inside their group as segmented sub-tabs.
