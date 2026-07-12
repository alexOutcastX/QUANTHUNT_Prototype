import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';
import AnalysisScreen from './AnalysisScreen';
import BacktestScreen from './BacktestScreen';
import CalculatorScreen from './CalculatorScreen';
import ChartScreen from './ChartScreen';
import PortfolioScreen from './PortfolioScreen';
import TradingViewScreen from './TradingViewScreen';
import TrackListScreen from './TrackListScreen';
import WatchlistScreen from './WatchlistScreen';
import UniverseScreen from './UniverseScreen';
import HolidaysScreen from './HolidaysScreen';
import IndicesScreen from './IndicesScreen';
import CorporateScreen from './CorporateScreen';
import DerivativesScreen from './DerivativesScreen';
import RiskScreen from './RiskScreen';
import EntityGraphScreen from './EntityGraphScreen';

type SubTab = { key: string; label: string; render: () => React.ReactElement };

// A lightweight top segmented switcher hosting several full screens under one
// bottom tab. Only the active sub-screen is mounted (each manages its own
// state / data fetches).
function SubTabs({ tabs }: { tabs: SubTab[] }) {
  const [active, setActive] = useState(tabs[0].key);
  const cur = tabs.find((t) => t.key === active) || tabs[0];
  return (
    <View style={styles.host}>
      <View style={styles.subBarWrap}>
        <View style={styles.subBar}>
          {tabs.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.subBtn, active === t.key && styles.subBtnOn]}
              onPress={() => setActive(t.key)}
              activeOpacity={0.75}
            >
              <Text style={[styles.subTxt, active === t.key && styles.subTxtOn]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
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
        { key: 'deriv', label: 'Derivatives', render: () => <DerivativesScreen /> },
        { key: 'risk', label: 'Risk', render: () => <RiskScreen /> },
        { key: 'bt', label: 'Backtest', render: () => <BacktestScreen /> },
      ]}
    />
  );
}

export function ListsHome() {
  return (
    <SubTabs
      tabs={[
        { key: 'track', label: 'Track List', render: () => <TrackListScreen /> },
        { key: 'portfolio', label: 'Portfolio', render: () => <PortfolioScreen /> },
        { key: 'watchlist', label: 'Watchlist', render: () => <WatchlistScreen /> },
      ]}
    />
  );
}

export function ToolsHome() {
  return (
    <SubTabs
      tabs={[
        { key: 'universe', label: 'Universe', render: () => <UniverseScreen /> },
        { key: 'corporate', label: 'Corporate', render: () => <CorporateScreen /> },
        { key: 'entities', label: 'Entities', render: () => <EntityGraphScreen /> },
        { key: 'calc', label: 'Calculator', render: () => <CalculatorScreen /> },
        { key: 'indices', label: 'Indices', render: () => <IndicesScreen /> },
        { key: 'holidays', label: 'Holidays', render: () => <HolidaysScreen /> },
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
  { key: 'universe', label: 'Universe', hint: 'Index constituents · mcap segments · heatmap', render: () => <UniverseScreen /> },
  { key: 'charts', label: 'Charts', hint: 'Native charts + TradingView', render: () => <ChartsHome /> },
  { key: 'track', label: 'Track List', hint: 'Your tracked BUY / SELL calls', render: () => <TrackListScreen /> },
  { key: 'portfolio', label: 'Portfolio', hint: 'Holdings with live P&L · broker sync', render: () => <PortfolioScreen /> },
  { key: 'watchlist', label: 'Watchlist', hint: 'Saved symbols with live quotes', render: () => <WatchlistScreen /> },
  { key: 'calc', label: 'Calculator', hint: 'Position size · SIP · CAGR', render: () => <CalculatorScreen /> },
  { key: 'corporate', label: 'Corporate', hint: 'Filings, actions, shareholding, bulk/block deals', render: () => <CorporateScreen /> },
  { key: 'derivatives', label: 'Derivatives', hint: 'F&O option chain · PCR · max-pain · payoff builder', render: () => <DerivativesScreen /> },
  { key: 'risk', label: 'Portfolio risk', hint: 'VaR · volatility · beta · drawdown · correlation', render: () => <RiskScreen /> },
  { key: 'entities', label: 'Entity graph', hint: 'Institution ⇄ company link analysis, grounded in NSE deals', render: () => <EntityGraphScreen /> },
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
          <TouchableOpacity onPress={() => setSel(null)} hitSlop={10} activeOpacity={0.75}>
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
        <TouchableOpacity
          key={i.key}
          style={styles.menuRow}
          onPress={() => setSel(i.key)}
          activeOpacity={0.75}
        >
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
  subBarWrap: { paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.md, paddingBottom: theme.sp.sm },
  subBar: {
    flexDirection: 'row',
    backgroundColor: theme.surface2,
    borderRadius: 999,
    padding: 3,
  },
  subBtn: { flex: 1, borderRadius: 999, paddingVertical: 8, alignItems: 'center' },
  subBtnOn: { backgroundColor: theme.accent },
  subTxt: { color: theme.muted2, fontSize: theme.fs.sm },
  subTxtOn: { color: theme.onAccent, fontWeight: '700' },
  moreHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.md - 2,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  back: { color: theme.text, fontSize: theme.fs.md + 1, width: 54 },
  moreTitle: { color: theme.text, fontSize: theme.fs.md + 1, fontWeight: '700' },
  menuPad: { padding: theme.sp.lg },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.sp.lg,
    marginBottom: theme.sp.md - 2,
  },
  menuLabel: { color: theme.text, fontSize: theme.fs.md, fontWeight: '700' },
  menuHint: { color: theme.muted, fontSize: theme.fs.sm, marginTop: 3 },
  menuChevron: { color: theme.muted2, fontSize: 22 },
});
