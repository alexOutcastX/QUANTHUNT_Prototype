// Calibration — the honesty page. Shows what each signal engine's setups have
// ACTUALLY done: realised hit-rate, average R and sample size, computed from
// the paper-trade outcome log (yours locally; everyone's via the server once
// accounts sync). Below the minimum sample the page says so instead of
// inventing a percentage — that restraint is the whole point.
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { API_BASE } from '../api';
import { EngineCal, MIN_SAMPLE, calibrate } from '../calibration';
import { loadPaperTrades } from '../paperTrades';
import { Card, EmptyState, SectionTitle } from '../ui';
import { theme } from '../theme';

type ServerCal = {
  engines: { source: string; n: number; closed: number; wins: number; hit_rate: number | null; avg_r: number | null }[];
  min_sample: number;
  accounts: number;
};

const pctS = (v: number | null) => (v == null ? '—' : (v * 100).toFixed(0) + '%');
const rS = (v: number | null) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + 'R');
const rateColor = (v: number | null) =>
  v == null ? theme.muted : v >= 0.55 ? theme.green : v >= 0.45 ? '#b7791f' : theme.red;

function CalTable({ rows, minSample }: { rows: EngineCal[] | ServerCal['engines']; minSample: number }) {
  if (!rows.length) return <EmptyState icon="◎" title="No outcomes yet" hint="Log paper trades from any setup — results accumulate here." />;
  return (
    <View>
      <View style={s.hrow}>
        <Text style={[s.hcell, { flex: 1.6 }]}>ENGINE</Text>
        <Text style={s.hcell}>CLOSED</Text>
        <Text style={s.hcell}>HIT RATE</Text>
        <Text style={s.hcell}>AVG R</Text>
      </View>
      {rows.map((r) => {
        const hit = 'hitRate' in r ? r.hitRate : r.hit_rate;
        const avg = 'avgR' in r ? r.avgR : r.avg_r;
        return (
          <View key={r.source} style={s.row}>
            <Text style={[s.cell, { flex: 1.6, color: theme.text }]} numberOfLines={1}>{r.source}</Text>
            <Text style={[s.cell, theme.numCell]}>{r.closed}<Text style={s.dim}>/{r.n}</Text></Text>
            <Text style={[s.cell, theme.numCell, { color: rateColor(hit) }]}>
              {r.closed < minSample ? 'n<' + minSample : pctS(hit)}
            </Text>
            <Text style={[s.cell, theme.numCell, { color: avg == null ? theme.muted : avg >= 0 ? theme.green : theme.red }]}>{rS(avg)}</Text>
          </View>
        );
      })}
    </View>
  );
}

export default function CalibrationScreen() {
  const [local, setLocal] = useState<EngineCal[]>([]);
  const [localOverall, setLocalOverall] = useState<EngineCal | null>(null);
  const [server, setServer] = useState<ServerCal | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const trades = await loadPaperTrades();
    const c = calibrate(trades);
    setLocal(c.engines);
    setLocalOverall(c.overall);
    try {
      const r = await fetch(API_BASE + '/calibration', { credentials: 'include' });
      setServer((await r.json()) as ServerCal);
    } catch {
      setServer(null);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <ScrollView
      style={s.wrap}
      contentContainerStyle={s.pad}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
          tintColor={theme.muted2}
        />
      }
    >
      <Text style={s.h1}>Calibration</Text>
      <Text style={s.sub}>
        Realised outcomes of logged setups — target hit vs stop hit, from the paper-trade
        tracker. Hit-rates appear only after {MIN_SAMPLE} closed trades per engine; below that the
        honest answer is “insufficient sample”, not a percentage.
      </Text>

      <Card style={s.card}>
        <SectionTitle>Your log</SectionTitle>
        {localOverall && localOverall.closed > 0 ? (
          <Text style={s.meta}>
            {localOverall.closed} closed of {localOverall.n} logged
            {localOverall.hitRate != null ? ` · overall ${pctS(localOverall.hitRate)} · ${rS(localOverall.avgR)}` : ''}
          </Text>
        ) : null}
        <CalTable rows={local} minSample={MIN_SAMPLE} />
      </Card>

      <Card style={s.card}>
        <SectionTitle>Community (all synced accounts)</SectionTitle>
        {server ? (
          <>
            <Text style={s.meta}>{server.accounts} account log{server.accounts === 1 ? '' : 's'} aggregated</Text>
            <CalTable rows={server.engines} minSample={server.min_sample} />
          </>
        ) : (
          <Text style={s.meta}>Community aggregate unavailable — sign in and sync to contribute.</Text>
        )}
      </Card>

      <Text style={s.foot}>
        Method: a win books the planned reward as a positive R multiple, a loss books −1R (stopped
        at the planned stop). Slippage and charges are not included in paper outcomes. This is
        measurement of the engines' mechanical rules, not a performance promise.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  pad: { padding: theme.sp.lg, gap: theme.sp.md },
  h1: { color: theme.text, fontSize: theme.fs.xxl, fontWeight: '800' },
  sub: { color: theme.muted, fontSize: theme.fs.sm, lineHeight: 19 },
  card: { padding: theme.sp.lg, gap: theme.sp.sm },
  meta: { color: theme.muted2, fontSize: theme.fs.sm, fontFamily: theme.mono },
  hrow: { flexDirection: 'row', borderBottomColor: theme.border2, borderBottomWidth: 1, paddingBottom: 6 },
  hcell: { flex: 1, color: theme.muted, fontSize: theme.fs.xs, fontWeight: '800', letterSpacing: 0.5, textAlign: 'right' },
  row: { flexDirection: 'row', paddingVertical: 7, borderBottomColor: theme.border, borderBottomWidth: 1, alignItems: 'center' },
  cell: { flex: 1, color: theme.muted2, fontSize: theme.fs.sm, textAlign: 'right' },
  dim: { color: theme.muted, fontSize: theme.fs.xs },
  foot: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 16 },
});
