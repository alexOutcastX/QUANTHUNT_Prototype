// API client for the TaurEye / QuantHunt Flask backend.
//
// Base URL defaults to the Oracle VM. Override at build/run time with
// EXPO_PUBLIC_API_BASE (e.g. your https domain once certbot is set up).
//
// NOTE: iOS ATS and Android block cleartext http in release builds. For
// production point this at an https URL. In Expo Go dev, http works.
//
// On web the app is served by the same Flask server that exposes the API, so
// default to same-origin (relative URLs). Native builds hit the VM directly.
import { Platform } from 'react-native';

// Inside the Capacitor Android shell the bundle runs as react-native-web, so
// Platform.OS === 'web', but the page origin is capacitor://localhost — a
// same-origin (relative) API base would never reach the VM. Capacitor injects
// window.Capacitor into the WebView, so detect the native shell explicitly and
// hit the VM by absolute URL. Plain http works because the Android manifest
// allows cleartext (see capacitor.config.ts); switch to an https domain via
// EXPO_PUBLIC_API_BASE once the backend has TLS.
const VM_BASE = 'http://161.118.174.177';
const inCapacitor = (() => {
  try {
    const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return !!cap?.isNativePlatform?.();
  } catch {
    return false;
  }
})();

export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE ??
  (inCapacitor ? VM_BASE : Platform.OS === 'web' ? '' : VM_BASE);

async function getJson<T>(path: string, timeoutMs = 25000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // credentials: 'include' so the owner session cookie rides along (needed
    // for the broker endpoints, and cross-origin/native).
    const res = await fetch(API_BASE + path, { signal: ctrl.signal, credentials: 'include' });
    if (!res.ok) {
      // Prefer the backend's JSON `error` message over a bare status code, so
      // "data source is rate-limiting, try again" reaches the user (not HTTP 502).
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error || 'HTTP ' + res.status);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error || 'HTTP ' + res.status);
  return data;
}

export type Ping = { server: string; status: string; source?: string; version?: string };
export type Version = { version: string; commit: string };

export type UniverseSymbol = { symbol: string; name: string; exchange: string };
export type UniverseResp = {
  ready: boolean;
  total: number;
  nse: number;
  bse: number;
  symbols: UniverseSymbol[];
};

export type Quote = {
  price?: number | null;
  prevClose?: number | null;
  chg?: number | null;
  absChg?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  volume?: number | null;
  source?: string;
  error?: string;
};
export type LtpResp = Record<string, Quote>;

export type FundamentalsBulk = {
  data: Record<string, Record<string, unknown>>;
  pending: string[];
  provider: string;
  cached: number;
  total: number;
};

// A single OHLCV candle with TA overlays (from /history).
export type Candle = {
  t: number;
  o: number | null;
  h: number | null;
  l: number | null;
  c: number | null;
  v: number;
  ema9?: number | null;
  ema20?: number | null;
  ema50?: number | null;
  ema200?: number | null;
  rsi?: number | null;
};
export type HistoryResp = {
  symbol: string;
  period: string;
  interval: string;
  count: number;
  candles: Candle[];
  error?: string;
};

// Single-symbol fundamentals (from /fundamentals). All fields best-effort.
export type Fundamentals = {
  symbol: string;
  name?: string;
  longName?: string;
  sector?: string | null;
  industry?: string | null;
  pe?: number | null;
  forward_pe?: number | null;
  pb?: number | null;
  eps?: number | null;
  dividend_yield?: number | null;
  roe?: number | null;
  roce?: number | null;
  debt_equity?: number | null;
  current_ratio?: number | null;
  market_cap_cr?: number | null;
  // Analyser extras seeded from the multibagger screen's metrics dict.
  peg?: number | null;
  revenue_growth_pct?: number | null;
  earnings_growth_pct?: number | null;
  fcf_cr?: number | null;
  pct_from_high_pct?: number | null;
  description?: string;
  error?: string;
};

// Live technical snapshot per symbol (from /scan).
export type ScanRow = {
  price?: number | null;
  prevClose?: number | null;
  chg?: number | null;
  absChg?: number | null;
  volume?: number | null;
  avgvol?: number | null;
  relvol?: number | null;
  d9?: number | null;
  d20?: number | null;
  d50?: number | null;
  d150?: number | null;
  d200?: number | null;
  rsi?: number | null;
  macd?: number | null;
  willr?: number | null;
  bollb?: number | null;
  high52?: number | null;
  low52?: number | null;
  pct_from_high?: number | null;
  pct_from_low?: number | null;
  beta?: number | null;
  sqzOn?: boolean | null;
  sqzFire?: boolean | null;
  sqzMom?: number | null;
  s1?: number | null;
  s2?: number | null;
  s3?: number | null;
  r1?: number | null;
  r2?: number | null;
  r3?: number | null;
  // true event flags detected on the latest bar (null = not enough history)
  golden_cross?: boolean | null;
  death_cross?: boolean | null;
  cross_20_50_up?: boolean | null;
  cross_20_50_down?: boolean | null;
  macd_bull_cross?: boolean | null;
  macd_bear_cross?: boolean | null;
  gap_up?: boolean | null;
  gap_down?: boolean | null;
  new_high_52w?: boolean | null;
  new_low_52w?: boolean | null;
  volume_spike?: boolean | null;
  cam_h3?: number | null;
  cam_h4?: number | null;
  cam_l3?: number | null;
  cam_l4?: number | null;
  cam_break_up?: boolean | null;
  cam_break_down?: boolean | null;
  // Minervini Trend Template + relative strength
  dma200_rising?: boolean | null;
  ret_1w?: number | null;
  ret_1m?: number | null;
  ret_6m?: number | null;
  minervini?: boolean | null;
  minervini_rules?: number | null;
  // Candlestick patterns on the latest bar
  cs_doji?: boolean | null;
  cs_hammer?: boolean | null;
  cs_shooting_star?: boolean | null;
  cs_bull_engulf?: boolean | null;
  cs_bear_engulf?: boolean | null;
  cs_piercing?: boolean | null;
  cs_dark_cloud?: boolean | null;
  cs_morning_star?: boolean | null;
  cs_evening_star?: boolean | null;
  cs_three_white?: boolean | null;
  cs_three_black?: boolean | null;
  cs_bullish?: boolean | null;
  cs_bearish?: boolean | null;
};
export type ScanResp = {
  data: Record<string, ScanRow>;
  count: number;
  computed?: number;
  cached?: number;
  error?: string;
};

