// TaurEye design tokens — refined dark-terminal identity with a light mode.
//
// Rules of the system (see DESIGN.md):
//   - Sans (system font, i.e. NO fontFamily) for labels, headings, body copy.
//   - Mono ONLY for data: prices, symbols, numbers, the brand word.
//   - Colour is reserved for price up/down and semantic state; hierarchy comes
//     from the type scale + surface elevation.
//
// Light/dark: colours are emitted as CSS custom properties on web (so a toggle
// swaps them live without rebuilding the StyleSheets), and as resolved hex on
// native. HTML-embedded views (charts/graphs) live in their own document and
// can't see the page variables, so they read resolved hex via getPalette().
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

type ColorKey =
  | 'bg' | 'surface' | 'surface2' | 'surface3' | 'card' | 'border' | 'border2'
  | 'text' | 'muted' | 'muted2' | 'accent' | 'onAccent' | 'green' | 'red';
type Palette = Record<ColorKey, string>;

// Refined dark terminal — deeper base, cleaner elevation steps, calmer borders.
const DARK: Palette = {
  bg: '#090b0f',
  surface: '#0f131a',
  surface2: '#161c26',
  surface3: '#1f2733',
  card: '#0f131a',
  border: '#212936',
  border2: '#303c4c',
  text: '#eef1f6',
  muted: '#6b7789',
  muted2: '#aeb8c6',
  accent: '#ffffff',
  onAccent: '#0a0f0c',
  green: '#25cf97',
  red: '#f5607f',
};

// Light terminal — soft off-white base, white cards, ink text, deeper up/down
// so the price colours stay legible on light surfaces.
const LIGHT: Palette = {
  bg: '#f4f6f9',
  surface: '#ffffff',
  surface2: '#eef1f6',
  surface3: '#e3e8ef',
  card: '#ffffff',
  border: '#e4e8ef',
  border2: '#cad3df',
  text: '#111823',
  muted: '#6a7686',
  muted2: '#3f4a59',
  accent: '#141c2b',
  onAccent: '#ffffff',
  green: '#0e9f6e',
  red: '#df2f59',
};

const KEYS = Object.keys(DARK) as ColorKey[];
const WEB = Platform.OS === 'web' && typeof document !== 'undefined';

type Mode = 'dark' | 'light';
let mode: Mode = 'dark';
const listeners = new Set<() => void>();

function applyAttr() {
  if (!WEB) return;
  const root = document.documentElement;
  if (mode === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
}

if (WEB) {
  const varBlock = (p: Palette) => KEYS.map((k) => `--c-${k}:${p[k]};`).join('');
  const css =
    `:root{${varBlock(DARK)}color-scheme:dark;}` +
    `:root[data-theme="light"]{${varBlock(LIGHT)}color-scheme:light;}`;
  const style = document.createElement('style');
  style.id = 'te-theme-vars';
  style.textContent = css;
  document.head.appendChild(style);
  try {
    const saved = window.localStorage?.getItem('taureye.theme');
    if (saved === 'light' || saved === 'dark') mode = saved;
  } catch {
    /* ignore */
  }
  applyAttr();
}

// Colour values used inside StyleSheets: a CSS var on web (resolves live to the
// active mode), the dark hex on native.
const colors = KEYS.reduce((o, k) => {
  o[k] = WEB ? `var(--c-${k})` : DARK[k];
  return o;
}, {} as Palette);

export const theme = {
  ...colors,
  mono: 'monospace' as const,
  fs: { xs: 10, sm: 12, md: 14, lg: 16, xl: 20, h1: 26 },
  sp: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  radius: { sm: 6, md: 10, lg: 14 },
};
export type Theme = typeof theme;

// Resolved hex for the current mode — for HTML-embedded views that can't read
// the page's CSS variables.
export function getPalette(): Palette {
  return mode === 'light' ? LIGHT : DARK;
}
export function getThemeMode(): Mode {
  return mode;
}
export function setThemeMode(next: Mode) {
  if (next === mode) return;
  mode = next;
  applyAttr();
  if (WEB) {
    try {
      window.localStorage?.setItem('taureye.theme', mode);
    } catch {
      /* ignore */
    }
  }
  listeners.forEach((l) => l());
}
export function toggleThemeMode() {
  setThemeMode(mode === 'dark' ? 'light' : 'dark');
}
export function subscribeTheme(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

// Re-render on theme change (also lets HTML-embedded views recompute their hex).
export function useThemeMode(): Mode {
  const [m, setM] = useState<Mode>(mode);
  useEffect(() => subscribeTheme(() => setM(getThemeMode())), []);
  return m;
}
