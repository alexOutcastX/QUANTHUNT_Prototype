import React, { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_BASE, api } from './api';
import { useResponsive } from './responsive';
import AnalysisScreen from './screens/AnalysisScreen';
import BacktestScreen from './screens/BacktestScreen';
import CalculatorScreen from './screens/CalculatorScreen';
import ChartScreen from './screens/ChartScreen';
import { AnalysisHome, ChartsHome, MoreScreen } from './screens/Hosts';
import PortfolioScreen from './screens/PortfolioScreen';
import ScreenerScreen from './screens/ScreenerScreen';
import TerminalScreen from './screens/TerminalScreen';
import TradingViewScreen from './screens/TradingViewScreen';
import TrackListScreen from './screens/TrackListScreen';
import UniverseScreen from './screens/UniverseScreen';
import WatchlistScreen from './screens/WatchlistScreen';
import { theme } from './theme';

type Screen = () => React.ReactElement;

// Desktop exposes every destination flat in the sidebar (there's room);
// mobile groups them into 5 bottom tabs (Analysis/Charts sub-toggle, More menu).
const SCREEN_BY_KEY: Record<string, Screen> = {
  screener: () => <ScreenerScreen />,
  terminal: () => <TerminalScreen />,
  universe: () => <UniverseScreen />,
  inst: () => <AnalysisScreen />,
  backtest: () => <BacktestScreen />,
  chart: () => <ChartScreen />,
  tv: () => <TradingViewScreen />,
  track: () => <TrackListScreen />,
  portfolio: () => <PortfolioScreen />,
  watchlist: () => <WatchlistScreen />,
  calc: () => <CalculatorScreen />,
};

// Desktop pages bar: every destination flat in one horizontal row, in the
// order of the old sidebar groups.
const PAGES: { k: string; label: string; glyph: string }[] = [
  { k: 'screener', label: 'Screener', glyph: '#' },
  { k: 'universe', label: 'Universe', glyph: '◈' },
  { k: 'terminal', label: 'Terminal', glyph: '⌘' },
  { k: 'inst', label: 'Institutional', glyph: '%' },
  { k: 'backtest', label: 'Backtest', glyph: '▶' },
  { k: 'chart', label: 'Chart', glyph: '~' },
  { k: 'tv', label: 'TradingView', glyph: 'TV' },
  { k: 'track', label: 'Track List', glyph: '★' },
  { k: 'portfolio', label: 'Portfolio', glyph: 'Pf' },
  { k: 'watchlist', label: 'Watchlist', glyph: '☆' },
  { k: 'calc', label: 'Calculator', glyph: '=' },
];

const TABS: { k: string; label: string; glyph: string; render: () => React.ReactElement }[] = [
  { k: 'screener', label: 'Screener', glyph: '#', render: () => <ScreenerScreen /> },
  { k: 'universe', label: 'Universe', glyph: '◈', render: () => <UniverseScreen /> },
  { k: 'analysis', label: 'Analysis', glyph: '%', render: () => <AnalysisHome /> },
  { k: 'charts', label: 'Charts', glyph: '~', render: () => <ChartsHome /> },
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
  const [active, setActive] = useState('screener');
  const Cur = SCREEN_BY_KEY[active] || SCREEN_BY_KEY.screener;
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
                <Text style={[styles.pageGlyph, on && styles.pageTextOn]}>{it.glyph}</Text>
                <Text style={[styles.pageLabel, on && styles.pageTextOn]}>{it.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
      <View style={styles.main}>
        <Cur />
      </View>
    </View>
  );
}

// ── Mobile / tablet-portrait: top header + bottom tab bar ────────────────────
function MobileShell({ version }: { version: string }) {
  const insets = useSafeAreaInsets();
  const [active, setActive] = useState('screener');
  const tab = TABS.find((t) => t.k === active) || TABS[0];
  return (
    <View style={styles.mobile}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Brand version={version} />
      </View>
      <View style={styles.mobileBody}>{tab.render()}</View>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  pageItemOn: { borderBottomColor: theme.accent, backgroundColor: theme.surface2 },
  pageGlyph: { color: theme.muted2, fontSize: 12, fontWeight: '700' },
  pageLabel: { color: theme.muted2, fontSize: 13, fontWeight: '600' },
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
