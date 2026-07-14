import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { MultibaggerReport, api } from '../api';
import SymbolInput from '../components/SymbolInput';
import { Btn, Card, EmptyState, Loading, ScreenTitle, SectionTitle, StatTile } from '../ui';
import { theme } from '../theme';

const GOLD = '#f5c518';

const tierColor = (score: number) =>
  score >= 75 ? theme.green : score >= 60 ? theme.accent : score >= 45 ? GOLD : theme.red;

const fmt = (v: number | null | undefined, suffix = '', d = 1) =>
  v == null || !isFinite(v) ? '—' : v.toFixed(d) + suffix;
const fmtCr = (v: number | null | undefined) =>
  v == null || !isFinite(v)
    ? '—'
    : v >= 1e5
      ? '₹' + (v / 1e5).toFixed(2) + 'L cr'
      : v >= 1e3
        ? '₹' + (v / 1e3).toFixed(2) + 'k cr'
        : '₹' + v.toFixed(0) + ' cr';

export default function MultibaggerScreen() {
  const [symbol, setSymbol] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<MultibaggerReport | null>(null);

  const analyse = (symOverride?: string) => {
    const sym = (symOverride ?? symbol).trim().toUpperCase().replace(/^[A-Z]+:/, '');
    if (!sym || busy) return;
    setSymbol(sym);
    setBusy(true);
    setError('');
    setReport(null);
    api
      .multibagger(sym)
      .then((r) => {
        if (r && !r.error) setReport(r);
        else setError(r?.error || 'No data available for ' + sym);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Analysis failed'))
      .finally(() => setBusy(false));
  };

  const m = report?.metrics || {};

  return (
    <View style={styles.container}>
      <ScreenTitle
        title="Multibagger analyser"
        sub="One-click multibagger-potential score · framework used by Lynch, Mayer & the 100x studies"
      />
      <View style={styles.inputRow}>
        <SymbolInput
          value={symbol}
          onChangeText={setSymbol}
          onSelect={(s) => analyse(s)}
          onSubmit={() => analyse()}
          placeholder="Small-cap NSE symbol — e.g. TARIL, KAYNES, JYOTICNC…"
          inputStyle={styles.input}
          containerStyle={{ flex: 1 }}
        />
        <Btn label={busy ? 'Analysing…' : '⚡ Analyse'} onPress={() => analyse()} disabled={busy || !symbol.trim()} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {busy ? <Loading label={`Reading ${symbol.toUpperCase()} fundamentals, ownership and trend…`} /> : null}
        {!busy && error ? <EmptyState icon="⚠" title="Analysis failed" hint={error} /> : null}
        {!busy && !error && !report ? (
          <EmptyState
            icon="◆"
            title="Pick a stock to analyse"
            hint="Best suited to small caps — the score rewards a small base, fast compounding, clean balance sheets, promoter skin in the game and an intact uptrend."
          />
        ) : null}

        {report ? (
          <>
            <Card style={styles.headCard}>
              <View style={styles.headRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.coName}>{report.name}</Text>
                  <Text style={styles.coMeta}>
                    {report.symbol}
                    {report.sector ? ` · ${report.sector}` : ''}
                    {report.industry ? ` · ${report.industry}` : ''}
                  </Text>
                </View>
                <View style={styles.headRight}>
                  <Text style={styles.coPrice}>{report.price != null ? '₹' + report.price.toLocaleString('en-IN') : ''}</Text>
                  <Text style={styles.coMeta}>{fmtCr(m.mcap_cr)}</Text>
                </View>
              </View>

              <View style={styles.scoreRow}>
                <View style={styles.scoreBox}>
                  <Text style={[styles.scoreBig, { color: tierColor(report.score) }]}>{report.score}</Text>
                  <Text style={styles.scoreOf}>/ 100</Text>
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={[styles.tier, { color: tierColor(report.score) }]}>{report.tier}</Text>
                  <View style={styles.probTrack}>
                    <View
                      style={[styles.probFill, { width: `${report.probability_pct}%`, backgroundColor: tierColor(report.score) }]}
                    />
                  </View>
                  <Text style={styles.probTxt}>
                    Indicative probability of a 5x+ outcome over 5–10 years: {' '}
                    <Text style={{ color: tierColor(report.score), fontWeight: '700' }}>{report.probability_pct}%</Text>
                    {report.coverage_pct < 100 ? `   ·   data coverage ${report.coverage_pct}%` : ''}
                  </Text>
                </View>
              </View>
            </Card>

            <SectionTitle>Pillars — how the big players screen</SectionTitle>
            <Card>
              {report.pillars.map((p) => (
                <View key={p.key} style={styles.pillarRow}>
                  <View style={styles.pillarHead}>
                    <Text style={styles.pillarLabel}>
                      {p.label} <Text style={styles.pillarW}>· {p.weight}%</Text>
                    </Text>
                    <Text style={[styles.pillarScore, { color: p.score == null ? theme.muted : tierColor(p.score) }]}>
                      {p.score == null ? 'no data' : p.score}
                    </Text>
                  </View>
                  <View style={styles.pillarTrack}>
                    <View
                      style={[
                        styles.pillarFill,
                        { width: `${p.score ?? 0}%`, backgroundColor: p.score == null ? theme.border2 : tierColor(p.score) },
                      ]}
                    />
                  </View>
                  <Text style={styles.pillarNote}>{p.note}</Text>
                </View>
              ))}
            </Card>

            <SectionTitle>The classic checklist</SectionTitle>
            <Card>
              <View style={styles.checkWrap}>
                {report.checklist.map((c) => (
                  <View key={c.label} style={styles.checkItem}>
                    <Text
                      style={[
                        styles.checkMark,
                        { color: c.state === 'pass' ? theme.green : c.state === 'fail' ? theme.red : theme.muted },
                      ]}
                    >
                      {c.state === 'pass' ? '✓' : c.state === 'fail' ? '✗' : '?'}
                    </Text>
                    <Text style={styles.checkLabel}>{c.label}</Text>
                  </View>
                ))}
              </View>
            </Card>

            {report.strengths.length ? (
              <>
                <SectionTitle>What works</SectionTitle>
                <Card>
                  {report.strengths.map((s) => (
                    <Text key={s} style={[styles.bullet, { color: theme.green }]}>
                      ▲ <Text style={styles.bulletTxt}>{s}</Text>
                    </Text>
                  ))}
                </Card>
              </>
            ) : null}

            {report.red_flags.length ? (
              <>
                <SectionTitle>Red flags</SectionTitle>
                <Card>
                  {report.red_flags.map((s) => (
                    <Text key={s} style={[styles.bullet, { color: theme.red }]}>
                      ▼ <Text style={styles.bulletTxt}>{s}</Text>
                    </Text>
                  ))}
                </Card>
              </>
            ) : null}

            <SectionTitle>Key numbers</SectionTitle>
            <View style={styles.tiles}>
              <StatTile label="Market cap" value={fmtCr(m.mcap_cr)} />
              <StatTile label="Revenue growth" value={fmt(m.revenue_growth_pct, '%')} color={m.revenue_growth_pct != null && m.revenue_growth_pct >= 15 ? theme.green : undefined} />
              <StatTile label="Earnings growth" value={fmt(m.earnings_growth_pct, '%')} color={m.earnings_growth_pct != null && m.earnings_growth_pct >= 18 ? theme.green : undefined} />
              <StatTile label="ROE" value={fmt(m.roe_pct, '%')} />
              <StatTile label="Op margin" value={fmt(m.op_margin_pct, '%')} />
              <StatTile label="Debt / equity" value={fmt(m.debt_equity, '', 2)} color={m.debt_equity != null && m.debt_equity > 1.5 ? theme.red : undefined} />
              <StatTile label="Free cash flow" value={fmtCr(m.fcf_cr)} color={m.fcf_cr != null && m.fcf_cr < 0 ? theme.red : undefined} />
              <StatTile label="Promoter / insider" value={fmt(m.insider_pct, '%')} />
              <StatTile label="Institutions" value={fmt(m.institution_pct, '%')} />
              <StatTile label="P/E" value={fmt(m.pe, '', 1)} />
              <StatTile label="PEG" value={fmt(m.peg, '', 2)} />
              <StatTile label="vs 200-DMA" value={fmt(m.vs_200dma_pct, '%')} color={m.vs_200dma_pct != null ? (m.vs_200dma_pct >= 0 ? theme.green : theme.red) : undefined} />
              <StatTile label="3y price CAGR" value={fmt(m.price_cagr_3y_pct, '%')} />
              <StatTile label="From 52w high" value={fmt(m.pct_from_high_pct, '%')} />
            </View>

            {report.about ? (
              <>
                <SectionTitle>About</SectionTitle>
                <Card>
                  <Text style={styles.about}>{report.about}</Text>
                </Card>
              </>
            ) : null}

            <Text style={styles.method}>{report.methodology}</Text>
            <Text style={styles.disclaimer}>{report.disclaimer}</Text>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  inputRow: {
    flexDirection: 'row',
    gap: theme.sp.sm,
    paddingHorizontal: theme.sp.lg,
    paddingBottom: theme.sp.md,
    zIndex: 50,
  },
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
  body: { paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.xl, gap: theme.sp.sm },
  headCard: { gap: theme.sp.md },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp.md },
  headRight: { alignItems: 'flex-end' },
  coName: { color: theme.text, fontSize: theme.fs.lg, fontWeight: '800' },
  coMeta: { color: theme.muted, fontSize: theme.fs.sm, marginTop: 2 },
  coPrice: { color: theme.text, fontSize: theme.fs.lg, fontWeight: '700', fontFamily: theme.mono },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.lg },
  scoreBox: { flexDirection: 'row', alignItems: 'baseline' },
  scoreBig: { fontSize: 54, fontWeight: '800', fontFamily: theme.mono, lineHeight: 58 },
  scoreOf: { color: theme.muted, fontSize: theme.fs.md, marginLeft: 4 },
  tier: { fontSize: theme.fs.md, fontWeight: '800', letterSpacing: 1.5 },
  probTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.surface3,
    overflow: 'hidden',
  },
  probFill: { height: '100%', borderRadius: 5 },
  probTxt: { color: theme.muted, fontSize: theme.fs.sm },
  pillarRow: { paddingVertical: theme.sp.sm, gap: 5 },
  pillarHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pillarLabel: { color: theme.text, fontSize: theme.fs.md, fontWeight: '600' },
  pillarW: { color: theme.muted, fontSize: theme.fs.sm, fontWeight: '400' },
  pillarScore: { fontFamily: theme.mono, fontSize: theme.fs.md, fontWeight: '700' },
  pillarTrack: { height: 6, borderRadius: 3, backgroundColor: theme.surface3, overflow: 'hidden' },
  pillarFill: { height: '100%', borderRadius: 3 },
  pillarNote: { color: theme.muted, fontSize: theme.fs.sm, lineHeight: 16 },
  checkWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  checkItem: { flexDirection: 'row', alignItems: 'center', gap: 7, width: '50%', minWidth: 260, paddingVertical: 5 },
  checkMark: { fontFamily: theme.mono, fontSize: theme.fs.md, fontWeight: '800', width: 14 },
  checkLabel: { color: theme.muted2, fontSize: theme.fs.sm, flexShrink: 1 },
  bullet: { fontSize: theme.fs.sm, lineHeight: 20, paddingVertical: 2 },
  bulletTxt: { color: theme.text },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm },
  about: { color: theme.muted2, fontSize: theme.fs.sm, lineHeight: 19 },
  method: { color: theme.muted, fontSize: theme.fs.sm, lineHeight: 17, marginTop: theme.sp.sm },
  disclaimer: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 15, fontStyle: 'italic' },
});