export type IndexConstituent = {
  symbol: string;
  // Custom groups (SME EMERGE / RECENT IPOS) carry names the main-board
  // master list doesn't have.
  name?: string | null;
  price?: number | null;
  prevClose?: number | null;
  chg?: number | null;
  absChg?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  volume?: number | null;
};
export type IndexResp = {
  index: string;
  count: number;
  data: IndexConstituent[];
  error?: string;
};
export type MoversResp = {
  index: string;
  breadth: { up: number; down: number; flat: number; total: number; ratio: number } | null;
  gainers: IndexConstituent[];
  losers: IndexConstituent[];
  asof?: number;
  stale?: boolean;
  error?: string;
};

export type ReturnsRow = { ret1y?: number | null; ret3y?: number | null; ret5y?: number | null };
export type ReturnsResp = Record<string, ReturnsRow>;

// Landing-page windows: NSE public-issue calendar + traded G-Sec/SGB quotes.
export type IpoItem = {
  symbol: string; name: string; series: string; start: string; end: string;
  price_band: string; size: string; status: 'open' | 'upcoming';
};
export type IpoResp = { items: IpoItem[]; asof?: string; stale?: boolean; error?: string };
export type GsecItem = {
  symbol: string; series: string; kind: 'gsec' | 'sgb';
  ltp?: number | null; chg?: number | null; yld?: number | null;
  coupon?: number | null; maturity: string;
};
export type GsecResp = { items: GsecItem[]; asof?: string; stale?: boolean; error?: string };
export type NewsItem = { title: string; link: string; source: string; ts?: number | null; sym?: string };
export type NewsResp = { items: NewsItem[]; fetched?: number; cached?: boolean };

// Scan up to 60 symbols per request; caller batches larger lists.
async function scanBatch(symbols: string[]): Promise<ScanResp> {
  return getJson<ScanResp>('/scan?symbols=' + encodeURIComponent(symbols.join(',')), 60000);
}

// Company-relationship graph (Terminal tab). Shape is stable across the
// curated demo dataset and AI-generated graphs (?symbol= with a server key).
export type GraphCompany = { name: string; listed: boolean };
export type GraphEdge = {
  src: string;
  dst: string;
  type: 'supplies' | 'group' | 'competitor' | 'finances';
  note: string;
  confidence: 'high' | 'medium' | 'low';
};
export type GraphResp = {
  companies: Record<string, GraphCompany>;
  edges: GraphEdge[];
  available: string[];
  source: string;
  disclaimer: string;
  ai?: boolean;
};

// Graph fetch is special-cased: AI generation can take ~15s+ on a cache miss,
// and error responses carry a user-facing `detail` worth surfacing.
export type AiCreds = { key: string; provider?: string; model?: string };

async function fetchGraph(symbol?: string, ai?: AiCreds): Promise<GraphResp> {
  const path = '/graph' + (symbol ? '?symbol=' + encodeURIComponent(symbol) : '');
  const ctrl = new AbortController();
  // Backend caps AI generation at ~60s; give a little margin, then surface an
  // error rather than spinning forever.
  const timer = setTimeout(() => ctrl.abort(), 75000);
  try {
    // BYOK: forward the user's own key + chosen provider so AI graphs work on
    // any deployment. Sent per-request only; the server never stores or logs it.
    let headers: Record<string, string> | undefined;
    if (ai?.key) {
      headers = { 'X-AI-Key': ai.key };
      if (ai.provider) headers['X-AI-Provider'] = ai.provider;
      if (ai.model) headers['X-AI-Model'] = ai.model;
    }
    let res: Response;
    try {
      res = await fetch(API_BASE + path, { signal: ctrl.signal, headers });
    } catch (e) {
      // AbortError = our own timeout fired; give a human message.
      if (e instanceof DOMException && e.name === 'AbortError') {
        throw new Error('Graph generation timed out — the AI provider was too slow. Try again.');
      }
      throw e;
    }
    const body = (await res.json().catch(() => null)) as
      | (GraphResp & { detail?: string })
      | null;
    if (!res.ok) throw new Error(body?.detail || 'HTTP ' + res.status);
    if (!body) throw new Error('Empty response');
    return body;
  } finally {
    clearTimeout(timer);
  }
}

// Live index levels + market holidays (Indices / Holidays pages, ticker strip).
// `category` (domestic | international | depository) tags the source list; older
// backends omit it, so it's optional. `country` is reserved for future use.
export type IndexQuote = {
  key: string;
  name: string;
  level: number;
  chg: number;
  y1: number;
  category?: string;
  country?: string;
};
export type IndicesResp = { indices: IndexQuote[]; asof: number; cached?: boolean };
export type Holiday = { date: string; name: string; day: string };
export type HolidaysResp = {
  open: boolean;
  now_ist: string;
  next_holiday: Holiday | null;
  holidays: Holiday[];
  note: string;
};

