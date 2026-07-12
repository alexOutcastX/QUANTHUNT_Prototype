import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { OptionChain, OptionStrike, api } from '../api';
import SymbolInput from '../components/SymbolInput';
import { Card, EmptyState, Loading, ScreenTitle, SectionTitle, StatTile } from '../ui';
import { theme } from '../theme';

const INDEX_CHIPS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];

const n0 = (v: number | null | undefined) =>
  v == null ? '—' : Math.round(v).toLocaleString('en-IN');
const n2 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(2));
const compact = (v: number | null | undefined) => {
  if (v == null) return '—';
  if (v >= 1e7) return (v / 1e7).toFixed(1) + 'Cr';
  if (v >= 1e5) return (v / 1e5).toFixed(1) + 'L';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  return String(Math.round(v));
};

// One payoff leg the user has staged from the chain.
type Leg = { id: string; kind: 'CE' | 'PE'; side: 'buy' | 'sell'; strike: number; premium: number };

// Payoff of a single option leg at expiry, per unit.
function legPayoff(leg: Leg, spot: number): number {
  const intrinsic = leg.kind === 'CE' ? Math.max(spot - leg.strike, 0) : Math.max(leg.strike - spot, 0);
  const sign = leg.side === 'buy' ? 1 : -1;
  const cost = leg.side === 'buy' ? -leg.premium : leg.premium;
  return sign * intrinsic + cost;
}

