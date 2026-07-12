import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { theme } from '../theme';
import { Card, ChipBtn, ScreenTitle, SectionTitle, StatTile } from '../ui';

type Mode = 'position' | 'sip' | 'cagr';

const money = (n: number) =>
  isFinite(n) ? '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—';
const num = (v: string) => {
  const n = parseFloat(v);
  return isFinite(n) ? n : 0;
};

function Field({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  suffix?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputWrap}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChange}
          keyboardType="numeric"
          placeholderTextColor={theme.muted}
        />
        {suffix ? <Text style={styles.suffix}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

function Result({ rows }: { rows: { k: string; v: string; hi?: boolean; color?: string }[] }) {
  return (
    <>
      <SectionTitle>Result</SectionTitle>
      <View style={styles.tiles}>
        {rows.map((r) => (
          <StatTile key={r.k} label={r.k} value={r.v} color={r.color} />
        ))}
      </View>
    </>
  );
}

// ── Position sizing (risk-based) ──
function PositionCalc() {
  const [capital, setCapital] = useState('100000');
  const [risk, setRisk] = useState('1');
  const [entry, setEntry] = useState('500');
  const [stop, setStop] = useState('480');

  const cap = num(capital);
  const riskAmt = (cap * num(risk)) / 100;
  const perShare = num(entry) - num(stop);
  const shares = perShare > 0 ? Math.floor(riskAmt / perShare) : 0;
  const posValue = shares * num(entry);
  const capPct = cap > 0 ? (posValue / cap) * 100 : 0;

  return (
    <>
      <Text style={styles.blurb}>
        How many shares to buy so a stop-out costs only your chosen slice of capital.
      </Text>
      <Card>
        <Field label="Capital" value={capital} onChange={setCapital} suffix="₹" />
        <Field label="Risk per trade" value={risk} onChange={setRisk} suffix="%" />
        <Field label="Entry price" value={entry} onChange={setEntry} suffix="₹" />
        <Field label="Stop-loss" value={stop} onChange={setStop} suffix="₹" />
      </Card>
      <Result
        rows={[
          { k: 'Risk amount', v: money(riskAmt) },
          { k: 'Risk / share', v: perShare > 0 ? money(perShare) : '— (stop ≥ entry)' },
          { k: 'Shares to buy', v: String(shares), hi: true },
          { k: 'Position value', v: money(posValue) },
          { k: '% of capital', v: isFinite(capPct) ? capPct.toFixed(1) + '%' : '—' },
        ]}
      />
    </>
  );
}

// ── SIP future value ──
function SipCalc() {
  const [amount, setAmount] = useState('10000');
  const [rate, setRate] = useState('12');
  const [years, setYears] = useState('10');

  const P = num(amount);
  const n = Math.round(num(years) * 12);
  const i = num(rate) / 100 / 12;
  // FV of an annuity-due (SIP invested at start of each month)
  const fv = i > 0 ? P * ((Math.pow(1 + i, n) - 1) / i) * (1 + i) : P * n;
  const invested = P * n;
  const gains = fv - invested;

  return (
    <>
      <Text style={styles.blurb}>
        Future value of a monthly SIP compounding at an assumed annual return.
      </Text>
      <Card>
        <Field label="Monthly investment" value={amount} onChange={setAmount} suffix="₹" />
        <Field label="Expected return" value={rate} onChange={setRate} suffix="% p.a." />
        <Field label="Duration" value={years} onChange={setYears} suffix="yrs" />
      </Card>
      <Result
        rows={[
          { k: 'Invested', v: money(invested) },
          { k: 'Est. gains', v: money(gains), color: gains >= 0 ? theme.green : theme.red },
          { k: 'Future value', v: money(fv), hi: true },
        ]}
      />
    </>
  );
}

// ── CAGR ──
function CagrCalc() {
  const [initial, setInitial] = useState('100000');
  const [final, setFinal] = useState('250000');
  const [years, setYears] = useState('5');

  const p0 = num(initial);
  const p1 = num(final);
  const y = num(years);
  const cagr = p0 > 0 && y > 0 ? (Math.pow(p1 / p0, 1 / y) - 1) * 100 : NaN;
  const totalRet = p0 > 0 ? (p1 / p0 - 1) * 100 : NaN;
  const col = isFinite(cagr) && cagr >= 0 ? theme.green : theme.red;

  return (
    <>
      <Text style={styles.blurb}>Compound annual growth rate between two values.</Text>
      <Card>
        <Field label="Initial value" value={initial} onChange={setInitial} suffix="₹" />
        <Field label="Final value" value={final} onChange={setFinal} suffix="₹" />
        <Field label="Period" value={years} onChange={setYears} suffix="yrs" />
      </Card>
      <Result
        rows={[
          { k: 'Total return', v: isFinite(totalRet) ? totalRet.toFixed(2) + '%' : '—' },
          { k: 'CAGR', v: isFinite(cagr) ? cagr.toFixed(2) + '%' : '—', hi: true, color: col },
        ]}
      />
    </>
  );
}

const TABS: { key: Mode; label: string }[] = [
  { key: 'position', label: 'Position Size' },
  { key: 'sip', label: 'SIP' },
  { key: 'cagr', label: 'CAGR' },
];

export default function CalculatorScreen() {
  const [mode, setMode] = useState<Mode>('position');
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenTitle title="Calculator" sub="Position sizing, SIP and CAGR — quick market maths." />
      <View style={styles.seg}>
        {TABS.map((t) => (
          <ChipBtn
            key={t.key}
            label={t.label}
            on={mode === t.key}
            onPress={() => setMode(t.key)}
            style={styles.segChip}
          />
        ))}
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {mode === 'position' ? <PositionCalc /> : mode === 'sip' ? <SipCalc /> : <CagrCalc />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  seg: { flexDirection: 'row', gap: theme.sp.sm, paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.md },
  segChip: { flex: 1, alignItems: 'center' },
  content: {
    padding: theme.sp.lg,
    paddingBottom: 48,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
  },
  blurb: { color: theme.muted, fontSize: theme.fs.sm, lineHeight: 18, marginBottom: theme.sp.lg },
  field: { marginBottom: theme.sp.md },
  label: { color: theme.muted2, fontSize: theme.fs.sm, marginBottom: theme.sp.xs },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    paddingHorizontal: theme.sp.md,
  },
  input: { flex: 1, color: theme.text, paddingVertical: 11, fontFamily: theme.mono, fontSize: theme.fs.md },
  suffix: { color: theme.muted, fontSize: theme.fs.sm, marginLeft: theme.sp.sm },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.md },
});
