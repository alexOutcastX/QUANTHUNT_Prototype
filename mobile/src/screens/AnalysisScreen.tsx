import React, { useEffect, useState } from 'react';
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
import SymbolInput from '../components/SymbolInput';
import { takeSymbol } from '../navIntent';
import { theme } from '../theme';
import { Card, Loading, ScreenTitle, SectionTitle, StatTile } from '../ui';

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

  const run = async (symOverride?: string) => {
    const symbol = (symOverride ?? sym).trim().toUpperCase().replace(/^NSE:/, '');
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

  // Auto-analyse a symbol handed off from another screen (e.g. "Analyse as
  // Institutional" on the Pattern Recogniser).
  useEffect(() => {
    const s = takeSymbol('inst');
    if (s) {
      setSym(s);
      run(s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <ScreenTitle
        title="Institutional Analysis"
        sub="Upside-probability model — Monte-Carlo (GBM) + historical frequency over 5y of daily data."
      />
      <View style={styles.body}>
        <Card style={styles.setupCard}>
          <SectionTitle>Setup</SectionTitle>
          <View style={styles.inputs}>
            <View style={styles.field}>
              <Text style={styles.label}>Symbol</Text>
              <SymbolInput
                inputStyle={styles.input}
                value={sym}
                onChangeText={setSym}
                onSelect={(s) => run(s)}
                onSubmit={() => run()}
                placeholder="RELIANCE"
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
          <TouchableOpacity style={styles.btn} onPress={() => run()} disabled={busy} activeOpacity={0.75}>
            {busy ? (
              <ActivityIndicator color={theme.onAccent} />
            ) : (
              <Text style={styles.btnText}>Analyse</Text>
            )}
          </TouchableOpacity>
        </Card>

        {busy && msg ? (
          <View style={styles.loadingBox}>
            <Loading label={msg.replace(/^[⟳⚠]\s*/, '')} />
          </View>
        ) : msg ? (
          <Text style={styles.msg}>{msg.replace(/^[⟳⚠]\s*/, '')}</Text>
        ) : null}

        {result ? (
          <View style={styles.result}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{result.name}</Text>
              <Text style={styles.symSmall}>
                {result.sym} · ₹{result.price.toLocaleString('en-IN')}
              </Text>
            </View>

            <View style={styles.tiles}>
              <StatTile
                label="Verdict"
                value={result.verdict}
                mono={false}
                color={verdictColor(result.verdict)}
              />
              <StatTile label="Score" value={`${result.score}/100`} />
              <StatTile
                label="Ann. drift"
                value={signed(result.driftAnn)}
                color={result.driftAnn >= 0 ? theme.green : theme.red}
              />
              <StatTile label="Ann. vol" value={pct(result.sigmaAnn)} />
              <StatTile label="Term" value={result.termLabel} mono={false} />
            </View>

            <SectionTitle>Probability of touching +{result.target}% by horizon</SectionTitle>
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
                <SectionTitle>Fundamental quality</SectionTitle>
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

            <Card style={styles.noteCard}>
              <Text style={styles.note}>{result.note}</Text>
            </Card>
            <Text style={styles.disclaimer}>
              Model output, not investment advice. Simulations assume returns are log-normal and
              stationary — real markets are neither.
            </Text>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  content: { paddingBottom: 48, width: '100%', maxWidth: 760, alignSelf: 'center' },
  body: { paddingHorizontal: theme.sp.lg },
  setupCard: { zIndex: 50 },
  inputs: { flexDirection: 'row', gap: theme.sp.md, zIndex: 50 },
  field: { flex: 1, zIndex: 50 },
  fieldSm: { width: 96 },
  label: { color: theme.muted2, fontSize: theme.fs.sm, marginBottom: theme.sp.xs },
  input: {
    backgroundColor: theme.surface,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    color: theme.text,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 10,
    fontFamily: theme.mono,
    fontSize: theme.fs.md,
  },
  btn: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius.sm + 2,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: theme.sp.lg,
  },
  btnText: { color: theme.onAccent, fontWeight: '700', fontSize: theme.fs.sm + 1, letterSpacing: 0.3 },
  loadingBox: { paddingVertical: theme.sp.xl },
  msg: {
    color: theme.muted2,
    fontSize: theme.fs.sm,
    marginTop: theme.sp.lg,
    textAlign: 'center',
    lineHeight: 18,
  },
  result: { marginTop: theme.sp.xl },
  nameRow: { marginBottom: theme.sp.lg },
  name: { color: theme.text, fontSize: theme.fs.lg, fontWeight: '700' },
  symSmall: { color: theme.muted, fontFamily: theme.mono, fontSize: theme.fs.sm, marginTop: 2 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.md },
  tHead: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface2,
    borderTopColor: theme.border,
    borderTopWidth: 1,
    borderBottomColor: theme.border2,
    borderBottomWidth: 1,
    paddingVertical: theme.sp.sm,
    paddingHorizontal: theme.sp.sm,
  },
  th: {
    color: theme.muted2,
    fontSize: theme.fs.xs + 1,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  tRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: theme.sp.sm,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  td: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm },
  strong: { fontWeight: '700' },
  cH: { flex: 1 },
  cN: { width: 84, textAlign: 'right' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.surface,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 6,
  },
  chipK: { color: theme.muted, fontSize: theme.fs.xs + 1, letterSpacing: 0.6, textTransform: 'uppercase' },
  chipV: { color: theme.text, fontWeight: '700', fontSize: theme.fs.md, fontFamily: theme.mono },
  noFund: { color: theme.muted, fontSize: theme.fs.sm, marginTop: theme.sp.lg },
  noteCard: { marginTop: theme.sp.xl },
  note: { color: theme.text, fontSize: theme.fs.md, lineHeight: 21 },
  disclaimer: {
    color: theme.muted,
    fontSize: theme.fs.xs,
    lineHeight: 15,
    marginTop: theme.sp.md,
    fontStyle: 'italic',
  },
});
