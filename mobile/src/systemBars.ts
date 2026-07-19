// Theme-aware system bars for the Android (Capacitor) shell.
//
// The shell is edge-to-edge: the WebView draws behind transparent status and
// navigation bars, so the *bar background* is just whatever the page paints
// there — the theme surface (see theme.ts + the header/tab-bar in Shell.tsx).
// That already flips with the light/dark toggle. What the OS still owns is the
// *icon appearance* (the clock / battery / nav glyphs): they must be light on
// our dark surface and dark on the light surface, or they vanish.
//
// @capacitor/status-bar lets us flip that at runtime. Everything here is guarded
// so it's a no-op on web / Expo Go and on older APKs that predate the plugin —
// the call simply fails the availability check and we move on.
import { getThemeMode, subscribeTheme } from './theme';

type StatusBarStyle = 'DARK' | 'LIGHT' | 'DEFAULT';

function isNative(): boolean {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

// Surface hex per mode — matches theme.ts (native can't read the CSS vars).
const SURFACE = { dark: '#0e1219', light: '#ffffff' } as const;

async function applyBars(): Promise<void> {
  if (!isNative()) return;
  try {
    const mod = await import('@capacitor/status-bar');
    const { StatusBar, Style } = mod;
    const dark = getThemeMode() === 'dark';
    // Style.Dark = dark background → light icons; Style.Light = light bg → dark
    // icons. So dark theme wants Style.Dark, light theme wants Style.Light.
    const style = (dark ? Style.Dark : Style.Light) as unknown as StatusBarStyle;
    await StatusBar.setStyle({ style: style as never });
    // Keep the WebView edge-to-edge so the theme surface shows through the bar.
    try {
      await StatusBar.setOverlaysWebView({ overlay: true });
    } catch {
      /* older plugin builds may not expose this — ignore */
    }
    // Best-effort background colour (ignored on Android 15+, honoured below it).
    try {
      await StatusBar.setBackgroundColor({ color: dark ? SURFACE.dark : SURFACE.light });
    } catch {
      /* ignore */
    }
  } catch {
    /* plugin absent (web / old APK) — the body background still colours the bar */
  }
}

let started = false;
// Wire the bars to the current theme and keep them in sync with the toggle.
export function initSystemBars(): void {
  if (started) return;
  started = true;
  applyBars();
  subscribeTheme(() => {
    applyBars();
  });
}
