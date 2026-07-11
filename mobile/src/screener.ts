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
  {
    key: 'sector', label: 'Sector', group: 'Fundamentals', type: 'select', options: TE_SECTORS, fund: true,
    get: (s) => {
      const f = s._fund;
      if (!f) return null;
      return (f.sector || f.industry || '') as string;
    },
  },
];

export const TE_GROUPS = ['Signals', 'Trend', 'Momentum', 'Volatility', 'Volume', 'Structure', 'Fundamentals'];
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

export function getSortVal(s: Row, col: string): number | string {
  if (col === 'signal' || col === 'strength') return SIGNAL_ORDER[calcSignal(s)];
  if (col === 'sym') return s.sym;
  if (col === 'relvol') return s.avgvol && s.volume ? s.volume / s.avgvol : 0;
  if (FUND_SORT.has(col)) {
    const v = s._fund ? (s._fund as Record<string, unknown>)[col] : null;
    // missing fundamentals sort to the bottom either way (large finite sentinel)
    return typeof v === 'number' && isFinite(v) ? v : -1e15;
  }
  const v = (s as unknown as Record<string, unknown>)[col];
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

export function sortRows(rows: Row[], col: string, dir: 1 | -1): Row[] {
  return [...rows].sort((a, b) => {
    const va = getSortVal(a, col);
    const vb = getSortVal(b, col);
    if (typeof va === 'string' || typeof vb === 'string') {
      return String(va).localeCompare(String(vb)) * dir;
    }
    return (va - vb) * dir;
  });
}
