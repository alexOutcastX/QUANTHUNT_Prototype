// The Symbol atom — ONE page per stock, the app's centre of gravity.
//
// Before this screen, "tell me about RELIANCE" had four different answers
// (momentum analyser, multibagger analyser, pattern scanner, dossier), each
// with its own search, layout and export. Every row/card/palette hit now lands
// here instead: a sticky verdict spine (identity · live price · freshness) over
// sliding tabs that compose the existing per-symbol panels, with ONE action row
// and ONE consolidated PDF export. The heavyweight dossier remains one tap away.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ChartPatternsResp,
  ChecklistResp,
  ScanRow,
  StrategyScoresResp,
  TimeframesResp,
  api,
} from '../api';
import ChecklistPanel from '../components/ChecklistPanel';
import StockDetail from '../components/StockDetail';
import StrategyScores from '../components/StrategyScores';
import SymbolInput from '../components/SymbolInput';
import TimeframePanel from '../components/TimeframePanel';
import { Icon } from '../icons';
import { crore, pct, price } from '../format';
import { navigate, subscribeNav, takeSymbol } from '../navIntent';
import { exportSymbolPdf } from '../pdfSymbol';
import { Row } from '../screener';
import { AsOfChip, Card, EmptyState, IconChip, Skeleton, SlidingTabs } from '../ui';
import { addSymbol, loadWatchlist, normSymbol, removeSymbol } from '../watchlist';
import { theme } from '../theme';

const RECENT_KEY = 'taureye.stock.recent';
type Tab = 'overview' | 'technicals' | 'fundamentals' | 'patterns';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'technicals', label: 'Technicals' },
  { key: 'fundamentals', label: 'Fundamentals' },
  { key: 'patterns', label: 'Patterns' },
];

