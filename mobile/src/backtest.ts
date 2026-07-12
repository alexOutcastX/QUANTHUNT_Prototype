// Strategy backtest engine — ported 1:1 from the web app (StockScreenPro.html).
// Indicators, 7 built-in strategies, and the trade simulator (SL / TP / trailing
// stop, brokerage) all match the web behaviour so results are identical.
import { Candle } from './api';

type Arr = (number | null)[];

// ── Indicators ───────────────────────────────────────────────────────────────
export function ema(arr: Arr, period: number): Arr {
  const k = 2 / (period + 1);
  const out: Arr = new Array(arr.length).fill(null);
  let val: number | null = null;
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i];
    if (x == null) continue;
    val = val == null ? x : x * k + val * (1 - k);
    out[i] = val;
  }
  return out;
}

export function sma(arr: Arr, period: number): Arr {
  const out: Arr = new Array(arr.length).fill(null);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i];
    if (x == null) {
      sum = 0;
      count = 0;
      continue;
    }
    sum += x;
    count++;
    if (count > period) {
      sum -= arr[i - period] as number;
      count = period;
    }
    if (count === period) out[i] = sum / period;
  }
  return out;
}

export function rsi(closes: number[], period: number): Arr {
  const out: Arr = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d;
    else losses -= d;
  }
  let avgG = gains / period;
  let avgL = losses / period;
  out[period] = 100 - 100 / (1 + (avgL ? avgG / avgL : 1e9));
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = 100 - 100 / (1 + (avgL ? avgG / avgL : 1e9));
  }
  return out;
}

export function boll(closes: number[], period: number, mult: number) {
  const mid: Arr = new Array(closes.length).fill(null);
  const upper: Arr = new Array(closes.length).fill(null);
  const lower: Arr = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const sl = closes.slice(i - period + 1, i + 1);
    const sma = sl.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(sl.reduce((a, b) => a + (b - sma) ** 2, 0) / period);
    mid[i] = sma;
    upper[i] = sma + mult * std;
    lower[i] = sma - mult * std;
  }
  return { mid, upper, lower };
}

export function stoch(highs: number[], lows: number[], closes: number[], kPer: number, dPer: number, smooth: number) {
  const n = closes.length;
  const rawK: Arr = new Array(n).fill(null);
  for (let i = kPer - 1; i < n; i++) {
    const hh = Math.max(...highs.slice(i - kPer + 1, i + 1));
    const ll = Math.min(...lows.slice(i - kPer + 1, i + 1));
    rawK[i] = hh !== ll ? ((closes[i] - ll) / (hh - ll)) * 100 : 50;
  }
  const k: Arr = new Array(n).fill(null);
  for (let i = kPer + smooth - 2; i < n; i++) {
    const sl = rawK.slice(i - smooth + 1, i + 1).filter((v) => v !== null) as number[];
    if (sl.length === smooth) k[i] = sl.reduce((a, b) => a + b, 0) / smooth;
  }
  const d: Arr = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const sl = k.slice(Math.max(0, i - dPer + 1), i + 1).filter((v) => v !== null) as number[];
    if (sl.length === dPer) d[i] = sl.reduce((a, b) => a + b, 0) / dPer;
  }
  return { k, d };
}

