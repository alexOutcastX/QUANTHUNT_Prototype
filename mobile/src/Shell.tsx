import React, { useEffect, useState } from 'react';
import { BackHandler, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_BASE, api } from './api';
import { marketState } from './format';
import { Icon, IconName } from './icons';
import { useResponsive } from './responsive';
import { DeskHub, ScreensHub } from './screens/Hosts';
import DashboardScreen from './screens/DashboardScreen';
import { lazyScreen, prefetchScreens } from './lazyScreen';

// Dashboard (the landing tab) stays in the main bundle; every other tab is a
// lazy chunk fetched on first open — see lazyScreen.tsx.
const ScreenerScreen = lazyScreen(() => import('./screens/ScreenerScreen'));
const StockScreen = lazyScreen(() => import('./screens/StockScreen'));
const TerminalScreen = lazyScreen(() => import('./screens/TerminalScreen'));
const HeatmapScreen = lazyScreen(() => import('./screens/HeatmapScreen'));
const BacktestScreen = lazyScreen(() => import('./screens/BacktestScreen'));
import TickerStrip from './components/TickerStrip';
import PdfPreview from './components/PdfPreview';
// Both are modals: nothing renders until the user opens them, so there is no
// reason for their code to be in the bundle that blocks first paint. They are
// prefetched with the screens once the app is idle, so opening one still feels
// instant. (PdfPreview stays eager — it is an always-mounted subscriber, not
// something you open, and lazily loading it would mean its subscription never
// registers until something tried to print.)
const CommandPalette = lazyScreen(() => import('./components/CommandPalette'));
const TickerSettings = lazyScreen(() => import('./components/TickerSettings'));

import { canGoBack, goBack, initHistory, navigate, peekNav, subscribeNav } from './navIntent';
import { refreshSession } from './session';
import { refreshFlags } from './flags';
import { installErrorReporting } from './errorReport';
import { theme, toggleThemeMode, useThemeMode } from './theme';

// Light/dark switch — glyph shows the mode you'll switch TO. Present in both the
// desktop brand bar and the mobile header.
function ThemeToggle({ style }: { style?: object }) {
  const mode = useThemeMode();
  return (
    <TouchableOpacity
      style={[styles.themeBtn, style]}
      onPress={toggleThemeMode}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={styles.themeGlyph}>{mode === 'dark' ? '☀' : '☾'}</Text>
    </TouchableOpacity>
  );
}

// NSE session state where the version string used to sit — a professional
// glances at "is the market open" far more often than a build number (the
// version now lives at the bottom of Desk → More).
function MarketChip() {
  const [st, setSt] = useState(() => marketState());
  useEffect(() => {
    const id = setInterval(() => setSt(marketState()), 30000);
    return () => clearInterval(id);
  }, []);
  return (
    <View style={styles.mktChip}>
      <View style={[styles.mktDot, { backgroundColor: st.open ? theme.green : theme.muted }]} />
      <Text style={styles.mktTxt}>{st.label}</Text>
    </View>
  );
}

function Brand({ version, big }: { version?: string; big?: boolean }) {
  return (
    <Text style={{ color: theme.text, fontSize: big ? 20 : 17, fontWeight: '800' }}>
      Taur<Text style={{ color: theme.accent }}>Eye</Text>
      {version ? <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '600' }}>{'  v' + version}</Text> : null}
    </Text>
  );
}

function useVersion() {
  const [version, setVersion] = useState('');
  useEffect(() => {
    api.version().then((v) => setVersion(v.version)).catch(() => {});
  }, []);
  return version;
}

// ═════════════════════════ Redesigned shell (default) ════════════════════════
// Five destinations, one atom (see the UI/UX review §3.3): Today (dashboard),
// Screens (everything that finds stocks), Symbol (ONE page per stock), Desk
// (the user's own workspace) and Terminal. Every legacy navigate() key still
// resolves — mapTarget translates old page names to their new home, and the
// hubs reuse the legacy sub-tab keys verbatim.
// ONE navigation set for every width. The two shells used to expose different
// tabs — desktop dropped Symbol and promoted Backtest, mobile did the reverse —
// so the same product had two information architectures, the same navigate()
// call landed on different screens depending on window width, and resizing past
// the breakpoint silently moved things. Layout still adapts (a top row on
// desktop, a bottom bar on phones); the destinations no longer do.
const NAV: { k: string; label: string; icon: IconName; render: (nav: (k: string) => void) => React.ReactElement }[] = [
  { k: 'today', label: 'Today', icon: 'home', render: (nav) => <DashboardScreen onNavigate={nav} /> },
  { k: 'screens', label: 'Screens', icon: 'screens', render: () => <ScreensHub /> },
  { k: 'stock', label: 'Symbol', icon: 'stock', render: () => <StockScreen /> },
  { k: 'desk', label: 'Desk', icon: 'desk', render: () => <DeskHub /> },
  { k: 'backtest', label: 'Backtest', icon: 'flask', render: () => <BacktestScreen /> },
  { k: 'terminal', label: 'Terminal', icon: 'terminal', render: () => <TerminalScreen /> },
];

