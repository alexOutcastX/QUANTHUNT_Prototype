// Screener filter engine — ported from the web app's FILTER_DEFS + calcSignal.
// Operates on rows that merge live technicals (/scan) with optional
// fundamentals (/fundamentals/bulk).
//
// NOTE: the scan stores d9/d20/d50/d200 as the % DISTANCE of price from each
// SMA (not the SMA level), so "price > 20DMA" is simply "d20 > 0".
import { Fundamentals, ScanRow } from './api';

export type Row = ScanRow & {
  sym: string;
  exchange?: string;
  name?: string;
  _fund?: Fundamentals | null;
};

export type Signal = 'buy' | 'sell' | 'neutral';

const n = (v: number | null | undefined): number | null =>
  v == null || !isFinite(v) ? null : v;

export function calcSignal(s: Row): Signal {
  let bull = 0;
  let bear = 0;
  const rsi = n(s.rsi);
  // RSI
  if (rsi != null) {
    if (rsi < 40) bull += 2;
    else if (rsi > 65) bull += 1;
    if (rsi > 70) bear += 2;
    else if (rsi < 30) bear -= 1;
  }
  // Price vs SMAs (distance sign)
  const gt = (v: number | null | undefined) => v != null && isFinite(v) && v > 0;
  const lt = (v: number | null | undefined) => v != null && isFinite(v) && v < 0;
  if (gt(s.d9)) bull++;
  if (gt(s.d20)) bull++;
  if (gt(s.d50)) bull++;
  if (gt(s.d200)) bull++;
  if (lt(s.d9)) bear++;
  if (lt(s.d20)) bear++;
  if (lt(s.d200)) bear += 2;
  // Williams %R
  const w = n(s.willr);
  if (w != null) {
    if (w < -80) bull += 2;
    else if (w > -20) bear += 2;
  }
  // Bollinger %B
  const b = n(s.bollb);
  if (b != null) {
    if (b < 0.2) bull += 2;
    else if (b > 0.8) bear += 1;
  }
  // Squeeze momentum
  const m = n(s.sqzMom);
  if (s.sqzFire && m != null && m > 0) bull += 2;
  if (s.sqzFire && m != null && m < 0) bear += 2;
  if (s.sqzOn && m != null && m > 1) bull += 1;
  if (s.sqzOn && m != null && m < -1) bear += 1;
  // Volume surge confirmation
  const relvol = s.avgvol && s.volume ? s.volume / s.avgvol : null;
  if (relvol != null && relvol >= 1.5) {
    if (bull > bear) bull++;
    else if (bear > bull) bear++;
  }
  const score = bull - bear;
  if (score >= 3) return 'buy';
  if (score <= -2) return 'sell';
  return 'neutral';
}

export const SIGNAL_ORDER: Record<Signal, number> = { buy: 3, neutral: 2, sell: 1 };

// ── Filter registry ──────────────────────────────────────────────────────────
export type FilterType = 'range' | 'toggle' | 'select';
export type FilterDef = {
  key: string;
  label: string;
  group: string;
  type: FilterType;
  unit?: string;
  options?: string[];
  fund?: boolean; // strict: missing fundamental data excludes the row
  get: (r: Row) => number | boolean | string | null;
};

export const TE_SECTORS = [
  'Automobile', 'Banking', 'Capital Goods', 'Chemicals', 'Construction',
  'Consumer Durables', 'Energy', 'FMCG', 'Financial Services', 'Healthcare',
  'Information Technology', 'Infrastructure', 'Media', 'Metals & Mining',
  'Oil & Gas', 'Pharmaceuticals', 'Power', 'Realty', 'Services', 'Telecom',
  'Textiles',
];

const fnum = (r: Row, k: keyof Fundamentals): number | null => {
  const f = r._fund;
  if (!f) return null;
  const v = f[k];
  return typeof v === 'number' && isFinite(v) ? v : null;
};