export function adx(highs: number[], lows: number[], closes: number[], period: number) {
  const n = closes.length;
  const plusDM = new Array(n).fill(0);
  const minusDM = new Array(n).fill(0);
  const tr = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const uMove = highs[i] - highs[i - 1];
    const dMove = lows[i - 1] - lows[i];
    plusDM[i] = uMove > dMove && uMove > 0 ? uMove : 0;
    minusDM[i] = dMove > uMove && dMove > 0 ? dMove : 0;
    tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }
  const sTR: Arr = new Array(n).fill(null);
  const sPDM: Arr = new Array(n).fill(null);
  const sMDM: Arr = new Array(n).fill(null);
  if (n > period) {
    sTR[period] = tr.slice(1, period + 1).reduce((a, b) => a + b, 0);
    sPDM[period] = plusDM.slice(1, period + 1).reduce((a, b) => a + b, 0);
    sMDM[period] = minusDM.slice(1, period + 1).reduce((a, b) => a + b, 0);
  }
  for (let i = period + 1; i < n; i++) {
    sTR[i] = (sTR[i - 1] as number) - (sTR[i - 1] as number) / period + tr[i];
    sPDM[i] = (sPDM[i - 1] as number) - (sPDM[i - 1] as number) / period + plusDM[i];
    sMDM[i] = (sMDM[i - 1] as number) - (sMDM[i - 1] as number) / period + minusDM[i];
  }
  const plusDI: Arr = new Array(n).fill(null);
  const minusDI: Arr = new Array(n).fill(null);
  const dx: Arr = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    if (!sTR[i]) continue;
    plusDI[i] = (100 * (sPDM[i] as number)) / (sTR[i] as number);
    minusDI[i] = (100 * (sMDM[i] as number)) / (sTR[i] as number);
    const sum = (plusDI[i] as number) + (minusDI[i] as number);
    dx[i] = sum ? (100 * Math.abs((plusDI[i] as number) - (minusDI[i] as number))) / sum : 0;
  }
  const adxArr: Arr = new Array(n).fill(null);
  let adxVal: number | null = null;
  for (let i = period * 2; i < n; i++) {
    if (dx[i] === null) continue;
    adxVal = adxVal === null ? (dx[i] as number) : (adxVal * (period - 1) + (dx[i] as number)) / period;
    adxArr[i] = adxVal;
  }
  return { adx: adxArr, plusDI, minusDI };
}

export function calcATR(candles: Candle[], period: number): number[] {
  const atr = new Array(candles.length).fill(0);
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    const h = candles[i].h ?? 0;
    const l = candles[i].l ?? 0;
    const tr =
      i === 0
        ? h - l
        : Math.max(h - l, Math.abs(h - (candles[i - 1].c ?? 0)), Math.abs(l - (candles[i - 1].c ?? 0)));
    if (i < period) {
      sum += tr;
      atr[i] = sum / (i + 1);
    } else if (i === period) {
      sum += tr;
      atr[i] = sum / (period + 1);
    } else {
      atr[i] = (atr[i - 1] * (period - 1) + tr) / period;
    }
  }
  return atr;
}

// ── Strategy metadata ────────────────────────────────────────────────────────
export type ParamDef = { label: string; default: number };
export type StrategyDef = { key: string; label: string; params: ParamDef[] };

export const STRATEGIES: StrategyDef[] = [
  { key: 'ema_cross', label: 'EMA Crossover', params: [{ label: 'Fast EMA', default: 9 }, { label: 'Slow EMA', default: 21 }] },
  { key: 'rsi', label: 'RSI Reversal', params: [{ label: 'RSI Period', default: 14 }, { label: 'Oversold', default: 30 }, { label: 'Overbought', default: 70 }] },
  { key: 'macd', label: 'MACD Signal', params: [{ label: 'Fast', default: 12 }, { label: 'Slow', default: 26 }, { label: 'Signal', default: 9 }] },
  { key: 'bb', label: 'Bollinger Bands', params: [{ label: 'Period', default: 20 }, { label: 'Std Dev', default: 2 }] },
  { key: 'price_ema', label: 'Price vs EMA', params: [{ label: 'EMA Period', default: 20 }] },
  { key: 'stoch', label: 'Stochastic', params: [{ label: 'K Period', default: 14 }, { label: 'D Period', default: 3 }, { label: 'Smooth', default: 3 }] },
  { key: 'adx_di', label: 'ADX + DI', params: [{ label: 'Period', default: 14 }, { label: 'Min ADX', default: 25 }] },
];