export default function DerivativesScreen() {
  const [sym, setSym] = useState('NIFTY');
  const [input, setInput] = useState('NIFTY');
  const [expiry, setExpiry] = useState<string | undefined>(undefined);
  const [chain, setChain] = useState<OptionChain | null | undefined>(undefined);
  const [legs, setLegs] = useState<Leg[]>([]);

  const load = useCallback((symbol: string, exp?: string) => {
    setChain(undefined);
    api
      .optionChain(symbol, exp)
      .then((c) => {
        setChain(c);
        if (!exp) setExpiry(c.expiry || undefined);
      })
      .catch(() => setChain(null));
  }, []);

  useEffect(() => {
    load(sym, expiry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, expiry]);

  const go = (s: string) => {
    const v = s.trim().toUpperCase().replace(/^NSE:/, '');
    if (v && v !== sym) {
      setExpiry(undefined);
      setSym(v);
    }
  };

  const addLeg = (strike: number, kind: 'CE' | 'PE', ltp: number | null) => {
    setLegs((prev) => [
      ...prev,
      { id: `${kind}${strike}-${prev.length}`, kind, side: 'buy', strike, premium: ltp ?? 0 },
    ]);
  };
  const toggleSide = (id: string) =>
    setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, side: l.side === 'buy' ? 'sell' : 'buy' } : l)));
  const removeLeg = (id: string) => setLegs((prev) => prev.filter((l) => l.id !== id));

  // Payoff summary across a price band around the underlying.
  const payoff = useMemo(() => {
    if (!legs.length || !chain?.underlying) return null;
    const u = chain.underlying;
    const lo = u * 0.85;
    const hi = u * 1.15;
    const steps = 41;
    const pts: { spot: number; pnl: number }[] = [];
    for (let i = 0; i < steps; i++) {
      const spot = lo + ((hi - lo) * i) / (steps - 1);
      const pnl = legs.reduce((acc, l) => acc + legPayoff(l, spot), 0);
      pts.push({ spot, pnl });
    }
    const pnls = pts.map((p) => p.pnl);
    const maxP = Math.max(...pnls);
    const maxL = Math.min(...pnls);
    const net = legs.reduce((acc, l) => acc + (l.side === 'buy' ? -l.premium : l.premium), 0);
    // Breakevens: where the payoff curve crosses zero.
    const bes: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if ((a.pnl <= 0 && b.pnl >= 0) || (a.pnl >= 0 && b.pnl <= 0)) {
        const t = a.pnl === b.pnl ? 0 : -a.pnl / (b.pnl - a.pnl);
        bes.push(a.spot + t * (b.spot - a.spot));
      }
    }
    return { pts, maxP, maxL, net, bes };
  }, [legs, chain]);

  return (
    <View style={styles.container}>
      <ScreenTitle title="Derivatives" sub="F&O option chain · PCR · max-pain · payoff (NSE)" />

      <View style={styles.searchWrap}>
        <SymbolInput
          value={input}
          onChangeText={setInput}
          onSelect={go}
          onSubmit={() => go(input)}
          inputStyle={styles.input}
          placeholder="NIFTY / BANKNIFTY / RELIANCE"
        />
        <View style={styles.chipRow}>
          {INDEX_CHIPS.map((c) => (
            <TouchableOpacity
              key={c}
              style={[styles.chip, sym === c && styles.chipOn]}
              onPress={() => go(c)}
              activeOpacity={0.75}
            >
              <Text style={[styles.chipTxt, sym === c && styles.chipTxtOn]}>{c}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {chain === undefined ? (
          <Loading label="Loading option chain…" />
        ) : !chain || chain.error || !chain.strikes.length ? (
          <EmptyState
            title="No option chain"
            hint="NSE serves this live and best from an Indian IP; index symbols (NIFTY, BANKNIFTY) are most reliable."
          />
        ) : (
          <>
            <View style={styles.statRow}>
              <StatTile label="Underlying" value={n2(chain.underlying)} />
              <StatTile
                label="PCR"
                value={chain.pcr == null ? '—' : chain.pcr.toFixed(2)}
                color={chain.pcr == null ? undefined : chain.pcr >= 1 ? theme.green : theme.red}
                sub={chain.pcr == null ? undefined : chain.pcr >= 1 ? 'put-heavy' : 'call-heavy'}
              />
              <StatTile label="Max pain" value={n0(chain.max_pain)} />
              <StatTile label="ATM IV" value={chain.atm_iv == null ? '—' : chain.atm_iv.toFixed(1) + '%'} />
            </View>

            {chain.expiries.length > 1 ? (
              <View style={styles.expRow}>
                {chain.expiries.slice(0, 6).map((e) => (
                  <TouchableOpacity
                    key={e}
                    style={[styles.expChip, chain.expiry === e && styles.expChipOn]}
                    onPress={() => setExpiry(e)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.expTxt, chain.expiry === e && styles.expTxtOn]}>{e}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            <SectionTitle>Option chain · {chain.expiry || ''}</SectionTitle>
            <Card style={styles.chainCard}>
              <View style={[styles.crow, styles.chead]}>
                <Text style={[styles.cCall, styles.chLbl]}>CALLS  OI · IV · LTP</Text>
                <Text style={styles.cStrikeH}>STRIKE</Text>
                <Text style={[styles.cPut, styles.chLbl, styles.right]}>LTP · IV · OI  PUTS</Text>
              </View>
              {chain.strikes.map((s) => (
                <StrikeRow
                  key={s.strike}
                  s={s}
                  atm={chain.atm}
                  maxPain={chain.max_pain}
                  onAdd={addLeg}
                />
              ))}
            </Card>

            <SectionTitle>Payoff builder</SectionTitle>
            {!legs.length ? (
              <EmptyState icon="⊹" title="Tap a CALL or PUT LTP above to stage a leg" hint="Then flip buy/sell to model a spread." />
            ) : (
              <Card style={styles.payCard}>
                {legs.map((l) => (
                  <View key={l.id} style={styles.legRow}>
                    <TouchableOpacity onPress={() => toggleSide(l.id)} activeOpacity={0.75}>
                      <Text style={[styles.legSide, { color: l.side === 'buy' ? theme.green : theme.red }]}>
                        {l.side.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                    <Text style={styles.legMain}>
                      {n0(l.strike)} {l.kind}
                    </Text>
                    <Text style={styles.legPrem}>@ {n2(l.premium)}</Text>
                    <TouchableOpacity onPress={() => removeLeg(l.id)} hitSlop={8} activeOpacity={0.6}>
                      <Text style={styles.legX}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                {payoff ? (
                  <>
                    <View style={styles.payStats}>
                      <StatTile label="Net premium" value={n2(payoff.net)} color={payoff.net >= 0 ? theme.green : theme.red} sub={payoff.net >= 0 ? 'credit' : 'debit'} />
                      <StatTile label="Max profit" value={payoff.maxP >= 1e6 ? '∞' : n2(payoff.maxP)} color={theme.green} />
                      <StatTile label="Max loss" value={payoff.maxL <= -1e6 ? '∞' : n2(payoff.maxL)} color={theme.red} />
                    </View>
                    <Text style={styles.beTxt}>
                      Breakeven: {payoff.bes.length ? payoff.bes.map((b) => n0(b)).join(' · ') : '—'}
                    </Text>
                    <PayoffBars pts={payoff.pts} />
                    <Text style={styles.note}>
                      Payoff at expiry, per unit (× lot size for the contract). Intrinsic value only —
                      excludes brokerage, STT and time value.
                    </Text>
                  </>
                ) : null}
              </Card>
            )}

            <Text style={styles.note}>
              Sourced live from NSE public option-chain feeds. Indicative — verify against your broker
              before trading.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function StrikeRow({
  s,
  atm,
  maxPain,
  onAdd,
}: {
  s: OptionStrike;
  atm: number | null;
  maxPain: number | null;
  onAdd: (strike: number, kind: 'CE' | 'PE', ltp: number | null) => void;
}) {
  const isAtm = atm != null && s.strike === atm;
  const isMp = maxPain != null && s.strike === maxPain;
  return (
    <View style={[styles.crow, isAtm && styles.atmRow]}>
      <TouchableOpacity style={styles.cCall} onPress={() => onAdd(s.strike, 'CE', s.ce?.ltp ?? null)} activeOpacity={0.6}>
        <Text style={styles.oi}>{compact(s.ce?.oi)}</Text>
        <Text style={styles.iv}>{s.ce?.iv == null ? '—' : s.ce.iv.toFixed(0)}</Text>
        <Text style={[styles.ltp, styles.callLtp]}>{n2(s.ce?.ltp)}</Text>
      </TouchableOpacity>
      <View style={styles.cStrike}>
        <Text style={[styles.strikeTxt, isAtm && styles.strikeAtm]}>{n0(s.strike)}</Text>
        {isMp ? <Text style={styles.mpTag}>MP</Text> : null}
      </View>
      <TouchableOpacity style={[styles.cPut, styles.right]} onPress={() => onAdd(s.strike, 'PE', s.pe?.ltp ?? null)} activeOpacity={0.6}>
        <Text style={[styles.ltp, styles.putLtp]}>{n2(s.pe?.ltp)}</Text>
        <Text style={styles.iv}>{s.pe?.iv == null ? '—' : s.pe.iv.toFixed(0)}</Text>
        <Text style={styles.oi}>{compact(s.pe?.oi)}</Text>
      </TouchableOpacity>
    </View>
  );
}

// Simple View-bar payoff chart: green above zero, red below.
function PayoffBars({ pts }: { pts: { spot: number; pnl: number }[] }) {
  const max = Math.max(...pts.map((p) => Math.abs(p.pnl)), 1);
  return (
    <View style={styles.bars}>
      {pts.map((p, i) => {
        const h = Math.max((Math.abs(p.pnl) / max) * 46, 1);
        const up = p.pnl >= 0;
        return (
          <View key={i} style={styles.barCol}>
            <View style={styles.barTop}>
              {up ? <View style={[styles.bar, { height: h, backgroundColor: theme.green }]} /> : null}
            </View>
            <View style={styles.barBot}>
              {!up ? <View style={[styles.bar, { height: h, backgroundColor: theme.red }]} /> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  searchWrap: { paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.sm, zIndex: 50 },
  input: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    color: theme.text,
    fontFamily: theme.mono,
    fontSize: theme.fs.md,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm + 2,
    letterSpacing: 1,
  },
  chipRow: { flexDirection: 'row', gap: theme.sp.sm, marginTop: theme.sp.sm, flexWrap: 'wrap' },
  chip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
  },
  chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipTxt: { color: theme.muted2, fontSize: theme.fs.xs + 1, fontFamily: theme.mono },
  chipTxtOn: { color: theme.onAccent, fontWeight: '700' },
  body: { padding: theme.sp.lg, paddingBottom: 40 },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginBottom: theme.sp.md },
  expRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginBottom: theme.sp.sm },
  expChip: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
  },
  expChipOn: { borderColor: theme.accent },
  expTxt: { color: theme.muted2, fontSize: theme.fs.xs + 1, fontFamily: theme.mono },
  expTxtOn: { color: theme.text, fontWeight: '700' },
  chainCard: { padding: 0, overflow: 'hidden' },
  crow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    paddingVertical: 7,
    paddingHorizontal: theme.sp.sm,
  },
  chead: { backgroundColor: theme.surface2 },
  chLbl: { color: theme.muted, fontSize: theme.fs.xs, fontWeight: '700' },
  atmRow: { backgroundColor: theme.surface3 },
  cCall: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm },
  cPut: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm },
  right: { justifyContent: 'flex-end' },
  cStrikeH: { width: 66, textAlign: 'center', color: theme.muted, fontSize: theme.fs.xs, fontWeight: '700' },
  cStrike: { width: 66, alignItems: 'center', justifyContent: 'center' },
  strikeTxt: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm, fontWeight: '700' },
  strikeAtm: { color: theme.accent },
  mpTag: { color: theme.muted, fontSize: 8, fontWeight: '700', marginTop: 1 },
  oi: { color: theme.muted2, fontFamily: theme.mono, fontSize: theme.fs.xs + 1, width: 42, textAlign: 'center' },
  iv: { color: theme.muted, fontFamily: theme.mono, fontSize: theme.fs.xs + 1, width: 26, textAlign: 'center' },
  ltp: { fontFamily: theme.mono, fontSize: theme.fs.sm, width: 48, textAlign: 'center' },
  callLtp: { color: theme.green },
  putLtp: { color: theme.red },
  payCard: {},
  legRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.md,
    paddingVertical: theme.sp.sm,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  legSide: { fontFamily: theme.mono, fontSize: theme.fs.sm, fontWeight: '700', width: 44 },
  legMain: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.md, flex: 1 },
  legPrem: { color: theme.muted2, fontFamily: theme.mono, fontSize: theme.fs.sm },
  legX: { color: theme.muted, fontSize: theme.fs.md },
  payStats: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginTop: theme.sp.md },
  beTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontFamily: theme.mono, marginTop: theme.sp.md },
  bars: { flexDirection: 'row', alignItems: 'stretch', height: 96, marginTop: theme.sp.md, gap: 1 },
  barCol: { flex: 1, justifyContent: 'center' },
  barTop: { height: 48, justifyContent: 'flex-end' },
  barBot: { height: 48, justifyContent: 'flex-start' },
  bar: { width: '100%', borderRadius: 1 },
  note: { color: theme.muted, fontSize: theme.fs.sm, marginTop: theme.sp.md, lineHeight: 18 },
});
