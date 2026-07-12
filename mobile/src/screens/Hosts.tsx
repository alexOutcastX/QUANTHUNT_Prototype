import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';
import AnalysisScreen from './AnalysisScreen';
import BacktestScreen from './BacktestScreen';
import CalculatorScreen from './CalculatorScreen';
import ChartScreen from './ChartScreen';
import PortfolioScreen from './PortfolioScreen';
import TradingViewScreen from './TradingViewScreen';
import TerminalScreen from './TerminalScreen';
import TrackListScreen from './TrackListScreen';
import WatchlistScreen from './WatchlistScreen';
import HolidaysScreen from './HolidaysScreen';
import IndicesScreen from './IndicesScreen';

type SubTab = { key: string; label: string; render: () => React.ReactElement };

// A lightweight top segmented switcher hosting several full screens under one
// bottom tab. Only the active sub-screen is mounted (each manages its own
// state / data fetches).
function SubTabs({ tabs }: { tabs: SubTab[] }) {
  const [active, setActive] = useState(tabs[0].key);
  const cur = tabs.find((t) => t.key === active) || tabs[0];
  return (
    <View style={styles.host}>
      <View style={styles.subBar}>
        {tabs.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.subBtn, active === t.key && styles.subBtnOn]}
            onPress={() => setActive(t.key)}
          >
            <Text style={[styles.subTxt, active === t.key && styles.subTxtOn]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.hostBody}>{cur.render()}</View>
    </View>
  );
}

export function AnalysisHome() {
  return (
    <SubTabs
      tabs={[
        { key: 'inst', label: 'Institutional', render: () => <AnalysisScreen /> },
        { key: 'bt', label: 'Backtest', render: () => <BacktestScreen /> },
      ]}
    />
  );
}

export function ChartsHome() {
  return (
    <SubTabs
      tabs={[
        { key: 'native', label: 'Chart', render: () => <ChartScreen /> },
        { key: 'tv', label: 'TradingView', render: () => <TradingViewScreen /> },
      ]}
    />
  );
}

// "More" menu: a list of secondary tools; tapping opens one full-screen with a
// back header. Keeps the bottom tab bar to five primary destinations.
const MORE_ITEMS: { key: string; label: string; hint: string; render: () => React.ReactElement }[] = [
  { key: 'terminal', label: 'Terminal', hint: 'AI relationship graph — who supplies whom (demo)', render: () => <TerminalScreen /> },
  { key: 'track', label: 'Track List', hint: 'Your tracked BUY / SELL calls', render: () => <TrackListScreen /> },
  { key: 'portfolio', label: 'Portfolio', hint: 'Holdings with live P&L', render: () => <PortfolioScreen /> },
  { key: 'watchlist', label: 'Watchlist', hint: 'Saved symbols with live quotes', render: () => <WatchlistScreen /> },
  { key: 'calc', label: 'Calculator', hint: 'Position size · SIP · CAGR', render: () => <CalculatorScreen /> },
  { key: 'indices', label: 'Indices', hint: 'Live index levels · day & 1Y change', render: () => <IndicesScreen /> },
  { key: 'holidays', label: 'Holidays', hint: 'NSE holiday calendar · market open/closed', render: () => <HolidaysScreen /> },
];

export function MoreScreen() {
  const [sel, setSel] = useState<string | null>(null);
  const item = MORE_ITEMS.find((i) => i.key === sel);

  if (item) {
    return (
      <View style={styles.host}>
        <View style={styles.moreHeader}>
          <TouchableOpacity onPress={() => setSel(null)} hitSlop={10}>
            <Text style={styles.back}>‹ More</Text>
          </TouchableOpacity>
          <Text style={styles.moreTitle}>{item.label}</Text>
          <View style={{ width: 54 }} />
        </View>
        <View style={styles.hostBody}>{item.render()}</View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.host} contentContainerStyle={styles.menuPad}>
      {MORE_ITEMS.map((i) => (
        <TouchableOpacity key={i.key} style={styles.menuRow} onPress={() => setSel(i.key)}>
          <View style={{ flex: 1 }}>
            <Text style={styles.menuLabel}>{i.label}</Text>
            <Text style={styles.menuHint}>{i.hint}</Text>
          </View>
          <Text style={styles.menuChevron}>›</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: theme.bg },
  hostBody: { flex: 1 },
  subBar: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomColor: theme.border, borderBottomWidth: 1 },
  subBtn: { flex: 1, borderColor: theme.border2, borderWidth: 1, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  subBtnOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  subTxt: { color: theme.muted2, fontFamily: theme.mono, fontSize: 12 },
  subTxtOn: { color: theme.bg, fontWeight: '700' },
  moreHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderBottomColor: theme.border, borderBottomWidth: 1 },
  back: { color: theme.accent, fontSize: 15, width: 54 },
  moreTitle: { color: theme.text, fontSize: 15, fontWeight: '700' },
  menuPad: { padding: 12 },
  menuRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.surface2, borderColor: theme.border, borderWidth: 1, borderRadius: 10, padding: 16, marginBottom: 10 },
  menuLabel: { color: theme.text, fontSize: 15, fontWeight: '700' },
  menuHint: { color: theme.muted, fontFamily: theme.mono, fontSize: 11, marginTop: 3 },
  menuChevron: { color: theme.muted2, fontSize: 22 },
});