// Analysis sub-tabs that moved into the Desk hub; the rest went to Screens.
const DESK_ANALYSIS_SUBS = new Set(['inst', 'shareholders', 'paper', 'risk', 'bt']);

// Shared by both shells so a reload — or dragging a browser window across the
// breakpoint, which swaps one shell component for the other — puts you back
// where you were instead of on Today.
const TAB_KEY = 'taureye.nav.tab2';

function usePersistedTab() {
  const [active, setActive] = useState('today');
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(TAB_KEY)
      .then((v) => {
        if (v && NAV.some((t) => t.k === v)) setActive(v);
      })
      .finally(() => setHydrated(true));
  }, []);
  useEffect(() => {
    if (hydrated) AsyncStorage.setItem(TAB_KEY, active).catch(() => {});
  }, [active, hydrated]);
  return [active, setActive, hydrated] as const;
}

// Back, in every sense the platform offers one.
//
// Nothing here used to touch history, so the browser's Back button had only the
// page you were on BEFORE the app to go back to — pressing it left the site.
// Opening a dossier from a screen was one-way. This binds the intent stack to
// real history entries, to Android's hardware back key, and to the header
// affordance below, so all three mean the same thing.
// Warm the screen chunks in the background once the first paint is done, so
// opening a tab doesn't pay a download at the moment it's asked for.
function usePrefetch(ready: boolean) {
  useEffect(() => {
    if (ready) prefetchScreens();
  }, [ready]);
}

function useBackNav(active: string, ready: boolean): boolean {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!ready) return undefined;
    // Seed with wherever the app actually opened — the restored tab, not the
    // 'today' placeholder that showed while storage was still being read.
    initHistory(active);
    const un = subscribeNav(() => bump((n) => n + 1));
    const sub = BackHandler.addEventListener('hardwareBackPress', () => goBack());
    return () => {
      un();
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  return canGoBack();
}

function BackBtn({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity
      style={styles.backBtn}
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel="Back"
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={styles.backGlyph}>‹</Text>
    </TouchableOpacity>
  );
}

// ⌘K / Ctrl+K anywhere. Registered at every width: a keyboard is a property of
// the input device, not of the window size, and tablets and phone-width browser
// windows can both have one attached.
function usePaletteHotkey(setPalette: (fn: (v: boolean) => boolean) => void) {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setPalette]);
}

// The disclaimer is a regulatory obligation, not desktop chrome — it renders at
// every width. Mobile puts it under the content rather than in the crowded
// header, where a full word would not fit beside the icon row.
function LegalLink({ style }: { style?: object }) {
  return (
    <TouchableOpacity
      style={[styles.legalBtn, style]}
      onPress={() => Linking.openURL((API_BASE || '') + '/legal.html').catch(() => {})}
      accessibilityRole="link"
      accessibilityLabel="Disclaimer and legal terms"
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={styles.legalTxt}>DISCLAIMER</Text>
    </TouchableOpacity>
  );
}

function mapTarget(page: string, sub?: string): string {
  // Backtest is a top-level destination at every width now.
  const bt = 'backtest';
  switch (page) {
    case 'today':
    case 'dashboard':
      return 'today';
    case 'stock':
      return 'stock';
    case 'terminal':
      return 'terminal';
    case 'backtest':
      return bt;
    case 'screens':
    case 'screener':
    case 'heatmap':
      return 'screens';
    case 'desk':
    case 'lists':
    case 'tools':
    case 'charts':
    case 'more':
      return sub === 'bt' ? bt : 'desk';
    case 'analysis':
      if (sub === 'bt') return bt;
      return sub && DESK_ANALYSIS_SUBS.has(sub) ? 'desk' : 'screens';
    default:
      return 'today';
  }
}

// Dashboard quick-links pass bare legacy page keys with no sub; re-issue them
// as full intents so the right hub AND sub-tab open.
function legacyNav(k: string, setActive: (k: string) => void) {
  if (k === 'screener') navigate('screens', { sub: 'screener' });
  else if (k === 'lists') navigate('desk', { sub: 'watchlist' });
  else if (k === 'tools') navigate('desk', { sub: 'more' });
  else setActive(mapTarget(k));
}

