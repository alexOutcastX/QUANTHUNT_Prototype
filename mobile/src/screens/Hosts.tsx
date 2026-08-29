import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../api';
import { currentMember, memberLogout } from '../member';
import { peekNav, subscribeNav } from '../navIntent';
import { useResponsive } from '../responsive';
import { theme } from '../theme';
import { lazyScreen } from '../lazyScreen';
import { usePreview } from '../usePreview';

// Every hosted screen is a lazy chunk: Metro splits each import() into its own
// web bundle, fetched the first time the user opens that screen. First paint
// only parses the shell + Dashboard instead of the whole app.
import type { ScreenerScreenProps } from './ScreenerScreen';

const ScreenerScreen = lazyScreen<ScreenerScreenProps>(() => import('./ScreenerScreen'));
const AnalysisScreen = lazyScreen(() => import('./AnalysisScreen'));
const BacktestScreen = lazyScreen(() => import('./BacktestScreen'));
const CalculatorScreen = lazyScreen(() => import('./CalculatorScreen'));
const AnnouncementsScreen = lazyScreen(() => import('./AnnouncementsScreen'));
const ChatScreen = lazyScreen(() => import('./ChatScreen'));
const ChartScreen = lazyScreen(() => import('./ChartScreen'));
const PortfolioScreen = lazyScreen(() => import('./PortfolioScreen'));
const TradingViewScreen = lazyScreen(() => import('./TradingViewScreen'));
const WatchlistScreen = lazyScreen(() => import('./WatchlistScreen'));
const UniverseScreen = lazyScreen(() => import('./UniverseScreen'));
const HolidaysScreen = lazyScreen(() => import('./HolidaysScreen'));
const IndicesScreen = lazyScreen(() => import('./IndicesScreen'));
const HeatmapScreen = lazyScreen(() => import('./HeatmapScreen'));
const CorporateScreen = lazyScreen(() => import('./CorporateScreen'));
const DerivativesScreen = lazyScreen(() => import('./DerivativesScreen'));
const MomentumScreen = lazyScreen(() => import('./MomentumScreen'));
const MultibaggerScreen = lazyScreen(() => import('./MultibaggerScreen'));
const PennyScreen = lazyScreen(() => import('./PennyScreen'));
const PatternScreen = lazyScreen(() => import('./PatternScreen'));
const RecommendationsScreen = lazyScreen(() => import('./RecommendationsScreen'));
const RiskScreen = lazyScreen(() => import('./RiskScreen'));
const EntityGraphScreen = lazyScreen(() => import('./EntityGraphScreen'));
const PaperTradeScreen = lazyScreen(() => import('./PaperTradeScreen'));
const AlertsScreen = lazyScreen(() => import('./AlertsScreen'));
const AccountScreen = lazyScreen(() => import('./AccountScreen'));
const CalibrationScreen = lazyScreen(() => import('./CalibrationScreen'));
const MethodologyScreen = lazyScreen(() => import('./MethodologyScreen'));
const DeveloperScreen = lazyScreen(() => import('./DeveloperScreen'));
const WalletScreen = lazyScreen(() => import('./WalletScreen'));

// hidden: routable via nav intents but not shown as a pill/menu entry (e.g.
// Universe after it left the Screens bar for the Today landing page).
type SubTab = { key: string; label: string; hint?: string; render: () => React.ReactElement; hidden?: boolean };

