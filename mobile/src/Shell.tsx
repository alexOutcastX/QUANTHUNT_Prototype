import React, { useEffect, useState } from 'react';
import WalletChip from './components/WalletChip';
import { BackHandler, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from './api';
import { marketState } from './format';
import { Icon, IconName } from './icons';
import { useResponsive } from './responsive';
import { DeskHub, ScreensHub } from './screens/Hosts';
import DashboardScreen from './screens/DashboardScreen';
import { lazyScreen, prefetchScreens } from './lazyScreen';

// Dashboard (the landing tab) stays in the main bundle; every other tab is a
// lazy chunk fetched on first open — see lazyScreen.tsx.
const ScreenerScreen = lazyScreen(() => import('./screens/ScreenerScreen'));
const StockScreen = lazyScreen(() => import('./screens/StockScreen'));
const TerminalScreen = lazyScreen(() => import('./screens/TerminalScreen'));
const HeatmapScreen = lazyScreen(() => import('./screens/HeatmapScreen'));
const BacktestScreen = lazyScreen(() => import('./screens/BacktestScreen'));
import TickerStrip from './components/TickerStrip';
import PdfPreview from './components/PdfPreview';
import LegalSheet from './components/LegalSheet';
// Both are modals: nothing renders until the user opens them, so there is no
// reason for their code to be in the bundle that blocks first paint. They are
// prefetched with the screens once the app is idle, so opening one still feels
// instant. (PdfPreview stays eager — it is an always-mounted subscriber, not
// something you open, and lazily loading it would mean its subscription never
// registers until something tried to print.)
const CommandPalette = lazyScreen(() => import('./components/CommandPalette'));
const TickerSettings = lazyScreen(() => import('./components/TickerSettings'));

import { TAB_KEY, canGoBack, goBack, initHistory, navigate, peekNav, subscribeNav } from './navIntent';
import { refreshSession } from './session';
import { currentMember, memberLogout, subscribeMember } from './member';
import { refreshFlags } from './flags';
import { installErrorReporting } from './errorReport';
import { theme, toggleThemeMode, useThemePref } from './theme';

// Light/dark switch — glyph shows the mode you'll switch TO. Present in both the
// desktop brand bar and the mobile header.
// Three states, not two: System follows the device, so a phone that goes dark
// at sunset takes the app with it. Cycles System → Light → Dark → System.
const THEME_GLYPH: Record<string, string> = { system: '◐', light: '☀', dark: '☾' };
const THEME_NEXT: Record<string, string> = { system: 'light', light: 'dark', dark: 'system' };

function ThemeToggle({ style }: { style?: object }) {
  const pref = useThemePref();
  return (
    <TouchableOpacity
      style={[styles.themeBtn, style]}
      onPress={toggleThemeMode}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`Theme: ${pref}. Switch to ${THEME_NEXT[pref]}`}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={styles.themeGlyph}>{THEME_GLYPH[pref]}</Text>
    </TouchableOpacity>
  );
}

// NSE session state where the version string used to sit — a professional
// glances at "is the market open" far more often than a build number (the
// version now lives at the bottom of Desk → More).
function MarketChip({ compact }: { compact?: boolean } = {}) {
  const [st, setSt] = useState(() => marketState());
  useEffect(() => {
    const id = setInterval(() => setSt(marketState()), 30000);
    return () => clearInterval(id);
  }, []);
  return (
    <View style={styles.mktChip}>
      <View style={[styles.mktDot, { backgroundColor: st.open ? theme.green : theme.muted }]} />
      {/* "CLOSED · 01:29 IST" costs 150px in a row that has none to spare.
          Below 1400 the state is kept and the clock dropped — the dot and the
          word are what anyone actually reads at a glance. */}
      <Text style={styles.mktTxt} numberOfLines={1}>
        {compact ? st.label.split('·')[0].trim() : st.label}
      </Text>
    </View>
  );
}

