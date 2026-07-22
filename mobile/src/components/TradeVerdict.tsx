// "Should I take this trade?" popup. Analyses any symbol through the same
// recommendation engine the Long-term list uses, then shows a plain verdict
// (Take / Watch / Avoid) plus the setup, a risk score and the reasoning.
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Recommendation, TimeframesResp, api } from '../api';
import { addPaperTrade } from '../paperTrades';
import StrategyScores from './StrategyScores';
import { Loading, RiskBadge } from '../ui';
import { lvlLabels, useAdvisory } from '../flags';
import { theme } from '../theme';

const money = (v?: number | null) => (v == null || !isFinite(v) ? '—' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const pct = (v?: number | null, d = 1) => (v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + '%');
const biasColor = (b?: string) =>
  b === 'bullish' ? theme.green : b === 'bearish' ? theme.red : b === 'neutral' ? '#e0a92e' : theme.muted;
const scoreColor = (s: number | null | undefined) =>
  s == null ? theme.muted : s >= 60 ? theme.green : s <= 40 ? theme.red : '#e0a92e';

type Verdict = { label: string; color: string; sub: string };
// Two vocabularies for the same mechanical output: advisory framing is only
// shown when the server's advisory_mode flag allows it (see flags.ts) — the
// neutral variant describes rule alignment without telling anyone to trade.
function verdictFor(r: Recommendation, advisory: boolean): Verdict {
  const c = r.confidence ?? 0;
  if (advisory) {
    if (r.action === 'BUY' && c >= 68) return { label: 'TAKE THIS TRADE', color: theme.green, sub: 'Setup + conviction line up. Enter near the level with the stop below.' };
    if (r.action === 'BUY') return { label: 'TAKEABLE — SIZE DOWN', color: '#e0a92e', sub: 'A valid buy setup but conviction is moderate. Consider a smaller position.' };
    if (r.action === 'WATCH') return { label: 'WAIT / WATCH', color: '#e0a92e', sub: 'Not a clean entry yet — put it on the watchlist and wait for confirmation.' };
    return { label: 'AVOID FOR NOW', color: theme.red, sub: 'The setup or risk/reward does not justify a trade here.' };
  }
  if (r.action === 'BUY' && c >= 68) return { label: 'STRONG RULE ALIGNMENT', color: theme.green, sub: 'The quantitative screens align at this level. Analytics only — not advice.' };
  if (r.action === 'BUY') return { label: 'MODERATE ALIGNMENT', color: '#e0a92e', sub: 'Some screens align; the aggregate score is middling. Analytics only — not advice.' };
  if (r.action === 'WATCH') return { label: 'NO ALIGNMENT YET', color: '#e0a92e', sub: 'The screens have not lined up on this name at current prices.' };
  return { label: 'WEAK ALIGNMENT', color: theme.red, sub: 'The screens score this setup poorly at current prices.' };
}

export default function TradeVerdict({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const [rec, setRec] = useState<Recommendation | null | undefined>(undefined);
  const [err, setErr] = useState('');
  const [papered, setPapered] = useState(false);
  const [tf, setTf] = useState<TimeframesResp | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    setTf(undefined);
    api.timeframes(symbol).then((r) => { if (alive) setTf(r && !r.error ? r : null); }).catch(() => { if (alive) setTf(null); });
    return () => { alive = false; };
  }, [symbol]);

  useEffect(() => {
    let alive = true;
    api
      .recommendation(symbol)
      .then((r) => {
        if (!alive) return;
        if ((r as Recommendation).error) setErr((r as Recommendation).error || 'No setup');
        else setRec(r);
      })
      .catch((e) => {
        if (alive) {
          setErr(e?.message || 'Could not analyse');
          setRec(null);
        }
      });
    return () => {
      alive = false;
    };
  }, [symbol]);

  const adv = useAdvisory();
  const L = lvlLabels(adv);
  const v = rec ? verdictFor(rec, adv) : null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.head}>
          <Text style={styles.sym}>{symbol}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.close}><Text style={styles.closeTxt}>✕</Text></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.body} bounces={false}>
          {rec === undefined ? (
            <Loading label={`Analysing ${symbol}…`} />
          ) : !rec ? (
            <View style={styles.center}>
              <Text style={styles.errIcon}>⚠</Text>
              <Text style={styles.errTxt}>{err || `Couldn't analyse ${symbol}. The data feed may be busy — try again shortly.`}</Text>
            </View>
          ) : (
            <>
              {v ? (
                <View style={[styles.verdict, { borderColor: v.color }]}>
                  <Text style={[styles.verdictLabel, { color: v.color }]}>{v.label}</Text>
                  <Text style={styles.verdictSub}>{v.sub}</Text>
                  <Text style={styles.verdictNote}>This is a blended daily read — see the per-timeframe scores below (they can disagree).</Text>
                </View>
              ) : null}

              {/* Near → far horizon outlook */}
              {tf === undefined ? (
                <Text style={styles.tfLoading}>Reading 5-minute → weekly timeframes…</Text>
              ) : tf && tf.horizons?.length ? (
                <>
                  <Text style={styles.secTitle}>OUTLOOK · NEAR → FAR</Text>
                  <View style={styles.hzRow}>
                    {tf.horizons.map((h) => (
                      <View key={h.key} style={styles.hzCell}>
                        <Text style={styles.hzLbl}>{h.label}</Text>
                        <Text style={[styles.hzScore, { color: scoreColor(h.score) }]}>{h.score == null ? '—' : h.score}</Text>
                        <Text style={[styles.hzBias, { color: biasColor(h.bias) }]}>{h.bias}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={styles.secTitle}>TIMEFRAME READ · 5-MIN → WEEKLY</Text>
                  {tf.timeframes.map((t) => (
                    <View key={t.tf} style={styles.tfRow}>
                      <Text style={styles.tfLabel}>{t.label}</Text>
                      <View style={styles.tfMid}>
                        <View style={styles.tfBarWrap}>
                          <View style={[styles.tfBar, { width: (`${t.score ?? 0}%`) as `${number}%`, backgroundColor: scoreColor(t.score) }]} />
                        </View>
                        <Text style={styles.tfMeta} numberOfLines={1}>
                          {t.score == null ? 'no data' : `RSI ${t.rsi ?? '—'} · vs 20EMA ${pct(t.vs_ema20)} · vs 50EMA ${pct(t.vs_ema50)}`}
                        </Text>
                      </View>
                      <Text style={[styles.tfBias, { color: biasColor(t.bias) }]}>{t.score == null ? 'n/a' : `${t.bias} ${t.score}`}</Text>
                    </View>
                  ))}
                </>
              ) : null}

              {rec.name ? <Text style={styles.name}>{rec.name}</Text> : null}
              <View style={styles.badges}>
                <View style={styles.metaPill}><Text style={styles.metaLbl}>{adv ? 'CONFIDENCE' : 'SCORE'}</Text><Text style={styles.metaVal}>{rec.confidence}</Text></View>
                <RiskBadge input={{ rr: rec.rr, stop_pct: rec.stop_pct, score: rec.confidence }} />
              </View>

              <View style={styles.grid}>
                <Cell k={L.entry} v={money(rec.entry)} />
                <Cell k={L.stop} v={money(rec.stop)} s={pct(rec.stop_pct)} c={theme.red} />
                <Cell k={L.target} v={money(rec.target)} s={pct(rec.upside_pct)} c={theme.green} />
                <Cell k="R : R" v={rec.rr != null ? `${rec.rr.toFixed(1)}:1` : '—'} />
                <Cell k="Fundamental" v={rec.fundamental_score != null ? String(rec.fundamental_score) : '—'} />
                <Cell k="Momentum" v={String(rec.momentum_score)} />
                <Cell k="Pattern" v={String(rec.pattern_score)} />
                {adv ? <Cell k="ETA" v={rec.eta || '—'} /> : null}
              </View>

              <StrategyScores symbol={symbol} />

              {rec.rationale?.length ? (
                <>
                  <Text style={styles.secTitle}>WHY</Text>
                  {rec.rationale.map((s, i) => <Text key={i} style={styles.why}>▸ {s}</Text>)}
                </>
              ) : null}

              <TouchableOpacity
                style={[styles.paperBtn, papered && { borderColor: theme.green }]}
                disabled={papered}
                onPress={async () => {
                  await addPaperTrade({ symbol: rec.symbol, name: rec.name || undefined, side: 'long', source: 'Analyse', entry: rec.entry, stop: rec.stop, target: rec.target });
                  setPapered(true);
                }}
                activeOpacity={0.75}
              >
                <Text style={[styles.paperTxt, papered && { color: theme.green }]}>{papered ? '✓ Logged to Paper trades' : '✎ Paper trade this setup'}</Text>
              </TouchableOpacity>

              <Text style={styles.disc}>
                Automated read from fundamentals + momentum + chart patterns — a decision aid, not advice.
                Verify on your own chart and manage risk. Markets can go against any setup.
              </Text>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Cell({ k, v, s, c }: { k: string; v: string; s?: string; c?: string }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellK}>{k}</Text>
      <Text style={[styles.cellV, c ? { color: c } : null]} numberOfLines={1}>{v}</Text>
      {s ? <Text style={[styles.cellS, c ? { color: c } : null]}>{s}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '90%', backgroundColor: theme.surface, borderTopLeftRadius: theme.radius.xl, borderTopRightRadius: theme.radius.xl, borderColor: theme.border2, borderWidth: 1 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.lg, paddingBottom: theme.sp.sm },
  sym: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.xl, fontWeight: '800' },
  close: { width: 34, height: 34, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1 },
  closeTxt: { color: theme.muted2, fontSize: theme.fs.md },
  body: { padding: theme.sp.lg, paddingTop: theme.sp.sm, paddingBottom: 40 },
  center: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  errIcon: { color: theme.muted, fontSize: 30 },
  errTxt: { color: theme.muted2, fontSize: theme.fs.md, textAlign: 'center', lineHeight: 20 },
  verdict: { borderWidth: 1.5, borderRadius: theme.radius.lg, padding: theme.sp.lg, marginBottom: theme.sp.md, backgroundColor: theme.surface2 },
  verdictLabel: { fontSize: theme.fs.xl, fontWeight: '900', letterSpacing: 0.3 },
  verdictSub: { color: theme.muted2, fontSize: theme.fs.sm, marginTop: 6, lineHeight: 19 },
  verdictNote: { color: theme.muted, fontSize: theme.fs.xs + 1, marginTop: 6, fontStyle: 'italic' },
  tfLoading: { color: theme.muted, fontSize: theme.fs.sm, marginBottom: theme.sp.md },
  hzRow: { flexDirection: 'row', gap: theme.sp.sm, marginBottom: theme.sp.xs },
  hzCell: { flex: 1, alignItems: 'center', backgroundColor: theme.surface2, borderColor: theme.border, borderWidth: 1, borderRadius: theme.radius.sm + 2, paddingVertical: theme.sp.sm, gap: 2 },
  hzLbl: { color: theme.muted, fontSize: 9, fontWeight: '700', letterSpacing: 0.3, textAlign: 'center' },
  hzScore: { fontFamily: theme.mono, fontSize: theme.fs.lg, fontWeight: '800' },
  hzBias: { fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.3 },
  tfRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, paddingVertical: 6, borderBottomColor: theme.border, borderBottomWidth: 1 },
  tfLabel: { width: 68, color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
  tfMid: { flex: 1, gap: 3 },
  tfBarWrap: { height: 6, borderRadius: 3, backgroundColor: theme.surface3, overflow: 'hidden' },
  tfBar: { height: '100%', borderRadius: 3 },
  tfMeta: { color: theme.muted, fontFamily: theme.mono, fontSize: theme.fs.xs },
  tfBias: { width: 84, textAlign: 'right', fontFamily: theme.mono, fontSize: theme.fs.xs + 1, fontWeight: '800' },
  name: { color: theme.muted2, fontSize: theme.fs.md, marginBottom: theme.sp.sm },
  badges: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, marginBottom: theme.sp.md, flexWrap: 'wrap' },
  metaPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderColor: theme.border2, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  metaLbl: { color: theme.muted, fontSize: theme.fs.xs, fontWeight: '800', letterSpacing: 0.5 },
  metaVal: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '25%', paddingVertical: theme.sp.sm },
  cellK: { color: theme.muted, fontSize: theme.fs.xs, letterSpacing: 0.4, textTransform: 'uppercase' },
  cellV: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm + 1, fontWeight: '700', marginTop: 3 },
  cellS: { fontFamily: theme.mono, fontSize: theme.fs.xs + 1, marginTop: 1 },
  secTitle: { color: theme.muted, fontSize: theme.fs.xs + 1, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', marginTop: theme.sp.md, marginBottom: theme.sp.xs },
  why: { color: theme.muted2, fontSize: theme.fs.sm, lineHeight: 19, marginBottom: 2 },
  paperBtn: { marginTop: theme.sp.lg, borderColor: theme.border2, borderWidth: 1, borderRadius: theme.radius.md, paddingVertical: 11, alignItems: 'center' },
  paperTxt: { color: theme.muted2, fontSize: theme.fs.sm + 1, fontWeight: '700' },
  disc: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 17, marginTop: theme.sp.lg },
});
