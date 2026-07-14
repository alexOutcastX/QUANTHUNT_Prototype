import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { api } from '../api';
import StockDetail from '../components/StockDetail';
import { MomentumRead, SETUP_LABEL, SetupKind, classify } from '../momentum';
import { Row } from '../screener';
import { loadNames } from './ScreenerScreen';
import { addSymbol, loadWatchlist, normSymbol, removeSymbol } from '../watchlist';
import { EmptyState, Loading, ScreenTitle } from '../ui';
import { theme } from '../theme';

const GOLD = '#f5c518';

const INDICES = [
  'NIFTY 50', 'NIFTY 100', 'NIFTY BANK', 'NIFTY IT', 'NIFTY AUTO',
  'NIFTY PHARMA', 'NIFTY FMCG', 'NIFTY METAL', 'NIFTY MIDCAP 100',
  'NIFTY SMALLCAP 100',
];

const SETUP_FILTERS: { key: 'all' | SetupKind; label: string }[] = [
  { key: 'all', label: 'All setups' },
  { key: 'breakout', label: '⚡ Breakout watch' },
  { key: 'fired', label: '🔥 Breakout fired' },
  { key: 'pullback', label: '↩ Pullback reversal' },
];

const setupColor = (s: SetupKind) =>
  s === 'fired' ? theme.green : s === 'breakout' ? GOLD : theme.accent;

const pct = (v: number | null | undefined, d = 1) =>
  v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + '%';
const fmtIN = (v: number | null | undefined) =>
  v == null || !isFinite(v)
    ? '—'
    : v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Hit = { row: Row; read: MomentumRead };