// BYOB broker connect (read-only; server holds the user's own Kite session).
export type BrokerStatus = {
  configured: boolean;
  connected: boolean;
  user?: string | null;
  login_url?: string | null;
  read_only: boolean;
};
export type BrokerHolding = {
  symbol: string;
  exchange?: string;
  qty: number;
  avg_price?: number | null;
  ltp?: number | null;
  pnl?: number | null;
};

export type AuthStatus = { configured: boolean; owner: boolean };

export type Broadcast = {
  title: string;
  body: string;
  ts: number;
  sent?: number;
  data?: Record<string, unknown>;
};

// Multi-timeframe trade analysis (/timeframes): 5-min → weekly + near/far horizons.
export type TimeframeRead = {
  tf: string; label: string; price?: number | null; rsi?: number | null;
  macd?: number | null; vs_ema20?: number | null; vs_ema50?: number | null;
  score: number | null; bias: string;
  rating?: string;
  supports?: number[]; resistances?: number[];
  fib?: Record<string, number>; swing_hi?: number; swing_lo?: number;
};
// 10-point fundamental checklist (/checklist).
export type ChecklistItem = {
  key: string; label: string; value: string | null;
  verdict: 'good' | 'ok' | 'bad' | 'na';
};
export type ChecklistResp = {
  symbol?: string; items: ChecklistItem[];
  passed?: number; ok?: number; scored?: number; total?: number;
  score?: number | null; error?: string;
};

export type HorizonRead = { key: string; label: string; score: number | null; bias: string; from?: string[] };
export type OverallRead = { score: number | null; bias: string; rating: string };
export type TimeframesResp = {
  symbol: string; timeframes: TimeframeRead[]; horizons: HorizonRead[];
  overall?: OverallRead; error?: string;
};

// Per-strategy scorecard (/strategy-scores) — shown in every detail popup.
export type StrategyScore = { id: string; name: string; score: number | null; pass: boolean; note: string };
export type StrategyScoresResp = { symbol: string; strategies: StrategyScore[]; error?: string };

// On-demand screener.in scrape (/screener-financials) — real Indian promoter /
// FII / DII shareholding + borrowings that Yahoo/NSE don't reliably give.
export type ScreenerPL = { year: string; revenue: number | null; net_profit: number | null; eps: number | null };
export type ScreenerFinancials = {
  symbol: string;
  shareholding?: { promoter?: number; fii?: number; dii?: number; government?: number; public?: number };
  balance?: { borrowings?: number; reserves?: number; equity_capital?: number; total_liabilities?: number };
  pl?: ScreenerPL[];
  source?: string; url?: string; ok?: boolean; error?: string;
};

// Full company report (/report) — used by the institutional dossier for
// quarterly + annual P&L, balance sheet, cash flow and shareholding.
export type ReportFinYear = {
  year: string; revenue: number | null; net_income: number | null;
  op_income?: number | null; net_margin?: number | null;
  rev_growth?: number | null; ni_growth?: number | null;
};
export type ReportFinQuarter = {
  period: string; revenue: number | null; net_income: number | null; op_income?: number | null;
};
export type ReportResp = {
  fin_years?: ReportFinYear[];
  fin_quarters?: ReportFinQuarter[];
  shareholding?: { insiders_pct?: number | null; institutions_pct?: number | null };
  balance_sheet?: {
    total_debt?: number | null; long_term_debt?: number | null; current_debt?: number | null;
    total_assets?: number | null; equity?: number | null; cash?: number | null;
    inventory?: number | null; receivables?: number | null;
  };
  cash_flow?: { ocf?: number | null; fcf?: number | null; capex?: number | null };
  error?: string;
};

// Corporate / institutional data (NSE public feeds).
export type Announcement = { date: string; subject: string; detail: string; attachment: string };
export type CorpAction = { type: string; ex_date: string; record_date: string; detail: string };
export type Shareholding = {
  date: string;
  promoter: number | null;
  fii: number | null;
  dii: number | null;
  public: number | null;
  pledge: number | null;
};
export type Deal = {
  kind: string;
  date: string;
  symbol: string;
  client: string;
  side: string;
  qty: number | null;
  price: number | null;
};

// Derivatives — F&O option chain (NSE public feed).
export type OptionLeg = {
  oi: number | null;
  chg_oi: number | null;
  iv: number | null;
  ltp: number | null;
  volume: number | null;
};
export type OptionStrike = { strike: number; ce: OptionLeg | null; pe: OptionLeg | null };
export type OptionChain = {
  symbol: string | null;
  underlying: number | null;
  expiry: string | null;
  expiries: string[];
  strikes: OptionStrike[];
  pcr: number | null;
  total_ce_oi: number | null;
  total_pe_oi: number | null;
  max_pain: number | null;
  atm: number | null;
  atm_iv: number | null;
  source: string;
  error?: string;
};

