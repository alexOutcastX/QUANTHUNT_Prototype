// Today — the market-universe landing page (report issue 4). News leads: a
// compact scrolling headline box with on-demand refresh and the user's social
// feeds sit at the top, followed by Portfolio / Watchlist jump-buttons, index
// tiles, animated breadth, a per-index movers slider, NSE/BSE sectors and
// the primary market (G-Sec · upcoming IPOs · fixed-income yields). Every
// window degrades independently.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  GsecResp,
  HolidaysResp,
  IndexConstituent,
  IndexQuote,
  IpoResp,
  MoversResp,
  NewsItem,
  Quote,
  SectorAgg,
  api,
} from '../api';
import { REFRESH, REFRESHING } from '../copy';
import { loadWatchlist } from '../watchlist';
import { loadPortfolio } from '../portfolio';
import { navigate, openStock } from '../navIntent';
import { AsOfChip, Card, EmptyState, Loading, SectionTitle, StatTile } from '../ui';
import { theme } from '../theme';
import { sessionLabel } from '../format';
import MarketClock from '../components/MarketClock';
import NewsPanel from '../components/NewsPanel';
import IndexSlider from '../components/IndexSlider';
import HeatmapScreen from './HeatmapScreen';
import IndicesScreen from './IndicesScreen';
import { MarketDeals } from './CorporateScreen';
import {
  PortfolioPanel,
  PosRow,
  WatchlistPanel,
  useChgMode,
} from '../components/PositionsPanel';
import { useResponsive } from '../responsive';

type Mover = { symbol: string; price?: number | null; chg?: number | null };
type SocialLink = { label: string; url: string };

const SOCIAL_KEY = 'taureye.social.v1';

const pct = (v: number | null | undefined) =>
  v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
const colorOf = (v: number | null | undefined) =>
  v == null ? theme.muted : v >= 0 ? theme.green : theme.red;
const inr = (v: number) => '₹' + Math.round(v).toLocaleString('en-IN');

// Last-known dashboard snapshot, kept for the app session. Re-entering Today
// paints this instantly (stale-while-revalidate) instead of a page of spinners.
const dash: {
  indices?: IndexQuote[] | null;
  market?: HolidaysResp | null;
  mv?: MoversResp | null;
  watch?: { symbol: string; q?: Quote }[] | null;
  pfRows?: PosRow[] | null;
  news?: NewsItem[] | null;
  sectors?: SectorAgg[] | null;
  gsec?: GsecResp | null;
  ipos?: IpoResp | null;
  pf?: { value: number; dayChg: number; dayPct: number; n: number } | null;
} = {};

// Top/bottom N of an index's constituents by day change.
const topBottom = (rows: IndexConstituent[], n: number): Mover[] => {
  const priced = rows.filter((r) => r.chg != null);
  priced.sort((a, b) => (b.chg as number) - (a.chg as number));
  return [...priced.slice(0, n), ...priced.slice(-n)];
};

// Live date + local-time widget (top of the page).
// Animated bullish/bearish breadth bar: segment widths spring to the live
// advance/decline split and the leading side's dot pulses.
function BreadthBar({ up, flat, down }: { up: number; flat: number; down: number }) {
  const a = useRef(new Animated.Value(1)).current;
  const b = useRef(new Animated.Value(1)).current;
  const c = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.spring(a, { toValue: Math.max(0.5, up), useNativeDriver: false, speed: 4, bounciness: 6 }),
      Animated.spring(b, { toValue: Math.max(0.25, flat), useNativeDriver: false, speed: 4, bounciness: 6 }),
      Animated.spring(c, { toValue: Math.max(0.5, down), useNativeDriver: false, speed: 4, bounciness: 6 }),
    ]).start();
  }, [up, flat, down, a, b, c]);
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0.35, duration: 900, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const bull = up >= down;
  return (
    <View>
      <View style={styles.breadthBar}>
        <Animated.View style={{ flex: a, backgroundColor: theme.green }} />
        <Animated.View style={{ flex: b, backgroundColor: theme.border2 }} />
        <Animated.View style={{ flex: c, backgroundColor: theme.red }} />
      </View>
      <View style={styles.moodRow}>
        <Animated.View
          style={[styles.moodDot, { backgroundColor: bull ? theme.green : theme.red, opacity: pulse }]}
        />
        <Text style={[styles.moodTxt, { color: bull ? theme.green : theme.red }]}>
          {bull ? 'BULLISH BREADTH' : 'BEARISH BREADTH'}
        </Text>
      </View>
    </View>
  );
}

// "Open in Custom screener with this universe pre-selected" footer link.
function ScreenerLink({ index, label }: { index: string; label?: string }) {
  return (
    <TouchableOpacity
      onPress={() => navigate('screens', { sub: 'screener', index })}
      activeOpacity={0.7}
    >
      <Text style={styles.moreLink}>{label || 'Open in Custom screener ›'}</Text>
    </TouchableOpacity>
  );
}

