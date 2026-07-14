import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MomentumHit, api } from '../api';
import StockDetail from '../components/StockDetail';
import { Row } from '../screener';
import { addSymbol, loadWatchlist, normSymbol, removeSymbol } from '../watchlist';
import { EmptyState, Loading, ScreenTitle } from '../ui';
import { theme } from '../theme';

const GOLD = '#f5c518';

type SetupKind = MomentumHit['setup'];
const SETUP_LABEL: Record<SetupKind, string> = {
  breakout: 'BREAKOUT WATCH',
  fired: 'BREAKOUT FIRED',
  pullback: 'PULLBACK REVERSAL',
};
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
const fmtAsof = (epoch: number) =>
  new Date(epoch * 1000).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });

// Session caches — switching tabs doesn't refetch.
let momCache: MomentumHit[] | null = null;
let momNote = '';
let momAsof = 0;

export default function MomentumScreen() {
  const [hits, setHits] = useState<MomentumHit[]>(momCache || []);
  const [note, setNote] = useState(momNote);
  const [loading, setLoading] = useState(!momCache);
  const [asof, setAsof] = useState(momAsof);
  const [tick, setTick] = useState(0);
  const [setupFilter, setSetupFilter] = useState<'all' | SetupKind>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const [watch, setWatch] = useState<string[]>([]);

  useEffect(() => {
    loadWatchlist().then(setWatch);
  }, []);

  const forceRefresh = () => {
    if (loading) return;
    momCache = null;
    momNote = '';
    setHits([]);
    setLoading(true);
    setNote('Restarting the universe radar…');
    setTick((t) => t + 1);
  };

  // Poll the server-side full NSE+BSE radar; setups stream in live.
  useEffect(() => {
    if (momCache && tick === 0) return;
    let cancelled = false;
    (async () => {
      try {
        let snap = await api.momentumScreen(tick > 0);
        while (!cancelled && snap.status === 'running') {
          if (snap.results.length) {
            setHits(snap.results);
            setLoading(false);
          }
          setNote(`Scanning the whole NSE + BSE universe server-side… ${snap.progress || ''}`);
          await new Promise((r) => setTimeout(r, 4000));
          snap = await api.momentumScreen();
        }
        if (cancelled) return;
        if (snap.status === 'error' && !snap.results.length) {
          setNote(snap.error || 'Radar failed — retry shortly.');
          setLoading(false);
          return;
        }
        const meta = `${snap.universe_nse.toLocaleString('en-IN')} NSE${snap.universe_bse ? ` + ${snap.universe_bse.toLocaleString('en-IN')} BSE` : ''} scanned${snap.refreshing ? ' · refreshing…' : ''}`;
        setHits(snap.results);
        setLoading(false);
        setNote(meta);
        setAsof(snap.asof);
        momCache = snap.results;
        momNote = meta;
        momAsof = snap.asof;
      } catch (e) {
        if (!cancelled) {
          setNote(e instanceof Error ? e.message : 'Failed to load the radar');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const shown = useMemo(
    () => hits.filter((h) => setupFilter === 'all' || h.setup === setupFilter),
    [hits, setupFilter],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { breakout: 0, fired: 0, pullback: 0 };
    hits.forEach((h) => c[h.setup]++);
    return c;
  }, [hits]);

  const isWatched = (sym: string) => watch.includes(normSymbol(sym));
  const toggleWatch = async (sym: string) => {
    if (isWatched(sym)) setWatch(await removeSymbol(watch, normSymbol(sym)));
    else setWatch(await addSymbol(watch, sym));
  };
  const openChart = (h: MomentumHit) =>
    setDetail({ sym: h.symbol, name: h.name, exchange: h.exchange, price: h.price, chg: h.chg });

  return (
    <View style={styles.container}>
      <ScreenTitle
        title="Momentum radar"
        sub="Whole NSE + BSE universe · breakout & pullback-reversal setups · technical score + follow-through probability"
      />
      <View style={styles.chipsRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsInner}>
          {SETUP_FILTERS.map((f) => {
            const count =
              f.key === 'all' ? counts.breakout + counts.fired + counts.pullback : counts[f.key] || 0;
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
          <TouchableOpacity
            style={[styles.updBtn, loading && { opacity: 0.5 }]}
            onPress={forceRefresh}
            disabled={loading}
            activeOpacity={0.75}
          >
            <Text style={styles.updTxt}>⟳ Update list</Text>
          </TouchableOpacity>
          <Text style={styles.note} numberOfLines={1}>{note} · tap a row for the technical read</Text>
        </ScrollView>
      </View>
      {asof ? <Text style={styles.lastUpd}>Setups last updated {fmtAsof(asof)}</Text> : null}

      <ScrollView style={{ flex: 1 }}>
        {loading ? <Loading label="Scanning the universe — setups stream in as they're found…" /> : null}
        {!loading && !shown.length ? (
          <EmptyState
            icon="◇"
            title="No qualifying setups right now"
            hint="Compression and pullback windows come and go — hit ⟳ Update list or check back later."
          />
        ) : null}

        {shown.length ? (
          <View style={styles.headerRow}>
            <Text style={[styles.th, { width: 96 }]}>SYMBOL</Text>
            <Text style={[styles.th, { flex: 3, minWidth: 170 }]}>NAME</Text>
            <Text style={[styles.th, { width: 46 }]}>EXCH</Text>
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

        {shown.map((h) => {
          const open = expanded === h.symbol;
          const c = setupColor(h.setup);
          return (
            <View key={h.symbol}>
              <TouchableOpacity
                style={styles.dataRow}
                onPress={() => setExpanded(open ? null : h.symbol)}
                activeOpacity={0.8}
              >
                <Text style={[styles.sym, { width: 96 }]}>{h.symbol}</Text>
                <Text style={[styles.name, { flex: 3, minWidth: 170 }]} numberOfLines={1}>{h.name || '—'}</Text>
                <Text style={[styles.exch, { width: 46 }]}>{h.exchange}</Text>
                <View style={{ width: 150 }}>
                  <Text style={[styles.setupBadge, { color: c, borderColor: c }]}>{SETUP_LABEL[h.setup]}</Text>
                </View>
                <Text style={[styles.cellR, { width: 56, color: c, fontWeight: '700' }]}>{h.score}</Text>
                <Text style={[styles.cellR, { width: 56 }]}>{h.probability}%</Text>
                <Text style={[styles.cellR, { width: 96, fontWeight: '700' }]}>{fmtIN(h.price)}</Text>
                <Text style={[styles.cellR, { width: 70, color: (h.chg ?? 0) >= 0 ? theme.green : theme.red }]}>{pct(h.chg, 2)}</Text>
                <Text style={[styles.cellR, { width: 48 }]}>{h.rsi != null ? h.rsi.toFixed(0) : '—'}</Text>
                <Text style={[styles.cellR, { width: 60 }]}>{h.relvol != null ? h.relvol.toFixed(2) + 'x' : '—'}</Text>
                <Text style={[styles.cellR, { width: 80, color: (h.d200 ?? 0) >= 0 ? theme.green : theme.red }]}>{pct(h.d200)}</Text>
                <Text style={[styles.cellR, { width: 70, color: theme.red }]}>{pct(h.pct_from_high)}</Text>
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.aBtn} onPress={() => openChart(h)} activeOpacity={0.75}>
                    <Text style={styles.aTxt}>Chart</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.aBtn} onPress={() => toggleWatch(h.symbol)} activeOpacity={0.75}>
                    <Text style={[styles.aTxt, isWatched(h.symbol) && { color: theme.green }]}>
                      {isWatched(h.symbol) ? '★' : '☆'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
              {open ? (
                <View style={styles.readBox}>
                  <View style={styles.probTrack}>
                    <View style={[styles.probFill, { width: `${h.probability}%`, backgroundColor: c }]} />
                  </View>
                  <Text style={styles.readMeta}>
                    Technical score {h.score}/100 · indicative follow-through probability {h.probability}%
                  </Text>
                  {h.signals.map((s) => (
                    <Text key={s} style={styles.sigTxt}>▲ <Text style={styles.sigBody}>{s}</Text></Text>
                  ))}
                  {h.cautions.map((s) => (
                    <Text key={s} style={styles.cauTxt}>▼ <Text style={styles.sigBody}>{s}</Text></Text>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}

        {shown.length ? (
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
  chipsRow: { paddingBottom: theme.sp.xs },
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
  updBtn: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 5,
  },
  updTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
  note: { color: theme.muted, fontSize: theme.fs.sm, marginLeft: theme.sp.sm },
  lastUpd: { color: theme.muted, fontSize: theme.fs.xs + 1, paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.sm },
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
  exch: { color: theme.muted, fontSize: theme.fs.xs + 1, fontFamily: theme.mono, paddingHorizontal: theme.sp.xs },
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
