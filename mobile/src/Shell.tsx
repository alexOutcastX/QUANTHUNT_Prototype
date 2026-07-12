import React, { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
import TrackListScreen from './screens/TrackListScreen';
import WatchlistScreen from './screens/WatchlistScreen';
import HolidaysScreen from './screens/HolidaysScreen';
import IndicesScreen from './screens/IndicesScreen';
import TickerStrip from './components/TickerStrip';
import { theme } from './theme';

type Screen = () => React.ReactElement;

// Desktop exposes every destination flat in the sidebar (there's room);
// mobile groups them into 5 bottom tabs (Analysis/Charts sub-toggle, More menu).
const SCREEN_BY_KEY: Record<string, (nav: (k: string) => void) => React.ReactElement> = {
  dashboard: (nav) => <DashboardScreen onNavigate={nav} />,
  screener: () => <ScreenerScreen />,
  terminal: () => <TerminalScreen />,
  analysis: () => <AnalysisHome />,
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
  return (
    <View style={styles.desktop}>
      <View style={styles.brandBar}>
        <Brand version={version} big />
        <Text style={styles.tagline}>NSE · BSE Live Screener</Text>
        <TouchableOpacity
          style={styles.legalBtn}
          onPress={() => Linking.openURL((API_BASE || '') + '/legal.html').catch(() => {})}
        >
          <Text style={styles.legalTxt}>DISCLAIMER</Text>
        </TouchableOpacity>
      </View>
      <TickerStrip />
      <View style={styles.pagesBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pagesRow}>
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
      </View>
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
  const nav = (k: string) => setActive(TABS.some((t) => t.k === k) ? k : 'more');
  const tab = TABS.find((t) => t.k === active) || TABS[0];
  return (
    <View style={styles.mobile}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Brand version={version} />
      </View>
      <View style={styles.mobileBody}>{tab.render(nav)}</View>
      <View style={[styles.tabBar, { paddingBottom: insets.bottom || 6 }]}>
        {TABS.map((t) => {
          const on = active === t.k;
          return (
            <TouchableOpacity key={t.k} style={styles.tab} onPress={() => setActive(t.k)}>
              <Text style={[styles.tabGlyph, { color: on ? theme.accent : theme.muted }]}>{t.glyph}</Text>
              <Text style={[styles.tabLabel, { color: on ? theme.accent : theme.muted }]}>{t.label}</Text>
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
  return isDesktop ? <DesktopShell version={version} /> : <MobileShell version={version} />;
}

const styles = StyleSheet.create({
  desktop: { flex: 1, backgroundColor: theme.bg },
  brandBar: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: theme.surface,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  tagline: { color: theme.muted, fontSize: 10, fontFamily: theme.mono },
  legalBtn: { marginLeft: 'auto' },
  legalTxt: { color: theme.muted, fontSize: 9, fontFamily: theme.mono, letterSpacing: 1 },
  pagesBar: { backgroundColor: theme.surface, borderBottomColor: theme.border, borderBottomWidth: 1 },
  pagesRow: { paddingHorizontal: 10, gap: 2 },
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
  header: { backgroundColor: theme.surface, borderBottomColor: theme.border, borderBottomWidth: 1, paddingHorizontal: 16, paddingBottom: 12 },
  mobileBody: { flex: 1 },
  tabBar: { flexDirection: 'row', backgroundColor: theme.surface, borderTopColor: theme.border, borderTopWidth: 1, paddingTop: 6 },
  tab: { flex: 1, alignItems: 'center', gap: 2 },
  tabGlyph: { fontSize: 16, fontWeight: '700' },
  tabLabel: { fontSize: 10 },
});
