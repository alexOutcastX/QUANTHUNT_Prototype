// Cases — TaurEye's own investment baskets.
//
// Each case is a themed basket the engine builds from the analyser's scored
// universe: sector leaders, cap bands, strategy screens and the multibagger
// flagship. Baskets are struck once a year; in between the engine books profit
// on runaways, exits broken theses and adds from the reserve bench — every move
// written to a ledger you can read on the card.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { CaseAction, CaseDetail, CaseKind, CaseSummary, CasesResp, api } from '../api';
import { Card, ChipBtn, EmptyState, ErrorState, Loading, SectionTitle, StatTile } from '../ui';
import { theme } from '../theme';

const money = (v?: number | null, d = 0) =>
  v == null || !isFinite(v) ? '—' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: d });
const pct = (v?: number | null, d = 1) =>
  v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + '%';
const wpct = (v?: number | null) => (v == null ? '—' : (v * 100).toFixed(1) + '%');
const date = (t?: number | null) =>
  !t ? '—' : new Date(t * 1000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });

const KINDS: { key: CaseKind | 'all'; label: string }[] = [
  { key: 'all', label: 'All cases' },
  { key: 'multibagger', label: 'Multibagger' },
  { key: 'sector', label: 'Sector' },
  { key: 'cap', label: 'Market cap' },
  { key: 'strategy', label: 'Strategy' },
];

const ACTION_COLOR: Record<CaseAction['action'], string> = {
  add: theme.brand,
  book: theme.green,
  exit: theme.red,
  rebalance: theme.muted2,
};
const ACTION_LABEL: Record<CaseAction['action'], string> = {
  add: 'ADDED',
  book: 'BOOKED',
  exit: 'EXITED',
  rebalance: 'REBALANCED',
};

export default function CasesPanel() {
  const [data, setData] = useState<CasesResp | null>(null);
  const [kind, setKind] = useState<CaseKind | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setErr('');
    try {
      setData(await api.cases());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load the cases');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const list = useMemo(
    () => (data?.cases || []).filter((c) => kind === 'all' || c.kind === kind),
    [data, kind],
  );

  if (!data && busy) return <Loading label="Building the cases" />;
  if (!data && err) return <ErrorState title="Could not load the cases" detail={err} onRetry={load} />;

  const building = data?.progress?.running || data?.status === 'running';
  const waiting = data?.progress?.status === 'waiting';

  return (
    <ScrollView
      contentContainerStyle={styles.body}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={theme.muted2} />}
    >
      <View style={styles.filters}>
        {KINDS.map((k) => (
          <ChipBtn key={k.key} label={k.label} on={kind === k.key} onPress={() => setKind(k.key)} />
        ))}
      </View>

      {building ? <Text style={styles.notice}>The engine is rebuilding the cases — numbers will refresh shortly.</Text> : null}
      {err ? <Text style={styles.err}>{err}</Text> : null}

      {!list.length ? (
        <EmptyState
          icon="◫"
          title={waiting ? 'Cases are still being built' : 'No cases in this group yet'}
          hint={
            waiting
              ? 'The engine builds every basket from the multibagger screen. That sweep runs on a 12-hour cycle — the cases appear once it has scored the universe.'
              : 'Try another group, or pull to refresh.'
          }
        />
      ) : (
        <>
          <SectionTitle>{list.length} cases</SectionTitle>
          {list.map((c) => (
            <CaseCard
              key={c.id}
              c={c}
              expanded={openId === c.id}
              onToggle={() => setOpenId(openId === c.id ? null : c.id)}
            />
          ))}
        </>
      )}

      {data ? (
        <Text style={styles.note}>
          Every case is built by the engine from the analyser's own scores — nothing is hand-picked.
          A basket holds {String(data.rules.target_n)} names, each scoring{' '}
          {String(data.rules.min_score)}+, weighted by score and capped so no single stock dominates.
          Baskets are struck once a year; between vintages the engine books{' '}
          {String(data.rules.book_at_pct)}%+ runners, exits anything that falls below a{' '}
          {String(data.rules.exit_score)} score or {String(data.rules.exit_loss_pct)}%, and replaces
          it from the reserve list. The minimum investment is what it costs to buy at least one share
          of every constituent at its target weight. Returns are the basket's own, measured from the
          day each holding entered — they are not a forecast, and this is research, not investment
          advice.
        </Text>
      ) : null}
    </ScrollView>
  );
}