export const FILTER_DEFS: FilterDef[] = [
  // Trend
  { key: 'd20', label: 'Price vs 20 DMA', group: 'Trend', type: 'range', unit: '%', get: (s) => n(s.d20) },
  { key: 'd50', label: 'Price vs 50 DMA', group: 'Trend', type: 'range', unit: '%', get: (s) => n(s.d50) },
  { key: 'd150', label: 'Price vs 150 DMA', group: 'Trend', type: 'range', unit: '%', get: (s) => n(s.d150) },
  { key: 'd200', label: 'Price vs 200 DMA', group: 'Trend', type: 'range', unit: '%', get: (s) => n(s.d200) },
  { key: 'macd', label: 'MACD Histogram', group: 'Trend', type: 'range', get: (s) => n(s.macd) },
  { key: 'pct_from_high', label: '% from 52W High', group: 'Trend', type: 'range', unit: '%', get: (s) => n(s.pct_from_high) },
  { key: 'pct_from_low', label: '% from 52W Low', group: 'Trend', type: 'range', unit: '%', get: (s) => n(s.pct_from_low) },
  // Momentum
  { key: 'rsi', label: 'RSI (14)', group: 'Momentum', type: 'range', get: (s) => n(s.rsi) },
  { key: 'willr', label: 'Williams %R', group: 'Momentum', type: 'range', get: (s) => n(s.willr) },
  { key: 'bollb', label: 'Bollinger %B', group: 'Momentum', type: 'range', get: (s) => n(s.bollb) },
  { key: 'chg', label: 'Day % Change', group: 'Momentum', type: 'range', unit: '%', get: (s) => n(s.chg) },
  // Volatility
  { key: 'sqzOn', label: 'Squeeze ON', group: 'Volatility', type: 'toggle', get: (s) => s.sqzOn === true },
  { key: 'sqzFire', label: 'Squeeze Fired', group: 'Volatility', type: 'toggle', get: (s) => s.sqzFire === true },
  { key: 'sqzMom', label: 'Squeeze Momentum', group: 'Volatility', type: 'range', get: (s) => n(s.sqzMom) },
  // Signals — true events detected on the latest bar
  { key: 'golden_cross', label: 'Golden cross (50↑200)', group: 'Signals', type: 'toggle', get: (s) => s.golden_cross === true },
  { key: 'death_cross', label: 'Death cross (50↓200)', group: 'Signals', type: 'toggle', get: (s) => s.death_cross === true },
  { key: 'cross_20_50_up', label: '20-DMA crossed ↑ 50', group: 'Signals', type: 'toggle', get: (s) => s.cross_20_50_up === true },
  { key: 'cross_20_50_down', label: '20-DMA crossed ↓ 50', group: 'Signals', type: 'toggle', get: (s) => s.cross_20_50_down === true },
  { key: 'macd_bull_cross', label: 'MACD bullish cross', group: 'Signals', type: 'toggle', get: (s) => s.macd_bull_cross === true },
  { key: 'macd_bear_cross', label: 'MACD bearish cross', group: 'Signals', type: 'toggle', get: (s) => s.macd_bear_cross === true },
  { key: 'gap_up', label: 'Gapped up', group: 'Signals', type: 'toggle', get: (s) => s.gap_up === true },
  { key: 'gap_down', label: 'Gapped down', group: 'Signals', type: 'toggle', get: (s) => s.gap_down === true },
  { key: 'new_high_52w', label: 'New 52-week high', group: 'Signals', type: 'toggle', get: (s) => s.new_high_52w === true },
  { key: 'new_low_52w', label: 'New 52-week low', group: 'Signals', type: 'toggle', get: (s) => s.new_low_52w === true },
  { key: 'volume_spike', label: 'Volume spike (≥2.5×)', group: 'Signals', type: 'toggle', get: (s) => s.volume_spike === true },
  { key: 'cam_break_up', label: 'Camarilla H4 breakout', group: 'Signals', type: 'toggle', get: (s) => s.cam_break_up === true },
  { key: 'cam_break_down', label: 'Camarilla L4 breakdown', group: 'Signals', type: 'toggle', get: (s) => s.cam_break_down === true },
  // Strategies — multi-rule chart strategies computed server-side
  { key: 'minervini', label: 'Minervini Trend Template', group: 'Strategies', type: 'toggle', get: (s) => s.minervini === true },
  { key: 'dma200_rising', label: '200-DMA rising', group: 'Strategies', type: 'toggle', get: (s) => s.dma200_rising === true },
  { key: 'ret_6m', label: '6-month return', group: 'Strategies', type: 'range', unit: '%', get: (s) => n(s.ret_6m) },
  // Candlestick patterns on the latest bar
  { key: 'cs_bullish', label: 'Any bullish candle', group: 'Candlesticks', type: 'toggle', get: (s) => s.cs_bullish === true },
  { key: 'cs_bearish', label: 'Any bearish candle', group: 'Candlesticks', type: 'toggle', get: (s) => s.cs_bearish === true },
  { key: 'cs_bull_engulf', label: 'Bullish engulfing', group: 'Candlesticks', type: 'toggle', get: (s) => s.cs_bull_engulf === true },
  { key: 'cs_bear_engulf', label: 'Bearish engulfing', group: 'Candlesticks', type: 'toggle', get: (s) => s.cs_bear_engulf === true },
  { key: 'cs_hammer', label: 'Hammer', group: 'Candlesticks', type: 'toggle', get: (s) => s.cs_hammer === true },
  { key: 'cs_shooting_star', label: 'Shooting star', group: 'Candlesticks', type: 'toggle', get: (s) => s.cs_shooting_star === true },
  { key: 'cs_morning_star', label: 'Morning star', group: 'Candlesticks', type: 'toggle', get: (s) => s.cs_morning_star === true },
  { key: 'cs_evening_star', label: 'Evening star', group: 'Candlesticks', type: 'toggle', get: (s) => s.cs_evening_star === true },
  { key: 'cs_doji', label: 'Doji', group: 'Candlesticks', type: 'toggle', get: (s) => s.cs_doji === true },
  { key: 'cs_three_white', label: 'Three white soldiers', group: 'Candlesticks', type: 'toggle', get: (s) => s.cs_three_white === true },
  { key: 'cs_three_black', label: 'Three black crows', group: 'Candlesticks', type: 'toggle', get: (s) => s.cs_three_black === true },
  // Volume
  { key: 'volume', label: 'Volume', group: 'Volume', type: 'range', get: (s) => n(s.volume) },
  { key: 'avgvol', label: 'Avg Volume', group: 'Volume', type: 'range', get: (s) => n(s.avgvol) },
  { key: 'relvol', label: 'Relative Volume', group: 'Volume', type: 'range', unit: 'x', get: (s) => n(s.relvol) },
  // Structure
  { key: 'price', label: 'Price', group: 'Structure', type: 'range', unit: '₹', get: (s) => n(s.price) },
  { key: 'beta', label: 'Beta', group: 'Structure', type: 'range', get: (s) => n(s.beta) },
  { key: 'above_s1', label: '% above Support S1', group: 'Structure', type: 'range', unit: '%', get: (s) => (s.s1 && s.price ? ((s.price - s.s1) / s.s1) * 100 : null) },
  { key: 'below_r1', label: '% below Resist. R1', group: 'Structure', type: 'range', unit: '%', get: (s) => (s.r1 && s.price ? ((s.r1 - s.price) / s.r1) * 100 : null) },
  // Fundamentals (strict)
  { key: 'pe', label: 'P/E', group: 'Fundamentals', type: 'range', fund: true, get: (s) => fnum(s, 'pe') },
  { key: 'forward_pe', label: 'Forward P/E', group: 'Fundamentals', type: 'range', fund: true, get: (s) => fnum(s, 'forward_pe') },
  { key: 'pb', label: 'P/B', group: 'Fundamentals', type: 'range', fund: true, get: (s) => fnum(s, 'pb') },
  { key: 'eps', label: 'EPS', group: 'Fundamentals', type: 'range', fund: true, get: (s) => fnum(s, 'eps') },
  { key: 'dividend_yield', label: 'Dividend Yield', group: 'Fundamentals', type: 'range', unit: '%', fund: true, get: (s) => fnum(s, 'dividend_yield') },
  { key: 'roe', label: 'ROE', group: 'Fundamentals', type: 'range', unit: '%', fund: true, get: (s) => fnum(s, 'roe') },
  { key: 'roce', label: 'ROCE', group: 'Fundamentals', type: 'range', unit: '%', fund: true, get: (s) => fnum(s, 'roce') },
  { key: 'debt_equity', label: 'Debt / Equity', group: 'Fundamentals', type: 'range', fund: true, get: (s) => fnum(s, 'debt_equity') },
  { key: 'current_ratio', label: 'Current Ratio', group: 'Fundamentals', type: 'range', fund: true, get: (s) => fnum(s, 'current_ratio') },
  { key: 'market_cap_cr', label: 'Market Cap', group: 'Fundamentals', type: 'range', unit: '₹cr', fund: true, get: (s) => fnum(s, 'market_cap_cr') },
  { key: 'peg', label: 'PEG Ratio', group: 'Fundamentals', type: 'range', fund: true, get: (s) => fnum(s, 'peg') },
  { key: 'revenue_growth_pct', label: 'Revenue Growth', group: 'Fundamentals', type: 'range', unit: '%', fund: true, get: (s) => fnum(s, 'revenue_growth_pct') },
  { key: 'earnings_growth_pct', label: 'Earnings Growth', group: 'Fundamentals', type: 'range', unit: '%', fund: true, get: (s) => fnum(s, 'earnings_growth_pct') },
  { key: 'fcf_cr', label: 'Free Cash Flow', group: 'Fundamentals', type: 'range', unit: '₹cr', fund: true, get: (s) => fnum(s, 'fcf_cr') },
  {
    key: 'sector', label: 'Sector', group: 'Fundamentals', type: 'select', options: TE_SECTORS, fund: true,
    get: (s) => {
      const f = s._fund;
      if (!f) return null;
      return (f.sector || f.industry || '') as string;
    },
  },
];