// ── Backtest engine v2 (from /backtest/*) ────────────────────────────────────
export type BtRule = {
  ind: string;
  period?: number;
  op: 'gt' | 'lt' | 'cross_above' | 'cross_below';
  target: string;
  value?: number;
};
export type BtConfig = {
  symbols?: string[];
  index?: string;
  period?: string;
  capital?: number;
  max_positions?: number;
  execution?: 'next_open' | 'same_close';
  strategy: {
    key: string;
    name?: string;
    params?: Record<string, number>;
    buy?: BtRule[];
    sell?: BtRule[];
    filters?: BtRule[];
    mode_buy?: 'all' | 'any';
    mode_sell?: 'all' | 'any';
    base?: { key: string; params?: Record<string, number> };
  };
  sizing?: { mode: 'equal' | 'fixed' | 'risk'; value?: number };
  costs?: Record<string, number>;
  risk?: {
    sl_type?: 'none' | 'pct' | 'atr';
    sl_val?: number;
    tp_type?: 'none' | 'pct' | 'rr';
    tp_val?: number;
    trail_pct?: number;
    max_hold_days?: number;
  };
};
export type BtStrategyMeta = { key: string; label: string; params: Record<string, number>; blurb: string };
export type BtStrategiesResp = {
  strategies: BtStrategyMeta[];
  default_costs: Record<string, number>;
  max_symbols: number;
};
export type BtTrade = {
  id: number;
  symbol: string;
  qty: number;
  entry_date: string;
  entry_ts: number;
  entry_px: number;
  exit_date: string;
  exit_ts: number;
  exit_px: number;
  reason: string;
  gross_pnl: number;
  charges: number;
  net_pnl: number;
  ret_pct: number;
  hold_days: number;
  r_multiple: number | null;
};
export type BtStats = {
  final_capital: number;
  net_profit: number;
  total_return_pct: number;
  cagr_pct: number;
  volatility_pct: number;
  sharpe: number;
  sortino: number;
  calmar: number | null;
  max_drawdown_pct: number;
  max_drawdown_days: number;
  exposure_pct: number;
  turnover_x: number;
  trades: number;
  win_rate_pct: number;
  profit_factor: number | null;
  expectancy: number;
  avg_win: number;
  avg_loss: number;
  payoff: number | null;
  avg_hold_days: number;
  total_charges: number;
  best_trade: BtTrade | null;
  worst_trade: BtTrade | null;
  drawdown_curve: { t: number; dd: number }[];
  monthly_returns: { year: number; months: (number | null)[]; total: number }[];
  per_symbol: { symbol: string; trades: number; wins: number; net_pnl: number; charges: number }[];
  rf_rate_pct: number;
};
export type BtResult = {
  universe: string[];
  skipped: string[];
  period: string;
  strategy: BtConfig['strategy'];
  execution: string;
  stats: BtStats;
  equity_curve: { t: number; eq: number }[];
  benchmark_curve: { t: number; eq: number }[];
  trades: BtTrade[];
  costs: Record<string, number>;
  asof: number;
};
export type BtSnapshot = {
  status: 'running' | 'done' | 'error' | 'unknown';
  progress: string;
  run_id: string;
  error: string | null;
  result: BtResult | null;
};
export type BtLastResp = { run_id: string | null; config?: BtConfig; result?: BtResult };

// Portfolio risk report (from /risk/portfolio).
// Multibagger-potential report (from /multibagger).
export type MbPillar = { key: string; label: string; weight: number; score: number | null; note: string };
export type MbCheck = { label: string; state: 'pass' | 'fail' | 'unknown' };
export type MultibaggerReport = {
  symbol: string;
  name: string;
  sector?: string | null;
  industry?: string | null;
  price?: number | null;
  about?: string;
  score: number;
  coverage_pct: number;
  tier: string;
  probability_pct: number;
  pillars: MbPillar[];
  strengths: string[];
  red_flags: string[];
  checklist: MbCheck[];
  metrics: Record<string, number | null>;
  methodology: string;
  disclaimer: string;
  error?: string;
};

// Full-universe analyser-score screen (from /multibagger/screen).
export type MbScreenRow = {
  symbol: string;
  score: number;
  tier: string;
  probability_pct: number;
  coverage_pct: number;
  price: number | null;
  chg?: number | null;
  volume?: number | null;
  relvol?: number | null;
  vs_50dma?: number | null;
  vs_200dma: number | null;
  pct_from_high?: number | null;
  market_cap_cr: number | null;
  roe: number | null;
  debt_equity: number | null;
  sector?: string | null;
  // Full analyser metrics dict (pe, pb, roce_pct, peg, margins…) — carried so
  // strategy filters work without a second fundamentals fetch.
  metrics?: Record<string, number | string | null> | null;
};
// Index-wide chart-pattern screener (from /patterns/screen).
export type PatternScreenHit = {
  symbol: string;
  price: number | null;
  type: string;
  label: string;
  bias: 'bullish' | 'bearish' | 'neutral';
  category: string;
  status?: 'confirmed' | 'forming' | null;
  confidence: number;
  continuation?: number | null;
  expansion_pct?: number | null;
  target?: number | null;
  start_ts?: number | null;
  end_ts?: number | null;
};
export type PatternScreenResp = {
  status: 'idle' | 'running' | 'done' | 'error';
  refreshing?: boolean;
  progress?: string;
  asof: number;
  index: string;
  universe: number;
  capped?: boolean;
  scanned_ok?: number;
  no_data?: number;
  partial?: boolean;
  matches: number;
  results: PatternScreenHit[];
  error?: string | null;
};

export type MbScreenResp = {
  status: 'idle' | 'running' | 'done' | 'error';
  refreshing?: boolean;
  progress?: string;
  asof: number;
  universe: number;
  matches: number;
  results: MbScreenRow[];
  criteria: Record<string, unknown>;
  error?: string | null;
};