function CaseCard({ c, expanded, onToggle }: { c: CaseSummary; expanded: boolean; onToggle: () => void }) {
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const col = (c.return_pct ?? 0) >= 0 ? theme.green : theme.red;

  const fetchDetail = useCallback(
    async (amt?: number) => {
      setLoading(true);
      try {
        setDetail(await api.caseDetail(c.id, amt));
      } catch {
        /* the card keeps its summary */
      } finally {
        setLoading(false);
      }
    },
    [c.id],
  );

  useEffect(() => {
    if (expanded && !detail) fetchDetail();
  }, [expanded, detail, fetchDetail]);

  const applyAmount = () => {
    const n = parseInt(amount.replace(/[^0-9]/g, ''), 10);
    if (n > 0) fetchDetail(n);
  };

  return (
    <Card style={styles.card}>
      <TouchableOpacity onPress={onToggle} activeOpacity={0.85}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.caseName}>{c.name}</Text>
            <Text style={styles.caseMeta}>
              {c.count} stocks · {c.vintage} vintage{c.theme ? ` · ${c.theme}` : ''}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.ret, { color: col }]}>{pct(c.return_pct)}</Text>
            <Text style={styles.retK}>since inception</Text>
          </View>
        </View>

        {c.blurb ? <Text style={styles.blurb}>{c.blurb}</Text> : null}

        <View style={styles.metrics}>
          <Metric k="Min investment" v={money(c.min_investment)} />
          <Metric k="CAGR" v={pct(c.cagr_pct)} tone={c.cagr_pct == null ? 'muted' : (c.cagr_pct >= 0 ? 'green' : 'red')} />
          <Metric k="Held since" v={date(c.held_since)} />
        </View>

        {c.top?.length ? (
          <Text style={styles.holdsLine}>
            Holds <Text style={styles.holdsSyms}>{c.top.join(' · ')}</Text>
            {c.count > c.top.length ? ` +${c.count - c.top.length} more` : ''}
          </Text>
        ) : null}
        <Text style={styles.tapHint}>{expanded ? 'Tap to collapse' : 'Tap for constituents, allocation & the engine log'}</Text>
      </TouchableOpacity>

      {expanded ? (
        loading && !detail ? (
          <Loading label="Loading the basket" />
        ) : detail ? (
          <View style={styles.detail}>
            {/* Allocation calculator */}
            <Text style={styles.detailHead}>Allocation</Text>
            <View style={styles.amountRow}>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder={`Amount (min ${money(c.min_investment)})`}
                placeholderTextColor={theme.muted}
                keyboardType="number-pad"
                style={styles.amountInput}
              />
              <TouchableOpacity style={styles.amountBtn} onPress={applyAmount} activeOpacity={0.8}>
                <Text style={styles.amountBtnTxt}>Size it</Text>
              </TouchableOpacity>
            </View>
            {detail.allocation ? (
              <Text style={styles.allocLine}>
                {money(detail.allocation.invested)} deployed across {detail.constituents.length}{' '}
                stocks · {money(detail.allocation.cash)} left over (whole shares only, so the
                realised weights drift from the targets).
              </Text>
            ) : null}

            {/* Constituents */}
            <Text style={[styles.detailHead, { marginTop: theme.sp.md }]}>Constituents</Text>
            <View style={styles.hRow}>
              <Text style={[styles.hCell, styles.hSym]}>STOCK</Text>
              <Text style={[styles.hCell, styles.hNum]}>WEIGHT</Text>
              <Text style={[styles.hCell, styles.hNum]}>ENTRY</Text>
              <Text style={[styles.hCell, styles.hNum]}>NOW</Text>
              <Text style={[styles.hCell, styles.hNum]}>P/L</Text>
              <Text style={[styles.hCell, styles.hNum]}>QTY</Text>
            </View>
            {detail.constituents.map((l) => {
              const lc = (l.pl_pct ?? 0) >= 0 ? theme.green : theme.red;
              return (
                <View key={l.symbol} style={styles.lRow}>
                  <View style={styles.hSym}>
                    <Text style={styles.lSym}>{l.symbol}</Text>
                    <Text style={styles.lSub} numberOfLines={1}>
                      {l.status === 'booked' ? 'part-booked · ' : ''}
                      {l.sector || l.name || ''}
                    </Text>
                  </View>
                  <Text style={[styles.lCell, styles.hNum]}>{wpct(l.weight)}</Text>
                  <Text style={[styles.lCell, styles.hNum]}>{money(l.entry, 2)}</Text>
                  <Text style={[styles.lCell, styles.hNum]}>{money(l.price, 2)}</Text>
                  <Text style={[styles.lCell, styles.hNum, { color: lc }]}>{pct(l.pl_pct)}</Text>
                  <Text style={[styles.lCell, styles.hNum]}>
                    {l.alloc_shares != null ? l.alloc_shares : l.shares}
                  </Text>
                </View>
              );
            })}

            {/* Engine action ledger */}
            <Text style={[styles.detailHead, { marginTop: theme.sp.md }]}>What the engine has done</Text>
            {detail.actions.length ? (
              detail.actions.map((a) => (
                <View key={a.id} style={styles.act}>
                  <View style={[styles.actBadge, { borderColor: ACTION_COLOR[a.action] }]}>
                    <Text style={[styles.actBadgeTxt, { color: ACTION_COLOR[a.action] }]}>
                      {ACTION_LABEL[a.action]}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.actNote}>
                      {a.symbol ? <Text style={styles.actSym}>{a.symbol} </Text> : null}
                      {a.note}
                    </Text>
                    <Text style={styles.actMeta}>
                      {date(a.ts)}
                      {a.price != null ? ` · ${money(a.price, 2)}` : ''}
                      {a.pl_pct != null ? ` · ${pct(a.pl_pct)}` : ''}
                    </Text>
                  </View>
                </View>
              ))
            ) : (
              <Text style={styles.actNote}>No moves since this vintage was struck.</Text>
            )}

            {detail.reserve?.length ? (
              <Text style={styles.reserve}>
                Reserve bench: {detail.reserve.map((r) => r.symbol).join(' · ')} — the engine draws
                from here when it exits a constituent.
              </Text>
            ) : null}
          </View>
        ) : (
          <Text style={styles.err}>Could not load this basket. Pull to refresh.</Text>
        )
      ) : null}
    </Card>
  );
}

