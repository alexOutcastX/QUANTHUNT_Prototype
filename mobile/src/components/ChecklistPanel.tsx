import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ChecklistResp, api } from '../api';
import { theme } from '../theme';

// 10-point fundamental checklist for one symbol — growth (3-yr sales/PAT/EPS
// CAGR, this-year EPS), value (P/E, PEG), cash quality (OCF, OCF/PAT) and
// balance-sheet safety (debt, interest coverage). Fed by /checklist
// (see checklist.py). Reused by the dossier and the multibagger analyser.

const vColor = (v: string) =>
  v === 'good' ? theme.green : v === 'ok' ? '#f08c00' : v === 'bad' ? theme.red : theme.muted;
const vMark = (v: string) => (v === 'good' ? '✓' : v === 'ok' ? '~' : v === 'bad' ? '✕' : '–');

export default function ChecklistPanel({ symbol }: { symbol: string }) {
  const [data, setData] = useState<ChecklistResp | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr('');
    setData(null);
    api
      .checklist(symbol)
      .then((r) => {
        if (cancelled) return;
        if (r.error && !(r.items || []).length) setErr(r.error);
        else setData(r);
      })
      .catch((e) => !cancelled && setErr(e instanceof Error ? e.message : 'Failed to load checklist'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (loading) return <Text style={s.muted}>Reading the financials…</Text>;
  if (err) return <Text style={s.err}>{err}</Text>;
  if (!data || !(data.items || []).length) return null;

  const scoreColor =
    data.score == null ? theme.muted : data.score >= 70 ? theme.green : data.score >= 45 ? '#f08c00' : theme.red;

  return (
    <View>
      <View style={s.summary}>
        <Text style={s.sumTxt}>
          {data.passed ?? 0}/{data.scored ?? 0} strong{data.ok ? ` · ${data.ok} fair` : ''}
          {(data.total ?? 0) - (data.scored ?? 0) > 0 ? ` · ${(data.total ?? 0) - (data.scored ?? 0)} n/a` : ''}
        </Text>
        {data.score != null ? (
          <View style={s.sumScoreBox}>
            <Text style={[s.sumScore, { color: scoreColor }]}>{data.score}</Text>
            <Text style={s.sumScoreSub}>/100</Text>
          </View>
        ) : null}
      </View>
      {data.items.map((it, i) => (
        <View key={it.key} style={[s.row, i < data.items.length - 1 && s.rowBorder]}>
          <Text style={[s.mark, { color: vColor(it.verdict) }]}>{vMark(it.verdict)}</Text>
          <Text style={s.label} numberOfLines={1}>{i + 1}. {it.label}</Text>
          <Text style={[s.value, { color: vColor(it.verdict) }]} numberOfLines={1}>
            {it.value ?? '—'}
          </Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  muted: { color: theme.muted, fontSize: theme.fs.sm, paddingVertical: theme.sp.sm },
  err: { color: theme.red, fontSize: theme.fs.sm, paddingVertical: theme.sp.sm },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.sm + 2,
    marginBottom: theme.sp.sm,
  },
  sumTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '700' },
  sumScoreBox: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  sumScore: { fontFamily: theme.mono, fontWeight: '800', fontSize: theme.fs.xl },
  sumScoreSub: { color: theme.muted, fontSize: theme.fs.xs + 1 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, gap: theme.sp.sm },
  rowBorder: { borderBottomColor: theme.border, borderBottomWidth: 1 },
  mark: { fontFamily: theme.mono, fontWeight: '800', fontSize: theme.fs.md, width: 16, textAlign: 'center' },
  label: { color: theme.text, fontSize: theme.fs.sm, flex: 1 },
  value: { fontFamily: theme.mono, fontSize: theme.fs.sm, fontWeight: '700', textAlign: 'right' },
});