// Full NSE+BSE sectoral aggregate (from /sectors) — a by-product of the
// multibagger universe sweep.
export type SectorLevel = 'macro' | 'industry' | 'basic';
export type SectorAgg = {
  sector: string;
  count: number;
  market_cap_cr: number | null;
  chg: number | null;
  // The parent macro sector (present at the finer levels), so a tile can still
  // route into the macro-sector screeners.
  parent?: string;
};
export type SectorsResp = {
  status: 'idle' | 'running' | 'done' | 'error';
  refreshing?: boolean;
  progress?: string;
  asof: number;
  level?: SectorLevel;
  universe: number;
  mapped: number;
  sectors: SectorAgg[];
  error?: string | null;
};

// Classic chart-pattern recognition (from /chart-patterns).
export type ChartPattern = {
  type: string;
  label: string;
  bias: 'bullish' | 'bearish' | 'neutral';
  category: string;
  start_ts: number;
  end_ts: number;
  confidence: number;      // how well the shape matches (0–100)
  continuation: number;    // indicative follow-through probability (0–100)
  expansion_pct: number;   // measured-move target, signed % of price
  target?: number | null;
  level?: number | null;   // neckline / breakout level
  status: string;          // 'forming' | 'confirmed'
  current?: boolean;
  active?: boolean;        // still touching the most recent bars
  bars_since_end?: number;
};
export type ChartPatternsResp = {
  symbol: string;
  count: number;
  patterns: ChartPattern[];
  current: ChartPattern | null;
  bars?: number;
  period?: string;
  interval?: string;
  candles?: { t: number; o: number; h: number; l: number; c: number }[];
  note?: string;
  error?: string;
};

// Buy recommendation for one symbol (from /recommendation).
export type Recommendation = {
  symbol: string;
  name?: string | null;
  action: 'BUY' | 'WATCH' | 'AVOID' | 'SKIP';
  confidence: number;
  fundamental_score: number | null;
  momentum_score: number;
  pattern_score: number;
  pattern?: string | null;
  pattern_bias?: string | null;
  price: number;
  entry: number;
  stop: number;
  stop_pct: number;
  target: number;
  target2: number;
  upside_pct: number;
  rr: number | null;
  eta_days?: number | null;
  eta?: string | null;
  support: number;
  support2: number;
  resistance: number;
  rsi: number;
  high52: number;
  low52: number;
  rationale: string[];
  note?: string;
  error?: string;
};

// Short-term (swing) trade read (from /swing) — mid & large caps near a
// pullback reversal / oversold bounce.
export type SwingRec = {
  symbol: string;
  name?: string | null;
  action: 'SWING' | 'WATCH' | 'AVOID' | 'SKIP';
  qualifies: boolean;
  setup: string;
  probability: number;
  trend: 'up' | 'down' | 'side';
  momentum: number;
  price: number;
  entry: number;
  stop: number;
  stop_pct: number;
  target: number;
  upside_pct: number;
  rr: number | null;
  eta_days?: number | null;
  eta?: string | null;
  support: number;
  resistance: number;
  rsi: number;
  max_dd: number;
  reasons: string[];
  note?: string;
  error?: string;
};

// Institutional / algorithmic strategy screen (from /institutional).
export type StrategyHit = { key: string; label: string; score: number; note: string };
export type InstitutionalRec = {
  symbol: string;
  name?: string | null;
  action: 'BUY' | 'WATCH' | 'AVOID' | 'SKIP';
  qualifies: boolean;
  score: number;
  strategies: StrategyHit[];
  primary: string;
  primary_key: string | null;
  matched_count: number;
  trend: 'up' | 'down' | 'side';
  momentum: number;
  rsi: number;
  price: number;
  entry: number;
  stop: number;
  stop_pct: number;
  target: number;
  upside_pct: number;
  rr: number | null;
  eta_days?: number | null;
  eta?: string | null;
  support: number;
  resistance: number;
  max_dd: number;
  ret_3m?: number;
  ret_6m?: number;
  ret_12m?: number;
  reasons: string[];
  note?: string;
  error?: string;
};

// ICT / Smart-Money-Concepts screen (from /smc).
export type SmcRec = {
  symbol: string;
  name?: string | null;
  action: 'LONG' | 'WATCH' | 'AVOID' | 'SKIP';
  qualifies: boolean;
  score: number;
  strategies: StrategyHit[];
  confluences: string[];
  conf_count: number;
  zone: 'discount' | 'premium' | 'equilibrium';
  in_discount: boolean;
  primary: string;
  primary_key: string | null;
  matched_count: number;
  trend: 'up' | 'down' | 'side';
  momentum: number;
  rsi: number;
  price: number;
  entry: number;
  stop: number;
  stop_pct: number;
  target: number;
  target2: number;
  upside_pct: number;
  rr: number | null;
  eta_days?: number | null;
  eta?: string | null;
  support: number;
  resistance: number;
  max_dd: number;
  reasons: string[];
  not_automated?: string[];
  note?: string;
  error?: string;
};

// Full NSE+BSE momentum radar (from /momentum/screen).
export type MomentumHit = {
  symbol: string;
  name: string;
  exchange: string;
  price: number | null;
  chg: number | null;
  rsi: number | null;
  relvol: number | null;
  d200: number | null;
  pct_from_high: number | null;
  ret_1w: number | null;      // trailing 1-week % return (higher-timeframe momentum)
  ret_1m: number | null;      // trailing 1-month % return
  target: number | null;      // nearest overhead target (52w high / pivot)
  upside_pct: number | null;  // % upside remaining to that target
  setup: 'breakout' | 'fired' | 'pullback';
  score: number;
  probability: number;
  signals: string[];
  cautions: string[];
};
export type MomentumScreenResp = {
  status: 'idle' | 'running' | 'done' | 'error';
  refreshing?: boolean;
  progress?: string;
  asof: number;
  universe_nse: number;
  universe_bse: number;
  matches: number;
  results: MomentumHit[];
  error?: string | null;
};

