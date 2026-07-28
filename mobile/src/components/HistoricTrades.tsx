// Historic — the engines' track record.
//
// Unlike the outcome tracker (a personal log of setups you tapped), this is the
// server's own ledger: every BUY the recommendation engine published, and the
// strongest picks from each momentum and multibagger sweep, recorded at the
// moment of the call and marked to market since. Nothing here was entered by
// hand, and nothing can be removed — that's the point of a record.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LoggedTrade, TradeLogResp, TradeSource, TradeStatus, api } from '../api';
import { Card, ChipBtn, EmptyState, ErrorState, Loading, SectionTitle, StatTile } from '../ui';
import { theme } from '../theme';

const money = (v?: number | null) =>
  v == null || !isFinite(v) ? '—' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const signedMoney = (v?: number | null) =>
  v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '−') + money(Math.abs(v));
const pct = (v?: number | null, d = 1) =>
  v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + '%';
const date = (t?: number | null) =>
  !t ? '—' : new Date(t * 1000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
const days = (n?: number | null) => (n == null ? '—' : n === 1 ? '1 day' : `${n} days`);

type SrcFilter = TradeSource | 'all';
type StFilter = TradeStatus | 'all';

const SOURCES: { key: SrcFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'reco', label: 'Recommendations' },
  { key: 'momentum', label: 'Momentum' },
  { key: 'multibagger', label: 'Multibagger' },
];
const STATUSES: { key: StFilter; label: string }[] = [
  { key: 'all', label: 'Every trade' },
  { key: 'open', label: 'Running' },
  { key: 'won', label: 'Target hit' },
  { key: 'lost', label: 'Stopped' },
  { key: 'closed', label: 'Timed out' },
];

const STATUS_BADGE: Record<TradeStatus, string> = {
  open: 'RUNNING',
  won: 'TARGET HIT',
  lost: 'STOPPED',
  closed: 'CLOSED ON TIME',
};

function statusColor(t: LoggedTrade): string {
  if (t.status === 'won') return theme.green;
  if (t.status === 'lost') return theme.red;
  const pl = t.pl_pct;
  return pl != null && pl >= 0 ? theme.green : theme.red;
}

