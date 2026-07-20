import React, { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_BASE, api } from './api';
import { useResponsive } from './responsive';
import AnalysisScreen from './screens/AnalysisScreen';
import BacktestScreen from './screens/BacktestScreen';
import CalculatorScreen from './screens/CalculatorScreen';
import ChartScreen from './screens/ChartScreen';
import { AnalysisHome, ChartsHome, ListsHome, MoreScreen, ToolsHome } from './screens/Hosts';
import DashboardScreen from './screens/DashboardScreen';
import PortfolioScreen from './screens/PortfolioScreen';
import ScreenerScreen from './screens/ScreenerScreen';
import TerminalScreen from './screens/TerminalScreen';
import TradingViewScreen from './screens/TradingViewScreen';
import WatchlistScreen from './screens/WatchlistScreen';
import HolidaysScreen from './screens/HolidaysScreen';
import IndicesScreen from './screens/IndicesScreen';
import HeatmapScreen from './screens/HeatmapScreen';
import TickerStrip from './components/TickerStrip';
import PdfPreview from './components/PdfPreview';
import { peekNav, subscribeNav } from './navIntent';
import { theme, toggleThemeMode, useThemeMode } from './theme';

type Screen = () => React.ReactElement;

// Light/dark switch — glyph shows the mode you'll switch TO. Present in both the
// desktop brand bar and the mobile header.
function ThemeToggle({ style }: { style?: object }) {
  const mode = useThemeMode();
  return (
    <TouchableOpacity
      style={[styles.themeBtn, style]}
      onPress={toggleThemeMode}
      activeOpacity={0.75}
      accessibilityLabel={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <Text style={styles.themeGlyph}>{mode === 'dark' ? '☀' : '☾'}</Text>
    </TouchableOpacity>
  );
}

// Desktop exposes every destination flat in the sidebar (there's room);
// mobile groups them into 5 bottom tabs (Analysis/Charts sub-toggle, More menu).
const SCREEN_BY_KEY: Record<string, (nav: (k: string) => void) => React.ReactElement> = {
  dashboard: (nav) => <DashboardScreen onNavigate={nav} />,
  screener: () => <ScreenerScreen />,
  terminal: () => <TerminalScreen />,
  analysis: () => <AnalysisHome />,
  heatmap: () => <HeatmapScreen />,
  charts: () => <ChartsHome />,
  lists: () => <ListsHome />,
  tools: () => <ToolsHome />,
};

// Desktop pages bar: eight grouped destinations (see DESIGN.md).
const PAGES: { k: string; label: string }[] = [
  { k: 'dashboard', label: 'Dashboard' },
  { k: 'screener', label: 'Screener' },
  { k: 'terminal', label: 'Terminal' },
  { k: 'analysis', label: 'Analysis' },
  { k: 'heatmap', label: 'Heatmap' },
  { k: 'charts', label: 'Charts' },
  { k: 'lists', label: 'Lists' },
  { k: 'tools', label: 'Tools' },
];

const TABS: { k: string; label: string; glyph: string; render: (nav: (k: string) => void) => React.ReactElement }[] = [
  { k: 'dashboard', label: 'Home', glyph: '◆', render: (nav) => <DashboardScreen onNavigate={nav} /> },
  { k: 'screener', label: 'Screener', glyph: '#', render: () => <ScreenerScreen /> },
  { k: 'terminal', label: 'Terminal', glyph: '⌘', render: () => <TerminalScreen /> },
  { k: 'analysis', label: 'Analysis', glyph: '%', render: () => <AnalysisHome /> },
  { k: 'more', label: 'More', glyph: '•••', render: () => <MoreScreen /> },
];

function Brand({ version, big }: { version: string; big?: boolean }) {
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

// ── Desktop: branding bar on top, pages bar below it, full-width content ─────
function DesktopShell({ version }: { version: string }) {
  const [active, setActive] = useState('dashboard');
  const nav = (k: string) => setActive(SCREEN_BY_KEY[k] ? k : 'dashboard');
  const cur = SCREEN_BY_KEY[active] || SCREEN_BY_KEY.dashboard;
  // Honor cross-screen navigation requests (e.g. "Analyse this stock").
  useEffect(
    () =>
      subscribeNav(() => {
        const p = peekNav();
        if (p && SCREEN_BY_KEY[p.page]) setActive(p.page);
      }),
    [],
  );
  return (
    <View style={styles.desktop}>
      <View style={styles.brandBar}>
        <Brand version={version} big />
        <Text style={styles.tagline}>NSE · BSE Live Screener</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.navScroll}
          contentContainerStyle={styles.pagesRow}
        >
          {PAGES.map((it) => {
            const on = active === it.k;
            return (
              <TouchableOpacity
                key={it.k}
                style={[styles.pageItem, on && styles.pageItemOn]}
                onPress={() => setActive(it.k)}
              >
                <Text style={[styles.pageLabel, on && styles.pageTextOn]}>{it.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <ThemeToggle style={styles.themeBtnDesktop} />
        <TouchableOpacity
          style={styles.legalBtn}
          onPress={() => Linking.openURL((API_BASE || '') + '/legal.html').catch(() => {})}
        >
          <Text style={styles.legalTxt}>DISCLAIMER</Text>
        </TouchableOpacity>
      </View>
      <TickerStrip />
      <View style={styles.main}>
        {cur(nav)}
      </View>
    </View>
  );
}

// ── Mobile / tablet-portrait: top header + bottom tab bar ────────────────────
function MobileShell({ version }: { version: string }) {
  const insets = useSafeAreaInsets();
  const [active, setActive] = useState('dashboard');
  const [hydrated, setHydrated] = useState(false);
  const nav = (k: string) => setActive(TABS.some((t) => t.k === k) ? k : 'more');
  const tab = TABS.find((t) => t.k === active) || TABS[0];
  // Restore the last tab so backgrounding the app (switching to WhatsApp etc.)
  // and returning doesn't dump you back on the Dashboard.
  useEffect(() => {
    AsyncStorage.getItem('taureye.nav.tab')
      .then((v) => {
        if (v && TABS.some((t) => t.k === v)) setActive(v);
      })
      .finally(() => setHydrated(true));
  }, []);
  useEffect(() => {
    if (hydrated) AsyncStorage.setItem('taureye.nav.tab', active).catch(() => {});
  }, [active, hydrated]);
  // A cross-screen jump targets a top-level tab when it maps to one (Analysis
  // is a bottom tab), otherwise it falls through to the More menu.
  useEffect(
    () =>
      subscribeNav(() => {
        const p = peekNav();
        if (p) setActive(TABS.some((t) => t.k === p.page) ? p.page : 'more');
      }),
    [],
  );
  return (
    <View style={styles.mobile}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Brand version={version} />
        <ThemeToggle />
      </View>
      <View style={styles.mobileBody}>{tab.render(nav)}</View>
      <View style={[styles.tabBar, { paddingBottom: insets.bottom || 8 }]}>
        {TABS.map((t) => {
          const on = active === t.k;
          return (
            <TouchableOpacity key={t.k} style={styles.tab} onPress={() => setActive(t.k)} activeOpacity={0.7}>
              <View style={[styles.tabPill, on && styles.tabPillOn]}>
                <Text style={[styles.tabGlyph, { color: on ? theme.brand : theme.muted }]}>{t.glyph}</Text>
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
  const version = useVersion();
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
  return (
    <>
      {isDesktop ? <DesktopShell version={version} /> : <MobileShell version={version} />}
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
  legalBtn: { marginLeft: 'auto', paddingLeft: 10 },
  legalTxt: { color: theme.muted, fontSize: 9, fontFamily: theme.mono, letterSpacing: 1 },
  navScroll: { flexGrow: 0, marginLeft: 10 },
  pagesRow: { gap: 2, alignItems: 'center' },
  pageItem: {
    alignItems: 'center',
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
  mobileBody: { flex: 1 },
  tabBar: { flexDirection: 'row', backgroundColor: theme.surface, borderTopColor: theme.border, borderTopWidth: 1, paddingTop: 8 },
  tab: { flex: 1, alignItems: 'center', gap: 3 },
  tabPill: { paddingHorizontal: 16, paddingVertical: 4, borderRadius: theme.radius.pill },
  tabPillOn: { backgroundColor: theme.brandSoft },
  tabGlyph: { fontSize: 16, fontWeight: '700', lineHeight: 20 },
  tabLabel: { fontSize: 10, letterSpacing: 0.2 },

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
  themeGlyph: { color: theme.muted2, fontSize: 16, lineHeight: 20 },
});
