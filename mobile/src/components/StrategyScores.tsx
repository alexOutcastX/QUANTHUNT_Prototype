// Shared strategy scorecard — the SAME scoring shown in every detail popup so
// a stock can be judged against every screening strategy at once (which does it
// fit best?). Self-contained: give it a symbol, it fetches /strategy-scores.
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StrategyScoresResp, api } from '../api';
import { theme } from '../theme';

const col = (s: number | null) =>
  s == null ? theme.muted : s >= 70 ? theme.green : s >= 45 ? '#e0a92e' : theme.red;

export default function StrategyScores({ symbol, compact }: { symbol: string; compact?: boolean }) {
  const [data, setData] = useState<StrategyScoresResp | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    setData(undefined);
    api
      .strategyScores(symbol)
      .then((r) => { if (alive) setData(r && !r.error ? r : null); })
      .catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
  }, [symbol]);

  if (data === undefined) return <Text style={styles.loading}>Scoring strategies…</Text>;
  if (!data || !data.strategies?.length) return null;

  // Best-fitting strategies first; drop ones with no data so the card stays honest.
  const rows = data.strategies.filter((s) => s.score != null).sort((a, b) => (b.score as number) - (a.score as number));
  if (!rows.length) return null;
  const passes = rows.filter((s) => s.pass).length;

  return (
    <View>
      <Text style={styles.title}>
        STRATEGY SCORECARD{'  '}
        <Text style={styles.sub}>· passes {passes}/{rows.length} · best fit first</Text>
      </Text>
      {rows.map((s) => (
        <View key={s.id} style={styles.row}>
          <Text style={styles.name} numberOfLines={1}>
            <Text style={{ color: s.pass ? theme.green : theme.muted }}>{s.pass ? '✓ ' : '· '}</Text>
            {s.name}
          </Text>
          <View style={styles.barWrap}>
            <View style={[styles.bar, { width: (`${s.score}%`) as `${number}%`, backgroundColor: col(s.score) }]} />
          </View>
          <Text style={[styles.score, { color: col(s.score) }]}>{s.score}</Text>
        </View>
      ))}
      {!compact ? <Text style={styles.foot}>Each 0-100: how well {data.symbol} fits that screening strategy right now. ✓ = qualifies (≥70).</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { color: theme.muted, fontSize: theme.fs.sm, marginVertical: theme.sp.sm },
  title: { color: theme.muted, fontSize: theme.fs.xs + 1, fontWeight: '800', letterSpacing: 1, marginTop: theme.sp.md, marginBottom: theme.sp.xs },
  sub: { color: theme.muted, fontSize: theme.fs.xs, fontWeight: '600', letterSpacing: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, paddingVertical: 5 },
  name: { width: 152, color: theme.text, fontSize: theme.fs.sm, fontWeight: '600' },
  barWrap: { flex: 1, height: 8, borderRadius: 4, backgroundColor: theme.surface3, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 4 },
  score: { width: 30, textAlign: 'right', fontFamily: theme.mono, fontSize: theme.fs.sm, fontWeight: '800' },
  foot: { color: theme.muted, fontSize: theme.fs.xs, lineHeight: 15, marginTop: theme.sp.xs, fontStyle: 'italic' },
});