// A lightweight top switcher hosting several full screens under one bottom tab.
// Only the active sub-screen is mounted (each manages its own state / fetches).
//
// Desktop shows a segmented pill row (there's room). Mobile can't fit 7 labels,
// so it collapses into a hamburger dropdown: the current tab + a menu listing
// every tab with a one-line description of what it's for.
function SubTabs({ tabs, persistKey, alias }: { tabs: SubTab[]; persistKey?: string; alias?: Record<string, string> }) {
  // alias maps legacy intent sub-keys onto the tab that now hosts them (e.g.
  // 'mb'/'momentum' → 'screener' since Multibagger and Momentum became tabs
  // inside the Screener page) so every old navigate() still lands somewhere.
  const resolve = (k?: string) => (k && alias?.[k]) || k;
  const has = (k?: string) => {
    const r = resolve(k);
    return !!r && tabs.some((t) => t.key === r);
  };
  const { isDesktop } = useResponsive();
  // If we arrived here via a cross-screen navigation targeting one of our
  // sub-tabs, open on that tab instead of the first.
  const [active, setActive] = useState(() => {
    const p = peekNav();
    return has(p?.sub) ? (resolve(p!.sub) as string) : tabs[0].key;
  });
  const [hydrated, setHydrated] = useState(false);
  // Restore the last sub-tab (unless a cross-nav intent targeted a specific one)
  // so returning to the app keeps you on the same section, not the first tab.
  useEffect(() => {
    const p = peekNav();
    if (has(p?.sub) || !persistKey) {
      setHydrated(true);
      return;
    }
    AsyncStorage.getItem('taureye.subnav.' + persistKey)
      .then((v) => {
        if (has(v || undefined)) setActive(v as string);
      })
      .finally(() => setHydrated(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (hydrated && persistKey) AsyncStorage.setItem('taureye.subnav.' + persistKey, active).catch(() => {});
  }, [active, hydrated, persistKey]);
  // …and react to later nav intents while this group stays mounted.
  useEffect(
    () =>
      subscribeNav(() => {
        const p = peekNav();
        if (has(p?.sub)) setActive(resolve(p!.sub) as string);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const cur = tabs.find((t) => t.key === active) || tabs[0];
  const [menuOpen, setMenuOpen] = useState(false);
  const shown = tabs.filter((t) => !t.hidden);

  return (
    <View style={styles.host}>
      {isDesktop ? (
        // Wide groups (the Desk hub) scroll horizontally with fixed-width pills;
        // small groups keep the classic equal-width segmented row.
        <View style={styles.subBarWrap}>
          {shown.length > 6 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.subScrollCenter}
            >
              <View style={styles.subBar}>
                {shown.map((t) => (
                  <TouchableOpacity
                    key={t.key}
                    style={[styles.subBtn, styles.subBtnFixed, active === t.key && styles.subBtnOn]}
                    onPress={() => setActive(t.key)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.subTxt, active === t.key && styles.subTxtOn]}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          ) : (
            // Content-width pills, centered in the row (report issues 2/9),
            // instead of equal-width pills stretched across the page.
            <View style={[styles.subBar, styles.subBarHug]}>
              {shown.map((t) => (
                <TouchableOpacity
                  key={t.key}
                  style={[styles.subBtn, styles.subBtnFixed, active === t.key && styles.subBtnOn]}
                  onPress={() => setActive(t.key)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.subTxt, active === t.key && styles.subTxtOn]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {/* The one-line explanation of each section used to render on mobile
              only, so desktop users never saw copy like "the honesty page". It
              is the same `hint`, shown for the active section. */}
          {shown.find((t) => t.key === active)?.hint ? (
            <Text style={styles.subBarHint} numberOfLines={1}>
              {shown.find((t) => t.key === active)?.hint}
            </Text>
          ) : null}
        </View>
      ) : (
        // Mobile: a hamburger button showing the current section; tap for a
        // drop-down list of every section with its one-line description.
        <View style={styles.hamWrap}>
          <TouchableOpacity
            style={styles.hamBtn}
            onPress={() => setMenuOpen(true)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={`Sections menu — currently ${cur.label}`}
          >
            <Text style={styles.hamIcon}>☰</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.hamLabel}>{cur.label}</Text>
              {cur.hint ? <Text style={styles.hamHint} numberOfLines={1}>{cur.hint}</Text> : null}
            </View>
            <Text style={styles.hamChevron}>▾</Text>
          </TouchableOpacity>
          <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
            <Pressable style={styles.menuScrim} onPress={() => setMenuOpen(false)} />
            <View style={styles.menuSheet}>
              <ScrollView bounces={false}>
                {shown.map((t) => (
                  <TouchableOpacity
                    key={t.key}
                    style={[styles.menuItem, active === t.key && styles.menuItemOn]}
                    onPress={() => {
                      setActive(t.key);
                      setMenuOpen(false);
                    }}
                    activeOpacity={0.75}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.menuLabel2, active === t.key && styles.menuLabel2On]}>{t.label}</Text>
                      {t.hint ? <Text style={styles.menuHint2} numberOfLines={2}>{t.hint}</Text> : null}
                    </View>
                    {active === t.key ? <Text style={styles.menuTick}>✓</Text> : null}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </Modal>
        </View>
      )}

      <View style={styles.hostBody}>{cur.render()}</View>
    </View>
  );
}

// ── Redesigned shell hubs ────────────────────────────────────────────────────
// Screens = every list that FINDS stocks (report §3.3: one place to generate
// candidates). Sub-tab keys deliberately match the legacy analysis/* keys so
// every existing navigate() intent lands unchanged.
export function ScreensHub() {
  // No bar of its own any more. Everything under Screens is "a way of finding
  // stocks", and which one you are using is now the SCREEN dropdown inside the
  // console's own top bar, beside the universe and the preset library. Two
  // stacked pill rows above the page were spending a lot of vertical space
  // saying what one control says.
  return <ScreenerHub />;
}

// Every screener the SCREEN dropdown offers, in the order it lists them.
// `hidden` keeps a destination reachable by intent without putting it in the
// menu — the heatmap moved to the home page and the constituent table has its
// own entry points.
type ScreenDef = {
  key: string;
  label: string;
  hint?: string;
  hidden?: boolean;
  // Custom renders nothing here — ScreenerHub gives it the picker as props so
  // it can host the control itself.
  render: () => React.ReactElement | null;
};

const SCREENS: ScreenDef[] = [
  { key: 'custom', label: 'Custom', hint: 'Build a screen from any field', render: () => null },
  { key: 'mb', label: 'Multibagger', hint: 'Long-run compounders by growth & quality', render: () => <MultibaggerScreen /> },
  { key: 'momentum', label: 'Momentum', hint: 'Strength, trend and relative performance', render: () => <MomentumScreen /> },
  { key: 'penny', label: 'Penny', hint: 'Low-priced names, graded for liquidity and risk', render: () => <PennyScreen /> },
  { key: 'reco', label: 'Recommendations', hint: 'Ranked buy setups from the Multibagger candidates', render: () => <RecommendationsScreen /> },
  { key: 'patterns', label: 'Patterns', hint: 'Chart patterns with confidence & targets', render: () => <PatternScreen /> },
  { key: 'heatmap', label: 'Heatmap', render: () => <HeatmapScreen />, hidden: true },
  { key: 'universe', label: 'Universe', render: () => <UniverseScreen />, hidden: true },
];

// Legacy intent sub-keys → a screen. 'screener' (the outer tab's old key)
// means the raw custom screener.
const SCREENER_SUBS: Record<string, string> = {
  screener: 'custom', custom: 'custom', mb: 'mb', momentum: 'momentum',
  penny: 'penny', reco: 'reco', patterns: 'patterns', heatmap: 'heatmap',
  universe: 'universe',
};

const SCREEN_CHOICES = SCREENS.filter((t) => !t.hidden)
  .map((t) => ({ key: t.key, label: t.label, hint: t.hint }));

export function ScreenerHub() {
  const pick = (sub?: string) => (sub && SCREENER_SUBS[sub]) || null;
  const [active, setActive] = useState(() => pick(peekNav()?.sub) || 'custom');
  useEffect(
    () =>
      subscribeNav(() => {
        const k = pick(peekNav()?.sub);
        if (k) setActive(k);
      }),
    [],
  );
  const cur = SCREENS.find((t) => t.key === active) || SCREENS[0];
  // The custom console renders the picker itself, in the row that already
  // holds the universe. Every other screen has no such row, so it gets a slim
  // one — otherwise picking Momentum would be a one-way trip.
  if (cur.key === 'custom') {
    return (
      <View style={styles.host}>
        <View style={styles.hostBody}>
          <ScreenerScreen screens={SCREEN_CHOICES} screen={active} onScreen={setActive} />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.host}>
      <View style={styles.screenBar}>
        <ScreenPicker choices={SCREEN_CHOICES} active={active} onPick={setActive} />
      </View>
      <View style={styles.hostBody}>{cur.render()}</View>
    </View>
  );
}

/** The SCREEN dropdown, for the screens that have no top bar to host it. */
function ScreenPicker({
  choices,
  active,
  onPick,
}: {
  choices: { key: string; label: string; hint?: string }[];
  active: string;
  onPick: (k: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.screenPickWrap}>
      <TouchableOpacity
        style={styles.screenBtn}
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Choose a screener"
      >
        <Text style={styles.screenBtnLbl}>SCREEN</Text>
        <Text style={styles.screenBtnTxt}>
          {choices.find((c) => c.key === active)?.label ?? 'Custom'} ▾
        </Text>
      </TouchableOpacity>
      {open ? (
        <View style={styles.screenMenu}>
          {choices.map((c) => (
            <TouchableOpacity
              key={c.key}
              style={styles.screenItem}
              onPress={() => {
                setOpen(false);
                onPick(c.key);
              }}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={c.label}
            >
              <Text style={[styles.screenMark, c.key === active && { color: theme.green }]}>
                {c.key === active ? '✓' : '○'}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.screenName}>{c.label}</Text>
                {c.hint ? <Text style={styles.screenHint} numberOfLines={1}>{c.hint}</Text> : null}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// Desk = the user's own workspace: positions, lists, alerts, deep research and
// utilities. Everything that used to live under Lists / Tools / the rest of
// Analysis, plus the More list so no destination is lost.
export function DeskHub() {
  const { isDesktop } = useResponsive();
  const preview = usePreview();
  return (
    <SubTabs
      persistKey="desk"
      tabs={[
        { key: 'watchlist', label: 'Watchlist', hint: 'Symbols with entry price + since-add move · live quotes', render: () => <WatchlistScreen /> },
        { key: 'portfolio', label: 'Portfolio', hint: 'Holdings with live P&L · broker sync', render: () => <PortfolioScreen /> },
        { key: 'paper', label: 'Paper trades', hint: 'Your logged setups, a virtual portfolio, and the engines’ own track record', render: () => <PaperTradeScreen /> },
        { key: 'calibration', label: 'Calibration', hint: 'Realised hit-rate & avg R per engine — the honesty page', render: () => <CalibrationScreen /> },
        { key: 'alerts', label: 'Alerts', hint: 'Price / % / RSI alerts', render: () => <AlertsScreen /> },
        { key: 'inst', label: 'Dossier', hint: 'Full company dossier · fundamentals, valuation, ownership, filings', render: () => <AnalysisScreen /> },
        { key: 'shareholders', label: 'Shareholders', hint: 'Institutions, promoters & political funding · every link cited', render: () => <EntityGraphScreen /> },
        { key: 'risk', label: 'Risk', hint: 'Portfolio VaR · volatility · beta · drawdown · correlation', render: () => <RiskScreen /> },
        { key: 'bt', label: 'Backtest', hint: 'Test a strategy against historical data before risking capital', render: () => <BacktestScreen /> },
        { key: 'calc', label: 'Calculator', hint: 'Position size · SIP · CAGR', render: () => <CalculatorScreen /> },
        // Wallet sits here rather than inside More: it used to be four taps
        // deep inside a nineteen-item menu, which is where the whole credit
        // economy went to be forgotten. The header pill links straight here.
        { key: 'wallet', label: 'Wallet', hint: 'Credits · daily bonus · refer and earn · your plan', render: () => <WalletScreen />, hidden: !preview },
        { key: 'account', label: 'Account', hint: 'Sign in · cloud sync across devices', render: () => <AccountScreen /> },
        { key: 'more', label: 'More', hint: 'Charts, community, corporate data, indices & settings', render: () => <MoreScreen /> },
        // Desktop promotes Backtest to the top bar beside Terminal; keep the
        // Desk tab only where that top-level entry doesn't exist (mobile).
      ].filter((t) => !(isDesktop && t.key === 'bt'))}
    />
  );
}

export function ChartsHome() {
  return (
    <SubTabs
      persistKey="charts"
      tabs={[
        { key: 'native', label: 'Chart', hint: 'Native candlestick chart with moving averages', render: () => <ChartScreen /> },
        { key: 'tv', label: 'TradingView', hint: 'Full TradingView charting widget', render: () => <TradingViewScreen /> },
      ]}
    />
  );
}

// "More" menu: a list of secondary tools; tapping opens one full-screen with a
// back header. Keeps the bottom tab bar to five primary destinations.
const MORE_ITEMS: {
  key: string; label: string; hint: string;
  render: () => React.ReactElement;
  /** Only listed on a preview host — see usePreview / preview.py. */
  preview?: boolean;
}[] = [
  { key: 'account', label: 'Account', hint: 'Sign in · cloud sync across devices', render: () => <AccountScreen /> },
  { key: 'methodology', label: 'Methodology', hint: 'How every score is computed — the published rules', render: () => <MethodologyScreen /> },
  { key: 'community', label: 'Community chat', hint: 'Global room, topic channels & direct messages with other traders', render: () => <ChatScreen /> },
  { key: 'announcements', label: 'Announcements', hint: 'Updates & notices from the team', render: () => <AnnouncementsScreen /> },
  { key: 'heatmap', label: 'Heatmap', hint: 'Sector & index day-change map · drill into constituents', render: () => <HeatmapScreen /> },
  { key: 'universe', label: 'Universe', hint: 'Index constituents · mcap segments · heatmap', render: () => <UniverseScreen /> },
  { key: 'charts', label: 'Charts', hint: 'Native charts + TradingView', render: () => <ChartsHome /> },
  { key: 'portfolio', label: 'Portfolio', hint: 'Holdings with live P&L · broker sync', render: () => <PortfolioScreen /> },
  { key: 'watchlist', label: 'Watchlist', hint: 'Symbols with entry price + since-add move · live quotes', render: () => <WatchlistScreen /> },
  { key: 'calc', label: 'Calculator', hint: 'Position size · SIP · CAGR', render: () => <CalculatorScreen /> },
  { key: 'corporate', label: 'Corporate', hint: 'Filings, actions, shareholding, bulk/block deals', render: () => <CorporateScreen /> },
  { key: 'derivatives', label: 'Derivatives', hint: 'F&O option chain · PCR · max-pain · payoff builder', render: () => <DerivativesScreen /> },
  { key: 'risk', label: 'Risk', hint: 'VaR · volatility · beta · drawdown · correlation', render: () => <RiskScreen /> },
  { key: 'entities', label: 'Shareholders', hint: "Institutions, promoters & political funding · every link cited", render: () => <EntityGraphScreen /> },
  { key: 'alerts', label: 'Alerts', hint: 'Server-side price / % / RSI alerts', render: () => <AlertsScreen /> },
  { key: 'developer', label: 'Developer', hint: 'Fundamentals cache · API keys · public /api/v1', render: () => <DeveloperScreen /> },
  { key: 'indices', label: 'Indices', hint: 'Live index levels · day & 1Y change', render: () => <IndicesScreen /> },
  { key: 'holidays', label: 'Holidays', hint: 'NSE holiday calendar · market open/closed', render: () => <HolidaysScreen /> },
  // Preview-only. usePreview() filters this out on taureye.com, where the
  // endpoints behind it 404 — an entry that always errored would be worse
  // than no entry.
];

// Destinations that already have a first-class tab on the Screens or Desk
// bars. One home per screen, so More never lists them a second time.
const MORE_DUP_KEYS = new Set(['account', 'heatmap', 'universe', 'portfolio', 'watchlist', 'calc', 'risk', 'entities', 'alerts']);
const MORE_MENU = MORE_ITEMS.filter((i) => !MORE_DUP_KEYS.has(i.key));

// Groups for the All-features list. A flat eighteen-item menu ordered by
// neither frequency nor category is where features go to be forgotten; the
// hints already exist on every entry and were wasted in a list.
const MORE_GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Markets', keys: ['heatmap', 'universe', 'indices', 'charts', 'holidays'] },
  { title: 'Research', keys: ['corporate', 'derivatives', 'entities', 'risk', 'methodology'] },
  { title: 'Your desk', keys: ['portfolio', 'watchlist', 'alerts', 'calc'] },
  { title: 'Community', keys: ['community', 'announcements'] },
  { title: 'Account', keys: ['account', 'developer'] },
];

export function MoreScreen() {
  const preview = usePreview();
  const menu = MORE_MENU.filter((i) => !i.preview || preview);
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [version, setVersion] = useState('');
  useEffect(() => {
    api.version().then((v) => setVersion(v.version)).catch(() => {});
  }, []);
  const items = menu;
  const item = items.find((i) => i.key === sel);

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

  const term = q.trim().toLowerCase();
  const match = (i: typeof items[number]) =>
    !term || i.label.toLowerCase().includes(term) || (i.hint || '').toLowerCase().includes(term);

  const row = (i: typeof items[number]) => (
    <TouchableOpacity
      key={i.key}
      style={styles.menuRow}
      onPress={() => setSel(i.key)}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`${i.label}. ${i.hint || ''}`}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.menuLabel}>{i.label}</Text>
        <Text style={styles.menuHint}>{i.hint}</Text>
      </View>
      <Text style={styles.menuChevron}>›</Text>
    </TouchableOpacity>
  );

  // Anything a group forgot to list still shows, so adding a MORE_MENU entry
  // can never make a feature disappear from the only page that lists them all.
  const grouped = new Set(MORE_GROUPS.flatMap((g) => g.keys));
  const ungrouped = items.filter((i) => !grouped.has(i.key));

  return (
    <ScrollView style={styles.host} contentContainerStyle={styles.menuPad}>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search features…"
        placeholderTextColor={theme.muted}
        style={styles.menuSearch}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {MORE_GROUPS.map((g) => {
        const rows = g.keys
          .map((k) => items.find((i) => i.key === k))
          .filter((i): i is typeof items[number] => !!i && match(i));
        if (!rows.length) return null;
        return (
          <View key={g.title}>
            <Text style={styles.menuGroup}>{g.title.toUpperCase()}</Text>
            {rows.map(row)}
          </View>
        );
      })}
      {ungrouped.filter(match).length ? (
        <View>
          <Text style={styles.menuGroup}>MORE</Text>
          {ungrouped.filter(match).map(row)}
        </View>
      ) : null}
      {currentMember() ? (
        <TouchableOpacity style={styles.menuRow} onPress={() => memberLogout()} activeOpacity={0.75}>
          <View style={{ flex: 1 }}>
            <Text style={styles.menuLabel}>Sign out</Text>
            <Text style={styles.menuHint}>
              Signed in as {currentMember()!.username} · {currentMember()!.plan.toUpperCase()} membership
            </Text>
          </View>
          <Text style={styles.menuChevron}>›</Text>
        </TouchableOpacity>
      ) : null}
      {version ? <Text style={styles.versionFoot}>TaurEye v{version}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: theme.bg },
  // The SCREEN picker for screens that have no top bar of their own.
  screenBar: { paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.md, zIndex: 90 },
  screenPickWrap: { position: 'relative', alignSelf: 'flex-start', zIndex: 90 },
  screenBtn: {
    backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1,
    borderRadius: theme.radius.md, paddingHorizontal: 12, paddingVertical: 6,
  },
  screenBtnLbl: { color: theme.muted, fontSize: 9, fontFamily: theme.mono, letterSpacing: 1 },
  screenBtnTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
  screenMenu: {
    position: 'absolute', top: 46, left: 0, width: 280,
    backgroundColor: theme.surface, borderColor: theme.border2, borderWidth: 1,
    borderRadius: theme.radius.md, paddingVertical: 6, zIndex: 95,
    ...theme.shadow.card,
  },
  screenItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 12, paddingVertical: 7 },
  screenMark: { color: theme.muted, fontSize: theme.fs.sm, width: 14 },
  screenName: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '600' },
  screenHint: { color: theme.muted, fontSize: theme.fs.xs },
  hostBody: { flex: 1 },
  subNav: { paddingTop: theme.sp.md },
  subNavHint: { color: theme.muted, fontSize: theme.fs.xs + 1, paddingHorizontal: theme.sp.lg, marginTop: 2 },
  subBarWrap: { paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.md, paddingBottom: theme.sp.sm },
  subBarHint: { color: theme.muted, fontSize: theme.fs.xs + 1, textAlign: 'center', marginTop: 6 },
  subBar: {
    flexDirection: 'row',
    backgroundColor: theme.surface2,
    borderRadius: 999,
    padding: 3,
  },
  subBtn: { flex: 1, borderRadius: 999, paddingVertical: 8, alignItems: 'center' },
  // Longhand on purpose: RNW maps `flex: 0` to CSS `flex: 0 1 0%`, whose 0%
  // basis collapsed every pill to zero width (labels stacked on top of each
  // other in the scrollable desktop bar).
  subBtnFixed: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', paddingHorizontal: 18 },
  // Hug content + center in the row (desktop bars are center-aligned).
  subBarHug: { alignSelf: 'center' },
  subScrollCenter: { flexGrow: 1, justifyContent: 'center' },
  innerBarWrap: { paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.sm, alignItems: 'center' },
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
  menuGroup: { color: theme.muted, fontSize: theme.fs.xs, fontWeight: '700',
    letterSpacing: 1.4, marginTop: theme.sp.lg, marginBottom: theme.sp.xs,
    paddingHorizontal: theme.sp.lg },
  menuSearch: {
    backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1,
    borderRadius: theme.radius.md, color: theme.text, fontSize: theme.fs.md,
    paddingHorizontal: theme.sp.md, paddingVertical: theme.sp.sm + 2,
    marginHorizontal: theme.sp.lg, marginBottom: theme.sp.sm,
  },
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
  navToggle: {
    width: 44,
    height: 26,
    borderRadius: 999,
    backgroundColor: theme.surface3,
    borderColor: theme.border2,
    borderWidth: 1,
    padding: 2,
    justifyContent: 'center',
  },
  navToggleOn: { backgroundColor: theme.brandSoft, borderColor: theme.brand },
  navKnob: { width: 20, height: 20, borderRadius: 999, backgroundColor: theme.muted2 },
  navKnobOn: { backgroundColor: theme.brand, alignSelf: 'flex-end' },
  versionFoot: {
    color: theme.muted,
    fontSize: theme.fs.xs + 1,
    fontFamily: theme.mono,
    textAlign: 'center',
    marginTop: theme.sp.md,
  },
});
