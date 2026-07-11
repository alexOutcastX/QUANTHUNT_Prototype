import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from './api';
import { useResponsive } from './responsive';
import AnalysisScreen from './screens/AnalysisScreen';
import BacktestScreen from './screens/BacktestScreen';
import CalculatorScreen from './screens/CalculatorScreen';
import ChartScreen from './screens/ChartScreen';
import { AnalysisHome, ChartsHome, MoreScreen } from './screens/Hosts';
import PortfolioScreen from './screens/PortfolioScreen';
import ScreenerScreen from './screens/ScreenerScreen';
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

const SIDEBAR: { title: string; items: { k: string; label: string; glyph: string }[] }[] = [
  { title: 'Markets', items: [{ k: 'screener', label: 'Screener', glyph: '#' }, { k: 'universe', label: 'Universe', glyph: '◈' }] },
  { title: 'Analyze', items: [{ k: 'inst', label: 'Institutional', glyph: '%' }, { k: 'backtest', label: 'Backtest', glyph: '▶' }] },
  { title: 'Charts', items: [{ k: 'chart', label: 'Chart', glyph: '~' }, { k: 'tv', label: 'TradingView', glyph: 'TV' }] },
  { title: 'Lists', items: [{ k: 'track', label: 'Track List', glyph: '★' }, { k: 'portfolio', label: 'Portfolio', glyph: 'Pf' }, { k: 'watchlist', label: 'Watchlist', glyph: '☆' }] },
  { title: 'Tools', items: [{ k: 'calc', label: 'Calculator', glyph: '=' }] },
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

// ── Desktop: persistent left sidebar + main content ──────────────────────────
function DesktopShell({ version }: { version: string }) {
  const [active, setActive] = useState('screener');
  const Cur = SCREEN_BY_KEY[active] || SCREEN_BY_KEY.screener;
  return (
    <View style={styles.desktop}>
      <View style={styles.sidebar}>
        <View style={styles.brandBox}>
          <Brand version={version} big />
          <Text style={styles.tagline}>NSE · BSE Live Screener</Text>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} style={styles.navScroll}>
          {SIDEBAR.map((section) => (
            <View key={section.title} style={styles.section}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              {section.items.map((it) => {
                const on = active === it.k;
                return (
                  <TouchableOpacity
                    key={it.k}
                    style={[styles.navItem, on && styles.navItemOn]}
                    onPress={() => setActive(it.k)}
                  >
                    <Text style={[styles.navGlyph, on && styles.navTextOn]}>{it.glyph}</Text>
                    <Text style={[styles.navLabel, on && styles.navTextOn]}>{it.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
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

const SIDEBAR_W = 232;
const styles = StyleSheet.create({
  desktop: { flex: 1, flexDirection: 'row', backgroundColor: theme.bg },
  sidebar: { width: SIDEBAR_W, backgroundColor: theme.surface, borderRightColor: theme.border, borderRightWidth: 1 },
  brandBox: { paddingHorizontal: 18, paddingVertical: 18, borderBottomColor: theme.border, borderBottomWidth: 1 },
  tagline: { color: theme.muted, fontSize: 10, fontFamily: theme.mono, marginTop: 4 },
  navScroll: { flex: 1 },
  section: { paddingTop: 14, paddingHorizontal: 10 },
  sectionTitle: { color: theme.muted, fontSize: 10, fontFamily: theme.mono, textTransform: 'uppercase', letterSpacing: 1, paddingHorizontal: 8, marginBottom: 4 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8 },
  navItemOn: { backgroundColor: theme.surface2 },
  navGlyph: { color: theme.muted2, fontSize: 14, fontWeight: '700', width: 22, textAlign: 'center' },
  navLabel: { color: theme.muted2, fontSize: 14, fontWeight: '600' },
  navTextOn: { color: theme.accent },
  main: { flex: 1, backgroundColor: theme.bg },

  mobile: { flex: 1, backgroundColor: theme.bg },
  header: { backgroundColor: theme.surface, borderBottomColor: theme.border, borderBottomWidth: 1, paddingHorizontal: 16, paddingBottom: 12 },
  mobileBody: { flex: 1 },
  tabBar: { flexDirection: 'row', backgroundColor: theme.surface, borderTopColor: theme.border, borderTopWidth: 1, paddingTop: 6 },
  tab: { flex: 1, alignItems: 'center', gap: 2 },
  tabGlyph: { fontSize: 16, fontWeight: '700' },
  tabLabel: { fontSize: 10 },
});