export const TE_GROUPS = ['Signals', 'Strategies', 'Trend', 'Momentum', 'Volatility',
  'Candlesticks', 'Volume', 'Structure', 'Fundamentals'];
export const DEF_BY_KEY: Record<string, FilterDef> = {};
FILTER_DEFS.forEach((d) => {
  DEF_BY_KEY[d.key] = d;
});

// Active filter values: range → {min?,max?}; toggle → true; select → string.
export type RangeVal = { min?: number; max?: number };
export type FilterValue = RangeVal | boolean | string;
export type ActiveFilters = Record<string, FilterValue>;

export function hasFundFilter(active: ActiveFilters): boolean {
  return Object.keys(active).some((k) => DEF_BY_KEY[k]?.fund);
}

function passRange(v: number | null, val: RangeVal): boolean {
  // Lenient for technical (null passes); callers enforce strictness for fund.
  if (v == null) return true;
  if (val.min != null && v < val.min) return false;
  if (val.max != null && v > val.max) return false;
  return true;
}

export function applyFilters(rows: Row[], active: ActiveFilters): Row[] {
  const entries = Object.entries(active).filter(([k]) => DEF_BY_KEY[k]);
  if (!entries.length) return rows;
  return rows.filter((row) =>
    entries.every(([key, val]) => {
      const def = DEF_BY_KEY[key];
      if (def.type === 'toggle') {
        if (val !== true) return true;
        return def.get(row) === true;
      }
      if (def.type === 'select') {
        if (!val) return true;
        const sec = def.get(row);
        if (sec == null || sec === '') return false; // strict
        return String(sec).toLowerCase().includes(String(val).toLowerCase());
      }
      // range
      const v = def.get(row) as number | null;
      if (def.fund && v == null) return false; // fundamentals are strict
      return passRange(v, val as RangeVal);
    }),
  );
}

