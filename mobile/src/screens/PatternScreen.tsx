import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Candle, ChartPattern, ChartPatternsResp, api } from '../api';
import { chartHtml } from '../chartHtml';
import HtmlView from '../components/HtmlView';
import SymbolInput from '../components/SymbolInput';
import { Btn, Card, EmptyState, Loading, ScreenTitle, SectionTitle } from '../ui';
import { theme } from '../theme';

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

export default function PatternScreen() {
  const [symbol, setSymbol] = useState('');
  const [period, setPeriod] = useState('2y');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<ChartPatternsResp | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const lastQuery = useRef<{ sym: string; period: string } | null>(null);

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

  const chartCandles: Candle[] = (data?.candles || []).map((c) => ({
    t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: 0,
  }));

  const cur = data?.current || null;

  return (
    <View style={styles.container}>
      <ScreenTitle
        title="Pattern Recogniser"
        sub="Scans a stock's full price history for classic chart patterns — with start/end, confidence, continuation odds and the measured move"
      />

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

            {cur ? (
              <Card style={StyleSheet.flatten([styles.curCard, { borderColor: biasColor(cur.bias) }])}>
                <View style={styles.curHead}>
                  <Text style={styles.curKicker}>CURRENT PATTERN</Text>
                  <View style={[styles.biasChip, { borderColor: biasColor(cur.bias) }]}>
                    <Text style={[styles.biasTxt, { color: biasColor(cur.bias) }]}>{cur.bias.toUpperCase()}</Text>
                  </View>
                </View>
                <Text style={styles.curTitle}>{cur.label}</Text>
                <Text style={styles.curSub}>
                  {cur.category} · {cur.status} · started {fmtDate(cur.start_ts)}
                </Text>
                <View style={styles.curStats}>
                  <View style={styles.curStat}>
                    <Text style={styles.curStatLabel}>Probability</Text>
                    <Text style={styles.curStatVal}>{cur.confidence}%</Text>
                  </View>
                  <View style={styles.curStat}>
                    <Text style={styles.curStatLabel}>Continuation</Text>
                    <Text style={[styles.curStatVal, { color: biasColor(cur.bias) }]}>{cur.continuation}%</Text>
                  </View>
                  <View style={styles.curStat}>
                    <Text style={styles.curStatLabel}>Expansion</Text>
                    <Text style={[styles.curStatVal, { color: cur.expansion_pct >= 0 ? theme.green : theme.red }]}>
                      {signPct(cur.expansion_pct)}
                    </Text>
                  </View>
                  {cur.target ? (
                    <View style={styles.curStat}>
                      <Text style={styles.curStatLabel}>Target</Text>
                      <Text style={styles.curStatVal}>₹{cur.target.toLocaleString('en-IN')}</Text>
                    </View>
                  ) : null}
                </View>
              </Card>
            ) : null}

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

            <Text style={styles.method}>
              Patterns are detected geometrically from swing pivots and trend-line fits. “Probability” is how
              closely the price action matches the ideal shape; “continuation” is an indicative base-rate that
              price follows the pattern's implied direction; “expansion” is the measured-move target as a % of
              price. Indicative and educational only — not investment advice.
            </Text>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  inputRow: { flexDirection: 'row', gap: theme.sp.sm, paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.sm, zIndex: 50 },
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
  // current-pattern banner
  curCard: { borderWidth: 1, gap: 4 },
  curHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  curKicker: { color: theme.muted, fontSize: theme.fs.xs + 1, fontWeight: '700', letterSpacing: 1 },
  curTitle: { color: theme.text, fontSize: theme.fs.lg, fontWeight: '800' },
  curSub: { color: theme.muted, fontSize: theme.fs.sm },
  curStats: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.lg, marginTop: theme.sp.sm },
  curStat: { gap: 2 },
  curStatLabel: { color: theme.muted, fontSize: theme.fs.xs + 1 },
  curStatVal: { color: theme.text, fontSize: theme.fs.lg, fontWeight: '800', fontFamily: theme.mono },
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
