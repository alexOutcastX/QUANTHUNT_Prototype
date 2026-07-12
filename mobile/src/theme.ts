// TaurEye design tokens — dark terminal identity, readable and premium.
//
// Rules of the system (see DESIGN.md):
//   - Sans (system font, i.e. NO fontFamily) for labels, headings, body copy.
//   - Mono ONLY for data: prices, symbols, numbers, the brand word.
//   - Colour is reserved for price up/down and semantic state; the accent
//     stays white — hierarchy comes from type scale + surface elevation.
export const theme = {
  // surfaces (elevation: bg → surface → surface2 → surface3/hover)
  bg: '#08090c',
  surface: '#0e1116',
  surface2: '#141821',
  surface3: '#1a202b',
  card: '#0e1116',
  border: '#1d232e',
  border2: '#2b3441',

  // text
  text: '#edf0f5',
  muted: '#68748a',
  muted2: '#a9b3c2',

  // brand + semantics
  accent: '#ffffff',
  onAccent: '#0a0f0c',
  green: '#22c993',
  red: '#f4587a',

  // typography
  mono: 'monospace' as const,
  fs: { xs: 10, sm: 12, md: 14, lg: 16, xl: 20, h1: 26 },

  // rhythm
  sp: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  radius: { sm: 6, md: 10, lg: 14 },
};

export type Theme = typeof theme;
