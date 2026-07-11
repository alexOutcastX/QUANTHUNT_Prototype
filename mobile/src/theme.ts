// TaurEye monochrome theme — mirrors the web app's palette.
// Colour is reserved for branding, price up/down, and chart candles.
export const theme = {
  bg: '#0a0c0f',
  surface: '#11141a',
  surface2: '#161a22',
  card: '#11141a',
  border: '#232a35',
  border2: '#2f3845',
  text: '#e7eaef',
  muted: '#5e6776',
  muted2: '#9aa4b2',
  accent: '#ffffff',
  onAccent: '#0a0f0c',
  green: '#18c98c',
  red: '#f0506e',
  mono: 'monospace' as const,
};

export type Theme = typeof theme;
