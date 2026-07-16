import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MbScreenRow, Recommendation, api } from '../api';
import StockDetail from '../components/StockDetail';
import { Row } from '../screener';
import { navigate } from '../navIntent';
import { addSymbol, loadWatchlist, normSymbol } from '../watchlist';
import { LocalAlert, addLocalAlert, hasLocalAlert, loadLocalAlerts } from '../localalerts';
import { loadNames } from './ScreenerScreen';
import { useResponsive } from '../responsive';
import { Card, EmptyState, Loading, ScreenTitle } from '../ui';
import { theme } from '../theme';

const GOLD = '#f5c518';
const MAX_CANDIDATES = 24; // top Multibagger candidates to deep-analyse
const CONCURRENCY = 3;

const money = (v?: number | null) =>
  v == null || !isFinite(v) ? '—' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const signPct = (v?: number | null, d = 1) =>
  v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + '%';

const actionColor = (a: string) => (a === 'BUY' ? theme.green : a === 'WATCH' ? GOLD : theme.red);

// Session cache so switching tabs doesn't re-run the (slow) fan-out.
let recCache: Recommendation[] | null = null;
let recNote = '';

function Score({ label, value }: { label: string; value: number | null }) {
  const v = value ?? 0;
  const col = v >= 70 ? theme.green : v >= 50 ? GOLD : theme.muted2;
  return (
    <View style={styles.scoreCol}>
      <Text style={styles.scoreLabel}>{label}</Text>
      <Text style={[styles.scoreVal, { color: value == null ? theme.muted : col }]}>
        {value == null ? '—' : value}
      </Text>
      <View style={styles.scoreTrack}>
        <View style={[styles.scoreFill, { width: `${Math.max(3, Math.min(100, v))}%`, backgroundColor: col }]} />
      </View>
    </View>
  );
}