export default function StockScreen() {
  const [sym, setSym] = useState('');
  const [active, setActive] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [recent, setRecent] = useState<string[]>([]);
  const [watch, setWatch] = useState<string[]>([]);
  const [detail, setDetail] = useState<Row | null>(null);

  // Spine data — one cheap scan row + one fundamentals row.
  const [scan, setScan] = useState<ScanRow | null>(null);
  const [scanTs, setScanTs] = useState(0);
  const [meta, setMeta] = useState<{ name?: string; sector?: string | null; mcap?: number | null }>({});
  const [spineLoading, setSpineLoading] = useState(false);
  const token = useRef(0);

  // Patterns tab data (the other tabs' panels fetch for themselves).
  const [pat, setPat] = useState<ChartPatternsResp | null | 'loading'>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    loadWatchlist().then(setWatch).catch(() => {});
    AsyncStorage.getItem(RECENT_KEY)
      .then((v) => {
        const arr = v ? (JSON.parse(v) as string[]) : [];
        if (Array.isArray(arr)) setRecent(arr.slice(0, 8));
      })
      .catch(() => {});
    const s = takeSymbol('stock');
    if (s) run(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Later cross-screen jumps while this tab stays mounted.
  useEffect(
    () =>
      subscribeNav(() => {
        const s = takeSymbol('stock');
        if (s) run(s);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const run = useCallback((raw?: string) => {
    const q = (raw ?? '').trim().toUpperCase().replace(/^[A-Z]+:/, '');
    if (!q) return;
    const my = ++token.current;
    setActive(q);
    setSym(q);
    setTab('overview');
    setScan(null);
    setMeta({});
    setPat(null);
    setSpineLoading(true);
    setRecent((prev) => {
      const next = [q, ...prev.filter((x) => x !== q)].slice(0, 8);
      AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
    api
      .scan([q])
      .then((r) => {
        if (token.current !== my) return;
        setScan(r.data[q] || null);
        setScanTs(Math.floor(Date.now() / 1000));
      })
      .catch(() => {})
      .finally(() => token.current === my && setSpineLoading(false));
    api
      .fundamentalsBulk([q])
      .then((r) => {
        if (token.current !== my) return;
        const f = r.data?.[q] as Record<string, unknown> | undefined;
        if (f) {
          setMeta({
            name: (f.name as string) || (f.longName as string) || undefined,
            sector: (f.sector as string) ?? null,
            mcap: typeof f.market_cap_cr === 'number' ? (f.market_cap_cr as number) : null,
          });
        }
      })
      .catch(() => {});
  }, []);

  // Patterns tab lazy-load.
  useEffect(() => {
    if (tab !== 'patterns' || !active || pat) return;
    setPat('loading');
    api
      .chartPatterns(active)
      .then((r) => setPat(r))
      .catch(() => setPat({ symbol: active, count: 0, patterns: [], current: null, error: 'Pattern scan unavailable right now.' }));
  }, [tab, active, pat]);

  const watched = active ? watch.includes(normSymbol(active)) : false;
  const toggleWatch = async () => {
    if (!active) return;
    if (watched) setWatch(await removeSymbol(watch, normSymbol(active)));
    else setWatch(await addSymbol(watch, active));
  };

  const onExport = async () => {
    if (!active || exporting) return;
    setExporting(true);
    try {
      const [tf, strat, chk] = await Promise.all([
        api.timeframes(active).catch(() => null as TimeframesResp | null),
        api.strategyScores(active).catch(() => null as StrategyScoresResp | null),
        api.checklist(active).catch(() => null as ChecklistResp | null),
      ]);
      exportSymbolPdf(active, meta.name || null, scan, tf, strat, chk);
    } finally {
      setExporting(false);
    }
  };

  const chg = scan?.chg ?? null;
  const chgColor = chg == null ? theme.muted : chg >= 0 ? theme.green : theme.red;

  return (
    <View style={s.container}>
      {/* Search-first landing */}
      <View style={s.searchRow}>
        <SymbolInput
          value={sym}
          onChangeText={setSym}
          onSelect={(v) => run(v)}
          onSubmit={() => run(sym)}
          placeholder="Search any NSE / BSE symbol…"
          inputStyle={s.input}
          containerStyle={{ flex: 1 }}
        />
      </View>

      {!active ? (
        <ScrollView contentContainerStyle={s.landing}>
          {recent.length ? (
            <>
              <Text style={s.recentLabel}>RECENT</Text>
              <View style={s.recentRow}>
                {recent.map((r) => (
                  <TouchableOpacity key={r} style={s.recentChip} onPress={() => run(r)} activeOpacity={0.75}>
                    <Text style={s.recentTxt}>{r}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          ) : null}
          <EmptyState
            icon="◈"
            title="One page per stock"
            hint="Everything about a symbol in one place — live read, multi-timeframe technicals, fundamentals and chart patterns. Search above, or tap any stock anywhere in the app."
          />
        </ScrollView>
      ) : (
        <>
          {/* Verdict spine — sticky identity + live read */}
          <View style={s.spine}>
            <View style={s.spineTop}>
              <View style={{ flex: 1 }}>
                <View style={s.symRow}>
                  <Text style={s.sym}>{active}</Text>
                  {meta.sector ? (
                    <View style={s.secChip}>
                      <Text style={s.secChipTxt} numberOfLines={1}>{meta.sector}</Text>
                    </View>
                  ) : null}
                </View>
                {meta.name ? <Text style={s.name} numberOfLines={1}>{meta.name}</Text> : null}
              </View>
              <View style={s.priceBox}>
                {spineLoading && !scan ? (
                  <Skeleton variant="rows" rows={1} style={{ width: 110 }} />
                ) : (
                  <>
                    <Text style={[s.price, theme.numCell]}>{price(scan?.price)}</Text>
                    <Text style={[s.chg, theme.numCell, { color: chgColor }]}>{pct(chg)}</Text>
                  </>
                )}
              </View>
            </View>
            <View style={s.spineMeta}>
              {meta.mcap != null ? <Text style={[s.metaTxt, theme.numCell]}>{crore(meta.mcap)}</Text> : null}
              {scan?.rsi != null ? <Text style={[s.metaTxt, theme.numCell]}>RSI {scan.rsi.toFixed(0)}</Text> : null}
              {scan?.d200 != null ? (
                <Text style={[s.metaTxt, theme.numCell, { color: scan.d200 >= 0 ? theme.green : theme.red }]}>
                  200DMA {pct(scan.d200, 1)}
                </Text>
              ) : null}
              {scan?.ret_1w != null ? (
                <Text style={[s.metaTxt, theme.numCell, { color: scan.ret_1w >= 0 ? theme.green : theme.red }]}>
                  1W {pct(scan.ret_1w, 1)}
                </Text>
              ) : null}
              {scan?.ret_1m != null ? (
                <Text style={[s.metaTxt, theme.numCell, { color: scan.ret_1m >= 0 ? theme.green : theme.red }]}>
                  1M {pct(scan.ret_1m, 1)}
                </Text>
              ) : null}
              <AsOfChip ts={scanTs || null} source="NSE/Yahoo" style={{ marginLeft: 'auto' }} />
            </View>
            {/* THE action row — identical everywhere this stock appears */}
            <View style={s.actions}>
              <IconChip icon={watched ? 'watchFilled' : 'watch'} label={watched ? 'Watching' : 'Watch'} on={watched} onPress={toggleWatch} />
              <IconChip icon="chart" label="Chart" onPress={() => setDetail({ sym: active, name: meta.name || active, price: scan?.price ?? null, chg } as Row)} />
              <IconChip icon="landmark" label="Dossier" onPress={() => navigate('analysis', { sub: 'inst', symbol: active })} />
              <IconChip icon="export" label={exporting ? 'Exporting…' : 'Export PDF'} onPress={onExport} disabled={exporting} />
            </View>
          </View>

          <SlidingTabs items={TABS} value={tab} onChange={setTab} />

          <ScrollView contentContainerStyle={s.body} key={tab}>
            {tab === 'overview' ? (
              <>
                <Card><StrategyScores symbol={active} /></Card>
                <Card>
                  <Text style={s.cardTitle}>KEY LEVELS</Text>
                  <View style={s.kvGrid}>
                    <KV k="52-week high" v={price(scan?.high52)} />
                    <KV k="52-week low" v={price(scan?.low52)} />
                    <KV k="From high" v={pct(scan?.pct_from_high)} color={theme.red} />
                    <KV k="Pivot R1" v={price(scan?.r1)} />
                    <KV k="Pivot S1" v={price(scan?.s1)} />
                    <KV k="Rel. volume" v={scan?.relvol != null ? scan.relvol.toFixed(2) + 'x' : '—'} />
                  </View>
                </Card>
              </>
            ) : null}
            {tab === 'technicals' ? (
              <Card><TimeframePanel symbol={active} /></Card>
            ) : null}
            {tab === 'fundamentals' ? (
              <Card><ChecklistPanel symbol={active} /></Card>
            ) : null}
            {tab === 'patterns' ? (
              pat === 'loading' || pat === null ? (
                <Card><Skeleton variant="card" /></Card>
              ) : (
                <PatternsBlock data={pat} />
              )
            ) : null}
            <Text style={s.disc}>Research, not investment advice. Data aggregated from public market sources.</Text>
          </ScrollView>
        </>
      )}

      {detail ? <StockDetail row={detail} onClose={() => setDetail(null)} /> : null}
    </View>
  );
}

function KV({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <View style={s.kv}>
      <Text style={s.kvK}>{k}</Text>
      <Text style={[s.kvV, theme.numCell, color ? { color } : null]}>{v}</Text>
    </View>
  );
}

function PatternsBlock({ data }: { data: ChartPatternsResp }) {
  const cur = data.current;
  const biasColor = (b: string) => (/bull/i.test(b) ? theme.green : /bear/i.test(b) ? theme.red : theme.muted2);
  if (!data.patterns?.length && !cur) {
    return <Card><EmptyState icon="◇" title="No classic patterns detected" hint="Nothing matching the 22-formation library in the recent price action." /></Card>;
  }
  return (
    <>
      {cur ? (
        <Card style={{ borderColor: biasColor(cur.bias) }}>
          <Text style={s.cardTitle}>CURRENT PATTERN</Text>
          <Text style={s.patTitle}>{cur.label}</Text>
          <Text style={[s.patBias, { color: biasColor(cur.bias) }]}>
            {cur.bias.toUpperCase()} · {cur.status} · fit {cur.confidence}% · follow-through {cur.continuation}%
          </Text>
          <View style={s.kvGrid}>
            {cur.target != null ? <KV k="Target" v={price(cur.target)} /> : null}
            {cur.level != null ? <KV k="Key level" v={price(cur.level)} /> : null}
            <KV k="Move" v={pct(cur.expansion_pct)} color={cur.expansion_pct >= 0 ? theme.green : theme.red} />
          </View>
          <TouchableOpacity
            style={s.patLink}
            onPress={() => navigate('analysis', { sub: 'patterns', symbol: data.symbol })}
            activeOpacity={0.75}
          >
            <Text style={s.patLinkTxt}>Full pattern scanner</Text>
            <Icon name="chevronRight" size={13} color={theme.brand} />
          </TouchableOpacity>
        </Card>
      ) : null}
      {data.patterns?.length ? (
        <Card>
          <Text style={s.cardTitle}>HISTORY</Text>
          {data.patterns.slice(0, 8).map((p, i) => (
            <View key={i} style={s.patRow}>
              <Text style={[s.patRowBias, { color: biasColor(p.bias) }]}>{/bull/i.test(p.bias) ? '▲' : /bear/i.test(p.bias) ? '▼' : '◆'}</Text>
              <Text style={s.patRowLabel} numberOfLines={1}>{p.label}</Text>
              <Text style={[s.patRowPct, theme.numCell, { color: p.expansion_pct >= 0 ? theme.green : theme.red }]}>{pct(p.expansion_pct, 1)}</Text>
            </View>
          ))}
        </Card>
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  searchRow: { paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.md, paddingBottom: theme.sp.sm, zIndex: 50 },
  input: {
    backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1,
    borderRadius: theme.radius.md, color: theme.text,
    paddingHorizontal: theme.sp.md, paddingVertical: theme.sp.sm + 2, fontSize: theme.fs.md,
  },
  landing: { paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.sm },
  recentLabel: { color: theme.muted, fontSize: theme.fs.xs, fontWeight: '700', letterSpacing: 1, marginBottom: theme.sp.sm },
  recentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm },
  recentChip: {
    backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1,
    borderRadius: 999, paddingHorizontal: theme.sp.md, paddingVertical: 5,
  },
  recentTxt: { color: theme.muted2, fontFamily: theme.mono, fontSize: theme.fs.sm },

  spine: {
    paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.sm, gap: theme.sp.sm,
    backgroundColor: theme.bg,
  },
  spineTop: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp.md },
  symRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, flexWrap: 'wrap' },
  sym: { color: theme.text, fontFamily: theme.mono, fontWeight: '800', fontSize: theme.fs.xl },
  secChip: {
    borderColor: theme.border2, borderWidth: 1, borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 1, maxWidth: 180,
  },
  secChipTxt: { color: theme.muted2, fontSize: theme.fs.xs + 1 },
  name: { color: theme.muted, fontSize: theme.fs.sm, marginTop: 2 },
  priceBox: { alignItems: 'flex-end' },
  price: { color: theme.text, fontWeight: '800', fontSize: theme.fs.xl },
  chg: { fontSize: theme.fs.sm + 1, fontWeight: '700', marginTop: 1 },
  spineMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.sp.md },
  metaTxt: { color: theme.muted2, fontSize: theme.fs.xs + 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm },

  body: { padding: theme.sp.lg, gap: theme.sp.md },
  cardTitle: { color: theme.muted, fontSize: theme.fs.xs, fontWeight: '800', letterSpacing: 1.2, marginBottom: theme.sp.sm },
  kvGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  kv: { width: '33.33%', paddingVertical: theme.sp.sm },
  kvK: { color: theme.muted, fontSize: theme.fs.xs, letterSpacing: 0.4, marginBottom: 2 },
  kvV: { color: theme.text, fontSize: theme.fs.sm + 1, fontWeight: '700' },
  patTitle: { color: theme.text, fontSize: theme.fs.lg, fontWeight: '800' },
  patBias: { fontSize: theme.fs.sm, fontWeight: '700', marginTop: 2, marginBottom: theme.sp.sm },
  patLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: theme.sp.sm, alignSelf: 'flex-start' },
  patLinkTxt: { color: theme.brand, fontSize: theme.fs.sm, fontWeight: '700' },
  patRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, paddingVertical: 6, borderBottomColor: theme.border, borderBottomWidth: 1 },
  patRowBias: { fontSize: theme.fs.sm, width: 16, textAlign: 'center' },
  patRowLabel: { color: theme.text, fontSize: theme.fs.sm, flex: 1 },
  patRowPct: { fontSize: theme.fs.sm, fontWeight: '700' },
  disc: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 15, paddingBottom: theme.sp.xl },
});
