import React, { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { api } from '../api';
import { Assessment, assess } from '../analysis';
import { theme } from '../theme';

function verdictColor(v: string): string {
  if (v.startsWith('Strong')) return theme.green;
  if (v === 'Accumulate') return theme.green;
  if (v === 'Avoid') return theme.red;
  return theme.text;
}

function pct(x: number, d = 0): string {
  return isFinite(x) ? (x * 100).toFixed(d) + '%' : '—';
}
function signed(x: number, d = 1): string {
  if (!isFinite(x)) return '—';
  return (x >= 0 ? '+' : '') + (x * 100).toFixed(d) + '%';
}

export default function AnalysisScreen() {
  const [sym, setSym] = useState('RELIANCE');
  const [target, setTarget] = useState('10');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [result, setResult] = useState<Assessment | null>(null);

  const run = async () => {
    const symbol = sym.trim().toUpperCase().replace(/^NSE:/, '');
    const tgt = Math.max(0.1, parseFloat(target) || 10);
    if (!symbol) {
      setMsg('⚠ Enter a symbol to analyse.');
      return;
    }
    setBusy(true);
    setResult(null);
    setMsg('⟳ Fetching 5y history for ' + symbol + '…');
    try {
      const hist = await api.history(symbol, '5y', '1d');
      const candles = Array.isArray(hist.candles) ? hist.candles : [];
      if (candles.length < 60) {
        setMsg(`⚠ Not enough history for ${symbol} (${candles.length} bars, need ≥60).`);
        setBusy(false);
        return;
      }
      let fund = null;
      try {
        fund = await api.fundamentals(symbol);
        if (fund && fund.error) fund = null;
      } catch {
        fund = null;
      }
      setMsg('⟳ Running Monte-Carlo simulation…');
      // Yield a frame so the message paints before the CPU-bound sim.
      await new Promise((r) => setTimeout(r, 16));
      const C = candles.map((c) => Number(c.c)).filter((v) => isFinite(v) && v > 0);
      const last = candles[candles.length - 1];
      const price = Number(last.c);
      const ema200 =
        last.ema200 != null && isFinite(Number(last.ema200)) ? Number(last.ema200) : null;
      setResult(assess(symbol, C, price, ema200, tgt, fund));
      setMsg(null);
    } catch (e) {
      setMsg('⚠ ' + (e instanceof Error ? e.message : 'Analysis failed') + ' — is the backend reachable?');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>Institutional Analysis</Text>
      <Text style={styles.sub}>
        Upside-probability model — Monte-Carlo (GBM) + historical frequency over 5y of daily data.
      </Text>

      <View style={styles.inputs}>
        <View style={styles.field}>
          <Text style={styles.label}>Symbol</Text>
          <TextInput
            style={styles.input}
            value={sym}
            onChangeText={setSym}
            autoCapitalize="characters"
            placeholder="RELIANCE"
            placeholderTextColor={theme.muted}
            returnKeyType="go"
            onSubmitEditing={run}
          />
        </View>
        <View style={styles.fieldSm}>
          <Text style={styles.label}>Target %</Text>
          <TextInput
            style={styles.input}
            value={target}
            onChangeText={setTarget}
            keyboardType="numeric"
            placeholder="10"
            placeholderTextColor={theme.muted}
          />
        </View>
      </View>

      <TouchableOpacity style={styles.btn} onPress={run} disabled={busy}>
        {busy ? (
          <ActivityIndicator color={theme.bg} />
        ) : (
          <Text style={styles.btnText}>Analyse</Text>
        )}
      </TouchableOpacity>

      {msg ? <Text style={styles.msg}>{msg}</Text> : null}

      {result ? (
        <View style={styles.result}>
          <View style={styles.verdictRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{result.name}</Text>
              <Text style={styles.symSmall}>
                {result.sym} · ₹{result.price.toLocaleString('en-IN')}
              </Text>
            </View>
            <View style={styles.scoreBox}>
              <Text style={[styles.verdict, { color: verdictColor(result.verdict) }]}>
                {result.verdict}
              </Text>
              <Text style={styles.score}>{result.score}/100</Text>
            </View>
          </View>

          <View style={styles.metaRow}>
            <Meta label="Ann. drift" value={signed(result.driftAnn)} />
            <Meta label="Ann. vol" value={pct(result.sigmaAnn)} />
            <Meta label="Term" value={result.termLabel} />
          </View>

          <Text style={styles.tableTitle}>
            Probability of touching +{result.target}% by horizon
          </Text>
          <View style={styles.tHead}>
            <Text style={[styles.th, styles.cH]}>Horizon</Text>
            <Text style={[styles.th, styles.cN]}>MC touch</Text>
            <Text style={[styles.th, styles.cN]}>Hist touch</Text>
            <Text style={[styles.th, styles.cN]}>MC med ret</Text>
          </View>
          {result.rows.map((r) => (
            <View style={styles.tRow} key={r.label}>
              <Text style={[styles.td, styles.cH]}>{r.label}</Text>
              <Text style={[styles.td, styles.cN, styles.strong]}>{pct(r.mc.pReach)}</Text>
              <Text style={[styles.td, styles.cN]}>
                {r.hist.n ? pct(r.hist.pReach) : '—'}
              </Text>
              <Text
                style={[
                  styles.td,
                  styles.cN,
                  { color: r.mc.medRet >= 0 ? theme.green : theme.red },
                ]}
              >
                {signed(r.mc.medRet)}
              </Text>
            </View>
          ))}

          {result.qual.hasData ? (
            <>
              <Text style={styles.tableTitle}>Fundamental quality</Text>
              <View style={styles.chips}>
                {result.qual.parts.map((p) => (
                  <View style={styles.chip} key={p.k}>
                    <Text style={styles.chipK}>{p.k}</Text>
                    <Text style={styles.chipV}>{Math.round(p.s)}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <Text style={styles.noFund}>Fundamentals unavailable — valuation scored neutrally.</Text>
          )}

          <Text style={styles.note}>{result.note}</Text>
          <Text style={styles.disclaimer}>
            Model output, not investment advice. Simulations assume returns are log-normal and
            stationary — real markets are neither.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.meta}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, paddingBottom: 48 },
  h1: { color: theme.text, fontSize: 18, fontWeight: '700' },
  sub: { color: theme.muted, fontSize: 12, marginTop: 4, marginBottom: 16, lineHeight: 17 },
  inputs: { flexDirection: 'row', gap: 10 },
  field: { flex: 1 },
  fieldSm: { width: 90 },
  label: { color: theme.muted, fontSize: 11, marginBottom: 4, fontFamily: theme.mono },
  input: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 8,
    color: theme.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: theme.mono,
    fontSize: 14,
  },
  btn: {
    backgroundColor: theme.accent,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 14,
  },
  btnText: { color: theme.bg, fontWeight: '700', fontSize: 14 },
  msg: { color: theme.muted, fontFamily: theme.mono, fontSize: 12, marginTop: 16, textAlign: 'center' },
  result: { marginTop: 20 },
  verdictRow: { flexDirection: 'row', alignItems: 'flex-start' },
  name: { color: theme.text, fontSize: 16, fontWeight: '700' },
  symSmall: { color: theme.muted, fontFamily: theme.mono, fontSize: 12, marginTop: 2 },
  scoreBox: { alignItems: 'flex-end' },
  verdict: { fontSize: 14, fontWeight: '700' },
  score: { color: theme.muted, fontFamily: theme.mono, fontSize: 12, marginTop: 2 },
  metaRow: {
    flexDirection: 'row',
    marginTop: 16,
    borderTopColor: theme.border,
    borderBottomColor: theme.border,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: 12,
  },
  meta: { flex: 1 },
  metaLabel: { color: theme.muted2, fontSize: 10, fontFamily: theme.mono },
  metaValue: { color: theme.text, fontSize: 14, fontWeight: '600', marginTop: 3 },
  tableTitle: { color: theme.text, fontSize: 13, fontWeight: '700', marginTop: 22, marginBottom: 8 },
  tHead: {
    flexDirection: 'row',
    paddingBottom: 6,
    borderBottomColor: theme.border2,
    borderBottomWidth: 1,
  },
  th: { color: theme.muted2, fontSize: 10, fontFamily: theme.mono, textTransform: 'uppercase' },
  tRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  td: { color: theme.text, fontFamily: theme.mono, fontSize: 12 },
  strong: { fontWeight: '700' },
  cH: { flex: 1 },
  cN: { width: 84, textAlign: 'right' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipK: { color: theme.muted, fontFamily: theme.mono, fontSize: 11 },
  chipV: { color: theme.text, fontWeight: '700', fontSize: 13 },
  noFund: { color: theme.muted, fontFamily: theme.mono, fontSize: 11, marginTop: 4 },
  note: {
    color: theme.text,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 22,
    backgroundColor: theme.surface2,
    borderRadius: 8,
    padding: 14,
  },
  disclaimer: { color: theme.muted2, fontSize: 10, lineHeight: 15, marginTop: 12, fontStyle: 'italic' },
});