// The wordmark is the way home. Every site puts home behind its logo, and once
// it does, a Home tab beside it is a second button for the same destination —
// which is why Today could go.
function Brand({ version, big }: { version?: string; big?: boolean }) {
  return (
    <TouchableOpacity
      onPress={() => navigate(HOME)}
      activeOpacity={0.75}
      accessibilityRole="link"
      accessibilityLabel="TaurEye — go to the home page"
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
    >
      <Text style={{ color: theme.text, fontSize: big ? 20 : 17, fontWeight: '800' }}>
        Taur<Text style={{ color: theme.accent }}>Eye</Text>
        {version ? <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '600' }}>{'  v' + version}</Text> : null}
      </Text>
    </TouchableOpacity>
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
// ONE navigation set for every width. The two shells used to expose different
// tabs — desktop dropped Symbol and promoted Backtest, mobile did the reverse —
// so the same product had two information architectures, the same navigate()
// call landed on different screens depending on window width, and resizing past
// the breakpoint silently moved things. Layout still adapts (a top row on
// desktop, a bottom bar on phones); the destinations no longer do.
// Every destination the app can render, and — separately — the subset that
// earns a tab.
//
// Two of these are reachable without being tabs. HOME is what the brand mark
// goes to and where a fresh sign-in lands, so a tab for it was a second button
// for a thing the wordmark already does. Symbol is a destination, not a place
// you browse to: every mover row, watchlist row, sector member and search
// result opens a specific company, and the header search reaches any of them
// by name — a tab landing on whichever stock you happened to look at last was
// the redundant one. The SCREEN stays; only its tab is gone.
type Route = {
  k: string;
  label: string;
  icon: IconName;
  tab?: boolean;
  render: (nav: (k: string) => void) => React.ReactElement;
};

const HOME = 'today';

const ROUTES: Route[] = [
  { k: HOME, label: 'Home', icon: 'home', tab: false, render: (nav) => <DashboardScreen onNavigate={nav} /> },
  { k: 'screens', label: 'Screens', icon: 'screens', render: () => <ScreensHub /> },
  { k: 'stock', label: 'Symbol', icon: 'stock', tab: false, render: () => <StockScreen /> },
  { k: 'desk', label: 'Desk', icon: 'desk', render: () => <DeskHub /> },
  { k: 'backtest', label: 'Backtest', icon: 'flask', render: () => <BacktestScreen /> },
  { k: 'terminal', label: 'Terminal', icon: 'terminal', render: () => <TerminalScreen /> },
];

const NAV = ROUTES.filter((r) => r.tab !== false);

// Analysis sub-tabs that moved into the Desk hub; the rest went to Screens.
const DESK_ANALYSIS_SUBS = new Set(['inst', 'shareholders', 'paper', 'risk', 'bt']);

// Shared by both shells so a reload — or dragging a browser window across the
// breakpoint, which swaps one shell component for the other — puts you back
// where you were instead of on Today.

/**
 * How wide the header search may grow.
 *
 * The brand, market chip, six nav tabs, credit pill, two icon buttons and the
 * disclaimer all share one row. Search is the only element that can lose width
 * without losing meaning, so it yields first — a clipped tab label reads as
 * broken, a narrower search box does not. Measured: at 1280 the row overflowed
 * by 93px with search at 320.
 */
function searchMaxWidth(width: number): number {
  if (width >= 1600) return 420;
  if (width >= 1400) return 340;
  // Below 1400 the row is over-subscribed: measured at 1280, the six nav tabs
  // needed 636px and were given 528. Search drops to the short placeholder and
  // roughly a third of its width, which is most of the shortfall.
  return 132;
}

function usePersistedTab() {
  const [active, setActive] = useState('today');
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(TAB_KEY)
      .then((v) => {
        // ROUTES, not NAV: Home and Symbol are restorable destinations that no
        // longer have a tab, and validating against the tab list alone would
        // have quietly bounced you to Home from either one on every reload.
        if (v && ROUTES.some((t) => t.k === v)) setActive(v);
      })
      .finally(() => setHydrated(true));
  }, []);
  useEffect(() => {
    if (hydrated) AsyncStorage.setItem(TAB_KEY, active).catch(() => {});
  }, [active, hydrated]);
  return [active, setActive, hydrated] as const;
}

