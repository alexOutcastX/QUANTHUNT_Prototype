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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Candle, api } from '../api';
import { BacktestResult, CUSTOM_KEY, CustomRule, Risk, STRATEGIES, runBacktest } from '../backtest';
import HtmlView from '../components/HtmlView';
import { theme } from '../theme';

const UP = '#10b981';
const DOWN = '#f43f5e';
const INTERVALS = [
  { label: 'Daily', v: '1d' },
  { label: '1H', v: '1h' },
  { label: '15m', v: '15m' },
];
const PERIODS = ['3mo', '6mo', '1y', '2y', '5y'];

const money = (v: number) => '₹' + Math.round(v).toLocaleString('en-IN');
const signed = (v: number, d = 2) => (v >= 0 ? '+' : '') + v.toFixed(d);

// ── Custom rule builder ──────────────────────────────────────────────────────
const RULES_KEY = 'te_custom_rules_v1';
const IND_OPTS: CustomRule['ind'][] = ['close', 'rsi', 'ema', 'sma', 'macd_hist', 'volume'];
const OP_OPTS: CustomRule['op'][] = ['gt', 'lt', 'cross_above', 'cross_below'];
const TGT_OPTS: CustomRule['target'][] = ['value', 'ema', 'sma', 'close'];
const IND_LBL: Record<CustomRule['ind'], string> = {
  close: 'CLOSE', rsi: 'RSI', ema: 'EMA', sma: 'SMA', macd_hist: 'MACD-H', volume: 'VOL',
};
const OP_LBL: Record<CustomRule['op'], string> = {
  gt: '>', lt: '<', cross_above: 'X↑', cross_below: 'X↓',
};
const TGT_LBL: Record<CustomRule['target'], string> = {
  value: 'VALUE', ema: 'EMA', sma: 'SMA', close: 'CLOSE',
};
const hasPeriod = (ind: CustomRule['ind']) => ind === 'rsi' || ind === 'ema' || ind === 'sma';
const defaultBuyRule = (): CustomRule => ({ ind: 'rsi', period: 14, op: 'lt', target: 'value', value: 30 });
const defaultSellRule = (): CustomRule => ({ ind: 'rsi', period: 14, op: 'gt', target: 'value', value: 70 });
const cycle = <T,>(opts: readonly T[], cur: T): T => opts[(opts.indexOf(cur) + 1) % opts.length];

