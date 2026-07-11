import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { theme } from '../theme';

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
    <View style={styles.result}>
      {rows.map((r) => (
        <View style={styles.rRow} key={r.k}>
          <Text style={styles.rK}>{r.k}</Text>
          <Text style={[styles.rV, r.hi && styles.rVhi, r.color ? { color: r.color } : null]}>
            {r.v}
          </Text>
        </View>
      ))}
    </View>
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
      <Field label="Capital" value={capital} onChange={setCapital} suffix="₹" />
      <Field label="Risk per trade" value={risk} onChange={setRisk} suffix="%" />
      <Field label="Entry price" value={entry} onChange={setEntry} suffix="₹" />
      <Field label="Stop-loss" value={stop} onChange={setStop} suffix="₹" />
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
      <Field label="Monthly investment" value={amount} onChange={setAmount} suffix="₹" />
      <Field label="Expected return" value={rate} onChange={setRate} suffix="% p.a." />
      <Field label="Duration" value={years} onChange={setYears} suffix="yrs" />
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
      <Field label="Initial value" value={initial} onChange={setInitial} suffix="₹" />
      <Field label="Final value" value={final} onChange={setFinal} suffix="₹" />
      <Field label="Period" value={years} onChange={setYears} suffix="yrs" />
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
      <View style={styles.seg}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.segBtn, mode === t.key && styles.segBtnActive]}
            onPress={() => setMode(t.key)}
          >
            <Text style={[styles.segText, mode === t.key && styles.segTextActive]}>{t.label}</Text>
          </TouchableOpacity>
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
  seg: { flexDirection: 'row', gap: 6, padding: 12 },
  segBtn: {
    flex: 1,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
  },
  segBtnActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  segText: { color: theme.muted2, fontFamily: theme.mono, fontSize: 12 },
  segTextActive: { color: theme.bg, fontWeight: '700' },
  content: { padding: 16, paddingBottom: 48 },
  blurb: { color: theme.muted, fontSize: 12, lineHeight: 17, marginBottom: 16 },
  field: { marginBottom: 14 },
  label: { color: theme.muted2, fontSize: 11, fontFamily: theme.mono, marginBottom: 5 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  input: { flex: 1, color: theme.text, paddingVertical: 11, fontFamily: theme.mono, fontSize: 15 },
  suffix: { color: theme.muted, fontFamily: theme.mono, fontSize: 12, marginLeft: 8 },
  result: {
    marginTop: 8,
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
  },
  rRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
  },
  rK: { color: theme.muted2, fontSize: 13, fontFamily: theme.mono },
  rV: { color: theme.text, fontSize: 14, fontFamily: theme.mono },
  rVhi: { fontSize: 18, fontWeight: '700' },
});
