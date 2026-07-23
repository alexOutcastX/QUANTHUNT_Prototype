// Quant Lab — institutional-grade portfolio backtester (server engine v2).
//
// The heavy lifting happens server-side (backtest_engine.py): T+1-open
// execution, gap-aware stops, whole-share sizing, the Indian cost stack and
// the full analytics suite. This screen is the strategy console: configure
// universe / strategy / sizing / costs / risk, launch the job, watch live
// progress, then read the tear sheet — metric tiles, equity vs buy&hold,
// drawdown, monthly returns, per-symbol breakdown and the complete trade
// blotter with CSV / Excel / PDF export.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { BtConfig, BtResult, BtRule, BtStrategyMeta, BtTrade, api } from '../api';
import HtmlView from '../components/HtmlView';
import SymbolInput from '../components/SymbolInput';
import { LW_SCRIPT } from '../chartHtml';
import { exportCsvRows, exportExcelRows } from '../csv';
import { openPdfPreview } from '../pdf';
import { getPalette, theme } from '../theme';
import { Btn, Card, Dropdown, EmptyState, InfoButton, SectionTitle, Segmented, Sheet } from '../ui';
import { useResponsive } from '../responsive';

const CFG_KEY = 'taureye.bt.cfg.v2';
const SAVED_KEY = 'taureye.bt.saved.v2';
const MYSTRATS_KEY = 'taureye.bt.mystrats.v1';

const INDICES = ['NIFTY 50', 'NIFTY 100', 'NIFTY 200', 'NIFTY 500', 'NIFTY BANK', 'NIFTY IT',
  'NIFTY MIDCAP 100', 'NIFTY SMALLCAP 100', 'NIFTY AUTO', 'NIFTY PHARMA', 'NIFTY FMCG'];
const PERIODS = [
  { key: '1y', label: '1 year' }, { key: '2y', label: '2 years' },
  { key: '5y', label: '5 years' }, { key: '10y', label: '10 years' },
];

// Offline fallback so the console still renders if /backtest/strategies is
// briefly unreachable — keys/params mirror backtest_engine.STRATEGIES.
const FALLBACK_STRATS: BtStrategyMeta[] = [
  { key: 'ema_cross', label: 'EMA Crossover', params: { fast: 9, slow: 21 }, blurb: '' },
  { key: 'sma_cross', label: 'SMA Crossover', params: { fast: 20, slow: 50 }, blurb: '' },
  { key: 'macd', label: 'MACD Signal', params: { fast: 12, slow: 26, signal: 9 }, blurb: '' },
  { key: 'rsi_rev', label: 'RSI Mean Reversion', params: { period: 14, oversold: 30, overbought: 70 }, blurb: '' },
  { key: 'donchian', label: 'Donchian Breakout', params: { entry: 55, exit: 20 }, blurb: '' },
];

const RULE_INDS = [
  { key: 'close', label: 'Close' }, { key: 'volume', label: 'Volume' }, { key: 'rsi', label: 'RSI' },
  { key: 'ema', label: 'EMA' }, { key: 'sma', label: 'SMA' }, { key: 'macd_hist', label: 'MACD hist' },
  { key: 'atr', label: 'ATR' }, { key: 'high_n', label: 'N-day high' }, { key: 'low_n', label: 'N-day low' },
];
const RULE_OPS = [
  { key: 'gt', label: '>' }, { key: 'lt', label: '<' },
  { key: 'cross_above', label: 'crosses above' }, { key: 'cross_below', label: 'crosses below' },
];
const RULE_TARGETS = [
  { key: 'value', label: 'Value' }, { key: 'ema', label: 'EMA' }, { key: 'sma', label: 'SMA' },
  { key: 'close', label: 'Close' }, { key: 'high_n', label: 'N-day high' }, { key: 'low_n', label: 'N-day low' },
];

const money = (v?: number | null) =>
  v == null || !isFinite(v) ? '—' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const num = (v?: number | null, d = 2, suffix = '') =>
  v == null || !isFinite(v) ? '—' : v.toFixed(d) + suffix;

type SavedCfg = { name: string; cfg: BtConfig };

function NumIn({ label, value, onChange, width = 96 }: {
  label: string; value: number; onChange: (n: number) => void; width?: number;
}) {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => setTxt(String(value)), [value]);
  return (
    <View style={{ width }}>
      <Text style={styles.inLbl}>{label}</Text>
      <TextInput
        style={styles.in}
        value={txt}
        keyboardType="numeric"
        onChangeText={setTxt}
        onBlur={() => {
          const n = parseFloat(txt);
          if (isFinite(n)) onChange(n);
          else setTxt(String(value));
        }}
      />
    </View>
  );
}