function Metric({ k, v, tone }: { k: string; v: string; tone?: 'green' | 'red' | 'muted' }) {
  const col = tone === 'green' ? theme.green : tone === 'red' ? theme.red : tone === 'muted' ? theme.muted : theme.text;
  return (
    <View style={styles.metric}>
      <Text style={styles.metricK}>{k}</Text>
      <Text style={[styles.metricV, { color: col }]}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: theme.sp.lg, paddingBottom: 44 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginBottom: theme.sp.sm },
  notice: { color: theme.muted2, fontSize: theme.fs.sm, marginTop: theme.sp.sm },
  err: { color: theme.red, fontSize: theme.fs.sm, marginTop: theme.sp.sm },
  card: { marginBottom: theme.sp.sm, gap: theme.sp.sm },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp.sm },
  caseName: { color: theme.text, fontSize: theme.fs.lg, fontWeight: '800' },
  caseMeta: { color: theme.muted2, fontSize: theme.fs.xs + 1, marginTop: 3 },
  ret: { fontFamily: theme.mono, fontSize: theme.fs.lg, fontWeight: '800' },
  retK: { color: theme.muted, fontSize: theme.fs.xs },
  blurb: { color: theme.muted2, fontSize: theme.fs.sm, lineHeight: 19, marginTop: 2 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.lg, marginTop: theme.sp.sm },
  metric: { gap: 2 },
  metricK: { color: theme.muted, fontSize: theme.fs.xs, letterSpacing: 0.3 },
  metricV: { fontFamily: theme.mono, fontSize: theme.fs.md, fontWeight: '700' },
  holdsLine: { color: theme.muted2, fontSize: theme.fs.sm, marginTop: theme.sp.sm },
  holdsSyms: { color: theme.text, fontFamily: theme.mono, fontWeight: '700' },
  tapHint: { color: theme.muted, fontSize: theme.fs.xs, marginTop: theme.sp.sm },
  detail: { borderTopColor: theme.border, borderTopWidth: 1, paddingTop: theme.sp.md, gap: 4 },
  detailHead: { color: theme.muted, fontSize: theme.fs.xs + 1, fontWeight: '800', letterSpacing: 1 },
  amountRow: { flexDirection: 'row', gap: theme.sp.sm, marginTop: theme.sp.sm },
  amountInput: {
    flex: 1, backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1,
    borderRadius: theme.radius.sm + 2, color: theme.text, fontFamily: theme.mono,
    fontSize: theme.fs.sm, paddingHorizontal: theme.sp.md, paddingVertical: theme.sp.sm,
  },
  amountBtn: {
    backgroundColor: theme.surface3, borderColor: theme.border2, borderWidth: 1,
    borderRadius: theme.radius.sm + 2, paddingHorizontal: theme.sp.lg, justifyContent: 'center',
  },
  amountBtnTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '800' },
  allocLine: { color: theme.muted2, fontSize: theme.fs.xs + 1, marginTop: 6, lineHeight: 17 },
  hRow: { flexDirection: 'row', gap: 6, marginTop: 6, paddingBottom: 4, borderBottomColor: theme.border, borderBottomWidth: 1 },
  hCell: { color: theme.muted, fontSize: theme.fs.xs, letterSpacing: 0.3 },
  hSym: { flex: 1.6 },
  hNum: { flex: 1, textAlign: 'right' },
  lRow: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingVertical: 5, borderBottomColor: theme.border, borderBottomWidth: 1 },
  lSym: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm, fontWeight: '800' },
  lSub: { color: theme.muted, fontSize: theme.fs.xs },
  lCell: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm },
  act: { flexDirection: 'row', gap: theme.sp.sm, alignItems: 'flex-start', paddingVertical: 6 },
  actBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, marginTop: 1 },
  actBadgeTxt: { fontSize: theme.fs.xs - 1, fontWeight: '800', letterSpacing: 0.4 },
  actNote: { color: theme.muted2, fontSize: theme.fs.sm, lineHeight: 18 },
  actSym: { color: theme.text, fontFamily: theme.mono, fontWeight: '800' },
  actMeta: { color: theme.muted, fontSize: theme.fs.xs, marginTop: 2, fontFamily: theme.mono },
  reserve: { color: theme.muted, fontSize: theme.fs.xs + 1, marginTop: theme.sp.md, lineHeight: 17 },
  note: { color: theme.muted, fontSize: theme.fs.sm, marginTop: theme.sp.lg, lineHeight: 18 },
});