function NewDesktopShell() {
  const [active, setActive, hydrated] = usePersistedTab();
  const [palette, setPalette] = useState(false);
  const [settings, setSettings] = useState(false);
  const showBack = useBackNav(active, hydrated);
  usePrefetch(hydrated);
  const cur = NAV.find((t) => t.k === active) || NAV[0];
  useEffect(
    () =>
      subscribeNav(() => {
        const p = peekNav();
        if (p) setActive(mapTarget(p.page, p.sub));
      }),
    [],
  );
  usePaletteHotkey(setPalette);
  return (
    <View style={styles.desktop}>
      <View style={styles.brandBar}>
        {showBack ? <BackBtn onPress={goBack} /> : null}
        <Brand big />
        <MarketChip />
        <TouchableOpacity style={styles.searchBtn} onPress={() => setPalette(true)} activeOpacity={0.75}>
          <Icon name="search" size={14} color={theme.muted} />
          <Text style={styles.searchTxt}>Search symbols &amp; pages…</Text>
          <Text style={styles.searchKbd}>⌘K</Text>
        </TouchableOpacity>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.navScroll}
          contentContainerStyle={styles.pagesRow}
        >
          {NAV.map((it) => {
            const on = active === it.k;
            return (
              <TouchableOpacity
                key={it.k}
                style={[styles.pageItem, on && styles.pageItemOn]}
                onPress={() => navigate(it.k)}
              >
                <Icon name={it.icon} size={15} color={on ? theme.accent : theme.muted2} />
                <Text style={[styles.pageLabel, on && styles.pageTextOn]}>{it.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <TouchableOpacity
          style={[styles.themeBtn, styles.themeBtnDesktop]}
          onPress={() => setSettings(true)}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Ticker settings"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon name="settings" size={16} color={theme.muted2} />
        </TouchableOpacity>
        <ThemeToggle />
        <LegalLink />
      </View>
      <TickerStrip />
      <View style={styles.main}>{cur.render((k) => legacyNav(k, setActive))}</View>
      {palette ? <CommandPalette open onClose={() => setPalette(false)} /> : null}
      {settings ? <TickerSettings onClose={() => setSettings(false)} /> : null}
    </View>
  );
}

function NewMobileShell() {
  const insets = useSafeAreaInsets();
  const [active, setActive, hydrated] = usePersistedTab();
  const [palette, setPalette] = useState(false);
  const [settings, setSettings] = useState(false);
  const showBack = useBackNav(active, hydrated);
  usePrefetch(hydrated);
  const tab = NAV.find((t) => t.k === active) || NAV[0];
  usePaletteHotkey(setPalette);
  useEffect(
    () =>
      subscribeNav(() => {
        const p = peekNav();
        if (p) setActive(mapTarget(p.page, p.sub));
      }),
    [],
  );
  return (
    <View style={styles.mobile}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        {showBack ? <BackBtn onPress={goBack} /> : null}
        <Brand />
        <View style={styles.headerRight}>
          <MarketChip />
          <TouchableOpacity
            style={styles.themeBtn}
            onPress={() => setPalette(true)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Search symbols and pages"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="search" size={16} color={theme.muted2} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.themeBtn}
            onPress={() => setSettings(true)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Ticker settings"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="settings" size={16} color={theme.muted2} />
          </TouchableOpacity>
          <ThemeToggle />
        </View>
      </View>
      <TickerStrip />
      <View style={styles.mobileBody}>{tab.render((k) => legacyNav(k, setActive))}</View>
      <LegalLink style={styles.legalBtnMobile} />
      {palette ? <CommandPalette open onClose={() => setPalette(false)} /> : null}
      {settings ? <TickerSettings onClose={() => setSettings(false)} /> : null}
      <View style={[styles.tabBar, { paddingBottom: insets.bottom || 8 }]}>
        {NAV.map((t) => {
          const on = active === t.k;
          return (
            <TouchableOpacity key={t.k} style={styles.tab} onPress={() => navigate(t.k)} activeOpacity={0.7}>
              <View style={[styles.tabPill, on && styles.tabPillOn]}>
                <Icon name={t.icon} size={19} color={on ? theme.brand : theme.muted} strokeWidth={on ? 2 : 1.75} />
              </View>
              <Text style={[styles.tabLabel, { color: on ? theme.brand : theme.muted, fontWeight: on ? '700' : '500' }]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export default function Shell() {
  const { isDesktop } = useResponsive();
  useEffect(() => {
    // Restore the user session (and pull cloud-synced state) on boot, and
    // learn which feature flags (advisory mode) apply to this viewer.
    refreshSession();
    refreshFlags();
    installErrorReporting();
  }, []);
  // Web: clamp browser pinch-zoom. Page-level zoom trapped users inside the
  // Terminal graph (page zoom + graph zoom stacked with no way back) — the
  // graph has its own pinch/wheel zoom with an always-visible ⛶ FIT reset.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const m = document.querySelector('meta[name="viewport"]');
    // viewport-fit=cover exposes the safe-area insets (env(safe-area-inset-*))
    // so the header can pad for the status bar now that the native shell draws
    // the WebView edge-to-edge behind a transparent status bar.
    if (m) m.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
  }, []);
  // One navigation system. The legacy "classic" shell (a parallel page list
  // with its own duplicate entries in More) was retired — every screen now has
  // exactly one home, so there is nothing to keep in sync.
  const shell = isDesktop ? <NewDesktopShell /> : <NewMobileShell />;
  return (
    <>
      {shell}
      {/* Global PDF export preview — any screen's Export button opens it here. */}
      <PdfPreview />
    </>
  );
}

const styles = StyleSheet.create({
  desktop: { flex: 1, backgroundColor: theme.bg },
  // Single top bar: brand + tagline + page nav + disclaimer. No vertical
  // padding — the nav items set the bar height so their active underline
  // sits flush with the bar's bottom border.
  brandBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    backgroundColor: theme.surface,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  tagline: { color: theme.muted, fontSize: 10, fontFamily: theme.mono },
  // A legal link needs a real target, not a 10px sliver (QA finding D4).
  legalBtn: { marginLeft: 'auto', paddingLeft: 10, paddingRight: 4, paddingVertical: 12 },
  // Mobile: a full-width strip above the tab bar, centred, so it reads as a
  // footer rather than as another action crowding the header.
  legalBtnMobile: {
    marginLeft: 0,
    paddingLeft: 0,
    paddingRight: 0,
    paddingVertical: 7,
    alignItems: 'center',
    borderTopColor: theme.border,
    borderTopWidth: 1,
  },
  legalTxt: { color: theme.muted, fontSize: theme.fs.xs, fontFamily: theme.mono, letterSpacing: 1 },
  navScroll: { flexGrow: 0, marginLeft: 10 },
  pagesRow: { gap: 2, alignItems: 'center' },
  pageItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  pageItemOn: { borderBottomColor: theme.accent },
  pageLabel: { color: theme.muted2, fontSize: 14, fontWeight: '600', letterSpacing: 0.2 },
  pageTextOn: { color: theme.accent },
  main: { flex: 1, backgroundColor: theme.bg },

  mobile: { flex: 1, backgroundColor: theme.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.surface,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mobileBody: { flex: 1 },
  tabBar: { flexDirection: 'row', backgroundColor: theme.surface, borderTopColor: theme.border, borderTopWidth: 1, paddingTop: 8 },
  tab: { flex: 1, alignItems: 'center', gap: 3 },
  tabPill: { paddingHorizontal: 16, paddingVertical: 4, borderRadius: theme.radius.pill },
  tabPillOn: { backgroundColor: theme.brandSoft },
  tabGlyph: { fontSize: 16, fontWeight: '700', lineHeight: 20 },
  tabLabel: { fontSize: 10, letterSpacing: 0.2 },

  mktChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  mktDot: { width: 6, height: 6, borderRadius: 999 },
  mktTxt: { color: theme.muted2, fontSize: 10, fontFamily: theme.mono, letterSpacing: 0.4 },

  // Wide + prominent (it replaces the Symbol tab as the way into a stock).
  searchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexGrow: 1,
    flexShrink: 1,
    maxWidth: 440,
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  searchTxt: { color: theme.muted, fontSize: 12, flex: 1 },
  searchKbd: {
    color: theme.muted2,
    fontSize: 9,
    fontFamily: theme.mono,
    backgroundColor: theme.surface3,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },

  themeBtn: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
  },
  themeBtnDesktop: { marginLeft: 'auto' },
  backBtn: {
    width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border, marginRight: 8,
  },
  backGlyph: { color: theme.text, fontSize: 20, lineHeight: 22, fontWeight: '700', marginTop: -2 },
  themeGlyph: { color: theme.muted2, fontSize: 16, lineHeight: 20 },
});