// Back, in every sense the platform offers one.
//
// Nothing here used to touch history, so the browser's Back button had only the
// page you were on BEFORE the app to go back to — pressing it left the site.
// Opening a dossier from a screen was one-way. This binds the intent stack to
// real history entries, to Android's hardware back key, and to the header
// affordance below, so all three mean the same thing.
// Warm the screen chunks in the background once the first paint is done, so
// opening a tab doesn't pay a download at the moment it's asked for.
function usePrefetch(ready: boolean) {
  useEffect(() => {
    if (ready) prefetchScreens();
  }, [ready]);
}

function useBackNav(active: string, ready: boolean): boolean {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!ready) return undefined;
    // Seed with wherever the app actually opened — the restored tab, not the
    // 'today' placeholder that showed while storage was still being read.
    initHistory(active);
    const un = subscribeNav(() => bump((n) => n + 1));
    const sub = BackHandler.addEventListener('hardwareBackPress', () => goBack());
    return () => {
      un();
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  return canGoBack();
}

function BackBtn({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity
      style={styles.backBtn}
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel="Back"
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={styles.backGlyph}>‹</Text>
    </TouchableOpacity>
  );
}

// ⌘K / Ctrl+K anywhere. Registered at every width: a keyboard is a property of
// the input device, not of the window size, and tablets and phone-width browser
// windows can both have one attached.
function usePaletteHotkey(setPalette: (fn: (v: boolean) => boolean) => void) {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setPalette]);
}

// The disclaimer is a regulatory obligation, not desktop chrome — it renders at
// every width. Mobile puts it under the content rather than in the crowded
// header, where a full word would not fit beside the icon row.
// Who you are signed in as, next to the disclaimer, linking to the page that
// can do something about it. The name was only visible four taps deep inside
// the account page — which is the one place you do not need to be told.
function AccountChip({ style }: { style?: object }) {
  const [, force] = useState(0);
  useEffect(() => subscribeMember(() => force((n) => n + 1)), []);
  const member = currentMember();
  if (!member) return null;
  return (
    <TouchableOpacity
      style={[styles.acctBtn, style]}
      onPress={() => navigate('desk', { sub: 'wallet' })}
      activeOpacity={0.75}
      accessibilityRole="link"
      accessibilityLabel={`Signed in as ${member.username} — open your account`}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Icon name="desk" size={13} color={theme.muted2} />
      <Text style={styles.acctTxt} numberOfLines={1}>{member.username}</Text>
    </TouchableOpacity>
  );
}

// Over the page, not instead of it. This used to hand the browser to
// /legal.html: on the web that replaced the app, and in a standalone install
// it opened a document with nothing to go back to — you could read the
// disclaimer and then you were stuck in it.
function LegalLink({ style }: { style?: object }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity
        style={[styles.legalBtn, style]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Disclaimer and legal terms"
        accessibilityState={{ expanded: open }}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.legalTxt}>DISCLAIMER</Text>
      </TouchableOpacity>
      {open ? <LegalSheet onClose={() => setOpen(false)} /> : null}
    </>
  );
}

