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
  | 'text' | 'muted' | 'muted2' | 'accent' | 'onAccent' | 'green' | 'red'
  | 'brand' | 'brandSoft';
type Palette = Record<ColorKey, string>;

// Refined dark terminal — deeper, cool-biased base with cleaner elevation steps.
// `brand` is a single signature hue (iris) reserved for interactive/selected
// state, kept distinct from the green/red that mean price up/down.
const DARK: Palette = {
  bg: '#080a0f',
  surface: '#0e1219',
  surface2: '#151b25',
  surface3: '#1e2632',
  card: '#0e1219',
  border: '#1e2632',
  border2: '#2e3947',
  text: '#f0f3f8',
  muted: '#6a7688',
  muted2: '#a9b4c2',
  accent: '#f0f3f8',
  onAccent: '#0a0e14',
  green: '#2bd39b',
  red: '#f5637f',
  brand: '#7c9cff',
  brandSoft: '#1a2338',
};

// Light terminal — soft cool off-white base, white cards, ink text, deeper
// up/down so the price colours stay legible on light surfaces.
const LIGHT: Palette = {
  bg: '#f5f7fa',
  surface: '#ffffff',
  surface2: '#eef1f6',
  surface3: '#e3e8ef',
  card: '#ffffff',
  border: '#e6eaf1',
  border2: '#cdd6e2',
  text: '#0f1723',
  muted: '#68748a',
  muted2: '#3d4a5c',
  accent: '#131b29',
  onAccent: '#ffffff',
  green: '#0c9c6c',
  red: '#dd2c58',
  brand: '#4560d8',
  brandSoft: '#e7ecfd',
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
    `:root[data-theme="light"]{${varBlock(LIGHT)}color-scheme:light;}` +
    // Crisper text rendering + a refined system sans everywhere; the mono stack
    // (prices/symbols) is applied per-component via theme.mono.
    `html,body,#root{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;` +
    `text-rendering:optimizeLegibility;font-family:-apple-system,BlinkMacSystemFont,` +
    `"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;}` +
    // Paint the page background in the theme surface. The Android shell is
    // edge-to-edge (content draws behind transparent status/navigation bars),
    // so whatever colour sits here is what shows through the bars. Without it
    // the browser default (white) bled through and the bars looked white even
    // in dark mode. Using the header/tab surface makes the bars blend into the
    // app chrome and flip correctly with the light/dark toggle.
    `html,body,#root{background-color:var(--c-surface);}`;
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

  // Set viewport-fit=cover as early as possible (synchronously, before React
  // mounts) so the page's visual viewport extends into the status/navigation-bar
  // regions from the very first frame. Without this the WebView's own (white)
  // canvas shows in those bands at cold start and no DOM element can cover them
  // until a later re-layout. (Shell also sets this, but that runs after mount —
  // too late to stop the initial white flash.)
  try {
    let vp = document.querySelector('meta[name="viewport"]');
    if (!vp) {
      vp = document.createElement('meta');
      vp.setAttribute('name', 'viewport');
      document.head.appendChild(vp);
    }
    vp.setAttribute(
      'content',
      'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover',
    );
  } catch {
    /* ignore */
  }

  // Full-viewport backdrop behind the whole app. The Android shell is
  // edge-to-edge, so the status/navigation-bar regions are part of the WebView
  // viewport — but the React tree only paints them once the safe-area insets
  // measure, which at cold start doesn't happen until a full-screen view forces
  // a re-layout. Until then the WebView's own white background showed through
  // and the bars looked white. This fixed element covers the entire visual
  // viewport (exactly like the chart Modal's overlay does) with the theme
  // surface colour, so those bands are the right colour from the first frame and
  // flip with the light/dark toggle. It sits behind the app and ignores touches.
  const paintBackdrop = () => {
    if (!document.body || document.getElementById('te-safe-backdrop')) return;
    const bd = document.createElement('div');
    bd.id = 'te-safe-backdrop';
    bd.style.cssText =
      'position:fixed;top:0;left:0;right:0;bottom:0;z-index:-1;' +
      'background:var(--c-surface);pointer-events:none;';
    document.body.appendChild(bd);
  };
  if (document.body) paintBackdrop();
  else document.addEventListener('DOMContentLoaded', paintBackdrop);
}

// Colour values used inside StyleSheets: a CSS var on web (resolves live to the
// active mode), the dark hex on native.
const colors = KEYS.reduce((o, k) => {
  o[k] = WEB ? `var(--c-${k})` : DARK[k];
  return o;
}, {} as Palette);

// A real monospace stack (SF Mono / Cascadia / Roboto Mono …) instead of the
// generic 'monospace' that falls back to Courier — sharpens every price & symbol.
const MONO = WEB
  ? "ui-monospace, 'SF Mono', 'JetBrains Mono', 'Roboto Mono', Menlo, Consolas, monospace"
  : 'monospace';

// Soft elevation for cards & floating surfaces. On react-native-web these map to
// box-shadow; the app always runs as RN-web (incl. inside the Capacitor shell).
const shadow = {
  card: { shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  soft: { shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 9, shadowOffset: { width: 0, height: 3 } },
  none: { shadowColor: 'transparent', shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 } },
};

// Motion tokens — every animation in the app picks one of these durations so
// the whole product moves at one tempo. fast: press/hover feedback · base:
// sheets, tab indicators · gentle: screen-level entrances, skeleton cross-fade
// · data: number rolls, bar fills. (Transform/opacity only; nothing animates
// during scroll; reduced-motion collapses all to instant.)
const motion = { fast: 120, base: 200, gentle: 300, data: 400 };

// Tabular figures for every column of numbers — without this, table cells
// shimmy as values tick because proportional digits differ in width. Apply to
// any Text that column-aligns numbers (alongside theme.mono).
const numCell = Platform.OS === 'web'
  ? ({ fontFamily: MONO, fontVariant: ['tabular-nums'] } as const)
  : ({ fontFamily: MONO } as const);

export const theme = {
  ...colors,
  mono: MONO,
  shadow,
  motion,
  numCell,
  fs: { xs: 10, sm: 12, md: 14, lg: 16, xl: 20, xxl: 24, h1: 28 },
  sp: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  radius: { sm: 6, md: 10, lg: 14, xl: 20, pill: 999 },
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