export default function MomentumScreen() {
  const [indexName, setIndexName] = useState('NIFTY 100');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [setupFilter, setSetupFilter] = useState<'all' | SetupKind>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const [watch, setWatch] = useState<string[]>([]);

  useEffect(() => {
    loadWatchlist().then(setWatch);
  }, []);

  // Load index constituents + streamed technicals (same pipeline as the
  // Screener); classification happens per render over whatever has arrived.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setRows([]);
    setExpanded(null);
    (async () => {
      try {
        const [idx, names] = await Promise.all([api.indexConstituents(indexName), loadNames()]);
        if (cancelled) return;
        const cons = (idx.data || []).filter((c) => c.symbol);
        if (!cons.length) {
          setNote(idx.error || 'No constituents returned.');
          setLoading(false);
          return;
        }
        const seeded: Row[] = cons.map((c) => ({
          sym: c.symbol,
          name: names[c.symbol.toUpperCase()]?.name,
          exchange: names[c.symbol.toUpperCase()]?.exchange || 'NSE',
          price: c.price, prevClose: c.prevClose, chg: c.chg, absChg: c.absChg, volume: c.volume,
        }));
        setRows(seeded);
        setLoading(false);
        const syms = seeded.map((r) => r.sym);
        setNote(`scanning ${syms.length} stocks…`);
        await api.scan(syms, {
          onBatch: (data, done) => {
            if (cancelled) return;
            setRows((prev) => prev.map((r) => (data[r.sym] ? { ...r, ...data[r.sym], price: r.price ?? data[r.sym].price, chg: r.chg ?? data[r.sym].chg, volume: r.volume ?? data[r.sym].volume } : r)));
            setNote(`technicals ${Math.min(done, syms.length)}/${syms.length}`);
          },
        });
        if (!cancelled) setNote(`${syms.length} stocks scanned`);
      } catch (e) {
        if (!cancelled) {
          setNote(e instanceof Error ? e.message : 'Failed to load');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [indexName]);

  const hits = useMemo<Hit[]>(() => {
    const out: Hit[] = [];
    rows.forEach((row) => {
      const read = classify(row);
      if (read && (setupFilter === 'all' || read.setup === setupFilter)) out.push({ row, read });
    });
    return out.sort((a, b) => b.read.score - a.read.score);
  }, [rows, setupFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { breakout: 0, fired: 0, pullback: 0 };
    rows.forEach((row) => {
      const read = classify(row);
      if (read) c[read.setup]++;
    });
    return c;
  }, [rows]);

  const isWatched = (sym: string) => watch.includes(normSymbol(sym));
  const toggleWatch = async (row: Row) => {
    if (isWatched(row.sym)) setWatch(await removeSymbol(watch, normSymbol(row.sym)));
    else setWatch(await addSymbol(watch, row.sym));
  };

  return (
    <View style={styles.container}>
      <ScreenTitle
        title="Momentum radar"
        sub="Stocks setting up to break out or reverse a pullback · technical score + follow-through probability"
      />
      <View style={styles.chipsRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsInner}>
          {INDICES.map((idx) => (
            <TouchableOpacity
              key={idx}
              style={[styles.chip, idx === indexName && styles.chipOn]}
              onPress={() => setIndexName(idx)}
              activeOpacity={0.75}
            >
              <Text style={[styles.chipTxt, idx === indexName && styles.chipTxtOn]}>{idx.replace('NIFTY ', '')}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
      <View style={styles.chipsRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsInner}>
          {SETUP_FILTERS.map((f) => {
            const count =
              f.key === 'all'
                ? counts.breakout + counts.fired + counts.pullback
                : counts[f.key] || 0;
            return (
              <TouchableOpacity
                key={f.key}
                style={[styles.chip, setupFilter === f.key && styles.chipOn]}
                onPress={() => setSetupFilter(f.key)}
                activeOpacity={0.75}
              >
                <Text style={[styles.chipTxt, setupFilter === f.key && styles.chipTxtOn]}>
                  {f.label} ({count})
                </Text>
              </TouchableOpacity>
            );
          })}
          <Text style={styles.note} numberOfLines={1}>{note} · tap a row for the technical read</Text>
        </ScrollView>
      </View>

      <ScrollView style={{ flex: 1 }}>
        {loading ? <Loading label={`Loading ${indexName}…`} /> : null}
        {!loading && !hits.length ? (
          <EmptyState
            icon="◇"
            title="No qualifying setups right now"
            hint="Setups appear as technicals stream in. Try another index, or check back — compression and pullback windows come and go."
          />
        ) : null}

        {hits.length ? (
          <View style={styles.headerRow}>
            <Text style={[styles.th, { width: 96 }]}>SYMBOL</Text>
            <Text style={[styles.th, { flex: 3, minWidth: 170 }]}>NAME</Text>
            <Text style={[styles.th, { width: 150 }]}>SETUP</Text>
            <Text style={[styles.thR, { width: 56 }]}>SCORE</Text>
            <Text style={[styles.thR, { width: 56 }]}>PROB</Text>
            <Text style={[styles.thR, { width: 96 }]}>LTP</Text>
            <Text style={[styles.thR, { width: 70 }]}>% CHG</Text>
            <Text style={[styles.thR, { width: 48 }]}>RSI</Text>
            <Text style={[styles.thR, { width: 60 }]}>RVOL</Text>
            <Text style={[styles.thR, { width: 80 }]}>VS 200DMA</Text>
            <Text style={[styles.thR, { width: 70 }]}>52W HI</Text>
            <Text style={[styles.th, { width: 110, textAlign: 'center' }]}>ACTIONS</Text>
          </View>
        ) : null}

        {hits.map(({ row, read }) => {
          const open = expanded === row.sym;
          const c = setupColor(read.setup);
          return (
            <View key={row.sym}>
              <TouchableOpacity
                style={styles.dataRow}
                onPress={() => setExpanded(open ? null : row.sym)}
                activeOpacity={0.8}
              >
                <Text style={[styles.sym, { width: 96 }]}>{row.sym}</Text>
                <Text style={[styles.name, { flex: 3, minWidth: 170 }]} numberOfLines={1}>{row.name || '—'}</Text>
                <View style={{ width: 150 }}>
                  <Text style={[styles.setupBadge, { color: c, borderColor: c }]}>{SETUP_LABEL[read.setup]}</Text>
                </View>
                <Text style={[styles.cellR, { width: 56, color: c, fontWeight: '700' }]}>{read.score}</Text>
                <Text style={[styles.cellR, { width: 56 }]}>{read.probability}%</Text>
                <Text style={[styles.cellR, { width: 96, fontWeight: '700' }]}>{fmtIN(row.price)}</Text>
                <Text style={[styles.cellR, { width: 70, color: (row.chg ?? 0) >= 0 ? theme.green : theme.red }]}>{pct(row.chg, 2)}</Text>
                <Text style={[styles.cellR, { width: 48 }]}>{row.rsi != null ? row.rsi.toFixed(0) : '—'}</Text>
                <Text style={[styles.cellR, { width: 60 }]}>{row.relvol != null ? row.relvol.toFixed(2) + 'x' : '—'}</Text>
                <Text style={[styles.cellR, { width: 80, color: (row.d200 ?? 0) >= 0 ? theme.green : theme.red }]}>{pct(row.d200)}</Text>
                <Text style={[styles.cellR, { width: 70, color: theme.red }]}>{pct(row.pct_from_high)}</Text>
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.aBtn} onPress={() => setDetail(row)} activeOpacity={0.75}>
                    <Text style={styles.aTxt}>Chart</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.aBtn} onPress={() => toggleWatch(row)} activeOpacity={0.75}>
                    <Text style={[styles.aTxt, isWatched(row.sym) && { color: theme.green }]}>
                      {isWatched(row.sym) ? '★' : '☆'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
              {open ? (
                <View style={styles.readBox}>
                  <View style={styles.probTrack}>
                    <View style={[styles.probFill, { width: `${read.probability}%`, backgroundColor: c }]} />
                  </View>
                  <Text style={styles.readMeta}>
                    Technical score {read.score}/100 · indicative follow-through probability {read.probability}%
                  </Text>
                  {read.signals.map((s) => (
                    <Text key={s} style={styles.sigTxt}>▲ <Text style={styles.sigBody}>{s}</Text></Text>
                  ))}
                  {read.cautions.map((s) => (
                    <Text key={s} style={styles.cauTxt}>▼ <Text style={styles.sigBody}>{s}</Text></Text>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}

        {hits.length ? (
          <Text style={styles.method}>
            Setups: BREAKOUT WATCH — TTM squeeze compression near the 52-week high with volume building;
            BREAKOUT FIRED — squeeze release / fresh high / Camarilla break on the latest bar;
            PULLBACK REVERSAL — orderly dip to support inside an intact uptrend with washed-out oscillators.
            Probability is an indicative base-rate heuristic, not a forecast. For information only — not investment advice.
          </Text>
        ) : null}
      </ScrollView>

      {detail ? <StockDetail row={detail} onClose={() => setDetail(null)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  chipsRow: { paddingBottom: theme.sp.sm },
  chipsInner: { paddingHorizontal: theme.sp.lg, gap: theme.sp.sm, alignItems: 'center' },
  chip: {
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 6,
  },
  chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipTxt: { color: theme.muted2, fontSize: theme.fs.sm },
  chipTxtOn: { color: theme.onAccent, fontWeight: '700' },
  note: { color: theme.muted, fontSize: theme.fs.sm, marginLeft: theme.sp.sm },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface2,
    borderBottomColor: theme.border2,
    borderBottomWidth: 1,
    paddingVertical: theme.sp.sm,
    paddingHorizontal: theme.sp.xs,
  },
  th: { color: theme.muted2, fontSize: theme.fs.xs + 1, fontWeight: '600', letterSpacing: 0.5, paddingHorizontal: theme.sp.xs },
  thR: { color: theme.muted2, fontSize: theme.fs.xs + 1, fontWeight: '600', letterSpacing: 0.5, paddingHorizontal: theme.sp.xs, textAlign: 'right' },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    paddingVertical: 5,
    paddingHorizontal: theme.sp.xs,
    minHeight: 34,
  },
  sym: { color: theme.accent, fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.sm + 1, paddingHorizontal: theme.sp.xs },
  name: { color: theme.muted2, fontSize: theme.fs.sm, paddingHorizontal: theme.sp.xs },
  setupBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: theme.sp.sm,
    paddingVertical: 2,
    fontSize: theme.fs.xs,
    fontWeight: '800',
    letterSpacing: 0.5,
    alignSelf: 'flex-start',
    overflow: 'hidden',
  },
  cellR: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm, textAlign: 'right', paddingHorizontal: theme.sp.xs },
  actions: { width: 110, flexDirection: 'row', gap: 5, justifyContent: 'center' },
  aBtn: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.sp.sm,
    paddingVertical: 3,
  },
  aTxt: { color: theme.muted2, fontSize: theme.fs.xs + 1, fontWeight: '700' },
  readBox: {
    backgroundColor: theme.surface,
    borderBottomColor: theme.border2,
    borderBottomWidth: 1,
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.md,
    gap: 4,
  },
  probTrack: { height: 8, borderRadius: 4, backgroundColor: theme.surface3, overflow: 'hidden', marginBottom: 4 },
  probFill: { height: '100%', borderRadius: 4 },
  readMeta: { color: theme.muted, fontSize: theme.fs.sm, marginBottom: 4 },
  sigTxt: { color: theme.green, fontSize: theme.fs.sm, lineHeight: 19 },
  cauTxt: { color: GOLD, fontSize: theme.fs.sm, lineHeight: 19 },
  sigBody: { color: theme.text },
  method: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 16, padding: theme.sp.lg },
});
