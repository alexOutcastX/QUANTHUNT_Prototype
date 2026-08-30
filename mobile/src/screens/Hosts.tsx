import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { peekNav, subscribeNav } from '../navIntent';
import { useResponsive } from '../responsive';
import { theme } from '../theme';
import { lazyScreen } from '../lazyScreen';
import { AnchoredMenu, TitleSlotContext, useMenuAnchor } from '../ui';

// Every hosted screen is a lazy chunk: Metro splits each import() into its own
// web bundle, fetched the first time the user opens that screen. First paint
// only parses the shell + Dashboard instead of the whole app.
import type { ScreenerScreenProps } from './ScreenerScreen';

const ScreenerScreen = lazyScreen<ScreenerScreenProps>(() => import('./ScreenerScreen'));
const AnalysisScreen = lazyScreen(() => import('./AnalysisScreen'));
const CalculatorScreen = lazyScreen(() => import('./CalculatorScreen'));
const ChatScreen = lazyScreen(() => import('./ChatScreen'));
const HeatmapScreen = lazyScreen(() => import('./HeatmapScreen'));
const UniverseScreen = lazyScreen(() => import('./UniverseScreen'));
const PortfolioScreen = lazyScreen(() => import('./PortfolioScreen'));
const WatchlistScreen = lazyScreen(() => import('./WatchlistScreen'));
const HolidaysScreen = lazyScreen(() => import('./HolidaysScreen'));
const MomentumScreen = lazyScreen(() => import('./MomentumScreen'));
const MultibaggerScreen = lazyScreen(() => import('./MultibaggerScreen'));
const PennyScreen = lazyScreen(() => import('./PennyScreen'));
const PatternScreen = lazyScreen(() => import('./PatternScreen'));
const RecommendationsScreen = lazyScreen(() => import('./RecommendationsScreen'));
const EntityGraphScreen = lazyScreen(() => import('./EntityGraphScreen'));
const PaperTradeScreen = lazyScreen(() => import('./PaperTradeScreen'));
const AlertsScreen = lazyScreen(() => import('./AlertsScreen'));
const AccountWalletScreen = lazyScreen(() => import('./AccountWalletScreen'));
const DeskHome = lazyScreen(() => import('./DeskHome'));

// hidden: routable via nav intents but not shown as a pill/menu entry (e.g.
// Universe after it left the Screens bar for the Today landing page).
// titled: does this screen render a <ScreenTitle>? The side variant puts its
// hamburger inside that title row rather than in a band of its own; the few
// screens with no title row (they open on their own chrome) get the band.
// tests/test_desk_layout.py checks the flag against the screens themselves.
type SubTab = {
  key: string; label: string; hint?: string;
  render: () => React.ReactElement; hidden?: boolean; titled?: boolean;
};