function RuleRow({
  rule,
  onChange,
  onRemove,
}: {
  rule: CustomRule;
  onChange: (r: CustomRule) => void;
  onRemove: () => void;
}) {
  const cycleInd = () => {
    const ind = cycle(IND_OPTS, rule.ind);
    onChange({ ...rule, ind, period: hasPeriod(ind) ? rule.period ?? (ind === 'rsi' ? 14 : 20) : rule.period });
  };
  const cycleTgt = () => {
    const target = cycle(TGT_OPTS, rule.target);
    const value = target === 'ema' || target === 'sma' ? rule.value || 20 : rule.value;
    onChange({ ...rule, target, value });
  };
  return (
    <View style={styles.ruleRow}>
      <TouchableOpacity style={styles.ruleSeg} onPress={cycleInd}>
        <Text style={styles.ruleSegTxt}>{IND_LBL[rule.ind]}</Text>
      </TouchableOpacity>
      {hasPeriod(rule.ind) ? (
        <TextInput
          style={styles.ruleInput}
          value={String(rule.period ?? '')}
          onChangeText={(t) => onChange({ ...rule, period: parseFloat(t) || 0 })}
          keyboardType="numeric"
        />
      ) : null}
      <TouchableOpacity style={styles.ruleSeg} onPress={() => onChange({ ...rule, op: cycle(OP_OPTS, rule.op) })}>
        <Text style={[styles.ruleSegTxt, styles.ruleOpTxt]}>{OP_LBL[rule.op]}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.ruleSeg} onPress={cycleTgt}>
        <Text style={styles.ruleSegTxt}>{TGT_LBL[rule.target]}</Text>
      </TouchableOpacity>
      {rule.target !== 'close' ? (
        <TextInput
          style={styles.ruleInput}
          value={String(rule.value ?? '')}
          onChangeText={(t) => onChange({ ...rule, value: parseFloat(t) || 0 })}
          keyboardType="numeric"
        />
      ) : null}
      <TouchableOpacity style={styles.ruleDel} onPress={onRemove}>
        <Text style={styles.ruleDelTxt}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

function resultHtml(candles: Candle[], result: BacktestResult): string {
  const cData = JSON.stringify(
    candles.map((c) => ({ time: c.t, open: c.o, high: c.h, low: c.l, close: c.c })),
  );
  const markers = JSON.stringify(
    result.markers.map((m) => ({
      time: m.time,
      position: m.kind === 'buy' ? 'belowBar' : 'aboveBar',
      color: m.kind === 'buy' ? UP : m.win ? UP : DOWN,
      shape: m.kind === 'buy' ? 'arrowUp' : 'arrowDown',
      text: m.kind === 'buy' ? 'B' : 'S',
    })),
  );
  const eq = JSON.stringify(result.equityCurve.map((p) => ({ time: p.t, value: p.eq })));
  const eqColor = result.stats.totalRet >= 0 ? UP : DOWN;
  return `<!DOCTYPE html><html><head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <style>html,body{margin:0;background:${theme.bg}}#p{height:60%}#e{height:40%}
  .lbl{color:${theme.muted2};font:10px monospace;padding:4px 8px}
  #msg{color:#5e6776;font:12px monospace;text-align:center;padding-top:40px}</style>
  </head><body>
  <div id="msg">Loading chart library…</div>
  <div class="lbl" id="pl" style="display:none">Price &amp; Signals</div><div id="p"></div>
  <div class="lbl" id="el" style="display:none">Equity Curve</div><div id="e"></div>
  <script src="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"></script>
  <script>
  (function(){
    var msg=document.getElementById('msg');
    if(typeof LightweightCharts==='undefined'){msg.textContent='⚠ Chart library unavailable (no network).';return;}
    msg.style.display='none';document.getElementById('pl').style.display='block';document.getElementById('el').style.display='block';
    var LW=LightweightCharts;
    function base(el){return LW.createChart(el,{autoSize:true,layout:{background:{color:'${theme.bg}'},textColor:'${theme.muted2}',fontFamily:'monospace'},grid:{vertLines:{color:'${theme.border}'},horzLines:{color:'${theme.border}'}},rightPriceScale:{borderColor:'${theme.border2}'},timeScale:{borderColor:'${theme.border2}',timeVisible:false}});}
    var pc=base(document.getElementById('p'));
    var cs=pc.addCandlestickSeries({upColor:'${UP}',downColor:'${DOWN}',borderUpColor:'${UP}',borderDownColor:'${DOWN}',wickUpColor:'${UP}',wickDownColor:'${DOWN}'});
    cs.setData(${cData});
    cs.setMarkers(${markers});
    pc.timeScale().fitContent();
    var ec=base(document.getElementById('e'));
    var ls=ec.addAreaSeries({lineColor:'${eqColor}',topColor:'${eqColor}55',bottomColor:'${eqColor}05',lineWidth:2});
    ls.setData(${eq});
    ec.timeScale().fitContent();
  })();
  </script></body></html>`;
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  labelOf,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  labelOf?: (v: T) => string;
}) {
  return (
    <View style={styles.seg}>
      {options.map((o) => (
        <TouchableOpacity
          key={o}
          style={[styles.segBtn, value === o && styles.segBtnOn]}
          onPress={() => onChange(o)}
        >
          <Text style={[styles.segTxt, value === o && styles.segTxtOn]}>{labelOf ? labelOf(o) : o}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function BacktestScreen() {
  const [sym, setSym] = useState('RELIANCE');
  const [stratKey, setStratKey] = useState('ema_cross');
  const [interval, setInterval] = useState('1d');
  const [period, setPeriod] = useState('1y');
  const [params, setParams] = useState<number[]>(
    STRATEGIES[0].params.map((p) => p.default),
  );
  const [capital, setCapital] = useState('100000');
  const [slType, setSlType] = useState<Risk['slType']>('pct');
  const [slVal, setSlVal] = useState('5');
  const [tpType, setTpType] = useState<Risk['tpType']>('none');
  const [tpVal, setTpVal] = useState('10');
  const [trailOn, setTrailOn] = useState(false);
  const [trailPct, setTrailPct] = useState('1.5');

  const [buyRules, setBuyRules] = useState<CustomRule[]>([defaultBuyRule()]);
  const [sellRules, setSellRules] = useState<CustomRule[]>([defaultSellRule()]);
  const [rulesRestored, setRulesRestored] = useState(false);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [html, setHtml] = useState('');

  // Restore persisted custom rules once, before saving anything back.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(RULES_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.buy) && Array.isArray(parsed.sell)) {
            setBuyRules(parsed.buy);
            setSellRules(parsed.sell);
          }
        }
      } catch {
        /* fresh start */
      } finally {
        setRulesRestored(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!rulesRestored) return;
    AsyncStorage.setItem(RULES_KEY, JSON.stringify({ buy: buyRules, sell: sellRules })).catch(() => {});
  }, [buyRules, sellRules, rulesRestored]);

  const strat = STRATEGIES.find((s) => s.key === stratKey) || STRATEGIES[0];
  const isCustom = stratKey === CUSTOM_KEY;
  const stratLabel = isCustom ? 'Custom' : strat.label;

  const pickStrat = (key: string) => {
    setStratKey(key);
    const def = STRATEGIES.find((s) => s.key === key);
    if (def) setParams(def.params.map((p) => p.default));
  };
  const setParam = (i: number, text: string) => {
    setParams((prev) => prev.map((v, idx) => (idx === i ? parseFloat(text) || 0 : v)));
  };

  const run = async () => {
    const symbol = sym.trim().toUpperCase().replace(/^NSE:/, '');
    if (!symbol) {
      setMsg('⚠ Enter a symbol to backtest.');
      return;
    }
    if (isCustom && buyRules.length === 0 && sellRules.length === 0) {
      setMsg('⚠ Add at least one rule.');
      return;
    }
    setBusy(true);
    setResult(null);
    setHtml('');
    setMsg('⟳ Fetching data…');
    try {
      const hist = await api.history(symbol, period, interval);
      const candles = Array.isArray(hist.candles) ? hist.candles : [];
      if (candles.length < 20) {
        setMsg(`⚠ No data for ${symbol}. Try a different symbol or period.`);
        setBusy(false);
        return;
      }
      setMsg(`⟳ Running ${stratLabel} on ${candles.length} bars…`);
      await new Promise((r) => setTimeout(r, 16));
      const risk: Risk = {
        capital: parseFloat(capital) || 100000,
        slType,
        slVal: parseFloat(slVal) || 0,
        tpType,
        tpVal: parseFloat(tpVal) || 0,
        trailOn,
        trailPct: parseFloat(trailPct) || 1.5,
      };
      const res = runBacktest(
        candles,
        stratKey,
        params,
        risk,
        isCustom ? { buy: buyRules, sell: sellRules } : undefined,
      );
      setResult(res);
      setHtml(resultHtml(candles, res));
      setMsg(null);
    } catch (e) {
      setMsg('⚠ ' + (e instanceof Error ? e.message : 'Backtest failed') + ' — is the backend reachable?');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.h1}>Strategy Backtest</Text>

      <Text style={styles.lbl}>Symbol</Text>
      <TextInput
        style={styles.input}
        value={sym}
        onChangeText={setSym}
        autoCapitalize="characters"
        placeholder="RELIANCE"
        placeholderTextColor={theme.muted}
      />

      <Text style={styles.lbl}>Strategy</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
        {STRATEGIES.map((s) => (
          <TouchableOpacity
            key={s.key}
            style={[styles.chip, s.key === stratKey && styles.chipOn]}
            onPress={() => pickStrat(s.key)}
          >
            <Text style={[styles.chipTxt, s.key === stratKey && styles.chipTxtOn]}>{s.label}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          key={CUSTOM_KEY}
          style={[styles.chip, isCustom && styles.chipOn]}
          onPress={() => pickStrat(CUSTOM_KEY)}
        >
          <Text style={[styles.chipTxt, isCustom && styles.chipTxtOn]}>Custom</Text>
        </TouchableOpacity>
      </ScrollView>

      {isCustom ? (
        <View>
          <Text style={styles.lblSm}>
            Tap a segment to cycle it. X↑ / X↓ = crosses above / below.
          </Text>
          <Text style={styles.ruleSection}>BUY WHEN (all true)</Text>
          {buyRules.map((r, i) => (
            <RuleRow
              key={'b' + i}
              rule={r}
              onChange={(nr) => setBuyRules((p) => p.map((x, j) => (j === i ? nr : x)))}
              onRemove={() => setBuyRules((p) => p.filter((_, j) => j !== i))}
            />
          ))}
          <TouchableOpacity style={styles.addRule} onPress={() => setBuyRules((p) => [...p, defaultBuyRule()])}>
            <Text style={styles.addRuleTxt}>+ ADD RULE</Text>
          </TouchableOpacity>
          <Text style={styles.ruleSection}>SELL WHEN (all true)</Text>
          {sellRules.map((r, i) => (
            <RuleRow
              key={'s' + i}
              rule={r}
              onChange={(nr) => setSellRules((p) => p.map((x, j) => (j === i ? nr : x)))}
              onRemove={() => setSellRules((p) => p.filter((_, j) => j !== i))}
            />
          ))}
          <TouchableOpacity style={styles.addRule} onPress={() => setSellRules((p) => [...p, defaultSellRule()])}>
            <Text style={styles.addRuleTxt}>+ ADD RULE</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.paramRow}>
          {strat.params.map((p, i) => (
            <View key={p.label} style={styles.paramCell}>
              <Text style={styles.lblSm}>{p.label}</Text>
              <TextInput
                style={styles.paramInput}
                value={String(params[i] ?? '')}
                onChangeText={(t) => setParam(i, t)}
                keyboardType="numeric"
              />
            </View>
          ))}
        </View>
      )}

      <View style={styles.row2}>
        <View style={styles.half}>
          <Text style={styles.lbl}>Interval</Text>
          <Segmented options={INTERVALS.map((x) => x.v)} value={interval} onChange={setInterval} labelOf={(v) => INTERVALS.find((x) => x.v === v)?.label || v} />
        </View>
      </View>
      <Text style={styles.lbl}>Period</Text>
      <Segmented options={PERIODS} value={period} onChange={setPeriod} />

      <View style={styles.row2}>
        <View style={styles.half}>
          <Text style={styles.lbl}>Capital ₹</Text>
          <TextInput style={styles.input} value={capital} onChangeText={setCapital} keyboardType="numeric" />
        </View>
      </View>

      <Text style={styles.lbl}>Stop Loss</Text>
      <View style={styles.riskRow}>
        <Segmented options={['none', 'pct', 'atr'] as Risk['slType'][]} value={slType} onChange={setSlType} labelOf={(v) => (v === 'none' ? 'Off' : v === 'pct' ? '%' : 'ATR×')} />
        {slType !== 'none' ? (
          <TextInput style={styles.smInput} value={slVal} onChangeText={setSlVal} keyboardType="numeric" />
        ) : null}
      </View>

      <Text style={styles.lbl}>Target</Text>
      <View style={styles.riskRow}>
        <Segmented options={['none', 'pct', 'rr'] as Risk['tpType'][]} value={tpType} onChange={setTpType} labelOf={(v) => (v === 'none' ? 'Off' : v === 'pct' ? '%' : 'R:R')} />
        {tpType !== 'none' ? (
          <TextInput style={styles.smInput} value={tpVal} onChangeText={setTpVal} keyboardType="numeric" />
        ) : null}
      </View>

      <Text style={styles.lbl}>Trailing Stop</Text>
      <View style={styles.riskRow}>
        <TouchableOpacity
          style={[styles.segBtn, trailOn && styles.segBtnOn, { minWidth: 70 }]}
          onPress={() => setTrailOn((v) => !v)}
        >
          <Text style={[styles.segTxt, trailOn && styles.segTxtOn]}>{trailOn ? 'On' : 'Off'}</Text>
        </TouchableOpacity>
        {trailOn ? (
          <TextInput style={styles.smInput} value={trailPct} onChangeText={setTrailPct} keyboardType="numeric" />
        ) : null}
      </View>

      <TouchableOpacity style={styles.runBtn} onPress={run} disabled={busy}>
        {busy ? <ActivityIndicator color={theme.bg} /> : <Text style={styles.runTxt}>▶ Run Backtest</Text>}
      </TouchableOpacity>

      {msg ? <Text style={styles.msg}>{msg}</Text> : null}

      {result ? (
        <View style={styles.results}>
          <View style={styles.statGrid}>
            <StatCard label="Total Return" value={signed(result.stats.totalRet) + '%'} color={result.stats.totalRet >= 0 ? theme.green : theme.red} />
            <StatCard label="Final Capital" value={money(result.stats.finalCapital)} color={result.stats.totalRet >= 0 ? theme.green : theme.red} />
            <StatCard label="Win Rate" value={result.stats.winRate.toFixed(0) + '%'} />
            <StatCard label="Trades" value={String(result.stats.trades)} />
            <StatCard label="Wins / Losses" value={`${result.stats.wins} / ${result.stats.losses}`} />
            <StatCard label="Max Drawdown" value={result.stats.maxDD.toFixed(1) + '%'} />
            <StatCard label="Profit Factor" value={result.stats.profitFactor == null ? '∞' : result.stats.profitFactor.toFixed(2)} />
            <StatCard label="Avg Trade" value={signed(result.stats.avgRet) + '%'} color={result.stats.avgRet >= 0 ? theme.green : theme.red} />
          </View>

          {html ? (
            <View style={styles.chartBox}>
              <HtmlView html={html} style={styles.web} />
            </View>
          ) : null}

          <Text style={styles.tradeTitle}>Trade Log ({result.trades.length})</Text>
          <View style={styles.tHead}>
            <Text style={[styles.tCell, styles.cDate]}>Buy</Text>
            <Text style={[styles.tCell, styles.cDate]}>Sell</Text>
            <Text style={[styles.tCell, styles.cNum]}>Ret%</Text>
            <Text style={[styles.tCell, styles.cExit]}>Exit</Text>
          </View>
          {result.trades.slice(-50).reverse().map((t, i) => (
            <View style={styles.tRow} key={i}>
              <Text style={[styles.tCell, styles.cDate]}>{fmtT(t.buyT)}</Text>
              <Text style={[styles.tCell, styles.cDate]}>{fmtT(t.sellT)}</Text>
              <Text style={[styles.tCell, styles.cNum, { color: t.ret >= 0 ? theme.green : theme.red }]}>{signed(t.ret)}</Text>
              <Text style={[styles.tCell, styles.cExit]}>{t.exit}</Text>
            </View>
          ))}
          {result.trades.length === 0 ? (
            <Text style={styles.noTrades}>No trades generated — try a longer period or looser params.</Text>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

function fmtT(t: number): string {
  const d = new Date(t * 1000);
  return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statCardLabel}>{label}</Text>
      <Text style={[styles.statCardValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, paddingBottom: 48, width: '100%', maxWidth: 820, alignSelf: 'center' },
  h1: { color: theme.text, fontSize: 18, fontWeight: '700', marginBottom: 12 },
  lbl: { color: theme.muted2, fontSize: 11, fontFamily: theme.mono, marginTop: 14, marginBottom: 5 },
  lblSm: { color: theme.muted2, fontSize: 10, fontFamily: theme.mono, marginBottom: 4 },
  input: { backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1, borderRadius: 8, color: theme.text, paddingHorizontal: 12, paddingVertical: 10, fontFamily: theme.mono, fontSize: 14 },
  chipScroll: { marginVertical: 2 },
  chip: { borderColor: theme.border2, borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 7, marginRight: 6 },
  chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  ruleSection: { color: theme.muted2, fontSize: 10, fontFamily: theme.mono, letterSpacing: 1, marginTop: 10, marginBottom: 6 },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' },
  ruleSeg: { backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1, borderRadius: 5, paddingHorizontal: 10, paddingVertical: 7 },
  ruleSegTxt: { color: theme.text, fontSize: 11, fontFamily: theme.mono, fontWeight: '700' },
  ruleOpTxt: { color: theme.accent },
  ruleInput: {
    backgroundColor: theme.surface,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 5,
    color: theme.text,
    fontFamily: theme.mono,
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 6,
    minWidth: 52,
    textAlign: 'center',
  },
  ruleDel: { paddingHorizontal: 6, paddingVertical: 6 },
  ruleDelTxt: { color: theme.muted, fontSize: 12 },
  addRule: { alignSelf: 'flex-start', borderColor: theme.border2, borderWidth: 1, borderRadius: 5, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 4 },
  addRuleTxt: { color: theme.muted2, fontSize: 10, fontFamily: theme.mono, letterSpacing: 1 },
  chipTxt: { color: theme.muted2, fontFamily: theme.mono, fontSize: 12 },
  chipTxtOn: { color: theme.bg, fontWeight: '700' },
  paramRow: { flexDirection: 'row', gap: 10, marginTop: 12, flexWrap: 'wrap' },
  paramCell: { width: 90 },
  paramInput: { backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1, borderRadius: 6, color: theme.text, paddingHorizontal: 8, paddingVertical: 8, fontFamily: theme.mono, fontSize: 13, textAlign: 'center' },
  row2: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  seg: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  segBtn: { borderColor: theme.border2, borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 7 },
  segBtnOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  segTxt: { color: theme.muted2, fontFamily: theme.mono, fontSize: 12 },
  segTxtOn: { color: theme.bg, fontWeight: '700' },
  riskRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  smInput: { backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1, borderRadius: 6, color: theme.text, paddingHorizontal: 10, paddingVertical: 7, width: 70, fontFamily: theme.mono, fontSize: 13, textAlign: 'center' },
  runBtn: { backgroundColor: theme.accent, borderRadius: 8, paddingVertical: 13, alignItems: 'center', marginTop: 20 },
  runTxt: { color: theme.bg, fontWeight: '700', fontSize: 14 },
  msg: { color: theme.muted, fontFamily: theme.mono, fontSize: 12, marginTop: 16, textAlign: 'center' },
  results: { marginTop: 20 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCard: { width: '48%', backgroundColor: theme.surface2, borderColor: theme.border, borderWidth: 1, borderRadius: 8, padding: 12, alignItems: 'center' },
  statCardLabel: { color: theme.muted2, fontSize: 10, fontFamily: theme.mono, textTransform: 'uppercase' },
  statCardValue: { color: theme.text, fontSize: 17, fontWeight: '700', fontFamily: theme.mono, marginTop: 5 },
  chartBox: { height: 380, marginTop: 16, borderColor: theme.border, borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  web: { flex: 1, backgroundColor: theme.bg },
  tradeTitle: { color: theme.text, fontSize: 13, fontWeight: '700', marginTop: 20, marginBottom: 8 },
  tHead: { flexDirection: 'row', borderBottomColor: theme.border2, borderBottomWidth: 1, paddingBottom: 6 },
  tRow: { flexDirection: 'row', borderBottomColor: theme.border, borderBottomWidth: 1, paddingVertical: 8 },
  tCell: { color: theme.text, fontFamily: theme.mono, fontSize: 12 },
  cDate: { flex: 1 },
  cNum: { width: 64, textAlign: 'right' },
  cExit: { width: 60, textAlign: 'right', color: theme.muted2 },
  noTrades: { color: theme.muted, fontFamily: theme.mono, fontSize: 12, marginTop: 12, textAlign: 'center' },
});
