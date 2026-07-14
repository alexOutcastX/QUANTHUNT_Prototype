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
import { DEFAULT_COSTS } from '../costs';
import HtmlView from '../components/HtmlView';
import { theme } from '../theme';
import { Card, ChipBtn, EmptyState, Loading, ScreenTitle, SectionTitle, StatTile } from '../ui';

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
      <TouchableOpacity style={styles.ruleSeg} onPress={cycleInd} activeOpacity={0.75}>
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
      <TouchableOpacity
        style={styles.ruleSeg}
        onPress={() => onChange({ ...rule, op: cycle(OP_OPTS, rule.op) })}
        activeOpacity={0.75}
      >
        <Text style={[styles.ruleSegTxt, styles.ruleOpTxt]}>{OP_LBL[rule.op]}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.ruleSeg} onPress={cycleTgt} activeOpacity={0.75}>
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
      <TouchableOpacity style={styles.ruleDel} onPress={onRemove} activeOpacity={0.75}>
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
        <ChipBtn
          key={o}
          label={labelOf ? labelOf(o) : o}
          on={value === o}
          onPress={() => onChange(o)}
        />
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
  const [realistic, setRealistic] = useState(true); // apply India charges + slippage

  const [buyRules, setBuyRules] = useState<CustomRule[]>([defaultBuyRule()]);
  const [sellRules, setSellRules] = useState<CustomRule[]>([defaultSellRule()]);
  const [rulesRestored, setRulesRestored] = useState(false);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [html, setHtml] = useState('');

  // One-shot symbol handoff from the Multibagger analyser's "Backtest" action.
  useEffect(() => {
    AsyncStorage.getItem('taureye.backtest.prefill')
      .then((v) => {
        if (v) {
          setSym(v);
          AsyncStorage.removeItem('taureye.backtest.prefill').catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

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
        realistic ? DEFAULT_COSTS : undefined,
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
      <ScreenTitle title="Backtest" sub="Test a strategy against historical data before risking capital." />
      <View style={styles.body}>
        <SectionTitle>Strategy</SectionTitle>
        <Card>
          <Text style={[styles.lbl, styles.lblFirst]}>Symbol</Text>
          <TextInput
            style={styles.input}
            value={sym}
            onChangeText={setSym}
            autoCapitalize="characters"
            placeholder="RELIANCE"
            placeholderTextColor={theme.muted}
          />

          <Text style={styles.lbl}>Strategy</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipScroll}
            contentContainerStyle={styles.chipRow}
          >
            {STRATEGIES.map((s) => (
              <ChipBtn key={s.key} label={s.label} on={s.key === stratKey} onPress={() => pickStrat(s.key)} />
            ))}
            <ChipBtn key={CUSTOM_KEY} label="Custom" on={isCustom} onPress={() => pickStrat(CUSTOM_KEY)} />
          </ScrollView>

          {isCustom ? (
            <View>
              <Text style={styles.hint}>
                Tap a segment to cycle it. X↑ / X↓ = crosses above / below.
              </Text>
              <SectionTitle>BUY WHEN (all true)</SectionTitle>
              {buyRules.map((r, i) => (
                <RuleRow
                  key={'b' + i}
                  rule={r}
                  onChange={(nr) => setBuyRules((p) => p.map((x, j) => (j === i ? nr : x)))}
                  onRemove={() => setBuyRules((p) => p.filter((_, j) => j !== i))}
                />
              ))}
              <TouchableOpacity
                style={styles.addRule}
                onPress={() => setBuyRules((p) => [...p, defaultBuyRule()])}
                activeOpacity={0.75}
              >
                <Text style={styles.addRuleTxt}>+ ADD RULE</Text>
              </TouchableOpacity>
              <SectionTitle>SELL WHEN (all true)</SectionTitle>
              {sellRules.map((r, i) => (
                <RuleRow
                  key={'s' + i}
                  rule={r}
                  onChange={(nr) => setSellRules((p) => p.map((x, j) => (j === i ? nr : x)))}
                  onRemove={() => setSellRules((p) => p.filter((_, j) => j !== i))}
                />
              ))}
              <TouchableOpacity
                style={styles.addRule}
                onPress={() => setSellRules((p) => [...p, defaultSellRule()])}
                activeOpacity={0.75}
              >
                <Text style={styles.addRuleTxt}>+ ADD RULE</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.paramRow}>
              {strat.params.map((p, i) => (
                <View key={p.label} style={styles.paramCell}>
                  <Text style={styles.paramLbl}>{p.label}</Text>
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
        </Card>

        <SectionTitle>Data</SectionTitle>
        <Card>
          <Text style={[styles.lbl, styles.lblFirst]}>Interval</Text>
          <Segmented
            options={INTERVALS.map((x) => x.v)}
            value={interval}
            onChange={setInterval}
            labelOf={(v) => INTERVALS.find((x) => x.v === v)?.label || v}
          />
          <Text style={styles.lbl}>Period</Text>
          <Segmented options={PERIODS} value={period} onChange={setPeriod} />
        </Card>

        <SectionTitle>Risk</SectionTitle>
        <Card>
          <Text style={[styles.lbl, styles.lblFirst]}>Capital ₹</Text>
          <TextInput style={styles.input} value={capital} onChangeText={setCapital} keyboardType="numeric" />

          <Text style={styles.lbl}>Stop Loss</Text>
          <View style={styles.riskRow}>
            <Segmented
              options={['none', 'pct', 'atr'] as Risk['slType'][]}
              value={slType}
              onChange={setSlType}
              labelOf={(v) => (v === 'none' ? 'Off' : v === 'pct' ? '%' : 'ATR×')}
            />
            {slType !== 'none' ? (
              <TextInput style={styles.smInput} value={slVal} onChangeText={setSlVal} keyboardType="numeric" />
            ) : null}
          </View>

          <Text style={styles.lbl}>Target</Text>
          <View style={styles.riskRow}>
            <Segmented
              options={['none', 'pct', 'rr'] as Risk['tpType'][]}
              value={tpType}
              onChange={setTpType}
              labelOf={(v) => (v === 'none' ? 'Off' : v === 'pct' ? '%' : 'R:R')}
            />
            {tpType !== 'none' ? (
              <TextInput style={styles.smInput} value={tpVal} onChangeText={setTpVal} keyboardType="numeric" />
            ) : null}
          </View>

          <Text style={styles.lbl}>Trailing Stop</Text>
          <View style={styles.riskRow}>
            <ChipBtn
              label={trailOn ? 'On' : 'Off'}
              on={trailOn}
              onPress={() => setTrailOn((v) => !v)}
              style={styles.trailChip}
            />
            {trailOn ? (
              <TextInput style={styles.smInput} value={trailPct} onChangeText={setTrailPct} keyboardType="numeric" />
            ) : null}
          </View>

          <Text style={styles.lbl}>Realistic costs</Text>
          <View style={styles.riskRow}>
            <ChipBtn
              label={realistic ? 'On' : 'Off'}
              on={realistic}
              onPress={() => setRealistic((v) => !v)}
              style={styles.trailChip}
            />
            <Text style={styles.costHint}>Brokerage · STT · exchange/SEBI/GST · stamp · slippage</Text>
          </View>
        </Card>

        <TouchableOpacity style={styles.runBtn} onPress={run} disabled={busy} activeOpacity={0.75}>
          {busy ? <ActivityIndicator color={theme.onAccent} /> : <Text style={styles.runTxt}>Run Backtest</Text>}
        </TouchableOpacity>

        {busy && msg ? (
          <View style={styles.loadingBox}>
            <Loading label={msg.replace(/^[⟳⚠]\s*/, '')} />
          </View>
        ) : msg ? (
          <Text style={styles.msg}>{msg.replace(/^[⟳⚠]\s*/, '')}</Text>
        ) : null}

        {result ? (
          <View style={styles.results}>
            <View style={styles.statGrid}>
              <StatTile
                label="Total Return"
                value={signed(result.stats.totalRet) + '%'}
                color={result.stats.totalRet >= 0 ? theme.green : theme.red}
              />
              <StatTile
                label="Final Capital"
                value={money(result.stats.finalCapital)}
                color={result.stats.totalRet >= 0 ? theme.green : theme.red}
              />
              <StatTile label="Win Rate" value={result.stats.winRate.toFixed(0) + '%'} />
              <StatTile label="Trades" value={String(result.stats.trades)} />
              <StatTile label="Wins / Losses" value={`${result.stats.wins} / ${result.stats.losses}`} />
              <StatTile label="Max Drawdown" value={result.stats.maxDD.toFixed(1) + '%'} />
              <StatTile
                label="Profit Factor"
                value={result.stats.profitFactor == null ? '∞' : result.stats.profitFactor.toFixed(2)}
              />
              <StatTile
                label="Avg Trade"
                value={signed(result.stats.avgRet) + '%'}
                color={result.stats.avgRet >= 0 ? theme.green : theme.red}
              />
              {result.stats.totalCharges != null ? (
                <StatTile label="Costs (charges)" value={money(result.stats.totalCharges)} color={theme.red} />
              ) : null}
            </View>

            {html ? (
              <View style={styles.chartBox}>
                <HtmlView html={html} style={styles.web} />
              </View>
            ) : null}

            <SectionTitle>Trade Log ({result.trades.length})</SectionTitle>
            <View style={styles.tHead}>
              <Text style={[styles.th, styles.cDate]}>Buy</Text>
              <Text style={[styles.th, styles.cDate]}>Sell</Text>
              <Text style={[styles.th, styles.cNum]}>Ret%</Text>
              <Text style={[styles.th, styles.cExit]}>Exit</Text>
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
              <EmptyState
                icon="▤"
                title="No trades generated"
                hint="Try a longer period or looser parameters."
              />
            ) : null}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

function fmtT(t: number): string {
  const d = new Date(t * 1000);
  return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  content: { paddingBottom: 48, width: '100%', maxWidth: 820, alignSelf: 'center' },
  body: { paddingHorizontal: theme.sp.lg },
  lbl: { color: theme.muted2, fontSize: theme.fs.sm, marginTop: theme.sp.lg, marginBottom: theme.sp.xs },
  lblFirst: { marginTop: 0 },
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
  chipScroll: { marginVertical: 2 },
  chipRow: { gap: theme.sp.sm, paddingVertical: 2 },
  hint: { color: theme.muted, fontSize: theme.fs.sm, marginTop: theme.sp.md, lineHeight: 17 },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, marginBottom: theme.sp.sm, flexWrap: 'wrap' },
  ruleSeg: {
    height: 38,
    justifyContent: 'center',
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    paddingHorizontal: theme.sp.md,
  },
  ruleSegTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '600' },
  ruleOpTxt: { color: theme.accent, fontWeight: '700' },
  ruleInput: {
    height: 38,
    backgroundColor: theme.surface,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    color: theme.text,
    fontFamily: theme.mono,
    fontSize: theme.fs.sm,
    paddingHorizontal: theme.sp.sm,
    minWidth: 52,
    textAlign: 'center',
  },
  ruleDel: { height: 38, width: 30, alignItems: 'center', justifyContent: 'center' },
  ruleDelTxt: { color: theme.muted, fontSize: theme.fs.md },
  addRule: {
    alignSelf: 'flex-start',
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 8,
    marginBottom: theme.sp.xs,
  },
  addRuleTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '600', letterSpacing: 1 },
  paramRow: { flexDirection: 'row', gap: theme.sp.md, marginTop: theme.sp.lg, flexWrap: 'wrap' },
  paramCell: { width: 96 },
  paramLbl: { color: theme.muted2, fontSize: theme.fs.sm, marginBottom: theme.sp.xs },
  paramInput: {
    height: 38,
    backgroundColor: theme.surface,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    color: theme.text,
    paddingHorizontal: theme.sp.sm,
    fontFamily: theme.mono,
    fontSize: theme.fs.md,
    textAlign: 'center',
  },
  seg: { flexDirection: 'row', gap: theme.sp.sm, flexWrap: 'wrap' },
  riskRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm },
  trailChip: { minWidth: 70, alignItems: 'center' },
  costHint: { color: theme.muted, fontSize: theme.fs.xs + 1, flex: 1, flexWrap: 'wrap' },
  smInput: {
    height: 38,
    backgroundColor: theme.surface,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    color: theme.text,
    paddingHorizontal: theme.sp.sm,
    width: 72,
    fontFamily: theme.mono,
    fontSize: theme.fs.md,
    textAlign: 'center',
  },
  runBtn: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius.sm + 2,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: theme.sp.xl,
  },
  runTxt: { color: theme.onAccent, fontWeight: '700', fontSize: theme.fs.sm + 1, letterSpacing: 0.3 },
  loadingBox: { paddingVertical: theme.sp.xl },
  msg: {
    color: theme.muted2,
    fontSize: theme.fs.sm,
    marginTop: theme.sp.lg,
    textAlign: 'center',
    lineHeight: 18,
  },
  results: { marginTop: theme.sp.xl },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.md },
  chartBox: {
    height: 380,
    marginTop: theme.sp.lg,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
  },
  web: { flex: 1, backgroundColor: theme.bg },
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
  tCell: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm },
  cDate: { flex: 1 },
  cNum: { width: 64, textAlign: 'right' },
  cExit: { width: 60, textAlign: 'right', color: theme.muted2 },
});