// Returns per-bar signal: 1 = buy, -1 = sell, 0 = none.
export function runStrategy(candles: Candle[], strat: string, params: number[]): number[] {
  const n = candles.length;
  const closes = candles.map((x) => x.c ?? 0);
  const highs = candles.map((x) => x.h ?? 0);
  const lows = candles.map((x) => x.l ?? 0);
  const signals = new Array(n).fill(0);

  if (strat === 'ema_cross') {
    const fast = ema(closes, params[0]);
    const slow = ema(closes, params[1]);
    for (let i = 1; i < n; i++) {
      if (fast[i - 1] != null && slow[i - 1] != null) {
        if ((fast[i - 1] as number) < (slow[i - 1] as number) && (fast[i] as number) > (slow[i] as number)) signals[i] = 1;
        else if ((fast[i - 1] as number) > (slow[i - 1] as number) && (fast[i] as number) < (slow[i] as number)) signals[i] = -1;
      }
    }
  } else if (strat === 'rsi') {
    const r = rsi(closes, params[0]);
    const os = params[1];
    const ob = params[2];
    for (let i = 1; i < n; i++) {
      if (r[i - 1] != null) {
        if ((r[i - 1] as number) >= os && (r[i] as number) < os) signals[i] = 1;
        if ((r[i - 1] as number) <= ob && (r[i] as number) > ob) signals[i] = -1;
      }
    }
  } else if (strat === 'macd') {
    const fast = ema(closes, params[0]);
    const slow = ema(closes, params[1]);
    const ml: Arr = closes.map((_, i) => (fast[i] != null && slow[i] != null ? (fast[i] as number) - (slow[i] as number) : null));
    const sig = ema(ml, params[2]);
    for (let i = 1; i < n; i++) {
      if (ml[i - 1] != null && sig[i - 1] != null) {
        if ((ml[i - 1] as number) < (sig[i - 1] as number) && (ml[i] as number) > (sig[i] as number)) signals[i] = 1;
        if ((ml[i - 1] as number) > (sig[i - 1] as number) && (ml[i] as number) < (sig[i] as number)) signals[i] = -1;
      }
    }
  } else if (strat === 'bb') {
    const { upper, lower } = boll(closes, params[0], params[1]);
    for (let i = 1; i < n; i++) {
      if (lower[i] != null) {
        if (closes[i - 1] >= (lower[i - 1] as number) && closes[i] < (lower[i] as number)) signals[i] = 1;
        if (closes[i - 1] <= (upper[i - 1] as number) && closes[i] > (upper[i] as number)) signals[i] = -1;
      }
    }
  } else if (strat === 'price_ema') {
    const e = ema(closes, params[0]);
    for (let i = 1; i < n; i++) {
      if (e[i - 1] == null) continue;
      if (closes[i - 1] < (e[i - 1] as number) && closes[i] >= (e[i] as number)) signals[i] = 1;
      if (closes[i - 1] > (e[i - 1] as number) && closes[i] <= (e[i] as number)) signals[i] = -1;
    }
  } else if (strat === 'stoch') {
    const { k, d } = stoch(highs, lows, closes, params[0], params[1], params[2]);
    for (let i = 1; i < n; i++) {
      if (k[i - 1] == null || d[i - 1] == null) continue;
      if ((k[i - 1] as number) < (d[i - 1] as number) && (k[i] as number) >= (d[i] as number) && (k[i] as number) < 30) signals[i] = 1;
      if ((k[i - 1] as number) > (d[i - 1] as number) && (k[i] as number) <= (d[i] as number) && (k[i] as number) > 70) signals[i] = -1;
    }
  } else if (strat === 'adx_di') {
    const { adx: adxA, plusDI, minusDI } = adx(highs, lows, closes, params[0]);
    const minAdx = params[1];
    for (let i = 1; i < n; i++) {
      if (plusDI[i - 1] == null || adxA[i] == null) continue;
      if ((plusDI[i - 1] as number) < (minusDI[i - 1] as number) && (plusDI[i] as number) >= (minusDI[i] as number) && (adxA[i] as number) >= minAdx) signals[i] = 1;
      if ((minusDI[i - 1] as number) < (plusDI[i - 1] as number) && (minusDI[i] as number) >= (plusDI[i] as number) && (adxA[i] as number) >= minAdx) signals[i] = -1;
    }
  }
  return signals;
}

// ── Custom (user-defined) strategy ───────────────────────────────────────────
export const CUSTOM_KEY = 'custom';

