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
ONE set of destinations at every width. Desktop and mobile used to expose
different tabs, so the same navigate() call landed on different screens
depending on window size; only the layout adapts now, never the destinations.

- Six tabs: Today · Screens · Symbol · Desk · Backtest · Terminal.
  Active tab = white text + 2px white underline (not a filled block).
- Desktop lays them in a top row, phones in a bottom bar.
- Between 1024 and 1280 the tabs are icon-only — six labels do not fit beside
  the rest of the bar there. Each keeps its accessibilityLabel.
- Sub-pages live inside Screens and Desk as segmented sub-tabs. Wallet is a
  Desk sub-tab (preview hosts only), not a More-menu entry.
- The header carries the credit balance on the right, always in the same place.

## Colour contrast
Every text token must clear WCAG AA (4.5:1) against BOTH the card surface and
the page background — a colour that passes on `surface` can still fail on `bg`.
`tests/test_theme_contrast.py` checks every pair and fails the build below the
threshold. Two tokens shipped failing it for months; do not regress them.

## Empty states
`EmptyState` takes `action` and `secondary`. Any empty state a first-week user
can reach MUST pass an action — an empty screen with no way out is the single
most common dead end in a new account.

## Paywalls
Gating happens in one place: the `Gate` component, which reads `hasFeature()`.
Never check the plan inline in a screen — that is how gating gets forgotten on
a new screen and drifts on old ones.
