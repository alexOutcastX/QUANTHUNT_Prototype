import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { peekNav, subscribeNav } from '../navIntent';
import { useResponsive } from '../responsive';
import { theme } from '../theme';
import AnalysisScreen from './AnalysisScreen';
import BacktestScreen from './BacktestScreen';
import CalculatorScreen from './CalculatorScreen';
import ChartScreen from './ChartScreen';
import PortfolioScreen from './PortfolioScreen';
import TradingViewScreen from './TradingViewScreen';
import WatchlistScreen from './WatchlistScreen';
import UniverseScreen from './UniverseScreen';
import HolidaysScreen from './HolidaysScreen';
import IndicesScreen from './IndicesScreen';
import HeatmapScreen from './HeatmapScreen';
import CorporateScreen from './CorporateScreen';
import DerivativesScreen from './DerivativesScreen';
import MomentumScreen from './MomentumScreen';
import MultibaggerScreen from './MultibaggerScreen';
import PatternScreen from './PatternScreen';
import RecommendationsScreen from './RecommendationsScreen';
import RiskScreen from './RiskScreen';
import EntityGraphScreen from './EntityGraphScreen';
import AlertsScreen from './AlertsScreen';
import DeveloperScreen from './DeveloperScreen';

type SubTab = { key: string; label: string; hint?: string; render: () => React.ReactElement };

