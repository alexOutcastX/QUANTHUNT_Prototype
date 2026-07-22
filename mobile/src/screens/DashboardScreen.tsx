import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { API_BASE, HolidaysResp, IndexConstituent, IndexQuote, MoversResp, Quote, api } from '../api';
import { loadWatchlist } from '../watchlist';
import { SimState, loadSim, metrics } from '../paperSim';
import { navigate } from '../navIntent';
import { AsOfChip, Card, EmptyState, Loading, SectionTitle, StatTile } from '../ui';
import { theme } from '../theme';

type NewsItem = { title: string; link: string; source: string; ts: number };
type Mover = { symbol: string; price?: number | null; chg?: number | null };

const pct = (v: number | null | undefined) =>
  v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
const colorOf = (v: number | null | undefined) =>
  v == null ? theme.muted : v >= 0 ? theme.green : theme.red;

// Last-known dashboard snapshot, kept for the app session. Re-entering Today
// paints this instantly (stale-while-revalidate) instead of a page of spinners
// while every card refetches from scratch.
const dash: {
  indices?: IndexQuote[] | null;
  market?: HolidaysResp | null;
  movers?: Mover[] | null;
  mv?: MoversResp | null;
  watch?: { symbol: string; q?: Quote }[] | null;
  news?: NewsItem[] | null;
  sim?: SimState | null;
  simPrices?: Record<string, number>;
} = {};