export type CustomRule = {
  ind: 'close' | 'rsi' | 'ema' | 'sma' | 'macd_hist' | 'volume';
  period?: number; // rsi/ema/sma period (default 14/20/20)
  op: 'gt' | 'lt' | 'cross_above' | 'cross_below';
  target: 'value' | 'ema' | 'sma' | 'close';
  value?: number; // constant when target='value', else MA period
};
// AND semantics within each list: all buy rules must hold to emit 1, all sell
// rules to emit -1 (buy wins if both fire on the same bar).
export type CustomStrategy = { buy: CustomRule[]; sell: CustomRule[] };

export function runCustomStrategy(candles: Candle[], cs: CustomStrategy): number[] {
  const n = candles.length;
  const closes = candles.map((x) => x.c ?? 0);
  const closeArr: Arr = closes;

  const seriesFor = (ind: CustomRule['ind'], period?: number): Arr => {
    if (ind === 'close') return closeArr;
    if (ind === 'rsi') return rsi(closes, period || 14);
    if (ind === 'ema') return ema(closeArr, period || 20);
    if (ind === 'sma') return sma(closeArr, period || 20);
    if (ind === 'macd_hist') {
      const fast = ema(closeArr, 12);
      const slow = ema(closeArr, 26);
      const ml: Arr = closes.map((_, i) =>
        fast[i] != null && slow[i] != null ? (fast[i] as number) - (slow[i] as number) : null,
      );
      const sig = ema(ml, 9);
      return ml.map((v, i) => (v != null && sig[i] != null ? v - (sig[i] as number) : null));
    }
    return candles.map((x) => x.v ?? 0); // volume
  };

  const targetFor = (rule: CustomRule): Arr => {
    if (rule.target === 'value') return new Array(n).fill(rule.value ?? 0);
    if (rule.target === 'ema') return ema(closeArr, rule.value || 20);
    if (rule.target === 'sma') return sma(closeArr, rule.value || 20);
    return closeArr; // close
  };

  const compile = (rules: CustomRule[]) =>
    rules.map((r) => ({ op: r.op, left: seriesFor(r.ind, r.period), right: targetFor(r) }));

  const ruleTrue = (rule: { op: CustomRule['op']; left: Arr; right: Arr }, i: number): boolean => {
    const l = rule.left[i];
    const r = rule.right[i];
    if (l == null || r == null) return false;
    if (rule.op === 'gt') return l > r;
    if (rule.op === 'lt') return l < r;
    if (i === 0) return false;
    const lp = rule.left[i - 1];
    const rp = rule.right[i - 1];
    if (lp == null || rp == null) return false;
    if (rule.op === 'cross_above') return lp <= rp && l > r;
    return lp >= rp && l < r; // cross_below
  };

  const buy = compile(cs.buy);
  const sell = compile(cs.sell);
  const signals = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (buy.length && buy.every((r) => ruleTrue(r, i))) signals[i] = 1;
    else if (sell.length && sell.every((r) => ruleTrue(r, i))) signals[i] = -1;
  }
  return signals;
}

// ── Trade simulator ──────────────────────────────────────────────────────────
export type Risk = {
  capital: number;
  slType: 'none' | 'pct' | 'atr';
  slVal: number;
  tpType: 'none' | 'pct' | 'rr';
  tpVal: number;
  trailOn: boolean;
  trailPct: number;
};

export type Trade = {
  buyT: number;
  sellT: number;
  buyP: number;
  sellP: number;
  ret: number;
  pnl: number;
  exit: string;
};
export type Marker = { time: number; kind: 'buy' | 'sell'; win?: boolean };
export type BacktestResult = {
  trades: Trade[];
  equityCurve: { t: number; eq: number }[];
  markers: Marker[];
  stats: {
    totalRet: number;
    finalCapital: number;
    winRate: number;
    trades: number;
    wins: number;
    losses: number;
    maxDD: number;
    profitFactor: number | null; // null = infinite
    avgRet: number;
  };
};

const BROK = 0.001;