const FUND_SORT = new Set([
  'pe', 'forward_pe', 'pb', 'eps', 'dividend_yield', 'roe', 'roce',
  'debt_equity', 'current_ratio', 'market_cap_cr',
]);

export function getSortVal(s: Row, col: string): number | string | null {
  if (col === 'signal' || col === 'strength') return SIGNAL_ORDER[calcSignal(s)];
  if (col === 'sym') return s.sym;
  if (col === 'name') return s.name || s.sym;
  if (col === 'exchange') return s.exchange || '';
  if (col === 'relvol') return s.avgvol && s.volume ? s.volume / s.avgvol : null;
  if (FUND_SORT.has(col)) {
    const v = s._fund ? (s._fund as Record<string, unknown>)[col] : null;
    return typeof v === 'number' && isFinite(v) ? v : null;
  }
  const v = (s as unknown as Record<string, unknown>)[col];
  return typeof v === 'number' && isFinite(v) ? v : null;
}

export function sortRows(rows: Row[], col: string, dir: 1 | -1): Row[] {
  return [...rows].sort((a, b) => {
    const va = getSortVal(a, col);
    const vb = getSortVal(b, col);
    if (typeof va === 'string' || typeof vb === 'string') {
      return String(va ?? '').localeCompare(String(vb ?? '')) * dir;
    }
    // Rows missing the value (fundamentals still streaming in, thin symbols)
    // always sort LAST regardless of direction. The old -1e15 sentinel only
    // worked descending — ascending put every blank row on top, which read as
    // "sorting is broken" (especially market cap while caps were loading).
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return (va - vb) * dir;
  });
}