function RecCard({
  r,
  watched,
  alerted,
  onWatch,
  onAlert,
  onChart,
  onAnalyse,
}: {
  r: Recommendation;
  watched: boolean;
  alerted: boolean;
  onWatch: () => void;
  onAlert: () => void;
  onChart: () => void;
  onAnalyse: () => void;
}) {
  const c = actionColor(r.action);
  return (
    <Card style={styles.card}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <View style={styles.symRow}>
            <Text style={styles.sym}>{r.symbol}</Text>
            <View style={[styles.actionPill, { backgroundColor: c }]}>
              <Text style={styles.actionTxt}>{r.action}</Text>
            </View>
          </View>
          {r.name ? <Text style={styles.name} numberOfLines={1}>{r.name}</Text> : null}
        </View>
        <View style={styles.confBox}>
          <Text style={[styles.confVal, { color: c }]}>{r.confidence}</Text>
          <Text style={styles.confLbl}>confidence</Text>
        </View>
      </View>

      <View style={styles.scores}>
        <Score label="FUNDAMENTAL" value={r.fundamental_score} />
        <Score label="MOMENTUM" value={r.momentum_score} />
        <Score label="PATTERN" value={r.pattern_score} />
      </View>

      {/* trade setup */}
      <View style={styles.setup}>
        <View style={styles.setupCell}>
          <Text style={styles.setupLbl}>ENTRY</Text>
          <Text style={styles.setupVal}>{money(r.entry)}</Text>
        </View>
        <View style={styles.setupCell}>
          <Text style={styles.setupLbl}>STOP</Text>
          <Text style={[styles.setupVal, { color: theme.red }]}>{money(r.stop)}</Text>
          <Text style={[styles.setupSub, { color: theme.red }]}>{signPct(r.stop_pct)}</Text>
        </View>
        <View style={styles.setupCell}>
          <Text style={styles.setupLbl}>TARGET</Text>
          <Text style={[styles.setupVal, { color: theme.green }]}>{money(r.target)}</Text>
          <Text style={[styles.setupSub, { color: theme.green }]}>{signPct(r.upside_pct)}</Text>
        </View>
        <View style={styles.setupCell}>
          <Text style={styles.setupLbl}>R : R</Text>
          <Text style={styles.setupVal}>{r.rr != null ? `${r.rr.toFixed(1)}:1` : '—'}</Text>
        </View>
      </View>

      <View style={styles.levels}>
        <Text style={styles.levelTxt}>
          <Text style={styles.levelLbl}>Support </Text>{money(r.support)}
          <Text style={styles.levelLbl}>   ·   Resistance </Text>{money(r.resistance)}
          <Text style={styles.levelLbl}>   ·   Next target </Text>{money(r.target2)}
        </Text>
        <Text style={styles.levelTxt}>
          {r.pattern ? (
            <>
              <Text style={styles.levelLbl}>Pattern </Text>
              <Text style={{ color: r.pattern_bias === 'bearish' ? theme.red : theme.green }}>{r.pattern}</Text>
            </>
          ) : null}
          <Text style={styles.levelLbl}>{r.pattern ? '   ·   ' : ''}RSI </Text>{r.rsi}
        </Text>
      </View>

      {r.rationale?.length ? (
        <View style={styles.why}>
          {r.rationale.slice(0, 5).map((s, i) => (
            <Text key={i} style={styles.whyTxt}>▸ {s}</Text>
          ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.aBtn} onPress={onChart} activeOpacity={0.75}>
          <Text style={styles.aTxt}>▤ Chart</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.aBtn} onPress={onAnalyse} activeOpacity={0.75}>
          <Text style={[styles.aTxt, { color: theme.accent }]}>⚡ Analyse</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.aBtn} onPress={onWatch} activeOpacity={0.75}>
          <Text style={[styles.aTxt, watched && { color: theme.green }]}>{watched ? '★ Watching' : '☆ Watchlist'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.aBtn} onPress={onAlert} activeOpacity={0.75}>
          <Text style={[styles.aTxt, alerted && { color: GOLD }]}>{alerted ? '🔔 Alerted' : '🔔 Alert'}</Text>
        </TouchableOpacity>
      </View>
    </Card>
  );
}

export default function RecommendationsScreen() {
  const [recs, setRecs] = useState<Recommendation[]>(recCache || []);
  const [loading, setLoading] = useState(!recCache);
  const [note, setNote] = useState(recNote);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [watch, setWatch] = useState<string[]>([]);
  const [alerts, setAlerts] = useState<LocalAlert[]>([]);
  const [detail, setDetail] = useState<Row | null>(null);
  const [flash, setFlash] = useState('');
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { isDesktop } = useResponsive();

  const toast = (m: string) => {
    setFlash(m);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(''), 2200);
  };

  useEffect(() => {
    loadWatchlist().then(setWatch);
    loadLocalAlerts().then(setAlerts);
  }, []);

  const refresh = () => {
    if (loading) return;
    recCache = null;
    setRecs([]);
    setError('');
    setLoading(true);
    setNote('Re-running the screen…');
    setTick((t) => t + 1);
  };

  useEffect(() => {
    if (recCache && tick === 0) return;
    let cancelled = false;
    const isCancelled = () => cancelled;
    (async () => {
      try {
        // 1) candidate pool = the Multibagger fixed screen (poll until it has rows).
        setNote('Loading Multibagger candidates…');
        let snap = await api.mbScreen(tick > 0);
        let tries = 0;
        while (!cancelled && snap.status === 'running' && !snap.results.length && tries < 15) {
          await new Promise((r) => setTimeout(r, 3000));
          snap = await api.mbScreen();
          tries++;
        }
        if (cancelled) return;
        const candidates = [...(snap.results || [])]
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
          .slice(0, MAX_CANDIDATES);
        if (!candidates.length) {
          setError(snap.error || 'No Multibagger candidates to analyse yet — try again shortly.');
          setLoading(false);
          return;
        }
        const names = await loadNames().catch(() => ({} as Record<string, { name: string; exchange: string }>));

        // 2) deep-analyse each candidate (bounded concurrency); surface BUYs live.
        const buys: Recommendation[] = [];
        let done = 0;
        const total = candidates.length;
        const run = async (row: MbScreenRow) => {
          try {
            const rec = await api.recommendation(row.symbol, row.score, names[row.symbol.toUpperCase()]?.name);
            if (cancelled) return;
            if (rec && !rec.error && rec.action === 'BUY') {
              buys.push(rec);
              buys.sort((a, b) => b.confidence - a.confidence);
              setRecs([...buys]);
              setLoading(false);
            }
          } catch {
            /* skip a failed candidate */
          } finally {
            if (!cancelled) {
              done++;
              setNote(`Analysing ${Math.min(done, total)}/${total} candidates · ${buys.length} buy${buys.length === 1 ? '' : 's'}`);
            }
          }
        };
        let idx = 0;
        const worker = async () => {
          while (idx < candidates.length && !cancelled) {
            const my = idx++;
            await run(candidates[my]);
          }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, worker));
        if (cancelled) return;
        setLoading(false);
        setNote(`${buys.length} buy recommendation${buys.length === 1 ? '' : 's'} from ${total} candidates`);
        recCache = buys;
        recNote = `${buys.length} buy recommendation${buys.length === 1 ? '' : 's'} from ${total} candidates`;
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to build recommendations');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const isWatched = (s: string) => watch.includes(normSymbol(s));
  const onWatch = useCallback(async (r: Recommendation) => {
    setWatch(await addSymbol(watch, r.symbol));
    toast(`${r.symbol} added to watchlist`);
  }, [watch]);
  const onAlert = useCallback(async (r: Recommendation) => {
    setAlerts(await addLocalAlert(alerts, r.symbol, r.target, r.price, r.name || undefined));
    toast(`Alert set for ${r.symbol} → ${money(r.target)} (${signPct(r.upside_pct)} upside)`);
  }, [alerts]);
  const onChart = (r: Recommendation) => setDetail({ sym: r.symbol, price: r.price } as Row);
  const onAnalyse = (r: Recommendation) => navigate('analysis', { sub: 'mb', symbol: r.symbol });

  return (
    <View style={styles.container}>
      <ScreenTitle
        title="Recommendations"
        sub="Multibagger candidates screened through fundamentals, momentum & chart patterns into actionable buy setups"
        right={
          <TouchableOpacity style={[styles.updBtn, loading && { opacity: 0.5 }]} onPress={refresh} disabled={loading} activeOpacity={0.75}>
            <Text style={styles.updTxt}>⟳ Rebuild</Text>
          </TouchableOpacity>
        }
      />
      {note ? <Text style={styles.note}>{note}</Text> : null}

      <ScrollView contentContainerStyle={styles.body}>
        {loading && !recs.length ? (
          <Loading label="Screening candidates — fundamentals, momentum & patterns…" />
        ) : null}
        {!loading && error ? <EmptyState icon="⚠" title="Couldn't build recommendations" hint={error} /> : null}
        {!loading && !error && !recs.length ? (
          <EmptyState
            icon="◇"
            title="No buy setups right now"
            hint="None of the current Multibagger candidates clear the fundamentals + momentum + pattern filters. Hit ⟳ Rebuild later."
          />
        ) : null}

        <View style={isDesktop ? styles.grid : undefined}>
          {recs.map((r) => (
            <View key={r.symbol} style={isDesktop ? styles.gridCell : undefined}>
              <RecCard
                r={r}
                watched={isWatched(r.symbol)}
                alerted={hasLocalAlert(alerts, r.symbol)}
                onWatch={() => onWatch(r)}
                onAlert={() => onAlert(r)}
                onChart={() => onChart(r)}
                onAnalyse={() => onAnalyse(r)}
              />
            </View>
          ))}
        </View>

        {recs.length ? (
          <Text style={styles.method}>
            Confidence blends the Multibagger analyser (fundamentals), a live momentum read (trend vs 20/50/200-DMA,
            RSI, volume) and the current chart pattern. Entry/stop/target come from pivot & swing structure with a
            capped risk band. Indicative and educational only — not investment advice; always confirm and manage risk.
          </Text>
        ) : null}
      </ScrollView>

      {detail ? <StockDetail row={detail} onClose={() => setDetail(null)} /> : null}
      {flash ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastTxt}>{flash}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  note: { color: theme.muted, fontSize: theme.fs.sm, paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.sm },
  updBtn: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 6,
  },
  updTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
  body: { paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.xl, gap: theme.sp.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.md },
  gridCell: { width: '48.5%', minWidth: 440, flexGrow: 1 },
  card: { gap: theme.sp.md },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp.md },
  symRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm },
  sym: { color: theme.text, fontFamily: theme.mono, fontWeight: '800', fontSize: theme.fs.lg },
  actionPill: { borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 },
  actionTxt: { color: theme.onAccent, fontSize: 10, fontWeight: '800', letterSpacing: 0.5, fontFamily: theme.mono },
  name: { color: theme.muted2, fontSize: theme.fs.sm, marginTop: 3 },
  confBox: { alignItems: 'flex-end' },
  confVal: { fontFamily: theme.mono, fontWeight: '800', fontSize: 30, lineHeight: 32 },
  confLbl: { color: theme.muted, fontSize: theme.fs.xs },
  scores: { flexDirection: 'row', gap: theme.sp.md },
  scoreCol: { flex: 1, gap: 3 },
  scoreLabel: { color: theme.muted, fontSize: theme.fs.xs, letterSpacing: 0.5 },
  scoreVal: { fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.md },
  scoreTrack: { height: 4, borderRadius: 2, backgroundColor: theme.surface3, overflow: 'hidden' },
  scoreFill: { height: '100%', borderRadius: 2 },
  setup: {
    flexDirection: 'row',
    backgroundColor: theme.surface2,
    borderRadius: theme.radius.sm + 2,
    paddingVertical: theme.sp.sm,
  },
  setupCell: { flex: 1, alignItems: 'center', gap: 1 },
  setupLbl: { color: theme.muted, fontSize: theme.fs.xs, letterSpacing: 0.5 },
  setupVal: { color: theme.text, fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.md },
  setupSub: { fontFamily: theme.mono, fontSize: theme.fs.xs },
  levels: { gap: 3 },
  levelTxt: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm },
  levelLbl: { color: theme.muted },
  why: { gap: 3 },
  whyTxt: { color: theme.muted2, fontSize: theme.fs.sm, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, borderTopColor: theme.border, borderTopWidth: 1, paddingTop: theme.sp.md },
  aBtn: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm,
  },
  aTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
  method: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 16, marginTop: theme.sp.sm },
  toast: {
    position: 'absolute',
    bottom: theme.sp.xl,
    alignSelf: 'center',
    backgroundColor: theme.surface3,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.sm + 2,
    maxWidth: '92%',
  },
  toastTxt: { color: theme.text, fontSize: theme.fs.sm + 1, fontWeight: '600' },
});