// Signing out, at the corner of the bar where account controls are looked for.
// Until now the only way out was a row five items deep in More, which is not
// anywhere a person hunting for "sign out" would think to open.
//
// Two presses, not one. This sits a few pixels from the theme toggle, and the
// cost of a mis-click is retyping a password on a site that has no
// self-service reset yet. The confirmation is absolutely positioned, so arming
// it cannot widen the bar — the desktop header's width budget is fully spent
// (see searchMaxWidth) and a control that grew on press would clip a nav tab.
function SignOutBtn({ style, up }: { style?: object; up?: boolean }) {
  const [, force] = useState(0);
  const [armed, setArmed] = useState(false);
  useEffect(() => subscribeMember(() => force((n) => n + 1)), []);
  // Arming is not a state anyone should be left in: if the press was a
  // mis-click, walking away has to be enough to undo it.
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 6000);
    return () => clearTimeout(t);
  }, [armed]);
  const member = currentMember();
  // Nothing to sign out of on the login gate, and no member name to show.
  if (!member) return null;
  return (
    <View style={[styles.signOutWrap, style]}>
      <TouchableOpacity
        style={[styles.themeBtn, styles.signOutBtn, armed && styles.signOutBtnOn]}
        onPress={() => setArmed((v) => !v)}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={`Sign out of TaurEye. Signed in as ${member.username}`}
        accessibilityState={{ expanded: armed }}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        testID="header-signout"
      >
        <Icon name="signOut" size={16} color={armed ? theme.red : theme.muted2} />
      </TouchableOpacity>
      {armed ? (
        <View style={[styles.signOutPop, up ? styles.signOutPopUp : styles.signOutPopDown]}>
          <Text style={styles.signOutWho} numberOfLines={1}>
            {member.username} · {member.plan.toUpperCase()}
          </Text>
          <Text style={styles.signOutAsk}>Sign out of TaurEye?</Text>
          <View style={styles.signOutActs}>
            <TouchableOpacity
              style={[styles.signOutAct, styles.signOutStay]}
              onPress={() => setArmed(false)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Stay signed in"
            >
              <Text style={styles.signOutStayTxt}>Stay</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.signOutAct, styles.signOutGo]}
              onPress={() => {
                setArmed(false);
                memberLogout();
              }}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Confirm sign out"
              testID="header-signout-confirm"
            >
              <Text style={styles.signOutGoTxt}>Sign out</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function mapTarget(page: string, sub?: string): string {
  // Backtest is a top-level destination at every width now.
  const bt = 'backtest';
  switch (page) {
    case 'today':
    case 'dashboard':
      return 'today';
    case 'stock':
      return 'stock';
    case 'terminal':
      return 'terminal';
    case 'backtest':
      return bt;
    case 'screens':
    case 'screener':
    case 'heatmap':
      return 'screens';
    case 'desk':
    case 'lists':
    case 'tools':
    case 'charts':
    case 'more':
      return sub === 'bt' ? bt : 'desk';
    case 'analysis':
      if (sub === 'bt') return bt;
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
  // 'tools' was the More menu, which no longer exists — its contents live on
  // the Desk home and the app home now, so the key lands on the former.
  else if (k === 'tools') navigate('desk', { sub: 'home' });
  else setActive(mapTarget(k));
}

function NewDesktopShell() {
  const { width } = useResponsive();
  const [active, setActive, hydrated] = usePersistedTab();
  const [palette, setPalette] = useState(false);
  const [settings, setSettings] = useState(false);
  const showBack = useBackNav(active, hydrated);
  usePrefetch(hydrated);
  const cur = ROUTES.find((t) => t.k === active) || ROUTES[0];
  useEffect(
    () =>
      subscribeNav(() => {
        const p = peekNav();
        if (p) setActive(mapTarget(p.page, p.sub));
      }),
    [],
  );
  usePaletteHotkey(setPalette);
  return (
    <View style={styles.desktop}>
      <View style={styles.brandBar}>
        {showBack ? <BackBtn onPress={goBack} /> : null}
        <Brand big />
        <MarketChip compact={width < 1400} />
        <TouchableOpacity
          style={[styles.searchBtn, { maxWidth: searchMaxWidth(width) }]}
          onPress={() => setPalette(true)}
          activeOpacity={0.75}
        >
          <Icon name="search" size={14} color={theme.muted} />
          <Text style={styles.searchTxt} numberOfLines={1}>
            {width >= 1400 ? 'Search symbols & pages…' : 'Search…'}
          </Text>
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
                onPress={() => navigate(it.k)}
                accessibilityRole="tab"
                accessibilityLabel={it.label}
                accessibilityState={{ selected: on }}
                // Marks the top-level strip specifically. Other surfaces use
                // accessibilityRole="tab" too (the news rail's Latest /
                // Archive / Saved), and "every tab on the page" is not the
                // same set as "the app's destinations".
                testID="nav-tab"
              >
                <Icon name={it.icon} size={15} color={on ? theme.accent : theme.muted2} />
                {/* Below 1180 the labels do not fit beside the rest of the
                    bar, and a tab clipped mid-word reads as broken. The icons
                    carry it in that band; the accessibility label always says
                    the full name. Measured with the Back affordance showing,
                    which is the widest the bar ever gets. Four tabs reach
                    their labels far earlier than six did — this was 1360. */}
                {width >= 1180 ? (
                  <Text style={[styles.pageLabel, on && styles.pageTextOn]}>{it.label}</Text>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <TouchableOpacity
          style={[styles.themeBtn, styles.themeBtnDesktop]}
          onPress={() => setSettings(true)}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Ticker settings"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon name="settings" size={16} color={theme.muted2} />
        </TouchableOpacity>
        <WalletChip />
        <ThemeToggle />
        <AccountChip />
        <LegalLink />
        <SignOutBtn />
      </View>
      <TickerStrip />
      <View style={styles.main}>{cur.render((k) => legacyNav(k, setActive))}</View>
      {palette ? <CommandPalette open onClose={() => setPalette(false)} /> : null}
      {settings ? <TickerSettings onClose={() => setSettings(false)} /> : null}
    </View>
  );
}

function NewMobileShell() {
  const insets = useSafeAreaInsets();
  const [active, setActive, hydrated] = usePersistedTab();
  const [palette, setPalette] = useState(false);
  const [settings, setSettings] = useState(false);
  const showBack = useBackNav(active, hydrated);
  usePrefetch(hydrated);
  const tab = ROUTES.find((t) => t.k === active) || ROUTES[0];
  usePaletteHotkey(setPalette);
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
        {showBack ? <BackBtn onPress={goBack} /> : null}
        <Brand />
        <View style={styles.headerRight}>
          <MarketChip />
          <TouchableOpacity
            style={styles.themeBtn}
            onPress={() => setPalette(true)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Search symbols and pages"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="search" size={16} color={theme.muted2} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.themeBtn}
            onPress={() => setSettings(true)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Ticker settings"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="settings" size={16} color={theme.muted2} />
          </TouchableOpacity>
          <WalletChip />
        <ThemeToggle />
        </View>
      </View>
      <TickerStrip />
      <View style={styles.mobileBody}>{tab.render((k) => legacyNav(k, setActive))}</View>
      {/* The disclaimer stays optically centred whether or not anyone is
          signed in: the sign-out sits on top of the strip, not in its flow. */}
      <View style={styles.footerBar}>
        <AccountChip style={styles.acctBtnMobile} />
        <LegalLink style={styles.legalBtnMobile} />
        <SignOutBtn up style={styles.signOutFooter} />
      </View>
      {palette ? <CommandPalette open onClose={() => setPalette(false)} /> : null}
      {settings ? <TickerSettings onClose={() => setSettings(false)} /> : null}
      <View style={[styles.tabBar, { paddingBottom: insets.bottom || 8 }]}>
        {NAV.map((t) => {
          const on = active === t.k;
          return (
            <TouchableOpacity
              key={t.k}
              style={styles.tab}
              onPress={() => navigate(t.k)}
              activeOpacity={0.7}
              // The bottom bar had no roles at all: to a screen reader it was
              // four unlabelled buttons with a decorative icon inside, and
              // nothing said which one you were on.
              accessibilityRole="tab"
              accessibilityLabel={t.label}
              accessibilityState={{ selected: on }}
              testID="nav-tab"
            >
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

export default function Shell() {
  const { isDesktop } = useResponsive();
  useEffect(() => {
    // Restore the user session (and pull cloud-synced state) on boot, and
    // learn which feature flags (advisory mode) apply to this viewer.
    refreshSession();
    refreshFlags();
    installErrorReporting();
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
  // One navigation system. The legacy "classic" shell (a parallel page list
  // with its own duplicate entries in More) was retired — every screen now has
  // exactly one home, so there is nothing to keep in sync.
  const shell = isDesktop ? <NewDesktopShell /> : <NewMobileShell />;
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
    // The bar has to sit above the ticker strip and the page below it, or the
    // sign-out confirmation — which hangs off the bottom of the bar — is
    // painted underneath the content it overlaps and cannot be clicked.
    zIndex: 20,
  },
  tagline: { color: theme.muted, fontSize: 10, fontFamily: theme.mono },
  // A legal link needs a real target, not a 10px sliver (QA finding D4).
  // The account chip takes the auto margin that used to push the disclaimer
  // right; the two then sit together at the end of the bar.
  acctBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginLeft: 'auto', paddingHorizontal: 8, paddingVertical: 6,
    maxWidth: 170,
  },
  acctBtnMobile: { marginLeft: 0, flexShrink: 1 },
  acctTxt: {
    color: theme.muted2, fontSize: theme.fs.xs, fontFamily: theme.mono,
    fontWeight: '700', letterSpacing: 0.4,
  },
  legalBtn: { paddingLeft: 10, paddingRight: 4, paddingVertical: 12 },
  // Mobile: a full-width strip above the tab bar, centred, so it reads as a
  // footer rather than as another action crowding the header.
  legalBtnMobile: {
    flex: 1,
    marginLeft: 0,
    paddingLeft: 0,
    paddingRight: 0,
    paddingVertical: 7,
    alignItems: 'center',
  },
  // The strip owns the rule now that it holds two things.
  footerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopColor: theme.border,
    borderTopWidth: 1,
    zIndex: 5,
  },
  signOutFooter: { position: 'absolute', right: 10 },
  legalTxt: { color: theme.muted, fontSize: theme.fs.xs, fontFamily: theme.mono, letterSpacing: 1 },
  // flexShrink 0 is the whole point: the nav and the search box were both
  // elastic, so an over-subscribed bar took width from BOTH — and the nav is a
  // horizontal ScrollView, so its share of the loss was silent. It scrolled
  // instead of overflowing and the last tab went off the end unnoticed, while
  // the search box beside it still had ~110px it could have given up.
  // Navigation is the thing that must never be clipped; search is the elastic
  // one.
  navScroll: { flexGrow: 0, flexShrink: 0, marginLeft: 10 },
  pagesRow: { gap: 2, alignItems: 'center' },
  pageItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 13,
    // Back at 16 now that Home and Symbol have given up their tabs. It was cut
    // to 12 to buy room for the sign-out button when there were six; four tabs
    // hand back nearly 190px, and the nav is a horizontal ScrollView, so a bar
    // that is over-subscribed does not visibly overflow — it silently scrolls
    // and the last tab goes half off the end where nobody looks for it.
    // Re-measured at every width below before widening it again.
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

  // Wide + prominent (it replaces the Symbol tab as the way into a stock).
  searchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexGrow: 1,
    flexShrink: 1,
    // maxWidth is set per render from the window width — see searchMaxWidth.
    // A fixed 440 clipped the last nav tab once the credit pill joined the bar,
    // and a fixed 320 wrapped this box's own placeholder onto two lines.
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  searchTxt: { color: theme.muted, fontSize: 12, flex: 1 },
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
  backBtn: {
    width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border, marginRight: 8,
  },
  backGlyph: { color: theme.text, fontSize: 20, lineHeight: 22, fontWeight: '700', marginTop: -2 },
  themeGlyph: { color: theme.muted2, fontSize: 16, lineHeight: 20 },

  // zIndex so the confirmation paints over the ticker strip below the bar,
  // rather than being hidden by the content it overlaps.
  signOutWrap: { zIndex: 30 },
  signOutBtn: { width: 32, height: 32 },
  signOutBtnOn: { borderColor: theme.red, backgroundColor: theme.surface3 },
  signOutPop: {
    position: 'absolute',
    right: 0,
    width: 214,
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.sp.md,
    gap: 6,
    ...theme.shadow.card,
  },
  signOutPopDown: { top: '100%', marginTop: 6 },
  signOutPopUp: { bottom: '100%', marginBottom: 6 },
  signOutWho: {
    color: theme.muted,
    fontSize: theme.fs.xs,
    fontFamily: theme.mono,
    letterSpacing: 0.4,
  },
  signOutAsk: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
  signOutActs: { flexDirection: 'row', gap: 8, marginTop: 4 },
  signOutAct: {
    flex: 1,
    minHeight: 34,
    borderRadius: theme.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  signOutStay: { backgroundColor: theme.surface2, borderColor: theme.border2 },
  signOutStayTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '600' },
  signOutGo: { backgroundColor: theme.red, borderColor: theme.red },
  signOutGoTxt: { color: theme.onAccent, fontSize: theme.fs.sm, fontWeight: '700' },
});