export default function HistoricTrades() {
  const [data, setData] = useState<TradeLogResp | null>(null);
  const [src, setSrc] = useState<SrcFilter>('all');
  const [st, setSt] = useState<StFilter>('all');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setErr('');
    try {
      setData(await api.tradeLog(src, st));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load the track record');
    } finally {
      setBusy(false);
    }
  }, [src, st]);

  useEffect(() => {
    load();
  }, [load]);

  const s = data?.summary;
  const trades = data?.trades || [];
  const totalPl = useMemo(
    () => (s ? s.total_pl_amt + s.open_pl_amt : 0),
    [s],
  );

  if (!data && busy) return <Loading label="Reading the record" />;
  if (!data && err) return <ErrorState title="Could not load the track record" detail={err} onRetry={load} />;

  return (
    <ScrollView
      contentContainerStyle={styles.body}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={theme.muted2} />}
    >
      {/* Headline record */}
      <View style={styles.tiles}>
        <StatTile label="Trades recorded" value={String(s?.total ?? 0)} sub={`${s?.open ?? 0} still running`} />
        <StatTile
          label="Win rate"
          value={s?.win_rate == null ? '—' : s.win_rate.toFixed(0) + '%'}
          sub={s ? `${s.wins}W · ${s.losses}L of ${s.settled} settled` : undefined}
          color={s?.win_rate != null && s.win_rate >= 50 ? theme.green : theme.muted2}
        />
        <StatTile
          label="Total P/L"
          value={signedMoney(totalPl)}
          sub={s ? `${signedMoney(s.total_pl_amt)} booked · ${signedMoney(s.open_pl_amt)} running` : undefined}
          color={totalPl >= 0 ? theme.green : theme.red}
        />
        <StatTile
          label="Average return"
          value={pct(s?.avg_pl_pct)}
          sub={s?.avg_hold_days != null ? `over ${days(s.avg_hold_days)} held` : undefined}
          color={(s?.avg_pl_pct ?? 0) >= 0 ? theme.green : theme.red}
        />
      </View>

      {s && (s.best || s.worst) ? (
        <View style={styles.extremes}>
          {s.best ? (
            <Text style={styles.extreme}>
              Best call <Text style={styles.extremeSym}>{s.best.symbol}</Text>{' '}
              <Text style={{ color: theme.green }}>{pct(s.best.pl_pct)}</Text>
            </Text>
          ) : null}
          {s.worst ? (
            <Text style={styles.extreme}>
              Worst <Text style={styles.extremeSym}>{s.worst.symbol}</Text>{' '}
              <Text style={{ color: theme.red }}>{pct(s.worst.pl_pct)}</Text>
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Filters */}
      <View style={styles.filters}>
        {SOURCES.map((o) => (
          <ChipBtn
            key={o.key}
            label={o.key === 'all' ? o.label : `${o.label} (${data?.by_source?.[o.key as TradeSource] ?? 0})`}
            on={src === o.key}
            onPress={() => setSrc(o.key)}
          />
        ))}
      </View>
      <View style={styles.filters}>
        {STATUSES.map((o) => (
          <ChipBtn key={o.key} label={o.label} on={st === o.key} onPress={() => setSt(o.key)} />
        ))}
      </View>

      {err ? <Text style={styles.err}>{err}</Text> : null}

      {!trades.length ? (
        <EmptyState
          icon="▤"
          title="Nothing recorded yet"
          hint="Every BUY the recommendation engine publishes, and the top picks from each momentum and multibagger sweep, land here automatically with their entry, levels and rationale."
        />
      ) : (
        <>
          <SectionTitle>{trades.length} trades</SectionTitle>
          {trades.map((t) => {
            const col = statusColor(t);
            const expanded = openId === t.id;
            return (
              <Card key={t.id} style={styles.row}>
                <TouchableOpacity onPress={() => setOpenId(expanded ? null : t.id)} activeOpacity={0.8}>
                  <View style={styles.rowTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sym} numberOfLines={1}>
                        {t.symbol}
                        {t.name ? <Text style={styles.name}> · {t.name}</Text> : null}
                      </Text>
                      <Text style={styles.meta}>
                        {t.source_label}
                        {t.strategy ? ` · ${t.strategy}` : ''}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <View style={[styles.badge, { borderColor: col }]}>
                        <Text style={[styles.badgeTxt, { color: col }]}>{STATUS_BADGE[t.status]}</Text>
                      </View>
                      <Text style={[styles.pl, { color: col }]}>{pct(t.pl_pct)}</Text>
                      <Text style={[styles.plAmt, { color: col }]}>{signedMoney(t.pl_amt)}</Text>
                    </View>
                  </View>

                  {/* The five numbers that define the trade */}
                  <View style={styles.grid}>
                    <Cell k="Entry" v={money(t.entry)} sub={date(t.opened)} />
                    <Cell
                      k={t.status === 'open' ? 'Now' : 'Exit'}
                      v={money(t.status === 'open' ? t.last : t.exit)}
                      sub={t.status === 'open' ? 'live' : date(t.closed)}
                    />
                    <Cell k="Hold" v={days(t.hold_days)} sub={t.status === 'open' ? 'running' : 'closed'} />
                    <Cell k="Stop" v={money(t.stop)} tone={t.stop == null ? 'muted' : 'red'} />
                    <Cell k="Target" v={money(t.target)} tone={t.target == null ? 'muted' : 'green'} />
                  </View>
                  <Text style={styles.tapHint}>{expanded ? 'Tap to collapse' : 'Tap for the rationale'}</Text>
                </TouchableOpacity>

                {expanded ? (
                  <View style={styles.detail}>
                    <Text style={styles.detailHead}>Why it was picked</Text>
                    {t.rationale.length ? (
                      t.rationale.map((r, i) => (
                        <Text key={i} style={styles.reason}>
                          • {r}
                        </Text>
                      ))
                    ) : (
                      <Text style={styles.reason}>The engine published no written rationale for this call.</Text>
                    )}
                    {Object.keys(t.meta || {}).length ? (
                      <View style={styles.metaWrap}>
                        {Object.entries(t.meta).map(([k, v]) => (
                          <View key={k} style={styles.metaPill}>
                            <Text style={styles.metaK}>{k.replace(/_/g, ' ')}</Text>
                            <Text style={styles.metaV}>{String(v)}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                    <Text style={styles.horizon}>
                      {t.status === 'open'
                        ? `Runs to ${date(t.opened + t.horizon_days * 86400)} unless the ${
                            t.target != null ? 'target' : 'horizon'
                          } resolves it sooner.`
                        : t.status === 'closed'
                          ? `Held its full ${days(t.horizon_days)} horizon and was closed at the market.`
                          : `Settled at the ${t.status === 'won' ? 'target' : 'stop'}.`}
                    </Text>
                  </View>
                ) : null}
              </Card>
            );
          })}
        </>
      )}

      {data ? (
        <Text style={styles.note}>
          Simulated, and recorded by the server the moment each call was published — no entry is added by
          hand and none can be deleted. Every trade is sized at a flat {money(data.rules.notional)} so no
          position can flatter the record. Recommendations enter on every BUY; the momentum radar logs its
          top {data.rules.momentum_top} setups scoring {data.rules.momentum_min_score}+ per sweep and the
          multibagger screen its top {data.rules.multibagger_top} — the rest of each sweep is shown on its
          own tab but not tracked here. A trade closes at its target or stop, or at the market once its
          horizon is up ({data.rules.horizon_days.reco}d for recommendations,{' '}
          {data.rules.horizon_days.momentum}d momentum, {data.rules.horizon_days.multibagger}d
          multibagger). Past results are not a promise of future ones, and this is research, not investment
          advice.
        </Text>
      ) : null}
    </ScrollView>
  );
}

function Cell({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: 'red' | 'green' | 'muted' }) {
  const col = tone === 'red' ? theme.red : tone === 'green' ? theme.green : tone === 'muted' ? theme.muted : theme.text;
  return (
    <View style={styles.cell}>
      <Text style={styles.cellK}>{k}</Text>
      <Text style={[styles.cellV, { color: col }]}>{v}</Text>
      {sub ? <Text style={styles.cellSub}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: theme.sp.lg, paddingBottom: 44 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm },
  extremes: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.md, marginTop: theme.sp.sm },
  extreme: { color: theme.muted2, fontSize: theme.fs.sm },
  extremeSym: { color: theme.text, fontFamily: theme.mono, fontWeight: '700' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginTop: theme.sp.md },
  err: { color: theme.red, fontSize: theme.fs.sm, marginTop: theme.sp.md },
  row: { marginBottom: theme.sp.sm, gap: theme.sp.sm },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp.sm },
  sym: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.md + 1, fontWeight: '800' },
  name: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '600' },
  meta: { color: theme.muted2, fontSize: theme.fs.xs + 1, marginTop: 3 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeTxt: { fontSize: theme.fs.xs, fontWeight: '800', letterSpacing: 0.4 },
  pl: { fontFamily: theme.mono, fontSize: theme.fs.md, fontWeight: '800', marginTop: 4 },
  plAmt: { fontFamily: theme.mono, fontSize: theme.fs.xs + 1, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginTop: theme.sp.sm },
  cell: { minWidth: 68, gap: 1 },
  cellK: { color: theme.muted, fontSize: theme.fs.xs, letterSpacing: 0.3 },
  cellV: { fontFamily: theme.mono, fontSize: theme.fs.sm, fontWeight: '700' },
  cellSub: { color: theme.muted, fontSize: theme.fs.xs },
  tapHint: { color: theme.muted, fontSize: theme.fs.xs, marginTop: theme.sp.sm },
  detail: { borderTopColor: theme.border, borderTopWidth: 1, paddingTop: theme.sp.sm, gap: 4 },
  detailHead: { color: theme.muted, fontSize: theme.fs.xs + 1, fontWeight: '800', letterSpacing: 1 },
  reason: { color: theme.muted2, fontSize: theme.fs.sm, lineHeight: 19 },
  metaWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: theme.sp.sm },
  metaPill: {
    flexDirection: 'row', gap: 5, alignItems: 'baseline', backgroundColor: theme.surface2,
    borderRadius: theme.radius.sm, paddingHorizontal: 8, paddingVertical: 3,
  },
  metaK: { color: theme.muted, fontSize: theme.fs.xs },
  metaV: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.xs + 1, fontWeight: '700' },
  horizon: { color: theme.muted, fontSize: theme.fs.xs + 1, marginTop: theme.sp.sm, lineHeight: 17 },
  note: { color: theme.muted, fontSize: theme.fs.sm, marginTop: theme.sp.lg, lineHeight: 18 },
});
