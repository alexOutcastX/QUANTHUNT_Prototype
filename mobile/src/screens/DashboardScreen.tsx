import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { API_BASE, HolidaysResp, IndexConstituent, IndexQuote, Quote, api } from '../api';
import { loadWatchlist } from '../watchlist';
import { Card, EmptyState, Loading, SectionTitle, StatTile } from '../ui';
import { theme } from '../theme';

type NewsItem = { title: string; link: string; source: string; ts: number };
type Mover = { symbol: string; price?: number | null; chg?: number | null };

const pct = (v: number | null | undefined) =>
  v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
const colorOf = (v: number | null | undefined) =>
  v == null ? theme.muted : v >= 0 ? theme.green : theme.red;

export default function DashboardScreen({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const [indices, setIndices] = useState<IndexQuote[] | null>(null);
  const [market, setMarket] = useState<HolidaysResp | null>(null);
  const [movers, setMovers] = useState<Mover[] | null>(null);
  // Broad universe (NIFTY 500) powers breadth + gainers/losers — one extra fetch.
  const [broad, setBroad] = useState<IndexConstituent[] | null>(null);
  const [watch, setWatch] = useState<{ symbol: string; q?: Quote }[] | null>(null);
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    api.indices().then((d) => setIndices(d.indices)).catch(() => setIndices([]));
    api.holidays().then(setMarket).catch(() => {});
    api
      .indexConstituents('NIFTY 50')
      .then((idx) => {
        const rows = (idx.data || []).filter((r) => r.chg != null);
        rows.sort((a, b) => (b.chg as number) - (a.chg as number));
        setMovers([...rows.slice(0, 4), ...rows.slice(-4)]);
      })
      .catch(() => setMovers([]));
    // Broad breadth universe — NIFTY 500 carries per-symbol chg/volume when the
    // NSE feed is live; keep only rows with a real % change (CSV fallback → empty).
    api
      .indexConstituents('NIFTY 500')
      .then((idx) => setBroad((idx.data || []).filter((r) => r.chg != null)))
      .catch(() => setBroad([]));
    try {
      const wl = await loadWatchlist();
      const syms = wl.slice(0, 8);
      if (!syms.length) setWatch([]);
      else {
        const q = await api.ltp(syms);
        setWatch(syms.map((symbol) => ({ symbol, q: q[symbol] })));
      }
    } catch {
      setWatch([]);
    }
    try {
      const r = await fetch(API_BASE + '/news');
      const d = await r.json();
      setNews(((d.items || []) as NewsItem[]).slice(0, 6));
    } catch {
      setNews([]);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  const go = (page: string) => onNavigate?.(page);

  // Advance/decline breadth from the broad universe.
  const breadth = useMemo(() => {
    const rows = broad || [];
    let up = 0,
      down = 0,
      flat = 0;
    for (const r of rows) {
      const c = r.chg as number;
      if (c > 0) up++;
      else if (c < 0) down++;
      else flat++;
    }
    const total = rows.length || 1;
    return { up, down, flat, total, ratio: down ? up / down : up };
  }, [broad]);

  // Top gainers / losers from the broad universe, skipping obviously illiquid
  // rows when volume is reported.
  const liquid = useMemo(
    () => (broad || []).filter((r) => r.chg != null && (r.volume == null || r.volume > 10000)),
    [broad],
  );
  const gainers = useMemo(
    () => [...liquid].sort((a, b) => (b.chg as number) - (a.chg as number)).slice(0, 6),
    [liquid],
  );
  const losers = useMemo(
    () => [...liquid].sort((a, b) => (a.chg as number) - (b.chg as number)).slice(0, 6),
    [liquid],
  );

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

  const upPct = (breadth.up / breadth.total) * 100;
  const downPct = (breadth.down / breadth.total) * 100;
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
        <TouchableOpacity onPress={() => go('tools')} activeOpacity={0.7}>
          <Text style={styles.moreLink}>All indices ›</Text>
        </TouchableOpacity>
      ) : null}

      <Card style={{ marginTop: theme.sp.lg }}>
        <SectionTitle>Market breadth · NIFTY 500</SectionTitle>
        {!broad ? (
          <Loading />
        ) : broad.length ? (
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
          {!broad ? (
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
          {!broad ? (
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
  nrow: { paddingVertical: 12, borderTopColor: theme.border, borderTopWidth: 1 },
  ntitle: { color: theme.text, fontSize: theme.fs.md, lineHeight: 20 },
  nmeta: { color: theme.muted, fontSize: theme.fs.xs + 1, marginTop: 4 },
});