// ── Expression filters (TaurEye-style rows with AND/OR chaining) ─────────────
// Each row is `<metric> <op> <value(s)>`; rows combine LEFT-TO-RIGHT with the
// row's own AND/OR join (no parentheses — same semantics as the TaurEye site).
export type ExprOp = 'gt' | 'lt' | 'between' | 'eq' | 'is' | 'has';
export type ExprRow = {
  id: string; // stable React key
  key: string; // DEF_BY_KEY key
  op: ExprOp;
  v1?: string; // raw text so typing "1." never fights the input
  v2?: string; // upper bound for `between`
  join: 'and' | 'or'; // how this row combines with everything before it
  src?: string; // 'preset:<id>' | 'nl' | undefined (manual row)
};

let exprSeq = 0;
export const exprId = () => 'x' + Date.now().toString(36) + '-' + exprSeq++;

export const defaultOpFor = (key: string): ExprOp => {
  const def = DEF_BY_KEY[key];
  return def?.type === 'toggle' ? 'is' : def?.type === 'select' ? 'has' : 'gt';
};

// Convert legacy keyed filters (presets, NL builder, old saved screens and
// share links) into expression rows (AND-joined).
export function filtersToExpr(f: ActiveFilters, src?: string): ExprRow[] {
  const out: ExprRow[] = [];
  for (const [key, val] of Object.entries(f || {})) {
    const def = DEF_BY_KEY[key];
    if (!def || val == null) continue;
    if (def.type === 'toggle') {
      if (val === true) out.push({ id: exprId(), key, op: 'is', join: 'and', src });
    } else if (def.type === 'select') {
      if (val) out.push({ id: exprId(), key, op: 'has', v1: String(val), join: 'and', src });
    } else {
      const r = val as RangeVal;
      if (r.min != null && r.max != null) {
        out.push({ id: exprId(), key, op: 'between', v1: String(r.min), v2: String(r.max), join: 'and', src });
      } else if (r.min != null) {
        out.push({ id: exprId(), key, op: 'gt', v1: String(r.min), join: 'and', src });
      } else if (r.max != null) {
        out.push({ id: exprId(), key, op: 'lt', v1: String(r.max), join: 'and', src });
      }
    }
  }
  return out;
}

// One row's truth value; null = row incomplete (neutral, skipped in the fold).
function evalExprRow(row: Row, e: ExprRow): boolean | null {
  const def = DEF_BY_KEY[e.key];
  if (!def) return null;
  const v = def.get(row);
  if (def.type === 'toggle') return v === true;
  if (def.type === 'select') {
    if (!e.v1) return null;
    if (v == null || v === '') return false;
    return String(v).toLowerCase().includes(String(e.v1).toLowerCase());
  }
  const n1 = e.v1 != null && e.v1 !== '' ? parseFloat(e.v1) : NaN;
  const n2 = e.v2 != null && e.v2 !== '' ? parseFloat(e.v2) : NaN;
  if (e.op === 'between') {
    if (!isFinite(n1) && !isFinite(n2)) return null;
    if (v == null || typeof v !== 'number') return false;
    if (isFinite(n1) && v < n1) return false;
    if (isFinite(n2) && v > n2) return false;
    return true;
  }
  if (!isFinite(n1)) return null;
  if (v == null || typeof v !== 'number') return false;
  if (e.op === 'gt') return v > n1;
  if (e.op === 'lt') return v < n1;
  return v === n1; // eq
}

export function applyExpr(rows: Row[], expr: ExprRow[]): Row[] {
  const active = (expr || []).filter((e) => DEF_BY_KEY[e.key]);
  if (!active.length) return rows;
  return rows.filter((row) => {
    let acc: boolean | null = null;
    for (const e of active) {
      const c = evalExprRow(row, e);
      if (c == null) continue; // incomplete row — doesn't constrain
      acc = acc == null ? c : e.join === 'or' ? acc || c : acc && c;
    }
    return acc == null ? true : acc;
  });
}