// A lightweight top switcher hosting several full screens under one bottom tab.
// Only the active sub-screen is mounted (each manages its own state / fetches).
//
// Desktop shows a segmented pill row (there's room). Mobile can't fit 7 labels,
// so it collapses into a hamburger dropdown: the current tab + a menu listing
// every tab with a one-line description of what it's for.
//
// variant="side" drops the pill row at every width for a hamburger and a
// left-hand drawer. A group with ten destinations spends a whole band of the
// page on a row of pills that is mostly the nine you are not on; the drawer
// costs one button, and it has room for each section's one-line description —
// which the desktop pill row never had space to show.
function SubTabs({ tabs, persistKey, alias, variant = 'pills', menuTitle }: {
  tabs: SubTab[];
  persistKey?: string;
  alias?: Record<string, string>;
  /** 'side' swaps the pill row for a hamburger and a left drawer. */
  variant?: 'pills' | 'side';
  menuTitle?: string;
}) {
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

  const close = () => setMenuOpen(false);
  // Escape used to be handled by Modal's onRequestClose. The drawer is part of
  // the page now, so it needs its own.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const g = globalThis as {
      addEventListener?: (t: string, f: (e: KeyboardEvent) => void) => void;
      removeEventListener?: (t: string, f: (e: KeyboardEvent) => void) => void;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    g.addEventListener?.('keydown', onKey);
    return () => g.removeEventListener?.('keydown', onKey);
  }, [menuOpen]);
  // The drawer's list, shared by the side variant and the mobile dropdown.
  const menuRows = shown.map((t) => (
    <TouchableOpacity
      key={t.key}
      style={[styles.menuItem, active === t.key && styles.menuItemOn]}
      onPress={() => {
        setActive(t.key);
        close();
      }}
      activeOpacity={0.75}
      accessibilityRole="menuitem"
      accessibilityState={{ selected: active === t.key }}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.menuLabel2, active === t.key && styles.menuLabel2On]}>{t.label}</Text>
        {t.hint ? <Text style={styles.menuHint2} numberOfLines={2}>{t.hint}</Text> : null}
      </View>
      {active === t.key ? <Text style={styles.menuTick}>✓</Text> : null}
    </TouchableOpacity>
  ));

  if (variant === 'side') {
    // Beside the page's own heading, not above it. In a band of its own the
    // button pushed every page title down behind a strip that repeated what
    // the title already said; the pages that have no heading of their own
    // still get the band, since there is nothing to sit beside.
    const inTitle = cur.titled !== false;
    const hamburger = (
      <TouchableOpacity
        style={inTitle ? styles.sideBtnCompact : styles.sideBtn}
        onPress={() => setMenuOpen(true)}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={`Sections menu — currently ${cur.label}`}
      >
        <Text style={styles.hamIcon}>☰</Text>
        {inTitle ? null : (
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.hamLabel} numberOfLines={1}>{cur.label}</Text>
            {cur.hint ? <Text style={styles.hamHint} numberOfLines={1}>{cur.hint}</Text> : null}
          </View>
        )}
      </TouchableOpacity>
    );
    return (
      <View style={styles.host}>
        {inTitle ? null : <View style={styles.sideWrap}>{hamburger}</View>}
        <View style={styles.hostBody}>
          <TitleSlotContext.Provider value={inTitle ? { node: hamburger } : null}>
            {cur.render()}
          </TitleSlotContext.Provider>
        </View>
        {/* Inside the page rather than portalled through a Modal, and that is
            deliberate: portalled it started at the top of the window and lay
            over the wordmark, the search box and the destination tabs — the
            chrome you use to leave the Desk. It belongs to the page it
            switches, so it is absolute within this host, which begins under
            the app bar and ends above the tab bar. Nothing above it is
            covered, and since the two no longer overlap there is no stacking
            contest with the header to lose. */}
        {menuOpen ? (
          <>
            <Pressable
              style={styles.drawerScrim}
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel="Close the sections menu"
            />
            <View style={styles.drawer}>
              <View style={styles.drawerHead}>
                <Text style={styles.drawerTitle}>{menuTitle || 'Sections'}</Text>
                <TouchableOpacity
                  onPress={close}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityRole="button"
                  accessibilityLabel="Close the sections menu"
                >
                  <Text style={styles.drawerX}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView bounces={false}>{menuRows}</ScrollView>
            </View>
          </>
        ) : null}
      </View>
    );
  }

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
              <ScrollView bounces={false}>{menuRows}</ScrollView>
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
  // Portalled, like the console's own pickers: a menu that can be painted
  // under the screen below it reads as a transparent menu.
  const menu = useMenuAnchor();
  return (
    <View style={styles.screenPickWrap}>
      <TouchableOpacity
        ref={menu.ref}
        style={styles.screenBtn}
        onPress={menu.toggle}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityState={{ expanded: menu.isOpen }}
        accessibilityLabel="Choose a screener"
      >
        <Text style={styles.screenBtnLbl}>SCREEN</Text>
        <Text style={styles.screenBtnTxt}>
          {choices.find((c) => c.key === active)?.label ?? 'Custom'} ▾
        </Text>
      </TouchableOpacity>
      <AnchoredMenu anchor={menu.anchor} width={300} onClose={menu.close}>
        {choices.map((c) => (
          <TouchableOpacity
            key={c.key}
            style={styles.screenItem}
            onPress={() => {
              menu.close();
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
      </AnchoredMenu>
    </View>
  );
}

// Desk = the user's own workspace: positions, lists, alerts, deep research and
// utilities. Everything that used to live under Lists / Tools / the rest of
// Analysis, plus the More list so no destination is lost.
export function DeskHub() {
  return (
    <SubTabs
      variant="side"
      menuTitle="DESK"
      // No persistKey, and that is the point: the Desk restored whichever of
      // its ten sections you were last on, so "Desk" meant a different page
      // every time you pressed it. It now always opens on the Desk home; an
      // explicit navigate('desk', { sub }) still lands on its own section.
      //
      // Calibration now lives inside Paper trades (it grades those very
      // trades), Risk inside Portfolio (it measures that very basket) and
      // Account inside Wallet — the old keys still resolve so every saved
      // sub-tab and every navigate('desk', { sub }) lands where the screen
      // moved to.
      alias={{ calibration: 'paper', risk: 'portfolio', account: 'wallet' }}
      tabs={[
        { key: 'home', label: 'Home', hint: 'Corporate actions, market dates, methodology, community & notices', render: () => <DeskHome /> },
        { key: 'watchlist', label: 'Watchlist', hint: 'Symbols with entry price + since-add move · live quotes', render: () => <WatchlistScreen /> },
        { key: 'portfolio', label: 'Portfolio', hint: 'Holdings with live P&L, broker sync and portfolio risk', render: () => <PortfolioScreen /> },
        { key: 'paper', label: 'Paper trades', hint: 'Your logged setups, a virtual portfolio, the engines’ track record and their calibration', render: () => <PaperTradeScreen /> },
        { key: 'alerts', label: 'Alerts', hint: 'Price / % / RSI alerts', render: () => <AlertsScreen /> },
        { key: 'inst', label: 'Reports', hint: 'Full company report · fundamentals, valuation, ownership, filings', render: () => <AnalysisScreen /> },
        { key: 'shareholders', label: 'Shareholders', hint: 'Institutions, promoters & political funding · every link cited', render: () => <EntityGraphScreen />, titled: false },
        { key: 'calc', label: 'Calculator', hint: 'Position size · SIP · CAGR', render: () => <CalculatorScreen /> },
        // Wallet sits here rather than inside More: it used to be four taps
        // deep inside a nineteen-item menu, which is where the whole credit
        // economy went to be forgotten. The header pill links straight here.
        { key: 'wallet', label: 'Account', hint: 'Credits, daily bonus, referrals and your plan · sign-in, cloud sync and deletion', render: () => <AccountWalletScreen /> },
        // Not pills — the Desk home links straight into these, so its
        // "Full calendar ›" and "Open community ›" land on the screen they
        // name instead of on a menu that lists it.
        { key: 'holidays', label: 'Holidays', render: () => <HolidaysScreen />, hidden: true },
        { key: 'community', label: 'Community', render: () => <ChatScreen />, hidden: true, titled: false },
        // Backtest is not here any more: it is a section of the Terminal, so
        // a navigate('desk', { sub: 'bt' }) is routed there by Shell's
        // mapTarget rather than being caught by a tab of the same name.
      ]}
    />
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
  screenItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 12, paddingVertical: 7 },
  screenMark: { color: theme.muted, fontSize: theme.fs.sm, width: 14 },
  screenName: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '600' },
  screenHint: { color: theme.muted, fontSize: theme.fs.xs },
  hostBody: { flex: 1 },
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
  // side-drawer sub-nav (the Desk)
  sideWrap: { paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.md, paddingBottom: theme.sp.sm },
  sideBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.md,
    alignSelf: 'flex-start',
    minWidth: 232,
    maxWidth: 360,
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.md - 3,
  },
  // Absolute within the sub-nav host — i.e. the page body — not the window.
  drawerScrim: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#0009', zIndex: 25,
  },
  // In a title row the heading names the section, so the button is just the
  // icon — a square that lines up with the cap height beside it.
  sideBtnCompact: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 38,
    height: 38,
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.md,
  },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 320,
    maxWidth: '86%',
    backgroundColor: theme.surface,
    borderRightColor: theme.border2,
    borderRightWidth: 1,
    zIndex: 30,
  },
  drawerHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.md,
    borderBottomColor: theme.border2,
    borderBottomWidth: 1,
  },
  drawerTitle: { color: theme.text, fontSize: theme.fs.md, fontWeight: '800', letterSpacing: 0.4 },
  drawerX: { color: theme.muted2, fontSize: theme.fs.lg },
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
});