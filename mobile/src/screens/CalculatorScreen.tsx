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
import { DEFAULT_COSTS, tradeCharges, type Segment } from '../costs';

type Mode =
  | 'sip'
  | 'swp'
  | 'lumpsum'
  | 'cagr'
  | 'goal'
  | 'fdrd'
  | 'position'
  | 'rr'
  | 'brokerage'
  | 'fno'
  | 'currency';

const money = (n: number, dp = 2) =>
  isFinite(n) ? '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: dp }) : '—';
const plain = (n: number, dp = 2) =>
  isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: dp }) : '—';
const pctStr = (n: number, dp = 2) => (isFinite(n) ? n.toFixed(dp) + '%' : '—');
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

// A small labeled segmented toggle (Delivery/Intraday, Call/Put, INR/USD…).
function Toggle({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: [string, string][];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.toggleRow}>
        {options.map(([v, l]) => (
          <ChipBtn key={v} label={l} on={value === v} onPress={() => onChange(v)} style={styles.toggleChip} />
        ))}
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
  const perShare = Math.abs(num(entry) - num(stop));
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
          { k: 'Risk / share', v: perShare > 0 ? money(perShare) : '— (stop = entry)' },
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

// ── SWP (systematic withdrawal) ──
function SwpCalc() {
  const [corpus, setCorpus] = useState('1000000');
  const [withdraw, setWithdraw] = useState('8000');
  const [rate, setRate] = useState('8');
  const [years, setYears] = useState('20');

  const P = num(corpus);
  const W = num(withdraw);
  const i = num(rate) / 100 / 12;
  const N = Math.round(num(years) * 12);
  let bal = P;
  let withdrawn = 0;
  let depletedAt = 0;
  for (let m = 1; m <= N; m++) {
    bal = bal * (1 + i) - W;
    if (bal <= 0) {
      withdrawn += W + bal; // last withdrawal is partial
      bal = 0;
      depletedAt = m;
      break;
    }
    withdrawn += W;
  }
  const duration = depletedAt
    ? `Depletes in ${Math.floor(depletedAt / 12)}y ${depletedAt % 12}m`
    : `Lasts full ${num(years)}y`;

  return (
    <>
      <Text style={styles.blurb}>
        Draw a monthly income from a corpus that keeps growing — how long it lasts and what remains.
      </Text>
      <Card>
        <Field label="Total investment (corpus)" value={corpus} onChange={setCorpus} suffix="₹" />
        <Field label="Monthly withdrawal" value={withdraw} onChange={setWithdraw} suffix="₹" />
        <Field label="Expected return" value={rate} onChange={setRate} suffix="% p.a." />
        <Field label="Period" value={years} onChange={setYears} suffix="yrs" />
      </Card>
      <Result
        rows={[
          { k: 'Balance at end', v: money(bal), hi: true, color: bal > 0 ? theme.green : theme.red },
          { k: 'Total withdrawn', v: money(withdrawn) },
          { k: 'Corpus duration', v: duration, color: depletedAt ? theme.red : theme.green },
        ]}
      />
    </>
  );
}

// ── Lumpsum future value ──
function LumpsumCalc() {
  const [amount, setAmount] = useState('100000');
  const [rate, setRate] = useState('12');
  const [years, setYears] = useState('10');

  const P = num(amount);
  const fv = P * Math.pow(1 + num(rate) / 100, num(years));
  const gains = fv - P;

  return (
    <>
      <Text style={styles.blurb}>
        Future value of a one-time investment compounding annually at an assumed return.
      </Text>
      <Card>
        <Field label="Investment amount" value={amount} onChange={setAmount} suffix="₹" />
        <Field label="Expected return" value={rate} onChange={setRate} suffix="% p.a." />
        <Field label="Period" value={years} onChange={setYears} suffix="yrs" />
      </Card>
      <Result
        rows={[
          { k: 'Invested', v: money(P) },
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
          { k: 'Gain / loss', v: money(p1 - p0), color: p1 - p0 >= 0 ? theme.green : theme.red },
          { k: 'CAGR', v: isFinite(cagr) ? cagr.toFixed(2) + '%' : '—', hi: true, color: col },
        ]}
      />
    </>
  );
}

// ── Goal planner ──
function GoalCalc() {
  const [target, setTarget] = useState('10000000');
  const [rate, setRate] = useState('12');
  const [years, setYears] = useState('15');

  const F = num(target);
  const i = num(rate) / 100 / 12;
  const n = Math.round(num(years) * 12);
  // Required annuity-due monthly SIP to reach the target.
  const sip = n > 0 ? (i > 0 ? F / (((Math.pow(1 + i, n) - 1) / i) * (1 + i)) : F / n) : NaN;
  // Equivalent one-time investment today.
  const lump = F / Math.pow(1 + num(rate) / 100, num(years));
  const invested = sip * n;

  return (
    <>
      <Text style={styles.blurb}>
        The monthly SIP (or one-time lumpsum) needed to reach a target corpus in a set time.
      </Text>
      <Card>
        <Field label="Target corpus" value={target} onChange={setTarget} suffix="₹" />
        <Field label="Expected return" value={rate} onChange={setRate} suffix="% p.a." />
        <Field label="Time to goal" value={years} onChange={setYears} suffix="yrs" />
      </Card>
      <Result
        rows={[
          { k: 'Required monthly SIP', v: money(sip), hi: true, color: theme.green },
          { k: 'Or lumpsum today', v: money(lump) },
          { k: 'Total invested', v: money(invested) },
          { k: 'Growth needed', v: money(F - invested) },
        ]}
      />
    </>
  );
}

// ── FD / RD maturity ──
function FdRdCalc() {
  const [mode, setMode] = useState('fd');
  const [amount, setAmount] = useState('100000');
  const [rate, setRate] = useState('7');
  const [years, setYears] = useState('5');

  const A = num(amount);
  const rr = num(rate) / 100;
  const y = num(years);
  let maturity: number;
  let invested: number;
  if (mode === 'fd') {
    maturity = A * Math.pow(1 + rr / 4, 4 * y); // quarterly compounding
    invested = A;
  } else {
    // RD: monthly deposits, interest accrued monthly
    const months = Math.round(y * 12);
    const i = rr / 12;
    let bal = 0;
    for (let m = 0; m < months; m++) bal = (bal + A) * (1 + i);
    maturity = bal;
    invested = A * months;
  }
  const interest = maturity - invested;

  return (
    <>
      <Text style={styles.blurb}>
        Bank deposit maturity — FD compounds quarterly on a lumpsum; RD adds a fixed deposit each month.
      </Text>
      <Card>
        <Toggle
          label="Type"
          options={[
            ['fd', 'Fixed (FD)'],
            ['rd', 'Recurring (RD)'],
          ]}
          value={mode}
          onChange={setMode}
        />
        <Field
          label={mode === 'fd' ? 'Deposit amount' : 'Monthly deposit'}
          value={amount}
          onChange={setAmount}
          suffix="₹"
        />
        <Field label="Interest rate" value={rate} onChange={setRate} suffix="% p.a." />
        <Field label="Period" value={years} onChange={setYears} suffix="yrs" />
      </Card>
      <Result
        rows={[
          { k: 'Maturity value', v: money(maturity), hi: true, color: theme.green },
          { k: 'Invested', v: money(invested) },
          { k: 'Interest earned', v: money(interest), color: theme.green },
        ]}
      />
    </>
  );
}

// ── Risk : reward ──
function RiskRewardCalc() {
  const [entry, setEntry] = useState('1000');
  const [stop, setStop] = useState('950');
  const [target, setTarget] = useState('1150');
  const [qty, setQty] = useState('100');

  const e = num(entry);
  const s = num(stop);
  const t = num(target);
  const q = num(qty);
  const risk = Math.abs(e - s);
  const reward = Math.abs(t - e);
  const ratio = risk > 0 ? reward / risk : NaN;
  const lossPct = e > 0 ? ((s - e) / e) * 100 : NaN;
  const gainPct = e > 0 ? ((t - e) / e) * 100 : NaN;

  return (
    <>
      <Text style={styles.blurb}>
        Reward-to-risk of a trade from entry, stop and target — plus rupee and % up/down.
      </Text>
      <Card>
        <Field label="Entry price" value={entry} onChange={setEntry} suffix="₹" />
        <Field label="Stop-loss" value={stop} onChange={setStop} suffix="₹" />
        <Field label="Target" value={target} onChange={setTarget} suffix="₹" />
        <Field label="Quantity" value={qty} onChange={setQty} />
      </Card>
      <Result
        rows={[
          { k: 'Risk : reward', v: isFinite(ratio) ? '1 : ' + ratio.toFixed(2) : '—', hi: true },
          { k: 'Potential profit', v: money(reward * q) + ' (' + pctStr(gainPct) + ')', color: theme.green },
          { k: 'Potential loss', v: money(risk * q) + ' (' + pctStr(lossPct) + ')', color: theme.red },
        ]}
      />
    </>
  );
}

// ── Brokerage & charges (India equity) — reuses costs.ts tradeCharges ──
function BrokerageCalc() {
  const [seg, setSeg] = useState<Segment>('delivery');
  const [buy, setBuy] = useState('1000');
  const [sell, setSell] = useState('1050');
  const [qty, setQty] = useState('100');

  const b = num(buy);
  const s = num(sell);
  const q = num(qty);
  const buyVal = b * q;
  const sellVal = s * q;
  // Reuse the statutory-charge engine from costs.ts (₹0 brokerage on delivery
  // for discount brokers; ₹20/side cap on intraday).
  const model = {
    ...DEFAULT_COSTS,
    segment: seg,
    brokerageFlat: seg === 'delivery' ? 0 : 20,
    slippageBps: 0,
  };
  const ch = tradeCharges(buyVal, sellVal, model);
  const gross = (s - b) * q;
  const net = gross - ch.total;
  const breakeven = q > 0 ? ch.total / q : 0; // ₹/share move to break even

  return (
    <>
      <Text style={styles.blurb}>
        All-in India equity charges (brokerage, STT, exchange, SEBI, GST, stamp) — net P&L and the
        break-even move. Approximate; verify with your broker.
      </Text>
      <Card>
        <Toggle
          label="Segment"
          options={[
            ['delivery', 'Delivery'],
            ['intraday', 'Intraday'],
          ]}
          value={seg}
          onChange={(v) => setSeg(v as Segment)}
        />
        <Field label="Buy price" value={buy} onChange={setBuy} suffix="₹" />
        <Field label="Sell price" value={sell} onChange={setSell} suffix="₹" />
        <Field label="Quantity" value={qty} onChange={setQty} />
      </Card>
      <Result
        rows={[
          { k: 'Net P&L (after charges)', v: money(net), hi: true, color: net >= 0 ? theme.green : theme.red },
          { k: 'Gross P&L', v: money(gross), color: gross >= 0 ? theme.green : theme.red },
          { k: 'Total charges', v: money(ch.total), color: theme.red },
          { k: 'Break-even move', v: money(breakeven) + '/sh' },
        ]}
      />
      <Text style={styles.breakdown}>
        Brokerage {money(ch.brokerage)} · STT {money(ch.stt)} · Exchange {money(ch.exchange)} · GST{' '}
        {money(ch.gst)} · Stamp {money(ch.stamp)} · SEBI {money(ch.sebi)}
      </Text>
    </>
  );
}

// ── F&O option breakeven ──
function FnoCalc() {
  const [type, setType] = useState('call');
  const [action, setAction] = useState('buy');
  const [strike, setStrike] = useState('22000');
  const [premium, setPremium] = useState('150');
  const [lot, setLot] = useState('75');

  const k = num(strike);
  const p = num(premium);
  const q = num(lot);
  const breakeven = type === 'call' ? k + p : Math.max(0, k - p);
  const outlay = p * q;
  const isBuy = action === 'buy';
  let maxProfit: string;
  let maxLoss: string;
  if (type === 'call') {
    maxProfit = isBuy ? 'Unlimited' : money(outlay);
    maxLoss = isBuy ? money(outlay) : 'Unlimited';
  } else {
    const cap = (k - p) * q; // put value floored at spot 0
    maxProfit = isBuy ? money(cap) : money(outlay);
    maxLoss = isBuy ? money(outlay) : money(cap);
  }

  return (
    <>
      <Text style={styles.blurb}>
        Spot price at which an option position breaks even, plus premium outlay and max profit/loss.
      </Text>
      <Card>
        <Toggle
          label="Option"
          options={[
            ['call', 'Call'],
            ['put', 'Put'],
          ]}
          value={type}
          onChange={setType}
        />
        <Toggle
          label="Position"
          options={[
            ['buy', 'Buy'],
            ['sell', 'Sell / write'],
          ]}
          value={action}
          onChange={setAction}
        />
        <Field label="Strike price" value={strike} onChange={setStrike} suffix="₹" />
        <Field label="Premium" value={premium} onChange={setPremium} suffix="₹" />
        <Field label="Lot size (qty)" value={lot} onChange={setLot} />
      </Card>
      <Result
        rows={[
          { k: 'Breakeven (spot)', v: money(breakeven), hi: true },
          { k: 'Premium outlay', v: money(outlay), color: isBuy ? theme.red : theme.green },
          { k: 'Max profit', v: maxProfit, color: theme.green },
          { k: 'Max loss', v: maxLoss, color: theme.red },
        ]}
      />
    </>
  );
}

// ── Currency converter (editable rates — no live FX in the prototype) ──
const CCYS = ['INR', 'USD', 'EUR', 'GBP'] as const;
type Ccy = (typeof CCYS)[number];

function CurrencyCalc() {
  const [amount, setAmount] = useState('1000');
  const [from, setFrom] = useState<Ccy>('USD');
  const [to, setTo] = useState<Ccy>('INR');
  // Editable assumed rates: units of INR per 1 unit of currency (INR = 1).
  const [usd, setUsd] = useState('86');
  const [eur, setEur] = useState('93');
  const [gbp, setGbp] = useState('108');

  const inrPer: Record<Ccy, number> = { INR: 1, USD: num(usd), EUR: num(eur), GBP: num(gbp) };
  const amt = num(amount);
  const out = inrPer[to] > 0 ? (amt * inrPer[from]) / inrPer[to] : NaN;
  const one = inrPer[to] > 0 ? inrPer[from] / inrPer[to] : NaN;

  return (
    <>
      <Text style={styles.blurb}>
        Convert between INR, USD, EUR and GBP. Rates are editable assumptions (no live FX feed in the
        prototype) — set them to today's rate.
      </Text>
      <Card>
        <Field label="Amount" value={amount} onChange={setAmount} />
        <Toggle label="From" options={CCYS.map((c) => [c, c])} value={from} onChange={(v) => setFrom(v as Ccy)} />
        <Toggle label="To" options={CCYS.map((c) => [c, c])} value={to} onChange={(v) => setTo(v as Ccy)} />
        <Text style={styles.subhead}>Assumed rates (₹ per 1 unit)</Text>
        <Field label="1 USD" value={usd} onChange={setUsd} suffix="₹" />
        <Field label="1 EUR" value={eur} onChange={setEur} suffix="₹" />
        <Field label="1 GBP" value={gbp} onChange={setGbp} suffix="₹" />
      </Card>
      <Result
        rows={[
          { k: `${plain(amt)} ${from} =`, v: isFinite(out) ? `${plain(out, 2)} ${to}` : '—', hi: true },
          { k: 'Exchange rate', v: isFinite(one) ? `1 ${from} = ${plain(one, 4)} ${to}` : '—' },
        ]}
      />
    </>
  );
}

type Group = 'Investing' | 'Trading' | 'Utilities';
const TABS: { key: Mode; label: string; group: Group }[] = [
  { key: 'sip', label: 'SIP', group: 'Investing' },
  { key: 'swp', label: 'SWP', group: 'Investing' },
  { key: 'lumpsum', label: 'Lumpsum', group: 'Investing' },
  { key: 'cagr', label: 'CAGR', group: 'Investing' },
  { key: 'goal', label: 'Goal planner', group: 'Investing' },
  { key: 'fdrd', label: 'FD / RD', group: 'Investing' },
  { key: 'position', label: 'Position size', group: 'Trading' },
  { key: 'rr', label: 'Risk : reward', group: 'Trading' },
  { key: 'brokerage', label: 'Brokerage', group: 'Trading' },
  { key: 'fno', label: 'F&O breakeven', group: 'Trading' },
  { key: 'currency', label: 'Currency', group: 'Utilities' },
];
const GROUPS: Group[] = ['Investing', 'Trading', 'Utilities'];

function Body({ mode }: { mode: Mode }) {
  switch (mode) {
    case 'sip':
      return <SipCalc />;
    case 'swp':
      return <SwpCalc />;
    case 'lumpsum':
      return <LumpsumCalc />;
    case 'cagr':
      return <CagrCalc />;
    case 'goal':
      return <GoalCalc />;
    case 'fdrd':
      return <FdRdCalc />;
    case 'position':
      return <PositionCalc />;
    case 'rr':
      return <RiskRewardCalc />;
    case 'brokerage':
      return <BrokerageCalc />;
    case 'fno':
      return <FnoCalc />;
    case 'currency':
      return <CurrencyCalc />;
  }
}

export default function CalculatorScreen() {
  const [mode, setMode] = useState<Mode>('sip');
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenTitle title="Calculators" sub="Plan investments and size trades — quick market maths." />
      <View style={styles.tabsWrap}>
        {GROUPS.map((g) => (
          <View key={g} style={styles.group}>
            <Text style={styles.groupLabel}>{g}</Text>
            <View style={styles.chipRow}>
              {TABS.filter((t) => t.group === g).map((t) => (
                <ChipBtn key={t.key} label={t.label} on={mode === t.key} onPress={() => setMode(t.key)} />
              ))}
            </View>
          </View>
        ))}
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Body mode={mode} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  tabsWrap: { paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.sm, gap: theme.sp.sm },
  group: { gap: theme.sp.xs },
  groupLabel: {
    color: theme.muted,
    fontSize: theme.fs.xs,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginBottom: theme.sp.xs },
  content: {
    padding: theme.sp.lg,
    paddingBottom: 48,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
  },
  blurb: { color: theme.muted, fontSize: theme.fs.sm, lineHeight: 18, marginBottom: theme.sp.lg },
  breakdown: {
    color: theme.muted,
    fontSize: theme.fs.xs + 1,
    fontFamily: theme.mono,
    lineHeight: 17,
    marginTop: theme.sp.md,
  },
  subhead: {
    color: theme.muted2,
    fontSize: theme.fs.xs + 1,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: theme.sp.sm,
    marginBottom: theme.sp.sm,
  },
  field: { marginBottom: theme.sp.md },
  label: { color: theme.muted2, fontSize: theme.fs.sm, marginBottom: theme.sp.xs },
  toggleRow: { flexDirection: 'row', gap: theme.sp.sm },
  toggleChip: { flex: 1, alignItems: 'center' },
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