// A lightweight top switcher hosting several full screens under one bottom tab.
// Only the active sub-screen is mounted (each manages its own state / fetches).
//
// Desktop shows a segmented pill row (there's room). Mobile can't fit 7 labels,
// so it collapses into a hamburger dropdown: the current tab + a menu listing
// every tab with a one-line description of what it's for.
function SubTabs({ tabs }: { tabs: SubTab[] }) {
  const has = (k?: string) => !!k && tabs.some((t) => t.key === k);
  const { isDesktop } = useResponsive();
  const [menuOpen, setMenuOpen] = useState(false);
  // If we arrived here via a cross-screen navigation targeting one of our
  // sub-tabs, open on that tab instead of the first.
  const [active, setActive] = useState(() => {
    const p = peekNav();
    return has(p?.sub) ? (p!.sub as string) : tabs[0].key;
  });
  // …and react to later nav intents while this group stays mounted.
  useEffect(
    () =>
      subscribeNav(() => {
        const p = peekNav();
        if (has(p?.sub)) {
          setActive(p!.sub as string);
          setMenuOpen(false);
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const cur = tabs.find((t) => t.key === active) || tabs[0];
  const pick = (k: string) => {
    setActive(k);
    setMenuOpen(false);
  };

  return (
    <View style={styles.host}>
      {isDesktop ? (
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
      ) : (
        <View style={styles.hamWrap}>
          <TouchableOpacity style={styles.hamBtn} onPress={() => setMenuOpen((o) => !o)} activeOpacity={0.75}>
            <Text style={styles.hamIcon}>☰</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.hamLabel}>{cur.label}</Text>
              {cur.hint ? <Text style={styles.hamHint} numberOfLines={1}>{cur.hint}</Text> : null}
            </View>
            <Text style={styles.hamChevron}>{menuOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.hostBody}>{cur.render()}</View>

      {/* mobile dropdown overlay */}
      {!isDesktop && menuOpen ? (
        <>
          <Pressable style={styles.menuScrim} onPress={() => setMenuOpen(false)} />
          <View style={styles.menuSheet}>
            <ScrollView bounces={false}>
              {tabs.map((t) => {
                const on = active === t.key;
                return (
                  <TouchableOpacity
                    key={t.key}
                    style={[styles.menuItem, on && styles.menuItemOn]}
                    onPress={() => pick(t.key)}
                    activeOpacity={0.75}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.menuLabel2, on && styles.menuLabel2On]}>{t.label}</Text>
                      {t.hint ? <Text style={styles.menuHint2}>{t.hint}</Text> : null}
                    </View>
                    {on ? <Text style={styles.menuTick}>✓</Text> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </>
      ) : null}
    </View>
  );
}

export function AnalysisHome() {
  return (
    <SubTabs
      tabs={[
        { key: 'inst', label: 'Institutional', hint: 'Upside-probability model · Monte-Carlo + historical frequency', render: () => <AnalysisScreen /> },
        { key: 'reco', label: 'Recommendations', hint: 'Ranked buy setups from the Multibagger candidates', render: () => <RecommendationsScreen /> },
        { key: 'mb', label: 'Multibagger', hint: 'Fixed-screen candidates + one-click potential analyser', render: () => <MultibaggerScreen /> },
        { key: 'patterns', label: 'Patterns', hint: 'Classic chart-pattern scanner with confidence & targets', render: () => <PatternScreen /> },
        { key: 'momentum', label: 'Momentum', hint: 'Trend & thrust radar with upside-remaining', render: () => <MomentumScreen /> },
        { key: 'risk', label: 'Risk', hint: 'Portfolio VaR · volatility · beta · drawdown · correlation', render: () => <RiskScreen /> },
        { key: 'bt', label: 'Backtest', hint: 'Test a strategy against historical data before risking capital', render: () => <BacktestScreen /> },
      ]}
    />
  );
}

export function ListsHome() {
  return (
    <SubTabs
      tabs={[
        { key: 'watchlist', label: 'Watchlist', hint: 'Symbols with entry price + since-add move · live quotes', render: () => <WatchlistScreen /> },
        { key: 'portfolio', label: 'Portfolio', hint: 'Holdings with live P&L · broker sync', render: () => <PortfolioScreen /> },
        { key: 'alerts', label: 'Alerts', hint: 'Price / % / RSI alerts', render: () => <AlertsScreen /> },
      ]}
    />
  );
}

export function ToolsHome() {
  return (
    <SubTabs
      tabs={[
        { key: 'universe', label: 'Universe', hint: 'Index constituents · mcap segments · heatmap', render: () => <UniverseScreen /> },
        { key: 'derivatives', label: 'Derivatives', hint: 'F&O option chain · PCR · max-pain · payoff builder', render: () => <DerivativesScreen /> },
        { key: 'corporate', label: 'Corporate', hint: 'Filings, actions, shareholding, bulk/block deals', render: () => <CorporateScreen /> },
        { key: 'entities', label: 'Entities', hint: 'Institution ⇄ company link analysis, grounded in NSE deals', render: () => <EntityGraphScreen /> },
        { key: 'calc', label: 'Calculator', hint: 'Position size · SIP · CAGR', render: () => <CalculatorScreen /> },
        { key: 'indices', label: 'Indices', hint: 'Live index levels · day & 1Y change', render: () => <IndicesScreen /> },
        { key: 'holidays', label: 'Holidays', hint: 'NSE holiday calendar · market open/closed', render: () => <HolidaysScreen /> },
        { key: 'developer', label: 'API', hint: 'Issue keys · public /api/v1 quote & indices', render: () => <DeveloperScreen /> },
      ]}
    />
  );
}

export function ChartsHome() {
  return (
    <SubTabs
      tabs={[
        { key: 'native', label: 'Chart', hint: 'Native candlestick chart with moving averages', render: () => <ChartScreen /> },
        { key: 'tv', label: 'TradingView', hint: 'Full TradingView charting widget', render: () => <TradingViewScreen /> },
      ]}
    />
  );
}

// "More" menu: a list of secondary tools; tapping opens one full-screen with a
// back header. Keeps the bottom tab bar to five primary destinations.
const MORE_ITEMS: { key: string; label: string; hint: string; render: () => React.ReactElement }[] = [
  { key: 'heatmap', label: 'Heatmap', hint: 'Sector & index day-change map · drill into constituents', render: () => <HeatmapScreen /> },
  { key: 'universe', label: 'Universe', hint: 'Index constituents · mcap segments · heatmap', render: () => <UniverseScreen /> },
  { key: 'charts', label: 'Charts', hint: 'Native charts + TradingView', render: () => <ChartsHome /> },
  { key: 'portfolio', label: 'Portfolio', hint: 'Holdings with live P&L · broker sync', render: () => <PortfolioScreen /> },
  { key: 'watchlist', label: 'Watchlist', hint: 'Symbols with entry price + since-add move · live quotes', render: () => <WatchlistScreen /> },
  { key: 'calc', label: 'Calculator', hint: 'Position size · SIP · CAGR', render: () => <CalculatorScreen /> },
  { key: 'corporate', label: 'Corporate', hint: 'Filings, actions, shareholding, bulk/block deals', render: () => <CorporateScreen /> },
  { key: 'derivatives', label: 'Derivatives', hint: 'F&O option chain · PCR · max-pain · payoff builder', render: () => <DerivativesScreen /> },
  { key: 'risk', label: 'Portfolio risk', hint: 'VaR · volatility · beta · drawdown · correlation', render: () => <RiskScreen /> },
  { key: 'entities', label: 'Entity graph', hint: 'Institution ⇄ company link analysis, grounded in NSE deals', render: () => <EntityGraphScreen /> },
  { key: 'alerts', label: 'Alerts', hint: 'Server-side price / % / RSI alerts (owner)', render: () => <AlertsScreen /> },
  { key: 'developer', label: 'Developer API', hint: 'Issue keys · public /api/v1 quote & indices (owner)', render: () => <DeveloperScreen /> },
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
  // mobile hamburger sub-nav
  hamWrap: { paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.md, paddingBottom: theme.sp.sm, zIndex: 20 },
  hamBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.md,
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.md - 2,
  },
  hamIcon: { color: theme.text, fontSize: 18 },
  hamLabel: { color: theme.text, fontSize: theme.fs.md, fontWeight: '700' },
  hamHint: { color: theme.muted, fontSize: theme.fs.xs + 1, marginTop: 1 },
  hamChevron: { color: theme.muted2, fontSize: 12 },
  menuScrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#0009', zIndex: 25 },
  menuSheet: {
    position: 'absolute',
    top: 64,
    left: theme.sp.lg,
    right: theme.sp.lg,
    maxHeight: 460,
    backgroundColor: theme.surface,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    zIndex: 30,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.md,
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.md,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  menuItemOn: { backgroundColor: theme.surface2 },
  menuLabel2: { color: theme.text, fontSize: theme.fs.md, fontWeight: '700' },
  menuLabel2On: { color: theme.accent },
  menuHint2: { color: theme.muted, fontSize: theme.fs.sm, marginTop: 2 },
  menuTick: { color: theme.accent, fontSize: theme.fs.md, fontWeight: '700' },
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
