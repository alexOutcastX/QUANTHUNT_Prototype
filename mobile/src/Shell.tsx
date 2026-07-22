import React, { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_BASE, api } from './api';
import { marketState } from './format';
import { Icon, IconName } from './icons';
import { useResponsive } from './responsive';
import { AnalysisHome, ChartsHome, DeskHub, ListsHome, MoreScreen, ScreensHub, ToolsHome } from './screens/Hosts';
import DashboardScreen from './screens/DashboardScreen';
import ScreenerScreen from './screens/ScreenerScreen';
import StockScreen from './screens/StockScreen';
import TerminalScreen from './screens/TerminalScreen';
import HeatmapScreen from './screens/HeatmapScreen';
import TickerStrip from './components/TickerStrip';
import CommandPalette from './components/CommandPalette';
import PdfPreview from './components/PdfPreview';
import { navigate, peekNav, subscribeNav } from './navIntent';
import { isClassicNav, navModeReady, subscribeNavMode } from './navMode';
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
      accessibilityLabel={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
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
const NAV: { k: string; label: string; icon: IconName; render: (nav: (k: string) => void) => React.ReactElement }[] = [
  { k: 'today', label: 'Today', icon: 'home', render: (nav) => <DashboardScreen onNavigate={nav} /> },
  { k: 'screens', label: 'Screens', icon: 'screens', render: () => <ScreensHub /> },
  { k: 'stock', label: 'Symbol', icon: 'stock', render: () => <StockScreen /> },
  { k: 'desk', label: 'Desk', icon: 'desk', render: () => <DeskHub /> },
  { k: 'terminal', label: 'Terminal', icon: 'terminal', render: () => <TerminalScreen /> },
];

// Analysis sub-tabs that moved into the Desk hub; the rest went to Screens.
const DESK_ANALYSIS_SUBS = new Set(['inst', 'shareholders', 'paper', 'risk', 'bt']);

function mapTarget(page: string, sub?: string): string {
  switch (page) {
    case 'today':
    case 'dashboard':
      return 'today';
    case 'stock':
      return 'stock';
    case 'terminal':
      return 'terminal';
    case 'screens':
    case 'screener':
    case 'heatmap':
      return 'screens';
    case 'desk':
    case 'lists':
    case 'tools':
    case 'charts':
    case 'more':
      return 'desk';
    case 'analysis':
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
  const [active, setActive] = useState('today');
  const [palette, setPalette] = useState(false);
  const cur = NAV.find((t) => t.k === active) || NAV[0];
  useEffect(
    () =>
      subscribeNav(() => {
        const p = peekNav();
        if (p) setActive(mapTarget(p.page, p.sub));
      }),
    [],
  );
  // ⌘K / Ctrl+K opens the palette anywhere (web only).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <View style={styles.desktop}>
      <View style={styles.brandBar}>
        <Brand big />
        <MarketChip />
        <TouchableOpacity style={styles.searchBtn} onPress={() => setPalette(true)} activeOpacity={0.75}>
          <Icon name="search" size={13} color={theme.muted} />
          <Text style={styles.searchTxt}>Search</Text>
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
                onPress={() => setActive(it.k)}
              >
                <Icon name={it.icon} size={15} color={on ? theme.accent : theme.muted2} />
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
      <View style={styles.main}>{cur.render((k) => legacyNav(k, setActive))}</View>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </View>
  );
}

function NewMobileShell() {
  const insets = useSafeAreaInsets();
  const [active, setActive] = useState('today');
  const [palette, setPalette] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const tab = NAV.find((t) => t.k === active) || NAV[0];
  // Restore the last tab so backgrounding the app and returning doesn't dump
  // you back on Today. (Separate key from the classic shell's.)
  useEffect(() => {
    AsyncStorage.getItem('taureye.nav.tab2')
      .then((v) => {
        if (v && NAV.some((t) => t.k === v)) setActive(v);
      })
      .finally(() => setHydrated(true));
  }, []);
  useEffect(() => {
    if (hydrated) AsyncStorage.setItem('taureye.nav.tab2', active).catch(() => {});
  }, [active, hydrated]);
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
        <Brand />
        <View style={styles.headerRight}>
          <MarketChip />
          <TouchableOpacity
            style={styles.themeBtn}
            onPress={() => setPalette(true)}
            activeOpacity={0.75}
            accessibilityLabel="Search stocks and pages"
          >
            <Icon name="search" size={16} color={theme.muted2} />
          </TouchableOpacity>
          <ThemeToggle />
        </View>
      </View>
      <View style={styles.mobileBody}>{tab.render((k) => legacyNav(k, setActive))}</View>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <View style={[styles.tabBar, { paddingBottom: insets.bottom || 8 }]}>
        {NAV.map((t) => {
          const on = active === t.k;
          return (
            <TouchableOpacity key={t.k} style={styles.tab} onPress={() => setActive(t.k)} activeOpacity={0.7}>
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

// ═══════════════════════ Classic shell (opt-in fallback) ═════════════════════
// The pre-redesign navigation, kept behind Desk → More → "Navigation layout"
// while the new shell beds in.
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

function DesktopShell({ version }: { version: string }) {
  const [active, setActive] = useState('dashboard');
  const nav = (k: string) => setActive(SCREEN_BY_KEY[k] ? k : 'dashboard');
  const cur = SCREEN_BY_KEY[active] || SCREEN_BY_KEY.dashboard;
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

function MobileShell({ version }: { version: string }) {
  const insets = useSafeAreaInsets();
  const [active, setActive] = useState('dashboard');
  const [hydrated, setHydrated] = useState(false);
  const nav = (k: string) => setActive(TABS.some((t) => t.k === k) ? k : 'more');
  const tab = TABS.find((t) => t.k === active) || TABS[0];
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
  // Wait for the persisted nav-mode flag so a classic-mode user never sees the
  // new shell flash in; re-render live when the toggle flips.
  const [modeReady, setModeReady] = useState(false);
  const [classic, setClassic] = useState(false);
  useEffect(() => {
    navModeReady().then(() => {
      setClassic(isClassicNav());
      setModeReady(true);
    });
    // Restore the user session (and pull cloud-synced state) on boot, and
    // learn which feature flags (advisory mode) apply to this viewer.
    refreshSession();
    refreshFlags();
    installErrorReporting();
    return subscribeNavMode(() => setClassic(isClassicNav()));
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
  if (!modeReady) return <View style={styles.mobile} />;
  const shell = classic
    ? (isDesktop ? <DesktopShell version={version} /> : <MobileShell version={version} />)
    : (isDesktop ? <NewDesktopShell /> : <NewMobileShell />);
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
  legalBtn: { marginLeft: 'auto', paddingLeft: 10 },
  legalTxt: { color: theme.muted, fontSize: 9, fontFamily: theme.mono, letterSpacing: 1 },
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

  searchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  searchTxt: { color: theme.muted, fontSize: 11 },
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
  themeGlyph: { color: theme.muted2, fontSize: 16, lineHeight: 20 },
});