export function runBacktest(
  candles: Candle[],
  strat: string,
  params: number[],
  risk: Risk,
  custom?: CustomStrategy,
): BacktestResult {
  const raw =
    strat === CUSTOM_KEY && custom ? runCustomStrategy(candles, custom) : runStrategy(candles, strat, params);
  const entrySigs = raw.map((s) => (s === 1 ? 1 : 0));
  const exitSigs = raw.map((s) => (s === -1 ? 1 : 0));
  const atrArr = calcATR(candles, 14);
  const CAPITAL = Math.max(1000, risk.capital || 100000);

  const getSLpct = (i: number, entryP: number) => {
    if (risk.slType === 'none') return 0;
    if (risk.slType === 'pct') return risk.slVal;
    if (risk.slType === 'atr') return (atrArr[i] / entryP) * 100 * risk.slVal;
    return 0;
  };
  const getTPpct = (slPct: number) => {
    if (risk.tpType === 'none') return 0;
    if (risk.tpType === 'pct') return risk.tpVal;
    if (risk.tpType === 'rr') return slPct * risk.tpVal;
    return 0;
  };

  let equity = CAPITAL;
  let inPos = false;
  let buyPrice = 0;
  let buyT = 0;
  let trailPeak = 0;
  let activeSL = 0;
  let activeTP = 0;
  const trades: Trade[] = [];
  const markers: Marker[] = [];
  const equityCurve: { t: number; eq: number }[] = [{ t: candles[0].t, eq: CAPITAL }];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const price = c.c ?? 0;
    const lo = c.l ?? price;
    const hi = c.h ?? price;

    if (!inPos && entrySigs[i] === 1) {
      buyPrice = price * (1 + BROK);
      buyT = c.t;
      activeSL = getSLpct(i, buyPrice);
      activeTP = getTPpct(activeSL);
      trailPeak = buyPrice;
      inPos = true;
      markers.push({ time: c.t, kind: 'buy' });
    } else if (inPos) {
      if (risk.trailOn && hi > trailPeak) trailPeak = hi;
      const curRet = ((price - buyPrice) / buyPrice) * 100;
      const trailDrop = risk.trailOn ? ((trailPeak - lo) / trailPeak) * 100 : 0;
      const hitSL = activeSL > 0 && curRet <= -activeSL;
      const hitTP = activeTP > 0 && curRet >= activeTP;
      const hitTrail = risk.trailOn && trailDrop >= risk.trailPct && trailPeak > buyPrice;

      if (hitSL || hitTP || hitTrail || exitSigs[i] === 1 || i === candles.length - 1) {
        let exitPrice = price;
        if (hitSL) exitPrice = buyPrice * (1 - activeSL / 100);
        if (hitTrail) exitPrice = trailPeak * (1 - risk.trailPct / 100);
        if (hitTP) exitPrice = buyPrice * (1 + activeTP / 100);
        exitPrice = Math.max(lo, Math.min(hi, exitPrice));

        const sellPrice = exitPrice * (1 - BROK);
        const ret = ((sellPrice - buyPrice) / buyPrice) * 100;
        const pnl = equity * (ret / 100);
        equity += pnl;
        const reason = hitSL ? 'SL' : hitTrail ? 'Trail' : hitTP ? 'TP' : exitSigs[i] === 1 ? 'Signal' : 'End';
        trades.push({ buyT, sellT: c.t, buyP: buyPrice, sellP: sellPrice, ret, pnl, exit: reason });
        markers.push({ time: c.t, kind: 'sell', win: ret > 0 });
        inPos = false;
        trailPeak = 0;
      }
    }
    equityCurve.push({ t: c.t, eq: equity });
  }

  const wins = trades.filter((t) => t.ret > 0).length;
  const losses = trades.filter((t) => t.ret <= 0).length;
  const grossW = trades.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossL = Math.abs(trades.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
  let peak = CAPITAL;
  let maxDD = 0;
  equityCurve.forEach((p) => {
    if (p.eq > peak) peak = p.eq;
    maxDD = Math.max(maxDD, ((peak - p.eq) / peak) * 100);
  });

  return {
    trades,
    equityCurve,
    markers,
    stats: {
      totalRet: ((equity - CAPITAL) / CAPITAL) * 100,
      finalCapital: equity,
      winRate: trades.length ? (wins / trades.length) * 100 : 0,
      trades: trades.length,
      wins,
      losses,
      maxDD,
      profitFactor: grossL ? grossW / grossL : null,
      avgRet: trades.length ? trades.reduce((s, t) => s + t.ret, 0) / trades.length : 0,
    },
  };
}