function MoverRows({ rows }: { rows: Mover[] }) {
  return (
    <>
      {rows.map((m, i) => (
        <TouchableOpacity
          key={m.symbol + i}
          style={[styles.mrow, i === 0 && { borderTopWidth: 0 }]}
          onPress={() => openStock(m.symbol)}
          activeOpacity={0.7}
        >
          <Text style={styles.msym}>{m.symbol}</Text>
          <Text style={styles.mprice}>{m.price != null ? m.price.toFixed(1) : '—'}</Text>
          <Text style={[styles.mchg, { color: colorOf(m.chg) }]}>{pct(m.chg)}</Text>
        </TouchableOpacity>
      ))}
    </>
  );
}

export default function DashboardScreen({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const [indices, setIndices] = useState<IndexQuote[] | null>(dash.indices ?? null);
  const [indicesAsof, setIndicesAsof] = useState<number | null>(null);
  const [indicesSession, setIndicesSession] = useState<string | null>(null);
  const [market, setMarket] = useState<HolidaysResp | null>(dash.market ?? null);
  const [pfRows, setPfRows] = useState<PosRow[] | null>(dash.pfRows ?? null);
  const [mv, setMv] = useState<MoversResp | null>(dash.mv ?? null);
  const [mvFailed, setMvFailed] = useState(false);
  const [watch, setWatch] = useState<{ symbol: string; q?: Quote }[] | null>(dash.watch ?? null);
  const [news, setNews] = useState<NewsItem[] | null>(dash.news ?? null);
  const [newsBusy, setNewsBusy] = useState(false);
  // Headline tapped → read it here first; the publisher's page is one more tap.
  const [article, setArticle] = useState<NewsItem | null>(null);
  const [sectors2, setSectors2] = useState<SectorAgg[] | null>(dash.sectors ?? null);
  const [gsec, setGsec] = useState<GsecResp | null>(dash.gsec ?? null);
  const [ipos, setIpos] = useState<IpoResp | null>(dash.ipos ?? null);
  const [pf, setPf] = useState<{ value: number; dayChg: number; dayPct: number; n: number } | null>(dash.pf ?? null);
  const [refreshing, setRefreshing] = useState(false);
  // Social accounts (small user-editable list of links).
  const [social, setSocial] = useState<SocialLink[]>([]);
  const [socialOpen, setSocialOpen] = useState(false);
  const [socLabel, setSocLabel] = useState('');
  const [socUrl, setSocUrl] = useState('');
  const { width } = useResponsive();
  // 1100, not the app's desktop breakpoint: a 340px rail plus a main column
  // that can still hold two mover lists side by side needs about this much,
  // and below it the two stack rather than squeezing both.
  const wide = width >= 1100;
  const [chgMode, toggleChg] = useChgMode();

  // Every window loads independently and in parallel.
  const load = useCallback(async () => {
    api.indices().then((d) => { dash.indices = d.indices; setIndices(d.indices); setIndicesAsof(d.asof ?? null); setIndicesSession(d.session ?? null); }).catch(() => setIndices((v) => v ?? []));
    api.holidays().then((d) => { dash.market = d; setMarket(d); }).catch(() => {});
    // Breadth + top gainers/losers, computed server-side over NIFTY 500.
    setMvFailed(false);
    api.movers('NIFTY 500', 6)
      .then((d) => { dash.mv = d; setMv(d); setMvFailed(false); })
      .catch(() => {
        setMvFailed(true);
        setTimeout(() => {
          api.movers('NIFTY 500', 6)
            .then((d) => { dash.mv = d; setMv(d); setMvFailed(false); })
            .catch(() => setMvFailed(true));
        }, 12000);
      });
    // Whole-universe NSE+BSE sector aggregates (incl. SME) — falls back to the
    // index-proxy list below while the server-side sweep is still warming.
    api.sectors('macro')
      .then((d) => {
        const rows = (d.sectors || []).filter((s) => s.chg != null);
        if (rows.length) { dash.sectors = rows; setSectors2(rows); }
        else setSectors2((v) => v ?? []);
      })
      .catch(() => setSectors2((v) => v ?? []));
    api.gsec().then((d) => { dash.gsec = d; setGsec(d); }).catch(() => setGsec((v) => v ?? { items: [] }));
    api.ipos().then((d) => { dash.ipos = d; setIpos(d); }).catch(() => setIpos((v) => v ?? { items: [] }));
    (async () => {
      try {
        const wl = await loadWatchlist();
        const syms = wl.slice(0, 8);
        if (!syms.length) { dash.watch = []; setWatch([]); return; }
        const q = await api.ltp(syms);
        const w = syms.map((symbol) => ({ symbol, q: q[symbol] }));
        dash.watch = w;
        setWatch(w);
      } catch {
        setWatch((v) => v ?? []);
      }
    })();
    (async () => {
      try {
        const holdings = await loadPortfolio();
        if (!holdings.length) {
          dash.pf = { value: 0, dayChg: 0, dayPct: 0, n: 0 };
          dash.pfRows = [];
          setPf(dash.pf);
          setPfRows([]);
          return;
        }
        const q = await api.ltp([...new Set(holdings.map((h) => h.symbol))]);
        let value = 0;
        let dayChg = 0;
        // The rows as well as the total. A flat total is as often two big
        // opposite moves as it is a quiet day, and the summary alone made you
        // leave the page to find out which.
        const rows: PosRow[] = [];
        for (const h of holdings) {
          const p = q[h.symbol]?.price;
          value += h.qty * (p ?? h.avg);
          const a = q[h.symbol]?.absChg;
          if (p != null && a != null) dayChg += h.qty * a;
          rows.push({
            symbol: h.symbol,
            price: p ?? h.avg,
            chg: q[h.symbol]?.chg ?? null,
            // The whole holding's rupee move, not one share's: what the day
            // cost YOU is the number a portfolio is asked for.
            abs: a != null ? h.qty * a : null,
            sub: `${h.qty} @ ${Math.round(h.avg).toLocaleString('en-IN')}`,
          });
        }
        dash.pfRows = rows;
        setPfRows(rows);
        const base = value - dayChg;
        const res = { value, dayChg, dayPct: base > 0 ? (dayChg / base) * 100 : 0, n: holdings.length };
        dash.pf = res;
        setPf(res);
      } catch {
        setPfRows((v) => v ?? []);
      }
    })();
    api.news().then((d) => { const n = (d.items || []).slice(0, 12); dash.news = n; setNews(n); }).catch(() => setNews((v) => v ?? []));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    AsyncStorage.getItem(SOCIAL_KEY)
      .then((raw) => { if (raw) setSocial(JSON.parse(raw)); })
      .catch(() => {});
  }, []);

  const saveSocial = (next: SocialLink[]) => {
    setSocial(next);
    AsyncStorage.setItem(SOCIAL_KEY, JSON.stringify(next)).catch(() => {});
  };

  const refreshNews = useCallback(async () => {
    setNewsBusy(true);
    try {
      const d = await api.news(true);
      const n = (d.items || []).slice(0, 12);
      dash.news = n;
      setNews(n);
    } catch {
      /* keep last headlines */
    } finally {
      setNewsBusy(false);
    }
  }, []);

  const go = (page: string) => onNavigate?.(page);

  const breadth = mv?.breadth ?? null;
  const gainers: IndexConstituent[] = mv?.gainers ?? [];
  const losers: IndexConstituent[] = mv?.losers ?? [];

  // Sector fallback while /sectors warms: live NSE sector sub-indices.
  const sectorProxy = useMemo(() => {
    const keys = new Set(['BANKNIFTY', 'NIFTYIT', 'NIFTYAUTO', 'NIFTYPHARMA', 'NIFTYFMCG', 'NIFTYMETAL', 'NIFTYENERGY', 'NIFTYREALTY']);
    return (indices || [])
      .filter((i) => keys.has(i.key) && i.chg != null)
      .slice()
      .sort((a, b) => (b.chg ?? 0) - (a.chg ?? 0))
      .map((i) => ({ sector: i.name.replace(/^NIFTY\s*/i, ''), count: 0, market_cap_cr: null, chg: i.chg }) as SectorAgg);
  }, [indices]);
  const sectorRows = (sectors2?.length ? sectors2 : sectorProxy).slice(0, 10);
  const sectorMax = Math.max(1, ...sectorRows.map((s) => Math.abs(s.chg ?? 0)));

  // "Friday" rather than "today", wherever a number on this page is a closing
  // price from a session that has already ended. Written once, read by the
  // index strip, the breadth card and both mover lists.
  const indicesWhen = sessionLabel(indicesSession).replace(/^on /, '');
  const moversWhen = sessionLabel(mv?.session).replace(/^on /, '');

  const wlRows: PosRow[] | null = useMemo(
    () =>
      watch
        ? watch.map((w) => ({
            symbol: w.symbol,
            price: w.q?.price,
            chg: w.q?.chg,
            abs: w.q?.absChg,
          }))
        : null,
    [watch],
  );

  // The slider labels each panel with that index's live level. Names differ
  // between the two feeds ("NIFTY BANK" in /index, "NIFTY Bank" in /indices),
  // so the match is case-insensitive on the compacted name.
  const indexLevel = useCallback(
    (name: string) => {
      const want = name.replace(/\s+/g, '').toUpperCase();
      const hit = (indices || []).find(
        (i) => i.name.replace(/\s+/g, '').toUpperCase() === want,
      );
      return hit ? { level: hit.level, chg: hit.chg } : null;
    },
    [indices],
  );

  const gsecRows = (gsec?.items || []).filter((g) => g.kind === 'gsec');
  const sgbRows = (gsec?.items || []).filter((g) => g.kind === 'sgb');
  const bestYield = gsecRows.length ? Math.max(...gsecRows.map((g) => g.yld ?? 0)) : null;

  if (!indices) return <Loading label="Loading market overview…" />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
          tintColor={theme.muted2}
        />
      }
    >
      {/* ── Header: date+clock · market pill · Portfolio / Watchlist buttons ── */}
      <View style={styles.headRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.h1}>Markets</Text>
          {/* The clock owns the status now. It used to sit in a second pill
              over on the right that only ever spoke for India, which was a
              separate answer to a question the clock was already being asked. */}
          <MarketClock indiaOpen={market ? market.open : null} />
        </View>
      </View>
      {/* ── Two columns: the market on the left, your desk on the right ──
          News was a full-width card at the very top: a lot of the best space
          on the screen for a list you skim, and it pushed the market data
          below the fold. It reads better narrow, and the column beside it is
          where everything about YOU now lives — headlines, your feeds, your
          portfolio, your watchlist. Below the rail breakpoint the two stack,
          because a 340px rail beside anything is not a phone layout. */}
      <View style={[styles.page, wide && styles.pageWide]}>
        <View style={styles.mainCol}>
      {/* ── Index tiles ── */}
      <View style={styles.tiles}>
        {indices.slice(0, 6).map((ix) => {
          // A tile that has not caught up to the last completed session says
          // which day it IS from. The server makes that call against the
          // trading calendar rather than against the neighbouring tiles: when
          // a whole feed goes quiet, "behind its neighbours" marks nothing,
          // which is exactly the case that needs marking.
          const lag = ix.stale ? sessionLabel(ix.session).replace(/^on /, '') : '';
          return (
            <StatTile
              key={ix.key}
              label={ix.name}
              value={
                ix.level == null
                  ? '—'
                  : ix.level.toLocaleString('en-IN', { maximumFractionDigits: 0 })
              }
              sub={lag ? `${pct(ix.chg)} · ${lag}` : pct(ix.chg)}
              color={undefined}
              style={{ maxWidth: 220 }}
            />
          );
        })}
      </View>
      {indices.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <TouchableOpacity onPress={() => go('tools')} activeOpacity={0.7}>
            <Text style={styles.moreLink}>All indices ›</Text>
          </TouchableOpacity>
          <AsOfChip
            ts={indicesAsof}
            source={[indicesWhen, 'delayed · Yahoo'].filter(Boolean).join(' · ')}
          />
        </View>
      ) : null}

      {/* ── Animated market breadth ── */}
      <Card style={{ marginTop: theme.sp.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <SectionTitle>Market breadth · NIFTY 500</SectionTitle>
          {mv?.asof ? (
            <AsOfChip
              ts={mv.asof}
              // The fetch age and the SESSION are different facts, and on a
              // Saturday only one of them is reassuring: quotes pulled five
              // minutes ago that describe Friday.
              source={[moversWhen, 'delayed · NSE'].filter(Boolean).join(' · ')}
            />
          ) : null}
        </View>
        {!mv ? (
          mvFailed ? (
            <EmptyState title="Breadth unavailable" hint="The data feed is busy — retrying automatically. Pull to refresh." />
          ) : (
            <Loading />
          )
        ) : breadth ? (
          <View>
            <View style={styles.breadthNums}>
              <Text style={[styles.breadthN, { color: theme.green }]}>{breadth.up} advancing</Text>
              <Text style={styles.breadthMid}>A/D {breadth.ratio.toFixed(2)}</Text>
              <Text style={[styles.breadthN, { color: theme.red, textAlign: 'right' }]}>
                {breadth.down} declining
              </Text>
            </View>
            <BreadthBar up={breadth.up} flat={breadth.flat} down={breadth.down} />
            <Text style={styles.breadthFoot}>
              {breadth.up >= breadth.down
                ? `Advancers lead — ${((breadth.up / breadth.total) * 100).toFixed(0)}% of the index is green`
                : `Decliners lead — ${((breadth.down / breadth.total) * 100).toFixed(0)}% of the index is red`}
              {breadth.flat ? ` · ${breadth.flat} unchanged` : ''}
            </Text>
          </View>
        ) : (
          <EmptyState title="Breadth unavailable" hint="Constituent quotes are briefly unreachable — pull to refresh." />
        )}
      </Card>

      {/* ── Top gainers / losers (rows open the company profile) ── */}
      <View style={styles.cols}>
        <Card style={styles.col}>
          <SectionTitle>Top gainers{moversWhen ? ` · ${moversWhen}` : ''}</SectionTitle>
          {!mv ? (mvFailed ? <EmptyState title="Unavailable" hint="Feed busy — retrying." /> : <Loading />)
            : gainers.length ? <MoverRows rows={gainers} />
            : <EmptyState title="Gainers unavailable" hint="Pull to refresh." />}
          <ScreenerLink index="NIFTY 500" />
        </Card>
        <Card style={styles.col}>
          <SectionTitle>Top losers{moversWhen ? ` · ${moversWhen}` : ''}</SectionTitle>
          {!mv ? (mvFailed ? <EmptyState title="Unavailable" hint="Feed busy — retrying." /> : <Loading />)
            : losers.length ? <MoverRows rows={losers} />
            : <EmptyState title="Losers unavailable" hint="Pull to refresh." />}
          <ScreenerLink index="NIFTY 500" />
        </Card>
      </View>

      {/* ── NSE + BSE sectors (incl. SME via the whole-universe sweep) ── */}
      <Card style={{ marginTop: theme.sp.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <SectionTitle>Sectors · NSE + BSE{sectors2?.length ? ' · full universe' : ''}</SectionTitle>
        </View>
        {sectorRows.length ? (
          sectorRows.map((sct, i) => (
            <TouchableOpacity
              key={sct.sector}
              style={[styles.srow, i === 0 && { borderTopWidth: 0 }]}
              onPress={() => navigate('screens', { sub: 'heatmap' })}
              activeOpacity={0.7}
            >
              <Text style={styles.sname} numberOfLines={1}>{sct.sector}</Text>
              <View style={styles.sbarWrap}>
                <View
                  style={{
                    width: ((Math.abs(sct.chg ?? 0) / sectorMax) * 100).toFixed(1) + '%' as `${number}%`,
                    height: '100%',
                    borderRadius: 3,
                    backgroundColor: colorOf(sct.chg),
                  }}
                />
              </View>
              {sct.count ? <Text style={styles.scount}>{sct.count}</Text> : null}
              <Text style={[styles.schg, { color: colorOf(sct.chg) }]}>{pct(sct.chg)}</Text>
            </TouchableOpacity>
          ))
        ) : (
          <EmptyState title="Sector data unavailable" hint="The NSE+BSE sector sweep is warming — pull to refresh in a minute." />
        )}
        <ScreenerLink index="SME EMERGE" label="Screen SME Emerge ›" />
      </Card>

      {/* ── The heatmap, moved here off the Screens bar. The bars above rank
          sectors; this maps every index and sector by the day's change, and
          a map belongs on the page you land on rather than three tabs into a
          screening console. ── */}
      <Card style={{ marginTop: theme.sp.lg }}>
        <SectionTitle>Heatmap</SectionTitle>
        <HeatmapScreen embedded />
      </Card>

      {/* ── Index movers, as one slider instead of a card per index ── */}
      <IndexSlider level={indexLevel} />

      {/* ── Index levels, off the old More menu. The strip at the top of every
          page carries a dozen; this is the full board with the day and the
          year beside each, plus global, currency and depository. It belongs on
          the page you land on, not four taps inside a menu. ── */}
      <Card style={{ marginTop: theme.sp.lg }}>
        <SectionTitle>Index levels</SectionTitle>
        <IndicesScreen embedded />
      </Card>

      {/* ── Today's bulk and block deals: who took a large position. A
          market-wide fact, so it sits with the market, not inside a
          per-company lookup. ── */}
      <Card style={{ marginTop: theme.sp.lg }}>
        <View style={styles.dealsHead}>
          <SectionTitle>Bulk &amp; block deals</SectionTitle>
          <Text style={styles.dealsNote}>latest session · NSE</Text>
        </View>
        <MarketDeals limit={12} />
      </Card>

      {/* ── G-SEC · Upcoming IPOs · Fixed returns ── */}
      <View style={styles.cols}>
        <Card style={styles.col}>
          <SectionTitle>G-Sec · govt bonds</SectionTitle>
          {!gsec ? (
            <Loading />
          ) : gsecRows.length ? (
            gsecRows.slice(0, 4).map((g, i) => (
              <View key={g.symbol} style={[styles.mrow, i === 0 && { borderTopWidth: 0 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.msym}>{g.symbol}</Text>
                  {g.maturity ? <Text style={styles.subTiny}>{g.maturity}</Text> : null}
                </View>
                <Text style={styles.yld}>{g.yld != null ? g.yld.toFixed(2) + '%' : '—'}</Text>
                <Text style={[styles.mchg, { color: colorOf(g.chg) }]}>{pct(g.chg)}</Text>
              </View>
            ))
          ) : (
            <EmptyState title="G-Sec quotes unavailable" hint={gsec.error ? 'NSE bond feed unreachable — retrying with the next refresh.' : 'No traded G-Secs right now.'} />
          )}
          <Text style={styles.finePrint}>Traded yields from the NSE bond market — not deposit rates.</Text>
        </Card>

        <Card style={styles.col}>
          {/* The server ranks these: closed books dropped, ordered by the day
              they open, OPEN/SOON from the dates. The Desk's corporate
              calendar reads the same ranked rows, so the two cannot disagree
              on screen about which issues are still live. */}
          <SectionTitle>Upcoming IPOs</SectionTitle>
          {!ipos ? (
            <Loading />
          ) : ipos.items.length ? (
            ipos.items.slice(0, 5).map((it, i) => (
              <View key={(it.symbol || it.name) + i} style={[styles.iporow, i === 0 && { borderTopWidth: 0 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.ipoName} numberOfLines={1}>{it.name || it.symbol}</Text>
                  <Text style={styles.subTiny} numberOfLines={1}>
                    {[it.series === 'SME' || /SME|EMERGE/.test(it.series) ? 'SME' : it.series,
                      it.start && it.end ? `${it.start} → ${it.end}` : it.start || it.end,
                      it.price_band ? '₹' + it.price_band.replace(/^₹/, '') : null]
                      .filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <View style={[styles.ipoChip, it.status === 'open' && styles.ipoChipOpen]}>
                  <Text style={[styles.ipoChipTxt, it.status === 'open' && { color: theme.onAccent }]}>
                    {it.status === 'open' ? 'OPEN' : 'SOON'}
                  </Text>
                </View>
              </View>
            ))
          ) : (
            <EmptyState title="No upcoming issues listed" hint={ipos.error ? 'NSE IPO feed unreachable — retrying with the next refresh.' : 'The NSE public-issue calendar is empty right now.'} />
          )}
          <ScreenerLink index="RECENT IPOS" label="Screen recent listings ›" />
        </Card>

        <Card style={styles.col}>
          <SectionTitle>Fixed returns</SectionTitle>
          {!gsec ? (
            <Loading />
          ) : bestYield != null || sgbRows.length ? (
            <View>
              {bestYield != null ? (
                <View style={styles.fixedTop}>
                  <Text style={styles.fixedBig}>{bestYield.toFixed(2)}%</Text>
                  <Text style={styles.fixedLbl}>top traded G-Sec yield — the sovereign risk-free benchmark FDs and liquid funds track</Text>
                </View>
              ) : null}
              {sgbRows.slice(0, 3).map((g, i) => (
                <View key={g.symbol} style={[styles.mrow, i === 0 && bestYield == null && { borderTopWidth: 0 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.msym}>{g.symbol}</Text>
                    <Text style={styles.subTiny}>Sovereign gold bond{g.maturity ? ' · ' + g.maturity : ''}</Text>
                  </View>
                  <Text style={styles.yld}>{g.yld != null ? g.yld.toFixed(1) + '%' : '—'}</Text>
                  <Text style={styles.mprice}>{g.ltp != null ? g.ltp.toFixed(0) : '—'}</Text>
                </View>
              ))}
            </View>
          ) : (
            <EmptyState title="Yields unavailable" hint="Government-security quotes are briefly unreachable." />
          )}
          <Text style={styles.finePrint}>Bank FD / savings-scheme rates vary by institution — compare against these sovereign yields.</Text>
        </Card>
      </View>

        </View>

        {/* The rail: what is yours, not what the market is doing. */}
        <View style={[styles.rail, wide && styles.railWide]}>
          <NewsPanel items={news} busy={newsBusy} onRefresh={refreshNews} onOpen={setArticle} />
          <Card style={{ marginBottom: theme.sp.md }}>
        {/* Social accounts: the user's own feeds, one tap away. */}
          <View style={styles.socialRow}>
            <Text style={styles.socialLbl}>MY FEEDS</Text>
            {social.map((s) => (
              <View key={s.url} style={styles.socialChip}>
                <TouchableOpacity onPress={() => Linking.openURL(s.url).catch(() => {})} activeOpacity={0.7}>
                  <Text style={styles.socialTxt}>{s.label}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => saveSocial(social.filter((x) => x.url !== s.url))}
                  hitSlop={8}
                  activeOpacity={0.7}
                >
                  <Text style={styles.socialX}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={styles.socialChip} onPress={() => setSocialOpen(true)} activeOpacity={0.7}>
              <Text style={styles.socialTxt}>＋ Add</Text>
            </TouchableOpacity>
          </View>

          </Card>
          <PortfolioPanel rows={pfRows} total={pf} mode={chgMode} onToggle={toggleChg} />
          <WatchlistPanel rows={wlRows} mode={chgMode} onToggle={toggleChg} />
        </View>
      </View>


      {/* Add-social sheet */}
      <Modal visible={socialOpen} animationType="fade" transparent onRequestClose={() => setSocialOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setSocialOpen(false)} />
        <View style={styles.miniSheet}>
          <Text style={styles.sheetTitle}>Add a social account</Text>
          <Text style={styles.subTiny}>e.g. an X list, Telegram channel or YouTube page you follow for updates.</Text>
          <TextInput
            style={styles.in}
            value={socLabel}
            onChangeText={setSocLabel}
            placeholder="Label — e.g. X · @markets"
            placeholderTextColor={theme.muted}
          />
          <TextInput
            style={styles.in}
            value={socUrl}
            onChangeText={setSocUrl}
            placeholder="https://…"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
          />
          <TouchableOpacity
            style={styles.sheetBtn}
            onPress={() => {
              const url = socUrl.trim();
              const label = socLabel.trim() || url.replace(/^https?:\/\//, '').slice(0, 24);
              if (/^https?:\/\//.test(url)) {
                saveSocial([...social.filter((s) => s.url !== url), { label, url }]);
                setSocLabel('');
                setSocUrl('');
                setSocialOpen(false);
              }
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.sheetBtnTxt}>Add</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Article popup — read the headline here, leave for the publisher on demand. */}
      {article ? (
        <Modal visible animationType="fade" transparent onRequestClose={() => setArticle(null)}>
          <View style={styles.artWrap}>
            <Pressable
              style={styles.artBackdrop}
              onPress={() => setArticle(null)}
              accessibilityRole="button"
              accessibilityLabel="Close article"
            />
            <View style={styles.artModal}>
              <View style={styles.artHead}>
                <Text style={styles.artSrc} numberOfLines={1}>
                  {article.source}
                  {article.ts
                    ? ' · ' + new Date(article.ts * 1000).toLocaleString('en-IN',
                        { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                    : ''}
                </Text>
                <TouchableOpacity
                  onPress={() => setArticle(null)}
                  hitSlop={10}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <Text style={styles.artX}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.artBody} showsVerticalScrollIndicator>
                <Text style={styles.artTitle}>{article.title}</Text>
                {article.summary ? (
                  <Text style={styles.artSummary}>{article.summary}</Text>
                ) : (
                  <Text style={styles.artNoSummary}>
                    This publisher's feed carries the headline only. Open the full article to read it.
                  </Text>
                )}
                <Text style={styles.artHost} numberOfLines={1}>
                  {article.link.replace(/^https?:\/\//, '').split('/')[0]}
                </Text>
              </ScrollView>
              <TouchableOpacity
                style={styles.artBtn}
                onPress={() => Linking.openURL(article.link).catch(() => {})}
                activeOpacity={0.85}
                accessibilityRole="link"
                accessibilityLabel={`Read the full article at ${article.source}. Opens outside TaurEye.`}
              >
                <Text style={styles.artBtnTxt}>Read full article ↗</Text>
              </TouchableOpacity>
              <Text style={styles.artNote}>
                Opens {article.source} in your browser — you're leaving TaurEye.
              </Text>
            </View>
          </View>
        </Modal>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  dealsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dealsNote: { color: theme.muted, fontSize: theme.fs.xs, fontFamily: theme.mono },
  container: { flex: 1, backgroundColor: theme.bg },
  content: { padding: theme.sp.lg, paddingBottom: 40, maxWidth: 1480, width: '100%', alignSelf: 'center' },
  // One column that becomes two. `alignItems: flex-start` matters: without it
  // the rail stretches to the main column's height and its last card floats in
  // the middle of a very tall empty box.
  page: { flexDirection: 'column' },
  pageWide: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp.lg },
  mainCol: { flex: 1, minWidth: 0 },
  rail: { width: '100%' },
  railWide: { width: 340, flexGrow: 0, flexShrink: 0 },
  headRow: { flexDirection: 'row', alignItems: 'center', marginBottom: theme.sp.md },
  h1: { color: theme.text, fontSize: theme.fs.h1, fontWeight: '700', letterSpacing: 0.2 },
  // Portfolio / Watchlist jump buttons (replace the paper-portfolio card).
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.md },
  moreLink: { color: theme.muted, fontSize: theme.fs.sm, marginTop: theme.sp.md, fontWeight: '600' },
  moreLinkInline: { color: theme.muted, fontSize: theme.fs.sm, fontWeight: '600' },
  cols: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.lg, marginTop: theme.sp.lg },
  col: { flex: 1, minWidth: 300 },
  mrow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    borderTopColor: theme.border,
    borderTopWidth: 1,
    gap: theme.sp.md,
  },
  msym: { flex: 1, color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm + 1, fontWeight: '700' },
  mprice: { color: theme.muted2, fontFamily: theme.mono, fontSize: theme.fs.sm + 1 },
  mchg: { fontFamily: theme.mono, fontSize: theme.fs.sm + 1, minWidth: 76, textAlign: 'right' },
  subTiny: { color: theme.muted, fontSize: theme.fs.xs + 1, marginTop: 2 },
  yld: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.md, fontWeight: '800' },
  breadthNums: { flexDirection: 'row', alignItems: 'center', marginTop: theme.sp.xs },
  breadthN: { flex: 1, fontFamily: theme.mono, fontSize: theme.fs.sm + 1, fontWeight: '700' },
  breadthMid: { flex: 1, color: theme.muted, fontFamily: theme.mono, fontSize: theme.fs.sm, textAlign: 'center' },
  breadthBar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    marginTop: theme.sp.sm,
    backgroundColor: theme.surface2,
  },
  breadthFoot: { color: theme.muted, fontSize: theme.fs.sm, marginTop: theme.sp.sm },
  moodRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: theme.sp.sm },
  moodDot: { width: 8, height: 8, borderRadius: 4 },
  moodTxt: { fontSize: 10, fontFamily: theme.mono, letterSpacing: 1.2, fontWeight: '700' },
  srow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    borderTopColor: theme.border,
    borderTopWidth: 1,
    gap: theme.sp.md,
  },
  sname: { width: 110, color: theme.text, fontSize: theme.fs.sm + 1, fontWeight: '600' },
  sbarWrap: { flex: 1, height: 6, borderRadius: 3, backgroundColor: theme.surface2, overflow: 'hidden' },
  scount: { color: theme.muted, fontFamily: theme.mono, fontSize: theme.fs.xs, minWidth: 34, textAlign: 'right' },
  schg: { fontFamily: theme.mono, fontSize: theme.fs.sm + 1, minWidth: 68, textAlign: 'right' },
  // IPO window
  iporow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.md,
    paddingVertical: 10,
    borderTopColor: theme.border,
    borderTopWidth: 1,
  },
  ipoName: { color: theme.text, fontSize: theme.fs.sm + 1, fontWeight: '700' },
  ipoChip: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  ipoChipOpen: { backgroundColor: theme.green, borderColor: theme.green },
  ipoChipTxt: { color: theme.muted2, fontSize: 9, fontFamily: theme.mono, letterSpacing: 0.8, fontWeight: '700' },
  fixedTop: { marginTop: theme.sp.xs, marginBottom: theme.sp.sm },
  fixedBig: { color: theme.text, fontFamily: theme.mono, fontSize: 30, fontWeight: '800' },
  fixedLbl: { color: theme.muted, fontSize: theme.fs.xs + 1, marginTop: 2, lineHeight: 16 },
  finePrint: { color: theme.muted, fontSize: theme.fs.xs, marginTop: theme.sp.md, lineHeight: 14 },
  // news box: compact, scrolls inside its own frame
  newsRow: { paddingVertical: theme.sp.sm + 1, borderTopColor: theme.border, borderTopWidth: 1 },
  newsTitle: { color: theme.text, fontSize: theme.fs.sm + 1, lineHeight: 19, fontWeight: '600' },
  nmeta: { color: theme.muted, fontSize: theme.fs.xs + 1, marginTop: 2 },
  // article popup: flex-centred overlay (absolute %-inset inside Modal pins to
  // a corner and outgrows the viewport on web — same trap as the heatmap
  // sector popup), with the body capped so long standfirsts scroll.
  artWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.sp.lg },
  artBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)' },
  artModal: {
    width: '94%',
    maxWidth: 560,
    maxHeight: '88%',
    backgroundColor: theme.surface,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.sp.md + 2,
  },
  artHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.sp.sm,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    paddingBottom: theme.sp.sm,
  },
  artSrc: { color: theme.muted2, fontSize: theme.fs.xs + 1, fontFamily: theme.mono, letterSpacing: 0.6, flex: 1 },
  artX: { color: theme.muted, fontSize: theme.fs.md },
  artBody: { flexGrow: 0, flexShrink: 1, marginTop: theme.sp.md },
  artTitle: { color: theme.text, fontSize: theme.fs.lg, lineHeight: 26, fontWeight: '700' },
  artSummary: { color: theme.muted2, fontSize: theme.fs.sm + 1, lineHeight: 21, marginTop: theme.sp.md },
  artNoSummary: {
    color: theme.muted,
    fontSize: theme.fs.sm,
    lineHeight: 19,
    marginTop: theme.sp.md,
    fontStyle: 'italic',
  },
  artHost: { color: theme.muted, fontSize: theme.fs.xs, fontFamily: theme.mono, marginTop: theme.sp.md },
  artBtn: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius.md,
    paddingVertical: theme.sp.sm + 3,
    alignItems: 'center',
    marginTop: theme.sp.md,
  },
  artBtnTxt: { color: theme.onAccent, fontSize: theme.fs.sm + 1, fontWeight: '700' },
  artNote: { color: theme.muted, fontSize: theme.fs.xs, textAlign: 'center', marginTop: theme.sp.sm },
  // social feeds
  // The rule and the top margin separated this from the headline list it used
  // to sit under. It has its own card in the rail now, so both were drawing a
  // divider under nothing.
  socialRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.sp.sm,
  },
  socialLbl: { color: theme.muted, fontSize: 9, fontFamily: theme.mono, letterSpacing: 1 },
  socialChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  socialTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '600' },
  socialX: { color: theme.muted, fontSize: theme.fs.xs + 1 },
  // add-social sheet
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  miniSheet: {
    position: 'absolute',
    top: '24%',
    alignSelf: 'center',
    width: '92%',
    maxWidth: 440,
    backgroundColor: theme.surface,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.sp.lg,
  },
  sheetTitle: { color: theme.text, fontSize: theme.fs.lg, fontWeight: '700', marginBottom: 4 },
  in: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    color: theme.text,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 10,
    fontSize: theme.fs.sm + 1,
    marginTop: theme.sp.md,
  },
  sheetBtn: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    paddingVertical: 11,
    marginTop: theme.sp.md,
  },
  sheetBtnTxt: { color: theme.onAccent, fontWeight: '700', fontSize: theme.fs.md },
});
