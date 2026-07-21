import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TimeframesResp, api } from '../api';
import { theme } from '../theme';

// Multi-timeframe momentum read for one symbol: an overall score/rating, then a
// per-timeframe card (5-minute → weekly) with its own score, trade rating,
// support/resistance and Fibonacci retracement levels. Fed by /timeframes
// (see timeframes.py). Reused by the Momentum detail popup and the analyser.

const biasColor = (bias?: string) =>
  bias === 'bullish' ? theme.green : bias === 'bearish' ? theme.red : theme.muted2;
const ratingColor = (r?: string) =>
  r === 'Strong Buy' || r === 'Buy' ? theme.green
    : r === 'Weak' || r === 'Avoid' ? theme.red : theme.muted2;
const fmt = (v?: number | null) =>
  v == null || !isFinite(v) ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

export default function TimeframePanel({ symbol }: { symbol: string }) {
  const [data, setData] = useState<TimeframesResp | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr('');
    setData(null);
    api
      .timeframes(symbol)
      .then((r) => {
        if (cancelled) return;
        if (r.error) setErr(r.error);
        else setData(r);
      })
      .catch((e) => !cancelled && setErr(e instanceof Error ? e.message : 'Failed to load timeframes'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (loading) return <Text style={s.muted}>Reading every timeframe (5-min → weekly)…</Text>;
  if (err) return <Text style={s.err}>{err}</Text>;
  if (!data) return null;

  const ov = data.overall;
  const tfs = (data.timeframes || []).filter((t) => t.score != null);

  return (
    <View>
      {ov && ov.score != null ? (
        <View style={s.overall}>
          <View>
            <Text style={s.ovLbl}>OVERALL MOMENTUM</Text>
            <Text style={[s.ovRating, { color: ratingColor(ov.rating) }]}>{ov.rating}</Text>
          </View>
          <View style={s.ovScoreBox}>
            <Text style={[s.ovScore, { color: biasColor(ov.bias) }]}>{ov.score}</Text>
            <Text style={s.ovScoreSub}>/100 · {ov.bias}</Text>
          </View>
        </View>
      ) : null}

      {tfs.length === 0 ? (
        <Text style={s.muted}>No timeframe data available right now — intraday feeds can be rate-limited; try again shortly.</Text>
      ) : null}

      {tfs.map((t) => {
        const bc = biasColor(t.bias);
        const sup = (t.supports || []).map(fmt).join('  ');
        const res = (t.resistances || []).map(fmt).join('  ');
        const fib = t.fib || {};
        return (
          <View key={t.tf} style={s.tfCard}>
            <View style={s.tfHead}>
              <Text style={s.tfLabel}>{t.label}</Text>
              <View style={s.tfHeadRight}>
                <Text style={[s.tfRating, { color: ratingColor(t.rating) }]}>{t.rating || t.bias}</Text>
                <Text style={[s.tfScore, { color: bc }]}>{t.score}</Text>
              </View>
            </View>
            <View style={s.tfMetaRow}>
              {t.rsi != null ? <Text style={s.tfMeta}>RSI {t.rsi.toFixed(0)}</Text> : null}
              {t.vs_ema20 != null ? (
                <Text style={[s.tfMeta, { color: t.vs_ema20 >= 0 ? theme.green : theme.red }]}>
                  EMA20 {t.vs_ema20 >= 0 ? '+' : ''}{t.vs_ema20.toFixed(1)}%
                </Text>
              ) : null}
              {t.vs_ema50 != null ? (
                <Text style={[s.tfMeta, { color: t.vs_ema50 >= 0 ? theme.green : theme.red }]}>
                  EMA50 {t.vs_ema50 >= 0 ? '+' : ''}{t.vs_ema50.toFixed(1)}%
                </Text>
              ) : null}
            </View>
            <View style={s.lvlRow}>
              <Text style={s.lvlLbl}>Resistance</Text>
              <Text style={[s.lvlVal, { color: theme.red }]}>{res || '—'}</Text>
            </View>
            <View style={s.lvlRow}>
              <Text style={s.lvlLbl}>Support</Text>
              <Text style={[s.lvlVal, { color: theme.green }]}>{sup || '—'}</Text>
            </View>
            {Object.keys(fib).length ? (
              <View style={s.fibWrap}>
                <Text style={s.lvlLbl}>Fibonacci</Text>
                <View style={s.fibRow}>
                  {['0.236', '0.382', '0.5', '0.618', '0.786'].map((k) =>
                    fib[k] != null ? (
                      <Text key={k} style={s.fibChip}>
                        <Text style={s.fibK}>{k}</Text> {fmt(fib[k])}
                      </Text>
                    ) : null,
                  )}
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  muted: { color: theme.muted, fontSize: theme.fs.sm, paddingVertical: theme.sp.sm },
  err: { color: theme.red, fontSize: theme.fs.sm, paddingVertical: theme.sp.sm },
  overall: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.md,
    marginBottom: theme.sp.sm,
  },
  ovLbl: { color: theme.muted, fontSize: theme.fs.xs, letterSpacing: 0.5, marginBottom: 2 },
  ovRating: { fontSize: theme.fs.md, fontWeight: '800' },
  ovScoreBox: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  ovScore: { fontFamily: theme.mono, fontWeight: '800', fontSize: theme.fs.xxl },
  ovScoreSub: { color: theme.muted, fontSize: theme.fs.xs + 1 },
  tfCard: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    padding: theme.sp.md,
    marginBottom: theme.sp.sm,
    gap: 4,
  },
  tfHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tfLabel: { color: theme.text, fontSize: theme.fs.md, fontWeight: '700' },
  tfHeadRight: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm },
  tfRating: { fontSize: theme.fs.sm, fontWeight: '800' },
  tfScore: { fontFamily: theme.mono, fontWeight: '800', fontSize: theme.fs.lg },
  tfMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.md, marginBottom: 2 },
  tfMeta: { color: theme.muted2, fontFamily: theme.mono, fontSize: theme.fs.xs + 1 },
  lvlRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm },
  lvlLbl: { color: theme.muted, fontSize: theme.fs.xs + 1, width: 74 },
  lvlVal: { fontFamily: theme.mono, fontSize: theme.fs.sm, fontWeight: '700', flex: 1 },
  fibWrap: { marginTop: 2 },
  fibRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginTop: 2 },
  fibChip: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.xs + 1 },
  fibK: { color: theme.muted },
});