// ── Equity + drawdown chart (self-hosted lightweight-charts) ────────────────
function equityChartHtml(res: BtResult): string {
  const pal = getPalette();
  const eq = JSON.stringify(res.equity_curve.map((p) => ({ time: p.t, value: p.eq })));
  const bm = JSON.stringify(res.benchmark_curve.map((p) => ({ time: p.t, value: p.eq })));
  const dd = JSON.stringify(res.stats.drawdown_curve.map((p) => ({ time: p.t, value: p.dd })));
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
${LW_SCRIPT}
<style>body{margin:0;background:${pal.bg};font-family:system-ui}
.lbl{color:${pal.muted};font-size:10px;padding:4px 8px 0;letter-spacing:.5px}
.legend{color:${pal.muted};font-size:10px;padding:0 8px}
.legend b{font-weight:600}
.err{color:${pal.muted};padding:16px;font-size:12px}</style></head><body>
<div class="lbl">EQUITY CURVE</div>
<div class="legend"><b style="color:#10b981">■</b> Strategy &nbsp; <b style="color:#64748b">■</b> Buy &amp; hold (equal-weight)</div>
<div id="eq" style="height:250px"></div>
<div class="lbl">DRAWDOWN %</div>
<div id="dd" style="height:110px"></div>
<script>
try{
  var opts={layout:{background:{color:'${pal.bg}'},textColor:'${pal.muted}'},
    grid:{vertLines:{color:'${pal.border}'},horzLines:{color:'${pal.border}'}},
    rightPriceScale:{borderColor:'${pal.border}'},timeScale:{borderColor:'${pal.border}'},
    handleScroll:false,handleScale:false};
  var c1=LightweightCharts.createChart(document.getElementById('eq'),opts);
  c1.addLineSeries({color:'#64748b',lineWidth:1,priceLineVisible:false}).setData(${bm});
  c1.addLineSeries({color:'#10b981',lineWidth:2,priceLineVisible:false}).setData(${eq});
  c1.timeScale().fitContent();
  var c2=LightweightCharts.createChart(document.getElementById('dd'),opts);
  c2.addAreaSeries({lineColor:'#f43f5e',topColor:'rgba(244,63,94,0.05)',bottomColor:'rgba(244,63,94,0.35)',lineWidth:1,priceLineVisible:false}).setData(${dd});
  c2.timeScale().fitContent();
}catch(e){document.body.innerHTML='<div class="err">Chart library unavailable — metrics and blotter below are unaffected.</div>'}
</script></body></html>`;
}

// ── PDF tear sheet ───────────────────────────────────────────────────────────
const esc = (v: unknown) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function tearSheetHtml(res: BtResult, stratLabel: string): string {
  const s = res.stats;
  const cell = (l: string, v: string) =>
    `<tr><td style="color:#64748b">${esc(l)}</td><td style="text-align:right"><b>${esc(v)}</b></td></tr>`;
  const trades = res.trades.slice(0, 200).map((t) =>
    `<tr><td>${t.id}</td><td>${esc(t.symbol)}</td><td style="text-align:right">${t.qty}</td>` +
    `<td>${t.entry_date}</td><td style="text-align:right">${t.entry_px}</td>` +
    `<td>${t.exit_date}</td><td style="text-align:right">${t.exit_px}</td>` +
    `<td>${esc(t.reason)}</td><td style="text-align:right;color:${t.net_pnl >= 0 ? '#0b7a53' : '#c92a2a'}">${t.net_pnl.toLocaleString('en-IN')}</td>` +
    `<td style="text-align:right">${t.ret_pct}%</td><td style="text-align:right">${t.hold_days}</td></tr>`).join('');
  const monthly = s.monthly_returns.map((r) =>
    `<tr><td><b>${r.year}</b></td>` + r.months.map((m) =>
      `<td style="text-align:right;color:${m == null ? '#999' : m >= 0 ? '#0b7a53' : '#c92a2a'}">${m == null ? '—' : m + '%'}</td>`).join('') +
    `<td style="text-align:right;font-weight:700">${r.total}%</td></tr>`).join('');
  return `<html><head><title>TaurEye — Backtest tear sheet</title></head><body>
<h1>Backtest tear sheet <span class="sub">${esc(stratLabel)} · ${esc(res.period)} · ${res.universe.length} symbols · ${esc(res.execution)}</span></h1>
<div class="big" style="color:${s.net_profit >= 0 ? '#0b7a53' : '#c92a2a'}">${s.total_return_pct}% <span class="sub">net ${money(s.net_profit)} · CAGR ${s.cagr_pct}%</span></div>
<h2>Performance</h2><table>
${cell('Final capital', money(s.final_capital))}${cell('CAGR', s.cagr_pct + '%')}
${cell('Sharpe (rf ' + s.rf_rate_pct + '%)', String(s.sharpe))}${cell('Sortino', String(s.sortino))}
${cell('Calmar', s.calmar == null ? '—' : String(s.calmar))}${cell('Volatility (ann.)', s.volatility_pct + '%')}
${cell('Max drawdown', s.max_drawdown_pct + '% over ' + s.max_drawdown_days + ' days')}
${cell('Exposure', s.exposure_pct + '%')}${cell('Turnover', s.turnover_x + '× / yr')}
${cell('Trades', String(s.trades))}${cell('Win rate', s.win_rate_pct + '%')}
${cell('Profit factor', s.profit_factor == null ? '∞' : String(s.profit_factor))}
${cell('Expectancy / trade', money(s.expectancy))}${cell('Avg win / avg loss', money(s.avg_win) + ' / ' + money(s.avg_loss))}
${cell('Avg holding', s.avg_hold_days + ' days')}${cell('Total charges', money(s.total_charges))}
</table>
<h2>Monthly returns</h2>
<table><tr><td></td>${['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'].map((m) => `<td style="text-align:right"><b>${m}</b></td>`).join('')}<td style="text-align:right"><b>YR</b></td></tr>${monthly}</table>
<h2>Trade blotter ${res.trades.length > 200 ? `(first 200 of ${res.trades.length})` : `(${res.trades.length} trades)`}</h2>
<table><tr><td><b>#</b></td><td><b>Symbol</b></td><td style="text-align:right"><b>Qty</b></td><td><b>Entry</b></td><td style="text-align:right"><b>₹</b></td><td><b>Exit</b></td><td style="text-align:right"><b>₹</b></td><td><b>Reason</b></td><td style="text-align:right"><b>Net ₹</b></td><td style="text-align:right"><b>%</b></td><td style="text-align:right"><b>Days</b></td></tr>${trades}</table>
<p style="color:#999;font-size:10px;margin-top:14px">Signals execute at the next bar's open; stops and targets are gap-aware resting orders. Charges: brokerage, STT, exchange, SEBI, GST, stamp duty + slippage. Historical simulation on public market data — past performance does not predict future results. Educational only — not investment advice.</p>
</body></html>`;
}

export default function BacktestScreen() {
  const { isDesktop } = useResponsive();
  const [metas, setMetas] = useState<BtStrategyMeta[]>(FALLBACK_STRATS);
  const [defaultCosts, setDefaultCosts] = useState<Record<string, number>>({});

  // ── Config state ──
  const [uniMode, setUniMode] = useState<'index' | 'symbols'>('index');
  const [index, setIndex] = useState('NIFTY 50');
  const [symList, setSymList] = useState<string[]>(['RELIANCE', 'TCS', 'INFY']);
  const [symQuery, setSymQuery] = useState('');
  const [period, setPeriod] = useState('2y');
  const [capital, setCapital] = useState(1000000);
  const [maxPos, setMaxPos] = useState(5);
  const [execution, setExecution] = useState<'next_open' | 'same_close'>('next_open');
  const [stratKey, setStratKey] = useState('ema_cross');
  const [params, setParams] = useState<Record<string, number>>({ fast: 9, slow: 21 });
  const [buyRules, setBuyRules] = useState<BtRule[]>([
    { ind: 'close', op: 'cross_above', target: 'sma', value: 50 },
  ]);
  const [sellRules, setSellRules] = useState<BtRule[]>([
    { ind: 'close', op: 'cross_below', target: 'sma', value: 50 },
  ]);
  const [filterRules, setFilterRules] = useState<BtRule[]>([]);
  const [modeBuy, setModeBuy] = useState<'all' | 'any'>('all');
  const [modeSell, setModeSell] = useState<'all' | 'any'>('all');
  const [baseKey, setBaseKey] = useState('');            // '' = no base bot
  const [baseParams, setBaseParams] = useState<Record<string, number>>({});
  const [stratName, setStratName] = useState('');
  const [myStrats, setMyStrats] = useState<{ name: string; def: BtConfig['strategy'] }[]>([]);
  const [sizeMode, setSizeMode] = useState<'equal' | 'fixed' | 'risk'>('equal');
  const [sizeVal, setSizeVal] = useState(1);
  const [slType, setSlType] = useState<'none' | 'pct' | 'atr'>('none');
  const [slVal, setSlVal] = useState(5);
  const [tpType, setTpType] = useState<'none' | 'pct' | 'rr'>('none');
  const [tpVal, setTpVal] = useState(10);
  const [trailPct, setTrailPct] = useState(0);
  const [maxHold, setMaxHold] = useState(0);
  const [costs, setCosts] = useState<Record<string, number> | null>(null); // null = server defaults
  const [showCosts, setShowCosts] = useState(false);

  // ── Run state ──
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<BtResult | null>(null);
  const [isPrevious, setIsPrevious] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Saved configs ──
  const [saved, setSaved] = useState<SavedCfg[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');

  const meta = metas.find((m) => m.key === stratKey);
  const stratLabel = stratKey === 'custom' ? (stratName || 'Custom strategy') : meta?.label || stratKey;

  // The full custom-strategy definition currently in the builder.
  const customDef = (): BtConfig['strategy'] => ({
    key: 'custom',
    ...(stratName.trim() ? { name: stratName.trim() } : {}),
    buy: buyRules,
    sell: sellRules,
    filters: filterRules,
    mode_buy: modeBuy,
    mode_sell: modeSell,
    ...(baseKey ? { base: { key: baseKey, params: baseParams } } : {}),
  });

  const loadCustomDef = (def: BtConfig['strategy']) => {
    setStratKey('custom');
    setStratName(def.name || '');
    setBuyRules(def.buy || []);
    setSellRules(def.sell || []);
    setFilterRules(def.filters || []);
    setModeBuy(def.mode_buy === 'any' ? 'any' : 'all');
    setModeSell(def.mode_sell === 'any' ? 'any' : 'all');
    setBaseKey(def.base?.key || '');
    setBaseParams(def.base?.params || {});
  };

  const saveStrategy = () => {
    const def = customDef();
    const name = (def.name || '').trim();
    if (!name) return;
    const next = [{ name, def }, ...myStrats.filter((s) => s.name !== name)].slice(0, 20);
    setMyStrats(next);
    AsyncStorage.setItem(MYSTRATS_KEY, JSON.stringify(next)).catch(() => {});
  };

  const deleteStrategy = (name: string) => {
    const next = myStrats.filter((s) => s.name !== name);
    setMyStrats(next);
    AsyncStorage.setItem(MYSTRATS_KEY, JSON.stringify(next)).catch(() => {});
  };

  // Add a symbol from the predictive search (dedup, cap at the engine's limit).
  const addSym = (sym: string) => {
    const s = sym.trim().toUpperCase().replace(/^[A-Z]+:/, '');
    if (!s) return;
    setSymList((l) => (l.includes(s) || l.length >= 100 ? l : [...l, s]));
    setSymQuery('');
  };

  const buildCfg = (): BtConfig => ({
    ...(uniMode === 'index'
      ? { index }
      : { symbols: symList }),
    period,
    capital,
    max_positions: maxPos,
    execution,
    strategy: stratKey === 'custom' ? customDef() : { key: stratKey, params },
    sizing: { mode: sizeMode, value: sizeVal },
    risk: { sl_type: slType, sl_val: slVal, tp_type: tpType, tp_val: tpVal,
      trail_pct: trailPct, max_hold_days: maxHold },
    ...(costs ? { costs } : {}),
  });

  const applyCfg = (cfg: BtConfig) => {
    if (cfg.index) { setUniMode('index'); setIndex(cfg.index); }
    if (cfg.symbols?.length) { setUniMode('symbols'); setSymList(cfg.symbols); }
    if (cfg.period) setPeriod(cfg.period);
    if (cfg.capital) setCapital(cfg.capital);
    if (cfg.max_positions) setMaxPos(cfg.max_positions);
    if (cfg.execution) setExecution(cfg.execution);
    if (cfg.strategy) {
      if (cfg.strategy.key === 'custom') {
        loadCustomDef(cfg.strategy);
      } else {
        setStratKey(cfg.strategy.key);
        if (cfg.strategy.params) setParams(cfg.strategy.params);
      }
    }
    if (cfg.sizing) { setSizeMode(cfg.sizing.mode); if (cfg.sizing.value != null) setSizeVal(cfg.sizing.value); }
    if (cfg.risk) {
      setSlType(cfg.risk.sl_type || 'none'); setSlVal(cfg.risk.sl_val ?? 5);
      setTpType(cfg.risk.tp_type || 'none'); setTpVal(cfg.risk.tp_val ?? 10);
      setTrailPct(cfg.risk.trail_pct ?? 0); setMaxHold(cfg.risk.max_hold_days ?? 0);
    }
    if (cfg.costs) setCosts(cfg.costs);
  };

  useEffect(() => {
    api.btStrategies()
      .then((r) => { setMetas(r.strategies); setDefaultCosts(r.default_costs); })
      .catch(() => {});
    AsyncStorage.getItem(CFG_KEY).then((raw) => {
      if (raw) { try { applyCfg(JSON.parse(raw)); } catch { /* corrupt saved config */ } }
    });
    AsyncStorage.getItem(SAVED_KEY).then((raw) => {
      if (raw) { try { setSaved(JSON.parse(raw)); } catch { /* ignore */ } }
    });
    AsyncStorage.getItem(MYSTRATS_KEY).then((raw) => {
      if (raw) { try { setMyStrats(JSON.parse(raw)); } catch { /* ignore */ } }
    });
    // Show the last completed run (survives restarts) until a fresh one lands.
    api.btLast().then((r) => {
      if (r?.result) { setResult(r.result); setIsPrevious(true); }
    }).catch(() => {});
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickStrategy = (k: string) => {
    if (k.startsWith('my:')) {
      const sv = myStrats.find((s) => s.name === k.slice(3));
      if (sv) loadCustomDef(sv.def);
      return;
    }
    if (k === 'custom') {
      setStratKey('custom');
      return;
    }
    setStratKey(k);
    const m = metas.find((x) => x.key === k);
    if (m) setParams({ ...m.params });
  };

  const run = async () => {
    if (running) return;
    const cfg = buildCfg();
    AsyncStorage.setItem(CFG_KEY, JSON.stringify(cfg)).catch(() => {});
    setError('');
    setRunning(true);
    setProgress('launching…');
    try {
      const { run_id } = await api.btRun(cfg);
      let misses = 0;
      const poll = async () => {
        try {
          const snap = await api.btStatus(run_id);
          misses = 0;
          if (snap.status === 'done' && snap.result) {
            setResult(snap.result);
            setIsPrevious(false);
            setRunning(false);
            return;
          }
          if (snap.status === 'error' || snap.status === 'unknown') {
            setError(snap.error || 'Backtest failed — retry shortly.');
            setRunning(false);
            return;
          }
          setProgress(snap.progress || 'running…');
        } catch {
          if (++misses > 8) { setError('Lost contact with the server — retry.'); setRunning(false); return; }
        }
        pollRef.current = setTimeout(poll, 1500);
      };
      poll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not launch the backtest');
      setRunning(false);
    }
  };

  const saveCurrent = async () => {
    const name = saveName.trim() || stratLabel;
    const next = [{ name, cfg: buildCfg() }, ...saved.filter((sv) => sv.name !== name)].slice(0, 12);
    setSaved(next);
    setSaveOpen(false);
    setSaveName('');
    AsyncStorage.setItem(SAVED_KEY, JSON.stringify(next)).catch(() => {});
  };

  // ── Blotter export ──
  const BLOTTER_HEADERS = ['#', 'Symbol', 'Qty', 'Entry date', 'Entry price', 'Exit date', 'Exit price',
    'Reason', 'Gross P&L', 'Charges', 'Net P&L', 'Return %', 'Days', 'R'];
  const blotterRows = (trades: BtTrade[]) => trades.map((t) => [
    String(t.id), t.symbol, String(t.qty), t.entry_date, String(t.entry_px), t.exit_date,
    String(t.exit_px), t.reason, String(t.gross_pnl), String(t.charges), String(t.net_pnl),
    String(t.ret_pct), String(t.hold_days), t.r_multiple == null ? '' : String(t.r_multiple),
  ]);
  const [exportOpen, setExportOpen] = useState(false);
  const doExport = (kind: 'csv' | 'excel' | 'pdf') => {
    if (!result) return;
    setExportOpen(false);
    if (kind === 'csv') exportCsvRows(BLOTTER_HEADERS, blotterRows(result.trades), 'backtest-trades');
    else if (kind === 'excel') exportExcelRows(BLOTTER_HEADERS, blotterRows(result.trades), 'backtest-trades');
    else openPdfPreview(tearSheetHtml(result, stratLabel), { docType: 'Backtest tear sheet', fileName: 'TaurEye-backtest' });
  };

  const chartDoc = useMemo(() => (result ? equityChartHtml(result) : ''), [result]);
  const s = result?.stats;

  const ruleRow = (r: BtRule, i: number, list: BtRule[], set: (x: BtRule[]) => void) => (
    <View key={i} style={styles.ruleRow}>
      <Dropdown value={r.ind} options={RULE_INDS} onChange={(k) => set(list.map((x, j) => (j === i ? { ...x, ind: k } : x)))} style={styles.ruleDd} />
      <NumIn label="PER" width={52} value={r.period ?? 14} onChange={(n) => set(list.map((x, j) => (j === i ? { ...x, period: n } : x)))} />
      <Dropdown value={r.op} options={RULE_OPS} onChange={(k) => set(list.map((x, j) => (j === i ? { ...x, op: k as BtRule['op'] } : x)))} style={styles.ruleDd} />
      <Dropdown value={r.target} options={RULE_TARGETS} onChange={(k) => set(list.map((x, j) => (j === i ? { ...x, target: k } : x)))} style={styles.ruleDd} />
      <NumIn label="VAL" width={64} value={r.value ?? 0} onChange={(n) => set(list.map((x, j) => (j === i ? { ...x, value: n } : x)))} />
      <TouchableOpacity onPress={() => set(list.filter((_x, j) => j !== i))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.ruleDel}>✕</Text>
      </TouchableOpacity>
    </View>
  );

  const tile = (label: string, value: string, color?: string) => (
    <View style={styles.tile} key={label}>
      <Text style={styles.tileLbl}>{label}</Text>
      <Text style={[styles.tileVal, color ? { color } : null]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
        {value}
      </Text>
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.body}>
      {/* ── 1 · Strategy ── */}
      <Card style={styles.cfgCard}>
        <View style={styles.secHead}>
          <SectionTitle>1 · Strategy</SectionTitle>
          <InfoButton
            title="Strategy"
            content={{ about: "Pick a systematic (bot) strategy and tune its parameters, or build your own entry/exit rules. Signals are computed on each bar's close and executed at the NEXT bar's open — no lookahead." }}
          />
        </View>
        <Dropdown
          value={stratKey === 'custom' && stratName && myStrats.some((s) => s.name === stratName) ? `my:${stratName}` : stratKey}
          options={[
            ...metas.map((m) => ({ key: m.key, label: m.label })),
            ...myStrats.map((s) => ({ key: `my:${s.name}`, label: `★ ${s.name}` })),
            { key: 'custom', label: '＋ Custom strategy builder' },
          ]}
          onChange={pickStrategy}
        />
        {stratKey !== 'custom' && meta?.blurb ? <Text style={styles.blurb}>{meta.blurb}</Text> : null}
        {stratKey !== 'custom' && meta ? (
          <View style={styles.paramRow}>
            {Object.keys(meta.params).map((k) => (
              <NumIn key={k} label={k.toUpperCase()} value={params[k] ?? meta.params[k]}
                onChange={(n) => setParams((p) => ({ ...p, [k]: n }))} />
            ))}
          </View>
        ) : null}
        {stratKey === 'custom' ? (
          <View>
            <Text style={styles.blurb}>
              Build your own system: an optional base bot supplies the trigger, your entry rules refine it
              (ALL/ANY), filters gate every entry (e.g. only above the 200-SMA), and exit rules or the base
              bot close the trade. Name it and Save to keep it in the strategy list.
            </Text>

            <Text style={styles.ruleGroup}>BASE STRATEGY (OPTIONAL)</Text>
            <Dropdown
              value={baseKey}
              options={[{ key: '', label: 'None — my rules only' }, ...metas.map((m) => ({ key: m.key, label: m.label }))]}
              onChange={(k) => {
                setBaseKey(k);
                const m = metas.find((x) => x.key === k);
                setBaseParams(m ? { ...m.params } : {});
              }}
            />
            {baseKey ? (
              <View style={styles.paramRow}>
                {Object.keys(metas.find((m) => m.key === baseKey)?.params || {}).map((k) => (
                  <NumIn key={k} label={k.toUpperCase()} value={baseParams[k] ?? 0}
                    onChange={(n) => setBaseParams((p) => ({ ...p, [k]: n }))} />
                ))}
              </View>
            ) : null}

            <View style={styles.ruleHead}>
              <Text style={styles.ruleGroup}>ENTRY RULES</Text>
              <Segmented
                items={[{ key: 'all', label: 'ALL' }, { key: 'any', label: 'ANY' }]}
                value={modeBuy}
                onChange={(k) => setModeBuy(k)}
              />
            </View>
            {buyRules.map((r, i) => ruleRow(r, i, buyRules, setBuyRules))}
            <TouchableOpacity onPress={() => setBuyRules([...buyRules, { ind: 'rsi', period: 14, op: 'lt', target: 'value', value: 30 }])}>
              <Text style={styles.ruleAdd}>+ Add entry rule</Text>
            </TouchableOpacity>

            <Text style={styles.ruleGroup}>FILTERS — EVERY ENTRY MUST ALSO SATISFY…</Text>
            {filterRules.map((r, i) => ruleRow(r, i, filterRules, setFilterRules))}
            <TouchableOpacity onPress={() => setFilterRules([...filterRules, { ind: 'close', op: 'gt', target: 'sma', value: 200 }])}>
              <Text style={styles.ruleAdd}>+ Add filter</Text>
            </TouchableOpacity>

            <View style={styles.ruleHead}>
              <Text style={styles.ruleGroup}>EXIT RULES</Text>
              <Segmented
                items={[{ key: 'all', label: 'ALL' }, { key: 'any', label: 'ANY' }]}
                value={modeSell}
                onChange={(k) => setModeSell(k)}
              />
            </View>
            {sellRules.map((r, i) => ruleRow(r, i, sellRules, setSellRules))}
            <TouchableOpacity onPress={() => setSellRules([...sellRules, { ind: 'rsi', period: 14, op: 'gt', target: 'value', value: 70 }])}>
              <Text style={styles.ruleAdd}>+ Add exit rule</Text>
            </TouchableOpacity>

            <Text style={styles.ruleGroup}>SAVE AS…</Text>
            <View style={styles.stratSaveRow}>
              <TextInput
                style={[styles.in, { flex: 1, minWidth: 140 }]}
                value={stratName}
                onChangeText={setStratName}
                placeholder="My breakout system…"
                placeholderTextColor={theme.muted}
              />
              <Btn label="Save strategy" kind="ghost" onPress={saveStrategy} disabled={!stratName.trim()} />
              {stratName.trim() && myStrats.some((s) => s.name === stratName.trim()) ? (
                <TouchableOpacity onPress={() => deleteStrategy(stratName.trim())}>
                  <Text style={[styles.ruleAdd, { color: theme.red }]}>Delete</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        ) : null}
      </Card>

      {/* ── 2 · Universe & capital ── */}
      <Card style={styles.cfgCard}>
        <View style={styles.secHead}>
          <SectionTitle>2 · Universe · capital · execution</SectionTitle>
          <InfoButton
            title="Universe & execution"
            content={{ about: "Backtest a whole index (constituents are fetched live) or your own symbol list. Capital is one shared pool; positions are whole shares. 'Next open' fills signals at the following bar's open — the honest default." }}
          />
        </View>
        <Segmented
          items={[{ key: 'index', label: 'Index' }, { key: 'symbols', label: 'My symbols' }]}
          value={uniMode}
          onChange={(k) => setUniMode(k)}
        />
        {uniMode === 'index' ? (
          <Dropdown value={index} options={INDICES.map((i) => ({ key: i, label: i }))} onChange={setIndex} style={{ marginTop: theme.sp.sm }} />
        ) : (
          <View style={{ marginTop: theme.sp.sm, zIndex: 30 }}>
            <SymbolInput
              value={symQuery}
              onChangeText={setSymQuery}
              onSelect={(sym) => { addSym(sym); }}
              onSubmit={() => { if (symQuery.trim()) addSym(symQuery); }}
              placeholder="Search any NSE/BSE stock to add…"
            />
            <View style={styles.chipWrap}>
              {symList.map((sym) => (
                <View key={sym} style={styles.symChip}>
                  <Text style={styles.symChipTxt}>{sym}</Text>
                  <TouchableOpacity
                    onPress={() => setSymList((l) => l.filter((x) => x !== sym))}
                    hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                  >
                    <Text style={styles.symChipX}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {!symList.length ? (
                <Text style={styles.note}>No symbols yet — search above to build your universe (up to 100).</Text>
              ) : null}
            </View>
          </View>
        )}
        <View style={styles.paramRow}>
          <Dropdown label="Period" value={period} options={PERIODS} onChange={setPeriod} style={styles.ddSm} />
          <NumIn label="CAPITAL ₹" width={110} value={capital} onChange={setCapital} />
          <NumIn label="MAX POSITIONS" width={110} value={maxPos} onChange={(n) => setMaxPos(Math.max(1, Math.round(n)))} />
          <Dropdown
            label="Execution"
            value={execution}
            options={[{ key: 'next_open', label: 'Next open (realistic)' }, { key: 'same_close', label: 'Same close' }]}
            onChange={(k) => setExecution(k)}
            style={styles.ddSm}
          />
        </View>
        <View style={styles.paramRow}>
          <Dropdown
            label="Position sizing"
            value={sizeMode}
            options={[
              { key: 'equal', label: 'Equal weight (capital ÷ slots)' },
              { key: 'fixed', label: 'Fixed ₹ per position' },
              { key: 'risk', label: '% risk per trade (needs a stop)' },
            ]}
            onChange={(k) => setSizeMode(k)}
            style={{ minWidth: 220 }}
          />
          {sizeMode !== 'equal' ? (
            <NumIn label={sizeMode === 'fixed' ? '₹ / POSITION' : 'RISK % / TRADE'} width={110}
              value={sizeVal} onChange={setSizeVal} />
          ) : null}
        </View>
      </Card>

      {/* ── 3 · Risk management ── */}
      <Card style={styles.cfgCard}>
        <View style={styles.secHead}>
          <SectionTitle>3 · Risk management</SectionTitle>
          <InfoButton
            title="Risk"
            content={{ about: "Stops, targets and trailing exits are resting orders checked every bar. When price gaps through a level at the open, the fill is the open — the real, worse price — never the level itself. Time stop closes a position after N trading days." }}
          />
        </View>
        <View style={styles.paramRow}>
          <Dropdown label="Stop loss" value={slType}
            options={[{ key: 'none', label: 'No stop' }, { key: 'pct', label: '% below entry' }, { key: 'atr', label: 'ATR multiple' }]}
            onChange={(k) => setSlType(k)} style={styles.ddSm} />
          {slType !== 'none' ? <NumIn label={slType === 'pct' ? 'SL %' : 'SL × ATR'} width={72} value={slVal} onChange={setSlVal} /> : null}
          <Dropdown label="Take profit" value={tpType}
            options={[{ key: 'none', label: 'No target' }, { key: 'pct', label: '% above entry' }, { key: 'rr', label: 'R:R multiple' }]}
            onChange={(k) => setTpType(k)} style={styles.ddSm} />
          {tpType !== 'none' ? <NumIn label={tpType === 'pct' ? 'TP %' : 'R : R'} width={72} value={tpVal} onChange={setTpVal} /> : null}
        </View>
        <View style={styles.paramRow}>
          <NumIn label="TRAIL % (0 = off)" width={110} value={trailPct} onChange={setTrailPct} />
          <NumIn label="MAX HOLD DAYS (0 = ∞)" width={140} value={maxHold} onChange={(n) => setMaxHold(Math.max(0, Math.round(n)))} />
        </View>
      </Card>

      {/* ── 4 · Costs ── */}
      <Card style={styles.cfgCard}>
        <TouchableOpacity style={styles.secHead} onPress={() => setShowCosts((v) => !v)} activeOpacity={0.7}>
          <SectionTitle>4 · Costs &amp; slippage {showCosts ? '▾' : '▸'}</SectionTitle>
          <Text style={styles.costState}>{costs ? 'custom' : 'Indian delivery defaults'}</Text>
        </TouchableOpacity>
        {showCosts ? (
          <View>
            <Text style={styles.blurb}>
              Charged per fill: brokerage (capped), STT, exchange txn, SEBI, GST, stamp duty — plus slippage
              against every fill. Defaults mirror an Indian discount broker on delivery.
            </Text>
            <View style={styles.paramRow}>
              {Object.entries(costs ?? defaultCosts).map(([k, v]) => (
                <NumIn key={k} label={k.replace(/_/g, ' ').toUpperCase()} width={110} value={v}
                  onChange={(n) => setCosts({ ...(costs ?? defaultCosts), [k]: n })} />
              ))}
            </View>
            {costs ? (
              <TouchableOpacity onPress={() => setCosts(null)}>
                <Text style={styles.ruleAdd}>Reset to defaults</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </Card>

      {/* ── Run row ── */}
      <View style={styles.runRow}>
        <Btn label={running ? '… Running' : '▶ Run backtest'} onPress={run} disabled={running} style={{ flex: 1 }} />
        <Btn label="Save" kind="ghost" onPress={() => setSaveOpen(true)} />
        {saved.length ? (
          <Dropdown
            value=""
            options={[{ key: '', label: 'Load…' }, ...saved.map((sv) => ({ key: sv.name, label: sv.name }))]}
            onChange={(name) => { const sv = saved.find((x) => x.name === name); if (sv) applyCfg(sv.cfg); }}
            style={styles.ddSm}
          />
        ) : null}
      </View>
      {running ? <Text style={styles.progress}>{progress}</Text> : null}
      {error ? <EmptyState icon="⚠" title="Backtest failed" hint={error} /> : null}

      {saveOpen ? (
        <Sheet onClose={() => setSaveOpen(false)}>
          <SectionTitle>Save this configuration</SectionTitle>
          <TextInput
            style={[styles.in, { width: '100%', marginVertical: theme.sp.md }]}
            value={saveName}
            onChangeText={setSaveName}
            placeholder={stratLabel}
            placeholderTextColor={theme.muted}
          />
          <Btn label="Save" onPress={saveCurrent} />
        </Sheet>
      ) : null}

      {/* ── Results ── */}
      {result && s ? (
        <View>
          <SectionTitle>
            {isPrevious ? 'Previous run · ' : ''}
            {result.universe.length} symbols · {result.period} · {result.execution === 'next_open' ? 'next-open fills' : 'same-close fills'}
            {result.skipped.length ? ` · ${result.skipped.length} skipped (no data)` : ''}
          </SectionTitle>

          <View style={styles.verdict}>
            <Text style={[styles.verdictBig, { color: s.net_profit >= 0 ? theme.green : theme.red }]}>
              {num(s.total_return_pct, 1, '%')}
            </Text>
            <View>
              <Text style={styles.verdictSub}>net {money(s.net_profit)} · CAGR {num(s.cagr_pct, 1, '%')}</Text>
              <Text style={styles.verdictSub2}>final {money(s.final_capital)} · charges {money(s.total_charges)}</Text>
            </View>
          </View>

          <View style={styles.tiles}>
            {tile('SHARPE', num(s.sharpe))}
            {tile('SORTINO', num(s.sortino))}
            {tile('CALMAR', s.calmar == null ? '—' : num(s.calmar))}
            {tile('MAX DD', num(s.max_drawdown_pct, 1, '%'), theme.red)}
            {tile('DD LENGTH', s.max_drawdown_days + 'd')}
            {tile('VOLATILITY', num(s.volatility_pct, 1, '%'))}
            {tile('WIN RATE', num(s.win_rate_pct, 1, '%'))}
            {tile('PROFIT FACTOR', s.profit_factor == null ? '∞' : num(s.profit_factor))}
            {tile('EXPECTANCY', money(s.expectancy), s.expectancy >= 0 ? theme.green : theme.red)}
            {tile('PAYOFF', s.payoff == null ? '—' : num(s.payoff))}
            {tile('TRADES', String(s.trades))}
            {tile('AVG HOLD', num(s.avg_hold_days, 1) + 'd')}
            {tile('EXPOSURE', num(s.exposure_pct, 0, '%'))}
            {tile('TURNOVER', num(s.turnover_x, 1, '×/yr'))}
          </View>

          <View style={[styles.chartBox, { height: 470 }]}>
            <HtmlView html={chartDoc} />
          </View>

          {/* Monthly returns */}
          <SectionTitle>Monthly returns</SectionTitle>
          <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: '100%' }}>
            <View>
              <View style={styles.mRow}>
                <Text style={[styles.mCellHead, { width: 46 }]}> </Text>
                {['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC', 'YEAR'].map((m) => (
                  <Text key={m} style={styles.mCellHead}>{m}</Text>
                ))}
              </View>
              {s.monthly_returns.map((r) => (
                <View key={r.year} style={styles.mRow}>
                  <Text style={[styles.mCellHead, { width: 46 }]}>{r.year}</Text>
                  {r.months.map((m, i) => (
                    <Text key={i} style={[styles.mCell, { color: m == null ? theme.muted : m >= 0 ? theme.green : theme.red }]}>
                      {m == null ? '—' : m.toFixed(1)}
                    </Text>
                  ))}
                  <Text style={[styles.mCell, { fontWeight: '700', color: r.total >= 0 ? theme.green : theme.red }]}>
                    {r.total.toFixed(1)}
                  </Text>
                </View>
              ))}
            </View>
          </ScrollView>

          {/* Per-symbol breakdown */}
          <SectionTitle>Per-symbol P&amp;L</SectionTitle>
          <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: '100%' }}>
            <View style={{ minWidth: 430 }}>
              <View style={styles.mRow}>
                {['SYMBOL', 'TRADES', 'WINS', 'NET ₹', 'CHARGES ₹'].map((h, i) => (
                  <Text key={h} style={[styles.mCellHead, { width: i === 0 ? 110 : 80, textAlign: i === 0 ? 'left' : 'right' }]}>{h}</Text>
                ))}
              </View>
              {s.per_symbol.slice(0, 40).map((r) => (
                <View key={r.symbol} style={styles.mRow}>
                  <Text style={[styles.mCell, { width: 110, textAlign: 'left', fontWeight: '700', color: theme.text }]}>{r.symbol}</Text>
                  <Text style={[styles.mCell, { width: 80 }]}>{r.trades}</Text>
                  <Text style={[styles.mCell, { width: 80 }]}>{r.wins}</Text>
                  <Text style={[styles.mCell, { width: 80, color: r.net_pnl >= 0 ? theme.green : theme.red }]}>
                    {r.net_pnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </Text>
                  <Text style={[styles.mCell, { width: 80 }]}>{r.charges.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</Text>
                </View>
              ))}
            </View>
          </ScrollView>

          {/* Trade blotter */}
          <View style={styles.blotterHead}>
            <SectionTitle>Trade blotter · {result.trades.length} trades</SectionTitle>
            <View>
              <TouchableOpacity style={styles.exportBtn} onPress={() => setExportOpen((v) => !v)} activeOpacity={0.75}>
                <Text style={styles.exportTxt}>Export ▾</Text>
              </TouchableOpacity>
              {exportOpen ? (
                <View style={styles.exportMenu}>
                  {(['csv', 'excel', 'pdf'] as const).map((k) => (
                    <TouchableOpacity key={k} style={styles.exportItem} onPress={() => doExport(k)} activeOpacity={0.7}>
                      <Text style={styles.exportItemTxt}>{k === 'pdf' ? 'PDF tear sheet' : k.toUpperCase()}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
            </View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: '100%' }}>
            <View style={{ minWidth: 940 }}>
              <View style={styles.mRow}>
                {[['#', 34], ['SYMBOL', 96], ['QTY', 60], ['ENTRY', 88], ['ENTRY ₹', 76], ['EXIT', 88], ['EXIT ₹', 76],
                  ['REASON', 86], ['NET ₹', 84], ['RET %', 64], ['DAYS', 48], ['R', 44]].map(([h, w]) => (
                    <Text key={String(h)} style={[styles.mCellHead, { width: Number(w), textAlign: h === 'SYMBOL' || h === 'ENTRY' || h === 'EXIT' || h === 'REASON' ? 'left' : 'right' }]}>
                      {h}
                    </Text>
                  ))}
              </View>
              {result.trades.slice(0, isDesktop ? 400 : 150).map((t) => (
                <View key={t.id} style={styles.mRow}>
                  <Text style={[styles.mCell, { width: 34 }]}>{t.id}</Text>
                  <Text style={[styles.mCell, { width: 96, textAlign: 'left', fontWeight: '700', color: theme.text }]}>{t.symbol}</Text>
                  <Text style={[styles.mCell, { width: 60 }]}>{t.qty}</Text>
                  <Text style={[styles.mCell, { width: 88, textAlign: 'left' }]}>{t.entry_date}</Text>
                  <Text style={[styles.mCell, { width: 76 }]}>{t.entry_px}</Text>
                  <Text style={[styles.mCell, { width: 88, textAlign: 'left' }]}>{t.exit_date}</Text>
                  <Text style={[styles.mCell, { width: 76 }]}>{t.exit_px}</Text>
                  <Text style={[styles.mCell, { width: 86, textAlign: 'left' }]}>{t.reason}</Text>
                  <Text style={[styles.mCell, { width: 84, color: t.net_pnl >= 0 ? theme.green : theme.red }]}>
                    {t.net_pnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </Text>
                  <Text style={[styles.mCell, { width: 64, color: t.ret_pct >= 0 ? theme.green : theme.red }]}>{t.ret_pct}</Text>
                  <Text style={[styles.mCell, { width: 48 }]}>{t.hold_days}</Text>
                  <Text style={[styles.mCell, { width: 44 }]}>{t.r_multiple == null ? '—' : t.r_multiple}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
          {result.trades.length > (isDesktop ? 400 : 150) ? (
            <Text style={styles.note}>Showing the first {isDesktop ? 400 : 150} trades — export CSV/Excel for the full log.</Text>
          ) : null}
        </View>
      ) : null}

      {!result && !running && !error ? (
        <EmptyState
          icon="◇"
          title="No backtest yet"
          hint="Configure the strategy, universe and risk above, then Run. Signals fill at the next bar's open, stops are gap-aware, and every trade is charged the full Indian cost stack."
        />
      ) : null}

      <Text style={styles.method}>
        Historical simulation on public market data (daily bars). Signals execute at the next bar's open by
        default; stop/target/trailing exits are resting orders — a gap through the level fills at the open.
        Charges per fill: brokerage, STT, exchange transaction, SEBI, GST, stamp duty, plus slippage. Sharpe
        and Sortino use a {s ? s.rf_rate_pct : 6}% risk-free rate. Past performance does not predict future
        results. Educational only — not investment advice.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: theme.sp.md, paddingBottom: 90 },
  cfgCard: { marginBottom: theme.sp.md },
  secHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' },
  blurb: { color: theme.muted, fontSize: theme.fs.xs + 1, marginTop: 4, marginBottom: 2 },
  paramRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.md, marginTop: theme.sp.sm, alignItems: 'flex-end' },
  inLbl: { color: theme.muted, fontSize: 9, fontFamily: theme.mono, letterSpacing: 0.5, marginBottom: 3 },
  in: {
    backgroundColor: theme.surface2, color: theme.text, borderRadius: theme.radius.sm,
    borderWidth: 1, borderColor: theme.border, paddingHorizontal: 10, paddingVertical: 7,
    fontFamily: theme.mono, fontSize: theme.fs.sm,
  },
  ddSm: { minWidth: 150 },
  ruleGroup: { color: theme.muted, fontSize: 10, fontFamily: theme.mono, letterSpacing: 0.5, marginTop: theme.sp.md, marginBottom: 4 },
  ruleHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: theme.sp.sm },
  stratSaveRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, flexWrap: 'wrap' },
  ruleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, alignItems: 'flex-end', marginBottom: theme.sp.sm },
  ruleDd: { minWidth: 108, flexShrink: 1 },
  ruleDel: { color: theme.red, fontSize: theme.fs.md, paddingBottom: 8 },
  ruleAdd: { color: theme.brand, fontSize: theme.fs.sm, marginTop: 2, marginBottom: 4 },
  costState: { color: theme.muted2, fontSize: theme.fs.xs, fontFamily: theme.mono },
  runRow: { flexDirection: 'row', gap: theme.sp.sm, alignItems: 'center', marginBottom: theme.sp.sm },
  progress: { color: theme.muted, fontSize: theme.fs.sm, fontFamily: theme.mono, marginBottom: theme.sp.md },
  verdict: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.lg, marginVertical: theme.sp.sm, flexWrap: 'wrap' },
  verdictBig: { fontSize: 40, fontWeight: '800', fontFamily: theme.mono },
  verdictSub: { color: theme.text, fontSize: theme.fs.md, fontWeight: '600' },
  verdictSub2: { color: theme.muted, fontSize: theme.fs.sm },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginBottom: theme.sp.md },
  tile: {
    backgroundColor: theme.surface2, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.border,
    paddingVertical: 8, paddingHorizontal: 10, minWidth: 92, flexGrow: 1,
  },
  tileLbl: { color: theme.muted, fontSize: 9, fontFamily: theme.mono, letterSpacing: 0.5 },
  tileVal: { color: theme.text, fontSize: theme.fs.md + 1, fontWeight: '700', fontFamily: theme.mono, marginTop: 2 },
  chartBox: { borderRadius: theme.radius.md, overflow: 'hidden', borderWidth: 1, borderColor: theme.border, marginBottom: theme.sp.md },
  mRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, paddingVertical: 6 },
  mCellHead: { width: 52, color: theme.muted, fontSize: 9, fontFamily: theme.mono, letterSpacing: 0.4, textAlign: 'right' },
  mCell: { width: 52, color: theme.muted2, fontSize: theme.fs.xs + 1, fontFamily: theme.mono, textAlign: 'right' },
  blotterHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 40, marginTop: theme.sp.md },
  exportBtn: {
    borderWidth: 1, borderColor: theme.border, borderRadius: theme.radius.sm,
    paddingHorizontal: 12, paddingVertical: 6, backgroundColor: theme.surface2,
  },
  exportTxt: { color: theme.text, fontSize: theme.fs.sm, fontFamily: theme.mono },
  exportMenu: {
    position: 'absolute', top: 34, right: 0, backgroundColor: theme.surface, borderWidth: 1,
    borderColor: theme.border, borderRadius: theme.radius.sm, zIndex: 50, elevation: 8, minWidth: 150,
  },
  exportItem: { paddingHorizontal: 14, paddingVertical: 10 },
  exportItemTxt: { color: theme.text, fontSize: theme.fs.sm },
  note: { color: theme.muted, fontSize: theme.fs.xs + 1, marginTop: 6 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginTop: theme.sp.sm },
  symChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.surface2,
    borderWidth: 1, borderColor: theme.border, borderRadius: theme.radius.sm,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  symChipTxt: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm, fontWeight: '700' },
  symChipX: { color: theme.muted, fontSize: theme.fs.sm },
  method: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 17, marginTop: theme.sp.lg },
});