export type RiskReport = {
  ok: boolean;
  reason?: string;
  value?: number;
  weights?: Record<string, number>;
  volatility_annual?: number | null;
  var_pct?: number | null;
  var_amount?: number | null;
  var_param_pct?: number | null;
  drawdown?: { mdd: number | null; peak: number | null; trough: number | null };
  sharpe?: number | null;
  beta?: number | null;
  correlations?: Record<string, number>;
  conf?: number;
  days?: number;
  symbols_priced?: string[];
  symbols_missing?: string[];
};
export type RiskHolding = { symbol: string; qty: number };

// Grounded entity graph — institution⇄company link analysis from NSE deals.
export type DealCitation = {
  date: string;
  side: string;
  qty: number | null;
  price: number | null;
  kind: string;
};
export type FlowEdge = {
  entity: string;
  entity_name: string;
  symbol: string;
  buy_qty: number;
  sell_qty: number;
  net_qty: number;
  deal_count: number;
  avg_price: number | null;
  first_date: string;
  last_date: string;
  citations: DealCitation[];
};
export type EntityNode = {
  id: string;
  name: string;
  kind: string;
  deals: number;
  breadth: number;
  symbols: string[];
};
export type EntityGraph = {
  nodes: { companies: { id: string; kind: string; deals: number }[]; entities: EntityNode[] };
  edges: FlowEdge[];
  asof: { first: string; last: string };
  source: string;
  disclaimer: string;
};
export type EntityView = { view: 'entity'; entity: string; positions: FlowEdge[]; asof: { first: string; last: string }; source: string };
export type SymbolView = { view: 'symbol'; symbol: string; flows: FlowEdge[]; asof: { first: string; last: string }; source: string };

// Promoter shareholding — curated cited seed of NSE/BSE shareholding filings.
export type PromoterEdge = {
  holder: string;
  holder_name: string;
  symbol: string;
  company_name: string;
  stake_pct: number | null;
  as_of: string;
  source: string;
  citation: string;
};
export type PromoterHolder = {
  id: string;
  name: string;
  kind: string;
  breadth: number;
  symbols: string[];
  edges: PromoterEdge[];
};
export type PromoterGraph = {
  kind: 'promoter';
  nodes: { holders: PromoterHolder[]; companies: { id: string; company_name: string; kind: string }[] };
  edges: PromoterEdge[];
  asof: { first: string; last: string };
  source: string;
  disclaimer: string;
};

// Disclosed political funding via electoral bonds (donor side), ECI/SBI 2024.
export type PoliticalDonor = {
  id: string;
  name: string;
  kind: string;
  symbol: string | null;
  amount_cr: number | null;
  first_date: string;
  last_date: string;
  source: string;
  citation: string;
};
export type PoliticalGraph = {
  kind: 'political';
  nodes: { donors: PoliticalDonor[] };
  total_cr: number;
  count: number;
  asof: { first: string; last: string };
  source: string;
  disclaimer: string;
};

// Server-side alerts (owner-only).
export type Alert = {
  id: string;
  symbol: string;
  type: 'price_above' | 'price_below' | 'pct_above' | 'pct_below' | 'rsi_above' | 'rsi_below';
  value: number;
  note: string;
  active: boolean;
  created: number;
  triggered_at: number | null;
  last_value: number | null;
};

// Public-API keys (owner-only).
export type ApiKey = {
  id: string;
  label: string;
  created: number;
  last_used: number | null;
  calls: number;
  active: boolean;
};

async function delJson<T>(path: string): Promise<T> {
  const res = await fetch(API_BASE + path, { method: 'DELETE', credentials: 'include' });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error || 'HTTP ' + res.status);
  return data;
}

// ── user accounts (email + OTP) ──
export type MeResp = { user: { email: string } | null };
export type OtpRequestResp = { sent?: boolean; dev_code?: string; error?: string; detail?: string };
export type OtpVerifyResp = { user?: { email: string }; created?: boolean; error?: string; detail?: string };
export type UserDataResp = { v: unknown; ts: number };
export type UserPutResp = { stored: boolean; ts?: number; server_newer?: boolean; v?: unknown };

