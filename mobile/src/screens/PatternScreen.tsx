import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Candle, ChartPattern, ChartPatternsResp, api } from '../api';
import { chartHtml } from '../chartHtml';
import HtmlView from '../components/HtmlView';
import StockDetail from '../components/StockDetail';
import SymbolInput from '../components/SymbolInput';
import { Row } from '../screener';
import { navigate, takeSymbol } from '../navIntent';
import { addSymbol, loadWatchlist, normSymbol } from '../watchlist';
import { Btn, Card, EmptyState, InfoButton, Loading, SectionTitle } from '../ui';
import { PATTERN_INFO } from '../tabInfo';
import { useResponsive } from '../responsive';
import { theme } from '../theme';

const PORTFOLIO_PREFILL_KEY = 'taureye.portfolio.prefill';

const RECENT_KEY = 'taureye.patterns.recent.v1';
const PERIODS: { key: string; label: string }[] = [
  { key: '1y', label: '1Y' },
  { key: '2y', label: '2Y' },
  { key: '5y', label: '5Y' },
];

const biasColor = (b: string) => (b === 'bullish' ? theme.green : b === 'bearish' ? theme.red : theme.muted2);
const fmtDate = (ts?: number) =>
  ts == null ? '—' : new Date(ts * 1000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
const signPct = (v?: number | null) =>
  v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%';

// Desktop/mobile share one horizontally-scrolling table (many columns).
type Col = { key: string; label: string; w: number; align?: 'left' | 'right' };
const COLS: Col[] = [
  { key: 'pattern', label: 'PATTERN', w: 186, align: 'left' },
  { key: 'bias', label: 'BIAS', w: 82, align: 'left' },
  { key: 'started', label: 'STARTED', w: 92, align: 'right' },
  { key: 'ended', label: 'ENDED', w: 96, align: 'right' },
  { key: 'conf', label: 'PROBABILITY', w: 108, align: 'right' },
  { key: 'cont', label: 'CONTINUATION', w: 116, align: 'right' },
  { key: 'exp', label: 'EXPANSION', w: 96, align: 'right' },
];
const TABLE_W = COLS.reduce((a, c) => a + c.w, 0);

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${Math.max(3, Math.min(100, pct))}%`, backgroundColor: color }]} />
    </View>
  );
}

function PatternRow({ p, top }: { p: ChartPattern; top?: boolean }) {
  const c = biasColor(p.bias);
  return (
    <View style={[styles.dataRow, p.current && styles.currentRow, top && { borderTopWidth: 0 }]}>
      <View style={{ width: 186 }}>
        <View style={styles.patName}>
          {p.current ? <Text style={styles.liveDot}>●</Text> : null}
          <Text style={styles.patLabel} numberOfLines={1}>{p.label}</Text>
        </View>
        <Text style={styles.patMeta} numberOfLines={1}>
          {p.category}{p.status === 'confirmed' ? ' · confirmed' : ' · forming'}
        </Text>
      </View>
      <View style={{ width: 82 }}>
        <View style={[styles.biasChip, { borderColor: c }]}>
          <Text style={[styles.biasTxt, { color: c }]}>{p.bias.toUpperCase()}</Text>
        </View>
      </View>
      <Text style={[styles.cell, { width: 92 }]}>{fmtDate(p.start_ts)}</Text>
      <Text style={[styles.cell, { width: 96 }]}>{p.current ? 'active' : fmtDate(p.end_ts)}</Text>
      <View style={{ width: 108, paddingHorizontal: theme.sp.xs, alignItems: 'flex-end' }}>
        <Text style={styles.cellStrong}>{p.confidence}%</Text>
        <Bar pct={p.confidence} color={theme.accent} />
      </View>
      <View style={{ width: 116, paddingHorizontal: theme.sp.xs, alignItems: 'flex-end' }}>
        <Text style={styles.cellStrong}>{p.continuation}%</Text>
        <Bar pct={p.continuation} color={c} />
      </View>
      <Text style={[styles.cell, styles.mono, { width: 96, color: p.expansion_pct >= 0 ? theme.green : theme.red }]}>
        {signPct(p.expansion_pct)}
      </Text>
    </View>
  );
}

// The dedicated "Current Pattern" detail box — bias, dates, probability, the
// continuation odds and the measured % move. Fills the space beside the table
// on desktop, stacks above it on mobile.
type CardActions = {
  onChart: () => void;
  onMultibagger: () => void;
  onInstitutional: () => void;
  onWatch: () => void;
  onPortfolio: () => void;
  watched: boolean;
};

function CurrentCard({ p, actions }: { p: ChartPattern; actions: CardActions }) {
  const c = biasColor(p.bias);
  const Stat = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <View style={styles.cStat}>
      <Text style={styles.cStatLabel}>{label}</Text>
      <Text style={[styles.cStatVal, color ? { color } : null]}>{value}</Text>
    </View>
  );
  return (
    <Card style={StyleSheet.flatten([styles.curCard, { borderColor: c }])}>
      <View style={styles.curHead}>
        <Text style={styles.curKicker}>CURRENT PATTERN</Text>
        <View style={[styles.statePill, { backgroundColor: p.active ? c : theme.surface3 }]}>
          <Text style={[styles.stateTxt, { color: p.active ? theme.bg : theme.muted2 }]}>
            {p.active ? 'IN PLAY' : 'LATEST'}
          </Text>
        </View>
      </View>
      <Text style={styles.curTitle}>{p.label}</Text>
      <View style={styles.curTags}>
        <View style={[styles.biasChip, { borderColor: c, marginHorizontal: 0 }]}>
          <Text style={[styles.biasTxt, { color: c }]}>{p.bias.toUpperCase()}</Text>
        </View>
        <Text style={styles.curCat}>{p.category} · {p.status}</Text>
      </View>

      <View style={styles.probBlock}>
        <View style={styles.probLine}>
          <Text style={styles.cStatLabel}>Probability</Text>
          <Text style={styles.probPct}>{p.confidence}%</Text>
        </View>
        <Bar pct={p.confidence} color={theme.accent} />
      </View>
      <View style={styles.probBlock}>
        <View style={styles.probLine}>
          <Text style={styles.cStatLabel}>Continuation</Text>
          <Text style={[styles.probPct, { color: c }]}>{p.continuation}%</Text>
        </View>
        <Bar pct={p.continuation} color={c} />
      </View>

      <View style={styles.cGrid}>
        <Stat label="Bias" value={p.bias[0].toUpperCase() + p.bias.slice(1)} color={c} />
        <Stat label="% move" value={signPct(p.expansion_pct)} color={p.expansion_pct >= 0 ? theme.green : theme.red} />
        <Stat label="Started" value={fmtDate(p.start_ts)} />
        <Stat label="Ended" value={p.active ? 'active' : fmtDate(p.end_ts)} />
        {p.target ? <Stat label="Target" value={`₹${p.target.toLocaleString('en-IN')}`} /> : null}
        {p.level ? <Stat label="Key level" value={`₹${p.level.toLocaleString('en-IN')}`} /> : null}
      </View>

      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.actBtn} onPress={actions.onChart} activeOpacity={0.75}>
          <Text style={styles.actTxt}>▤ Chart</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actBtn} onPress={actions.onMultibagger} activeOpacity={0.75}>
          <Text style={[styles.actTxt, { color: theme.accent }]}>⚡ Multibagger</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actBtn} onPress={actions.onInstitutional} activeOpacity={0.75}>
          <Text style={styles.actTxt}>◪ Institutional</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actBtn} onPress={actions.onWatch} activeOpacity={0.75}>
          <Text style={[styles.actTxt, actions.watched && { color: theme.green }]}>
            {actions.watched ? '★ Watching' : '☆ Watchlist'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actBtn} onPress={actions.onPortfolio} activeOpacity={0.75}>
          <Text style={styles.actTxt}>＋ Portfolio</Text>
        </TouchableOpacity>
      </View>
    </Card>
  );
}

export default function PatternScreen() {
  const [symbol, setSymbol] = useState('');
  const [period, setPeriod] = useState('2y');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<ChartPatternsResp | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [detail, setDetail] = useState<Row | null>(null);
  const [watch, setWatch] = useState<string[]>([]);
  const [flash, setFlash] = useState('');
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQuery = useRef<{ sym: string; period: string } | null>(null);
  const { isDesktop } = useResponsive();

  const toast = useCallback((m: string) => {
    setFlash(m);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(''), 2200);
  }, []);

  useEffect(() => {
    loadWatchlist().then(setWatch).catch(() => {});
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(RECENT_KEY)
      .then((v) => {
        const p = v ? JSON.parse(v) : null;
        if (Array.isArray(p)) setRecent(p.filter((s) => typeof s === 'string'));
      })
      .catch(() => {});
  }, []);
  const pushRecent = (sym: string) => {
    setRecent((prev) => {
      const next = [sym, ...prev.filter((s) => s !== sym)].slice(0, 8);
      AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  };

  const scan = useCallback((symOverride?: string, periodOverride?: string) => {
    const sym = (symOverride ?? symbol).trim().toUpperCase().replace(/^[A-Z]+:/, '');
    const per = periodOverride ?? period;
    if (!sym || busy) return;
    setSymbol(sym);
    setPeriod(per);
    setBusy(true);
    setError('');
    setData(null);
    pushRecent(sym);
    lastQuery.current = { sym, period: per };
    api
      .chartPatterns(sym, per)
      .then((r) => {
        if (r && !r.error) setData(r);
        else setError(r?.error || `No price history for ${sym}`);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Pattern scan failed'))
      .finally(() => setBusy(false));
  }, [symbol, period, busy]);

  // Auto-scan a symbol handed off from another screen (e.g. the Recommendations
  // "Pattern" button).
  useEffect(() => {
    const s = takeSymbol('patterns');
    if (s) scan(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chartCandles: Candle[] = (data?.candles || []).map((c) => ({
    t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: 0,
  }));

  const cur = data?.current || null;
  const activeSym = (data?.symbol || symbol).trim().toUpperCase();

  const actions: CardActions = {
    watched: watch.includes(normSymbol(activeSym)),
    onChart: () => activeSym && setDetail({ sym: activeSym } as Row),
    onMultibagger: () => activeSym && navigate('analysis', { sub: 'mb', symbol: activeSym }),
    onInstitutional: () => activeSym && navigate('analysis', { sub: 'inst', symbol: activeSym }),
    onWatch: async () => {
      if (!activeSym) return;
      setWatch(await addSymbol(watch, activeSym));
      toast(`${activeSym} added to watchlist`);
    },
    onPortfolio: async () => {
      if (!activeSym) return;
      await AsyncStorage.setItem(PORTFOLIO_PREFILL_KEY, activeSym).catch(() => {});
      toast(`${activeSym} queued — open Lists ▸ Portfolio`);
    },
  };

  return (
    <View style={styles.container}>
      <View style={styles.inputRow}>
        <SymbolInput
          value={symbol}
          onChangeText={setSymbol}
          onSelect={(s) => scan(s)}
          onSubmit={() => scan()}
          placeholder="NSE symbol — e.g. RELIANCE, TCS, HDFCBANK…"
          inputStyle={styles.input}
          containerStyle={{ flex: 1 }}
        />
        <Btn label={busy ? 'Scanning…' : '⚏ Scan'} onPress={() => scan()} disabled={busy || !symbol.trim()} />
        <InfoButton title="Pattern Recogniser" content={PATTERN_INFO} style={styles.infoInline} />
      </View>

      <View style={styles.periodRow}>
        {PERIODS.map((p) => (
          <TouchableOpacity
            key={p.key}
            style={[styles.perChip, period === p.key && styles.perChipOn]}
            onPress={() => {
              setPeriod(p.key);
              if (lastQuery.current) scan(lastQuery.current.sym, p.key);
            }}
            activeOpacity={0.75}
          >
            <Text style={[styles.perTxt, period === p.key && styles.perTxtOn]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
        {recent.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={styles.recentInner}>
            <Text style={styles.recentLabel}>RECENT</Text>
            {recent.map((s) => (
              <TouchableOpacity key={s} style={styles.recentChip} onPress={() => scan(s)} activeOpacity={0.75}>
                <Text style={styles.recentTxt}>{s}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {busy ? <Loading label={`Scanning ${symbol.toUpperCase()} for chart patterns…`} /> : null}
        {!busy && error ? <EmptyState icon="⚠" title="Couldn't scan" hint={error} /> : null}
        {!busy && !error && !data ? (
          <EmptyState
            icon="⚏"
            title="Pick a stock to scan"
            hint="Type any NSE symbol — the recogniser walks the whole history and lists every chart pattern it finds (double tops, head-and-shoulders, triangles, wedges, flags, cup-and-handle and more)."
          />
        ) : null}

        {data && !busy ? (
          <>
            {chartCandles.length ? (
              <Card style={styles.chartCard}>
                <HtmlView html={chartHtml(chartCandles, 86400)} style={styles.chart} />
              </Card>
            ) : null}

            {/* On desktop the table and the Current Pattern card sit side by
                side (the card fills the space that was blank); on mobile the
                card stacks above the table. */}
            <View style={isDesktop ? styles.split : undefined}>
              {!isDesktop && cur ? (
                <View style={{ marginBottom: theme.sp.md }}>
                  <CurrentCard p={cur} actions={actions} />
                </View>
              ) : null}
              <View style={isDesktop ? styles.splitMain : undefined}>
                <SectionTitle>
                  {data.count} pattern{data.count === 1 ? '' : 's'} found{data.bars ? ` · ${data.bars} bars` : ''}
                </SectionTitle>

                {data.patterns.length ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: '100%' }}>
                    <View style={{ minWidth: TABLE_W }}>
                      <View style={styles.headerRow}>
                        {COLS.map((c) => (
                          <Text
                            key={c.key}
                            style={[styles.th, { width: c.w, textAlign: c.align === 'left' ? 'left' : 'right' }]}
                          >
                            {c.label}
                          </Text>
                        ))}
                      </View>
                      {data.patterns.map((p, i) => (
                        <PatternRow key={`${p.type}-${p.start_ts}-${i}`} p={p} top={i === 0} />
                      ))}
                    </View>
                  </ScrollView>
                ) : (
                  <EmptyState
                    icon="◇"
                    title="No clear chart patterns"
                    hint={data.note || 'The recogniser found no textbook formations in this window. Try a longer period.'}
                  />
                )}
              </View>

              {isDesktop && cur ? (
                <View style={styles.splitSide}>
                  <CurrentCard p={cur} actions={actions} />
                </View>
              ) : null}
            </View>

            <Text style={styles.method}>
              Patterns are detected geometrically from swing pivots and trend-line fits. “Probability” is how
              closely the price action matches the ideal shape; “continuation” is an indicative base-rate that
              price follows the pattern's implied direction; “expansion” is the measured-move target as a % of
              price. Indicative and educational only — not investment advice.
            </Text>
          </>
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
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.sm, paddingBottom: theme.sp.sm, zIndex: 50 },
  infoInline: { alignSelf: 'center' },
  input: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    color: theme.text,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 10,
    fontSize: theme.fs.md,
    fontFamily: theme.mono,
  },
  periodRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.sm },
  perChip: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 4,
    backgroundColor: theme.surface2,
  },
  perChipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  perTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontFamily: theme.mono },
  perTxtOn: { color: theme.onAccent, fontWeight: '700' },
  recentInner: { gap: theme.sp.sm, alignItems: 'center', paddingLeft: theme.sp.sm },
  recentLabel: { color: theme.muted, fontSize: theme.fs.xs + 1, fontWeight: '700', letterSpacing: 1 },
  recentChip: {
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 4,
  },
  recentTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontFamily: theme.mono, fontWeight: '700' },
  body: { paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.xl, gap: theme.sp.md },
  chartCard: { height: 240, padding: 0, overflow: 'hidden', marginTop: theme.sp.sm },
  chart: { flex: 1 },
  // desktop two-column split (table | current-pattern card)
  split: { flexDirection: 'row', gap: theme.sp.lg, alignItems: 'flex-start' },
  splitMain: { flex: 1, minWidth: 0 },
  splitSide: { width: 360 },
  // current-pattern detail card
  curCard: { borderWidth: 1, gap: theme.sp.sm },
  curHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  curKicker: { color: theme.muted, fontSize: theme.fs.xs + 1, fontWeight: '700', letterSpacing: 1 },
  curTitle: { color: theme.text, fontSize: theme.fs.xl, fontWeight: '800' },
  curTags: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm },
  curCat: { color: theme.muted, fontSize: theme.fs.sm },
  statePill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  stateTxt: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5, fontFamily: theme.mono },
  probBlock: { gap: 4 },
  probLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  probPct: { color: theme.text, fontSize: theme.fs.md, fontWeight: '800', fontFamily: theme.mono },
  cGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: theme.sp.md, marginTop: 2 },
  cStat: { width: '50%', gap: 2 },
  cStatLabel: { color: theme.muted, fontSize: theme.fs.xs + 1 },
  cStatVal: { color: theme.text, fontSize: theme.fs.md, fontWeight: '700', fontFamily: theme.mono },
  // action buttons on the card
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginTop: theme.sp.sm, borderTopColor: theme.border, borderTopWidth: 1, paddingTop: theme.sp.md },
  actBtn: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm,
  },
  actTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
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
  },
  toastTxt: { color: theme.text, fontSize: theme.fs.sm + 1, fontWeight: '600' },
  // table
  headerRow: {
    flexDirection: 'row',
    borderBottomColor: theme.border2,
    borderBottomWidth: 1,
    backgroundColor: theme.surface2,
    paddingVertical: theme.sp.sm,
    paddingHorizontal: theme.sp.xs,
  },
  th: { color: theme.muted2, fontSize: theme.fs.xs + 1, fontWeight: '600', letterSpacing: 0.5, paddingHorizontal: theme.sp.xs },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopColor: theme.border,
    borderTopWidth: 1,
    paddingVertical: theme.sp.sm,
    paddingHorizontal: theme.sp.xs,
    minHeight: 46,
  },
  currentRow: { backgroundColor: theme.surface },
  patName: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: theme.sp.xs },
  liveDot: { color: theme.green, fontSize: 9 },
  patLabel: { color: theme.text, fontSize: theme.fs.sm + 1, fontWeight: '700' },
  patMeta: { color: theme.muted, fontSize: theme.fs.xs + 1, paddingHorizontal: theme.sp.xs, marginTop: 1 },
  biasChip: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1, alignSelf: 'flex-start', marginHorizontal: theme.sp.xs },
  biasTxt: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5, fontFamily: theme.mono },
  cell: { color: theme.text, fontSize: theme.fs.sm, paddingHorizontal: theme.sp.xs, textAlign: 'right' },
  cellStrong: { color: theme.text, fontSize: theme.fs.sm, fontFamily: theme.mono, fontWeight: '700' },
  mono: { fontFamily: theme.mono },
  barTrack: { height: 4, width: '86%', borderRadius: 2, backgroundColor: theme.surface3, overflow: 'hidden', marginTop: 3 },
  barFill: { height: '100%', borderRadius: 2 },
  method: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 16, marginTop: theme.sp.sm },
});