export default function DashboardScreen({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const [indices, setIndices] = useState<IndexQuote[] | null>(dash.indices ?? null);
  const [indicesAsof, setIndicesAsof] = useState<number | null>(null);
  const [market, setMarket] = useState<HolidaysResp | null>(dash.market ?? null);
  const [movers, setMovers] = useState<Mover[] | null>(dash.movers ?? null);
  // Breadth + gainers/losers now come pre-computed from the server (/movers),
  // which stays populated even when NSE falls back to the symbols-only CSV.
  const [mv, setMv] = useState<MoversResp | null>(dash.mv ?? null);
  const [watch, setWatch] = useState<{ symbol: string; q?: Quote }[] | null>(dash.watch ?? null);
  const [news, setNews] = useState<NewsItem[] | null>(dash.news ?? null);
  // Paper-trading simulator snapshot: virtual account equity + all-time P&L,
  // marked against live prices for the open positions.
  const [sim, setSim] = useState<SimState | null>(dash.sim ?? null);
  const [simPrices, setSimPrices] = useState<Record<string, number>>(dash.simPrices ?? {});
  const [refreshing, setRefreshing] = useState(false);

  // Every card loads independently and in parallel — the old flow awaited
  // watchlist quotes, then news, then the simulator in sequence, so the tail
  // cards waited on whichever earlier call was slow.
  const load = useCallback(async () => {
    api.indices().then((d) => { dash.indices = d.indices; setIndices(d.indices); setIndicesAsof(d.asof ?? null); }).catch(() => setIndices((v) => v ?? []));
    api.holidays().then((d) => { dash.market = d; setMarket(d); }).catch(() => {});
    api
      .indexConstituents('NIFTY 50')
      .then((idx) => {
        const rows = (idx.data || []).filter((r) => r.chg != null);
        rows.sort((a, b) => (b.chg as number) - (a.chg as number));
        const m = [...rows.slice(0, 4), ...rows.slice(-4)];
        dash.movers = m;
        setMovers(m);
      })
      .catch(() => setMovers((v) => v ?? []));
    // Breadth + top gainers/losers, computed server-side over NIFTY 500 (with a
    // resilient quote backfill), so this never blanks on the NSE CSV fallback.
    api
      .movers('NIFTY 500', 6)
      .then((d) => { dash.mv = d; setMv(d); })
      .catch(() => {});
    (async () => {
      try {
        const wl = await loadWatchlist();
        const syms = wl.slice(0, 8);
        if (!syms.length) {
          dash.watch = [];
          setWatch([]);
        } else {
          const q = await api.ltp(syms);
          const w = syms.map((symbol) => ({ symbol, q: q[symbol] }));
          dash.watch = w;
          setWatch(w);
        }
      } catch {
        setWatch((v) => v ?? []);
      }
    })();
    (async () => {
      try {
        const r = await fetch(API_BASE + '/news');
        const d = await r.json();
        const n = ((d.items || []) as NewsItem[]).slice(0, 6);
        dash.news = n;
        setNews(n);
      } catch {
        setNews((v) => v ?? []);
      }
    })();
    (async () => {
      try {
        const s = await loadSim();
        dash.sim = s;
        setSim(s);
        const syms = s.positions.map((p) => p.symbol);
        if (syms.length) {
          const q = await api.ltp(syms);
          const px: Record<string, number> = {};
          for (const sym of syms) {
            const p = q[sym]?.price;
            if (p != null) px[sym] = p;
          }
          dash.simPrices = px;
          setSimPrices(px);
        } else {
          dash.simPrices = {};
          setSimPrices({});
        }
      } catch {
        /* simulator card just shows starting state on failure */
      }
    })();
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  const go = (page: string) => onNavigate?.(page);

  // Breadth + gainers/losers are computed on the server now (see /movers).
  const breadth = mv?.breadth ?? null;
  const gainers: IndexConstituent[] = mv?.gainers ?? [];
  const losers: IndexConstituent[] = mv?.losers ?? [];

  // Sector performance uses the live NSE sector sub-indices from /indices as
  // proxies (NIFTY IT / Auto / Pharma / FMCG / Metal / Energy / Realty / Bank),
  // ranked best→worst by day change. Chosen over per-symbol sector aggregation
  // because it needs zero extra calls and no heavy /scan fan-out.
  const sectors = useMemo(() => {
    const keys = new Set([
      'BANKNIFTY',
      'NIFTYIT',
      'NIFTYAUTO',
      'NIFTYPHARMA',
      'NIFTYFMCG',
      'NIFTYMETAL',
      'NIFTYENERGY',
      'NIFTYREALTY',
    ]);
    return (indices || [])
      .filter((i) => keys.has(i.key) && i.chg != null)
      .slice()
      .sort((a, b) => b.chg - a.chg);
  }, [indices]);

  const simM = sim ? metrics(sim, simPrices) : null;
  const inr = (v: number) =>
    '₹' + Math.round(v).toLocaleString('en-IN');

  const upPct = breadth ? (breadth.up / breadth.total) * 100 : 0;
  const downPct = breadth ? (breadth.down / breadth.total) * 100 : 0;
  const flatPct = Math.max(0, 100 - upPct - downPct);
  const sectorMax = Math.max(1, ...sectors.map((s) => Math.abs(s.chg)));

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
      <View style={styles.headRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.h1}>Markets</Text>
          <Text style={styles.h1sub}>
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </Text>
        </View>
        {market ? (
          <View style={[styles.pill, { borderColor: market.open ? theme.green : theme.border2 }]}>
            <View style={[styles.dot, { backgroundColor: market.open ? theme.green : theme.red }]} />
            <Text style={styles.pillTxt}>{market.open ? 'Market open' : 'Market closed'}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.tiles}>
        {indices.slice(0, 6).map((ix) => (
          <StatTile
            key={ix.key}
            label={ix.name}
            value={ix.level.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            sub={pct(ix.chg)}
            color={undefined}
            style={{ maxWidth: 220 }}
          />
        ))}
      </View>
      {indices.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <TouchableOpacity onPress={() => go('tools')} activeOpacity={0.7}>
            <Text style={styles.moreLink}>All indices ›</Text>
          </TouchableOpacity>
          <AsOfChip ts={indicesAsof} source="delayed · Yahoo" />
        </View>
      ) : null}

      <Card style={{ marginTop: theme.sp.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <SectionTitle>Market breadth · NIFTY 500</SectionTitle>
          {mv?.asof ? <AsOfChip ts={mv.asof} source="delayed · NSE" /> : null}
        </View>
        {!mv ? (
          <Loading />
        ) : breadth ? (
          <View>
            <View style={styles.breadthNums}>
              <Text style={[styles.breadthN, { color: theme.green }]}>{breadth.up} advancing</Text>
              <Text style={styles.breadthMid}>A/D {breadth.ratio.toFixed(2)}</Text>
              <Text style={[styles.breadthN, { color: theme.red, textAlign: 'right' }]}>
                {breadth.down} declining
              </Text>
            </View>
            <View style={styles.breadthBar}>
              <View style={{ width: (upPct.toFixed(2) + '%') as `${number}%`, backgroundColor: theme.green }} />
              <View style={{ width: (flatPct.toFixed(2) + '%') as `${number}%`, backgroundColor: theme.border2 }} />
              <View style={{ width: (downPct.toFixed(2) + '%') as `${number}%`, backgroundColor: theme.red }} />
            </View>
            <Text style={styles.breadthFoot}>
              {upPct >= downPct
                ? `Advancers lead — ${upPct.toFixed(0)}% of the index is green`
                : `Decliners lead — ${downPct.toFixed(0)}% of the index is red`}
              {breadth.flat ? ` · ${breadth.flat} unchanged` : ''}
            </Text>
          </View>
        ) : (
          <EmptyState title="Breadth unavailable" hint="Constituent quotes are briefly unreachable — pull to refresh." />
        )}
      </Card>

      <View style={styles.cols}>
        <Card style={styles.col}>
          <SectionTitle>Top gainers</SectionTitle>
          {!mv ? (
            <Loading />
          ) : gainers.length ? (
            gainers.map((m, i) => (
              <TouchableOpacity
                key={m.symbol}
                style={[styles.mrow, i === 0 && { borderTopWidth: 0 }]}
                onPress={() => go('screener')}
                activeOpacity={0.7}
              >
                <Text style={styles.msym}>{m.symbol}</Text>
                <Text style={styles.mprice}>{m.price != null ? m.price.toFixed(1) : '—'}</Text>
                <Text style={[styles.mchg, { color: colorOf(m.chg) }]}>{pct(m.chg)}</Text>
              </TouchableOpacity>
            ))
          ) : (
            <EmptyState title="Gainers unavailable" hint="Pull to refresh." />
          )}
        </Card>

        <Card style={styles.col}>
          <SectionTitle>Top losers</SectionTitle>
          {!mv ? (
            <Loading />
          ) : losers.length ? (
            losers.map((m, i) => (
              <TouchableOpacity
                key={m.symbol}
                style={[styles.mrow, i === 0 && { borderTopWidth: 0 }]}
                onPress={() => go('screener')}
                activeOpacity={0.7}
              >
                <Text style={styles.msym}>{m.symbol}</Text>
                <Text style={styles.mprice}>{m.price != null ? m.price.toFixed(1) : '—'}</Text>
                <Text style={[styles.mchg, { color: colorOf(m.chg) }]}>{pct(m.chg)}</Text>
              </TouchableOpacity>
            ))
          ) : (
            <EmptyState title="Losers unavailable" hint="Pull to refresh." />
          )}
        </Card>
      </View>

      <Card style={{ marginTop: theme.sp.lg }}>
        <SectionTitle>Sector performance</SectionTitle>
        {sectors.length ? (
          sectors.map((sct, i) => (
            <View key={sct.key} style={[styles.srow, i === 0 && { borderTopWidth: 0 }]}>
              <Text style={styles.sname} numberOfLines={1}>
                {sct.name.replace(/^NIFTY\s*/i, '')}
              </Text>
              <View style={styles.sbarWrap}>
                <View
                  style={{
                    width: ((Math.abs(sct.chg) / sectorMax) * 100).toFixed(1) + '%' as `${number}%`,
                    height: '100%',
                    borderRadius: 3,
                    backgroundColor: colorOf(sct.chg),
                  }}
                />
              </View>
              <Text style={[styles.schg, { color: colorOf(sct.chg) }]}>{pct(sct.chg)}</Text>
            </View>
          ))
        ) : (
          <EmptyState title="Sector data unavailable" hint="Sector indices are briefly unreachable — pull to refresh." />
        )}
      </Card>

      <View style={styles.cols}>
        <Card style={styles.col}>
          <SectionTitle>NIFTY 50 movers</SectionTitle>
          {!movers ? (
            <Loading />
          ) : movers.length ? (
            movers.map((m, i) => (
              <View key={m.symbol} style={[styles.mrow, i === 0 && { borderTopWidth: 0 }]}>
                <Text style={styles.msym}>{m.symbol}</Text>
                <Text style={styles.mprice}>{m.price != null ? m.price.toFixed(1) : '—'}</Text>
                <Text style={[styles.mchg, { color: colorOf(m.chg) }]}>{pct(m.chg)}</Text>
              </View>
            ))
          ) : (
            <EmptyState title="Movers unavailable" hint="Index quotes are briefly unreachable — pull to refresh." />
          )}
          <TouchableOpacity onPress={() => go('screener')} activeOpacity={0.7}>
            <Text style={styles.moreLink}>Open screener ›</Text>
          </TouchableOpacity>
        </Card>

        <Card style={styles.col}>
          <SectionTitle>Your watchlist</SectionTitle>
          {!watch ? (
            <Loading />
          ) : watch.length ? (
            watch.map((w, i) => (
              <View key={w.symbol} style={[styles.mrow, i === 0 && { borderTopWidth: 0 }]}>
                <Text style={styles.msym}>{w.symbol}</Text>
                <Text style={styles.mprice}>{w.q?.price != null ? w.q.price.toFixed(1) : '—'}</Text>
                <Text style={[styles.mchg, { color: colorOf(w.q?.chg) }]}>{pct(w.q?.chg)}</Text>
              </View>
            ))
          ) : (
            <EmptyState
              title="Watchlist is empty"
              hint="Add symbols from the Screener or Lists tab and they'll appear here with live quotes."
            />
          )}
          <TouchableOpacity onPress={() => go('lists')} activeOpacity={0.7}>
            <Text style={styles.moreLink}>Open lists ›</Text>
          </TouchableOpacity>
        </Card>
      </View>

      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => navigate('analysis', { sub: 'paper' })}
        style={{ marginTop: theme.sp.lg }}
      >
        <Card>
          <View style={styles.paperHead}>
            <SectionTitle>Paper portfolio</SectionTitle>
            <Text style={styles.moreLinkInline}>Open ›</Text>
          </View>
          {!simM ? (
            <Loading />
          ) : (
            <View>
              <View style={styles.paperTop}>
                <View>
                  <Text style={styles.paperLabel}>Portfolio value</Text>
                  <Text style={styles.paperEquity}>{inr(simM.equity)}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.paperLabel}>All-time P&amp;L</Text>
                  <Text style={[styles.paperPnl, { color: colorOf(simM.pnl) }]}>
                    {(simM.pnl >= 0 ? '+' : '') + inr(simM.pnl)} ({pct(simM.pnlPct)})
                  </Text>
                </View>
              </View>
              <View style={styles.paperStats}>
                <View style={styles.paperStat}>
                  <Text style={styles.paperStatN}>{inr(sim?.cash ?? 0)}</Text>
                  <Text style={styles.paperStatL}>Cash</Text>
                </View>
                <View style={styles.paperStat}>
                  <Text style={styles.paperStatN}>{inr(simM.invested)}</Text>
                  <Text style={styles.paperStatL}>Invested</Text>
                </View>
                <View style={styles.paperStat}>
                  <Text style={[styles.paperStatN, { color: colorOf(simM.unrealized) }]}>
                    {(simM.unrealized >= 0 ? '+' : '') + inr(simM.unrealized)}
                  </Text>
                  <Text style={styles.paperStatL}>Unrealised</Text>
                </View>
                <View style={styles.paperStat}>
                  <Text style={styles.paperStatN}>{sim?.positions.length ?? 0}</Text>
                  <Text style={styles.paperStatL}>Holdings</Text>
                </View>
              </View>
            </View>
          )}
        </Card>
      </TouchableOpacity>

      <Card style={{ marginTop: theme.sp.lg }}>
        <SectionTitle>Latest market news</SectionTitle>
        {!news ? (
          <Loading />
        ) : news.length ? (
          news.map((n, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.nrow, i === 0 && { borderTopWidth: 0 }]}
              onPress={() => Linking.openURL(n.link).catch(() => {})}
              activeOpacity={0.7}
            >
              <Text style={styles.ntitle} numberOfLines={2}>
                {n.title}
              </Text>
              <Text style={styles.nmeta}>{n.source}</Text>
            </TouchableOpacity>
          ))
        ) : (
          <EmptyState title="No headlines right now" hint="News feeds refresh hourly." />
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  content: { padding: theme.sp.lg, paddingBottom: 40, maxWidth: 1240, width: '100%', alignSelf: 'center' },
  headRow: { flexDirection: 'row', alignItems: 'center', marginBottom: theme.sp.lg },
  h1: { color: theme.text, fontSize: theme.fs.h1, fontWeight: '700', letterSpacing: 0.2 },
  h1sub: { color: theme.muted, fontSize: theme.fs.sm + 1, marginTop: 3 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: theme.surface,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pillTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '600' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.md },
  moreLink: { color: theme.muted, fontSize: theme.fs.sm, marginTop: theme.sp.md, fontWeight: '600' },
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
  srow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    borderTopColor: theme.border,
    borderTopWidth: 1,
    gap: theme.sp.md,
  },
  sname: { width: 96, color: theme.text, fontSize: theme.fs.sm + 1, fontWeight: '600' },
  sbarWrap: { flex: 1, height: 6, borderRadius: 3, backgroundColor: theme.surface2, overflow: 'hidden' },
  schg: { fontFamily: theme.mono, fontSize: theme.fs.sm + 1, minWidth: 68, textAlign: 'right' },
  paperHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  moreLinkInline: { color: theme.muted, fontSize: theme.fs.sm, fontWeight: '600' },
  paperTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginTop: theme.sp.xs },
  paperLabel: { color: theme.muted, fontSize: theme.fs.xs + 1, fontWeight: '600' },
  paperEquity: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.xxl, fontWeight: '800', marginTop: 2 },
  paperPnl: { fontFamily: theme.mono, fontSize: theme.fs.md, fontWeight: '800', marginTop: 2 },
  paperStats: {
    flexDirection: 'row',
    marginTop: theme.sp.md,
    borderTopColor: theme.border,
    borderTopWidth: 1,
    paddingTop: theme.sp.md,
  },
  paperStat: { flex: 1 },
  paperStatN: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm + 1, fontWeight: '700' },
  paperStatL: { color: theme.muted, fontSize: theme.fs.xs, marginTop: 2 },
  nrow: { paddingVertical: 12, borderTopColor: theme.border, borderTopWidth: 1 },
  ntitle: { color: theme.text, fontSize: theme.fs.md, lineHeight: 20 },
  nmeta: { color: theme.muted, fontSize: theme.fs.xs + 1, marginTop: 4 },
});