export const api = {
  authMe: () => getJson<MeResp>('/auth/me'),
  otpRequest: (email: string) => postJson<OtpRequestResp>('/auth/otp/request', { email }),
  otpVerify: (email: string, code: string, consent: boolean) =>
    postJson<OtpVerifyResp>('/auth/otp/verify', { email, code, consent }),
  userLogout: () => postJson<{ user: null }>('/auth/logout', {}),
  accountDelete: async (): Promise<{ deleted: boolean }> => {
    const res = await fetch(API_BASE + '/auth/account', { method: 'DELETE', credentials: 'include' });
    const d = (await res.json().catch(() => ({}))) as { deleted?: boolean; error?: string };
    if (!res.ok) throw new Error(d.error || 'HTTP ' + res.status);
    return { deleted: !!d.deleted };
  },
  userDataGet: (kind: string) => getJson<UserDataResp>('/user/data/' + encodeURIComponent(kind)),
  userDataPut: async (kind: string, v: unknown, ts: number): Promise<UserPutResp> => {
    const res = await fetch(API_BASE + '/user/data/' + encodeURIComponent(kind), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ v, ts }),
    });
    const d = (await res.json().catch(() => ({}))) as UserPutResp & { error?: string };
    if (!res.ok) throw new Error(d.error || 'HTTP ' + res.status);
    return d;
  },
  alertsList: () => getJson<{ alerts: Alert[] }>('/alerts'),
  alertsCreate: (symbol: string, type: Alert['type'], value: number, note = '') =>
    postJson<{ alert: Alert }>('/alerts', { symbol, type, value, note }),
  alertsDelete: (id: string) => delJson<{ deleted: boolean }>('/alerts/' + encodeURIComponent(id)),
  alertsToggle: (id: string, active: boolean) =>
    postJson<{ ok: boolean }>('/alerts/' + encodeURIComponent(id) + '/toggle', { active }),
  alertsCheck: () => postJson<{ checked: number; fired: Alert[] }>('/alerts/check', {}),
  apiKeysList: () => getJson<{ keys: ApiKey[] }>('/apikeys'),
  apiKeysIssue: (label: string) => postJson<{ key: string; record: ApiKey }>('/apikeys', { label }),
  apiKeysRevoke: (id: string) => delJson<{ revoked: boolean }>('/apikeys/' + encodeURIComponent(id)),
  entityGraph: () => getJson<EntityGraph>('/entity-graph', 30000),
  entityPositions: (entity: string) =>
    getJson<EntityView>('/entity-graph?entity=' + encodeURIComponent(entity), 30000),
  symbolFlows: (symbol: string) =>
    getJson<SymbolView>('/entity-graph?symbol=' + encodeURIComponent(symbol), 30000),
  promoterGraph: () => getJson<PromoterGraph>('/promoter-graph', 30000),
  politicalGraph: () => getJson<PoliticalGraph>('/political-graph', 30000),
  optionChain: (symbol: string, expiry?: string) =>
    getJson<OptionChain>(
      '/derivatives/option-chain?symbol=' + encodeURIComponent(symbol) +
        (expiry ? '&expiry=' + encodeURIComponent(expiry) : ''),
      30000,
    ),
  multibagger: (symbol: string) =>
    getJson<MultibaggerReport>('/multibagger?symbol=' + encodeURIComponent(symbol), 60000),
  report: (symbol: string) =>
    getJson<ReportResp>('/report?symbol=' + encodeURIComponent(symbol), 60000),
  timeframes: (symbol: string) =>
    getJson<TimeframesResp>('/timeframes?symbol=' + encodeURIComponent(symbol), 60000),
  checklist: (symbol: string) =>
    getJson<ChecklistResp>('/checklist?symbol=' + encodeURIComponent(symbol), 60000),
  screenerFinancials: (symbol: string) =>
    getJson<ScreenerFinancials>('/screener-financials?symbol=' + encodeURIComponent(symbol), 20000),
  strategyScores: (symbol: string) =>
    getJson<StrategyScoresResp>('/strategy-scores?symbol=' + encodeURIComponent(symbol), 60000),
  chartPatterns: (symbol: string, period = '2y') =>
    getJson<ChartPatternsResp>(
      `/chart-patterns?symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}`,
      45000,
    ),
  recommendation: (symbol: string, fund?: number | null, name?: string) =>
    getJson<Recommendation>(
      `/recommendation?symbol=${encodeURIComponent(symbol)}` +
        (fund != null && isFinite(fund) ? `&fund=${fund}` : '') +
        (name ? `&name=${encodeURIComponent(name)}` : ''),
      45000,
    ),
  swing: (symbol: string, name?: string) =>
    getJson<SwingRec>(
      `/swing?symbol=${encodeURIComponent(symbol)}` + (name ? `&name=${encodeURIComponent(name)}` : ''),
      45000,
    ),
  institutional: (symbol: string, name?: string) =>
    getJson<InstitutionalRec>(
      `/institutional?symbol=${encodeURIComponent(symbol)}` + (name ? `&name=${encodeURIComponent(name)}` : ''),
      45000,
    ),
  smc: (symbol: string, name?: string) =>
    getJson<SmcRec>(
      `/smc?symbol=${encodeURIComponent(symbol)}` + (name ? `&name=${encodeURIComponent(name)}` : ''),
      45000,
    ),
  momentumScreen: (refresh = false) =>
    getJson<MomentumScreenResp>('/momentum/screen' + (refresh ? '?refresh=1' : ''), 30000),
  mbScreen: (refresh = false) =>
    getJson<MbScreenResp>('/multibagger/screen' + (refresh ? '?refresh=1' : ''), 30000),
  patternsScreen: (index: string, refresh = false) =>
    getJson<PatternScreenResp>(
      `/patterns/screen?index=${encodeURIComponent(index)}` + (refresh ? '&refresh=1' : ''), 30000),
  sectors: (level: SectorLevel = 'macro', refresh = false) => {
    const qs = new URLSearchParams();
    if (level && level !== 'macro') qs.set('level', level);
    if (refresh) qs.set('refresh', '1');
    const q = qs.toString();
    return getJson<SectorsResp>('/sectors' + (q ? '?' + q : ''), 30000);
  },
  riskPortfolio: (holdings: RiskHolding[], conf = 0.95) =>
    postJson<RiskReport>('/risk/portfolio', { holdings, conf }),
  corpAnnouncements: (s: string) => getJson<{ items: Announcement[]; source: string }>('/corporate/announcements?symbol=' + encodeURIComponent(s)),
  corpActions: (s: string) => getJson<{ items: CorpAction[]; source: string }>('/corporate/actions?symbol=' + encodeURIComponent(s)),
  corpShareholding: (s: string) => getJson<{ latest: Shareholding | null; source: string }>('/corporate/shareholding?symbol=' + encodeURIComponent(s)),
  corpDeals: () => getJson<{ bulk: Deal[]; block: Deal[]; source: string }>('/corporate/deals'),
  authStatus: () => getJson<AuthStatus>('/auth/status'),
  // Dev broadcasts / announcements: public inbox + owner-only send.
  broadcasts: () => getJson<{ items: Broadcast[] }>('/broadcast'),
  broadcastSend: (title: string, body: string) =>
    postJson<{ ok: boolean; sent: number; configured?: boolean }>('/broadcast', { title, body }),
  authLogin: (password: string) => postJson<{ owner: boolean }>('/auth/login', { password }),
  authLogout: () => postJson<{ owner: boolean }>('/auth/logout', {}),
  brokerStatus: () => getJson<BrokerStatus>('/broker/status'),
  brokerLtp: (symbols: string[]) =>
    getJson<{ data: LtpResp }>('/broker/ltp?symbols=' + encodeURIComponent(symbols.join(','))),
  brokerHoldings: () => getJson<{ holdings: BrokerHolding[] }>('/broker/holdings'),
  indices: (category?: string) =>
    getJson<IndicesResp>('/indices' + (category ? '?category=' + encodeURIComponent(category) : '')),
  holidays: () => getJson<HolidaysResp>('/holidays'),
  ping: () => getJson<Ping>('/ping'),
  version: () => getJson<Version>('/version'),
  universe: () => getJson<UniverseResp>('/universe'),
  ltp: (symbols: string[]) =>
    getJson<LtpResp>('/ltp?symbols=' + encodeURIComponent(symbols.join(','))),
  fundamentalsBulk: (symbols: string[]) =>
    getJson<FundamentalsBulk>(
      '/fundamentals/bulk?symbols=' + encodeURIComponent(symbols.join(',')),
    ),
  history: (symbol: string, period = '5y', interval = '1d') =>
    getJson<HistoryResp>(
      `/history?symbol=${encodeURIComponent(symbol)}&interval=${interval}&period=${period}`,
      40000,
    ),
  fundamentals: (symbol: string) =>
    getJson<Fundamentals>('/fundamentals?symbol=' + encodeURIComponent(symbol)),
  graph: (symbol?: string, ai?: AiCreds) => fetchGraph(symbol, ai),
  indexConstituents: (name: string) =>
    getJson<IndexResp>('/index?name=' + encodeURIComponent(name)),
  // Server-computed breadth + top gainers/losers (resilient: NSE pChange, else a
  // Yahoo batch quote, else last-good). Keeps the dashboard populated even when
  // the NSE constituent feed falls back to the symbols-only CSV.
  movers: (index = 'NIFTY 50', n = 6) =>
    getJson<MoversResp>('/movers?index=' + encodeURIComponent(index) + '&n=' + n),
  // Landing-page windows: NSE public-issue calendar + traded G-Sec/SGB quotes.
  ipos: () => getJson<IpoResp>('/ipos'),
  gsec: () => getJson<GsecResp>('/gsec'),
  news: (force = false) =>
    getJson<NewsResp>('/news' + (force ? '?force=1' : '')),
  // /returns caps at 50 symbols/call; batch and merge.
  returns: async (symbols: string[]): Promise<ReturnsResp> => {
    const merged: ReturnsResp = {};
    for (let i = 0; i < symbols.length; i += 50) {
      const res = await getJson<ReturnsResp>(
        '/returns?symbols=' + encodeURIComponent(symbols.slice(i, i + 50).join(',')),
        60000,
      );
      Object.assign(merged, res);
    }
    return merged;
  },
  // Scans any number of symbols in small batches so results stream in instead
  // of blocking on one huge request (a cold 50-symbol scan can take a minute;
  // 12 at a time returns the first technicals within seconds). onBatch fires
  // after each batch with that batch's rows and overall progress.
  scan: async (
    symbols: string[],
    opts?: {
      batch?: number;
      onBatch?: (data: Record<string, ScanRow>, done: number, total: number) => void;
    },
  ): Promise<ScanResp> => {
    const size = opts?.batch ?? 12;
    const merged: Record<string, ScanRow> = {};
    let cached = 0;
    let computed = 0;
    for (let i = 0; i < symbols.length; i += size) {
      const slice = symbols.slice(i, i + size);
      try {
        const res = await scanBatch(slice);
        Object.assign(merged, res.data || {});
        cached += res.cached || 0;
        computed += res.computed || 0;
        opts?.onBatch?.(res.data || {}, Math.min(i + size, symbols.length), symbols.length);
      } catch {
        // One failed batch shouldn't kill the whole scan — report progress and move on.
        opts?.onBatch?.({}, Math.min(i + size, symbols.length), symbols.length);
      }
    }
    return { data: merged, count: Object.keys(merged).length, cached, computed };
  },
  btStrategies: () => getJson<BtStrategiesResp>('/backtest/strategies'),
  btRun: (cfg: BtConfig) => postJson<{ run_id: string }>('/backtest/run', cfg),
  btStatus: (id: string) =>
    getJson<BtSnapshot>('/backtest/status?id=' + encodeURIComponent(id), 40000),
  btLast: () => getJson<BtLastResp>('/backtest/last'),
};
