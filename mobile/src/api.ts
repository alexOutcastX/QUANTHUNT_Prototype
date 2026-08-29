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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { pooled, setStorage, swr } from './swr';

// swr.ts is deliberately free of React Native imports so its logic can be
// unit-tested in plain node; the app supplies the durable backend here.
setStorage(AsyncStorage);

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

// ── session transport ────────────────────────────────────────────────────────
// On the web the app is same-origin, so the server's httpOnly session cookies
// are used as-is — nothing is readable from JS, which is the safest option.
// The Capacitor shell calls the API cross-site from https://localhost, where
// the browser refuses to attach SameSite cookies, so there the same signed
// session value travels as a header the shell stores itself. Web never sends
// these headers and keeps cookie-only sessions.
export type SessionKind = 'member' | 'user' | 'owner';
const SESSION_HEADER: Record<SessionKind, string> = {
  member: 'X-TE-Member',
  user: 'X-TE-User',
  owner: 'X-TE-Owner',
};
const sessionTokens: Partial<Record<SessionKind, string>> = {};

/** Native shell only: remember (or clear) a session token for later requests. */
export function setSessionToken(kind: SessionKind, token: string | null): void {
  if (token) sessionTokens[kind] = token;
  else delete sessionTokens[kind];
}
/** True when this build needs header sessions (the Android WebView). */
export const usesHeaderSessions = inCapacitor;

function authHeaders(): Record<string, string> {
  if (!inCapacitor) return {};
  const h: Record<string, string> = {};
  (Object.keys(sessionTokens) as SessionKind[]).forEach((k) => {
    const t = sessionTokens[k];
    if (t) h[SESSION_HEADER[k]] = t;
  });
  return h;
}

async function getJson<T>(path: string, timeoutMs = 25000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // credentials: 'include' so the owner session cookie rides along (needed
    // for the broker endpoints, and cross-origin/native).
    const res = await fetch(API_BASE + path, {
      signal: ctrl.signal,
      credentials: 'include',
      headers: authHeaders(),
    });
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

// A cached GET. The key is the path, so every caller of the same endpoint
// shares one entry and one in-flight request. `force` (pull-to-refresh) skips
// the cache. Only for reads whose staleness is harmless for a few minutes —
// never for a quote the user is about to trade on.
function cachedGet<T>(path: string, ttlMs: number, force = false, timeoutMs = 25000): Promise<T> {
  return swr<T>(path, ttlMs, () => getJson<T>(path, timeoutMs), { force });
}

// How long each kind of read stays fresh before a background refresh. Tuned to
// how fast the underlying thing actually changes: an index's membership is
// stable for hours, a background sweep republishes every few hours, a news
// feed every few minutes.
const TTL = {
  universe: 30 * 60_000,
  index: 10 * 60_000,
  sectors: 30 * 60_000,
  indices: 60_000,
  news: 5 * 60_000,
  screen: 2 * 60_000,     // momentum / multibagger sweep snapshots
  slow: 10 * 60_000,      // cases, sector medians, holidays, IPOs, G-Sec
  ledger: 60_000,         // tradelog, penny screen
} as const;

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error || 'HTTP ' + res.status);
  return data;
}

export type Ping = { server: string; status: string; source?: string; version?: string };
export type Version = { version: string; commit: string };

export type UniverseSymbol = {
  symbol: string; name: string; exchange: string;
  // Previous settled close from the daily bhavcopy — present for every NSE
  // symbol, so any screen holding the master list can show a real price.
  price?: number | null; chg?: number | null; volume?: number | null;
};
export type UniverseResp = {
  ready: boolean;
  total: number;
  nse: number;
  bse: number;
  as_of?: string | null;
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
  // The trading date these numbers are FROM, taken off the price bar itself.
  // Over a weekend it is Friday, and the UI says so rather than calling a
  // Friday move "today".
  session?: string | null;
  source?: string;
  error?: string;
};
export type LtpResp = Record<string, Quote>;

export type FundamentalsBulk = {
  data: Record<string, Record<string, unknown>>;
  pending: string[];
  provider?: string;      // absent when a batched call merged several responses
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
  // Sequential quarter and EPS growth — from NSE quarterly filings.
  revenue_qoq_pct?: number | null;
  earnings_qoq_pct?: number | null;
  eps_growth_yoy_pct?: number | null;
  eps_ttm_growth_pct?: number | null;
  // Annual cash flow, in crore, from the company's own NSE filing.
  // fcf_cr predates the rest — it was seeded by the multibagger screen; it is
  // now also populated for every symbol by the exchange provider.
  fcf_cr?: number | null;
  ocf_cr?: number | null;
  capex_cr?: number | null;
  fcf_yield_pct?: number | null;
  cash_conversion_pct?: number | null;
  cashflow_year?: string | null;
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
  // Symbols the server hasn't computed yet. It queues them and answers from
  // cache immediately rather than holding the request open, so this is the
  // list to poll for — the same contract /fundamentals/bulk uses.
  pending?: string[];
  computed?: number;
  cached?: number;
  stale?: number;
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
  source?: string;
  // Where the PRICES came from, which is not the same question as where the
  // constituent list came from. 'nse' is live and outranks anything /scan
  // computes off daily bars; 'bhavcopy' is the previous settled close, shown
  // so the table is never blank — but it yields to the first technical row.
  quote_source?: 'nse' | 'bhavcopy' | 'mixed' | 'none';
  quote_date?: string | null;
  priced?: number;
  note?: string;
  error?: string;
};
export type MoversResp = {
  index: string;
  breadth: { up: number; down: number; flat: number; total: number; ratio: number } | null;
  gainers: IndexConstituent[];
  losers: IndexConstituent[];
  asof?: number;
  // The trading session this breadth and these movers belong to (YYYY-MM-DD).
  session?: string | null;
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
export type NewsItem = {
  title: string;
  link: string;
  source: string;
  ts?: number | null;
  sym?: string;
  /** Feed standfirst, plain text. Empty when the publisher ships none. */
  summary?: string;
};
export type NewsResp = { items: NewsItem[]; fetched?: number; cached?: boolean };

// Trade Scan: short-term pattern setups on the major indices, per timeframe.
export type TradeScanRow = {
  index: string; tf: string; interval: string;
  pattern: string; bias: 'bullish' | 'bearish' | 'neutral';
  status?: string | null; confidence: number; continuation?: number | null;
  expansion_pct?: number | null; active?: boolean;
  price: number; entry: number; target: number; stop: number; rr: number;
};
export type TradeScanResp = {
  status: string; refreshing?: boolean; results: TradeScanRow[];
  indices?: string[]; asof?: number;
};

// Stocks inside one heatmap sector bucket (most-traded first).
export type SectorMember = {
  symbol: string; name: string; exchange: string;
  price?: number | null; chg?: number | null; turnover?: number | null;
};
export type SectorMembersResp = {
  sector: string; level: string; parent: string; count: number;
  warming?: boolean; items: SectorMember[]; error?: string;
};

// The track record — every trade the engines recommended, marked to market on
// the server. Recorded when the call is published, so the history can't be
// curated after the fact. See tradelog.py.
export type TradeSource = 'reco' | 'momentum' | 'multibagger';
export type TradeStatus = 'open' | 'won' | 'lost' | 'closed';
export type LoggedTrade = {
  id: number;
  source: TradeSource;
  source_label: string;
  symbol: string;
  name?: string | null;
  side: 'long' | 'short';
  strategy?: string | null;
  entry: number;
  stop?: number | null;
  target?: number | null;
  exit?: number | null;
  last?: number | null;
  price?: number | null;
  status: TradeStatus;
  opened: number;                 // epoch seconds
  closed?: number | null;
  marked?: number | null;
  horizon_days: number;
  hold_days: number;
  pl_pct?: number | null;
  pl_amt?: number | null;
  rationale: string[];
  meta: Record<string, string | number | null>;
  // True when the trade came from the historical replay rather than a live
  // call. The two are never summed into one win rate without saying so.
  backfilled: boolean;
};
export type TradeLogSummary = {
  total: number; open: number; settled: number;
  won: number; lost: number; closed: number;
  wins: number; losses: number;
  win_rate?: number | null;
  avg_pl_pct?: number | null;
  total_pl_amt: number;
  open_pl_amt: number;
  open_avg_pl_pct?: number | null;
  avg_hold_days?: number | null;
  best?: { symbol: string; pl_pct: number | null } | null;
  worst?: { symbol: string; pl_pct: number | null } | null;
  notional: number;
};
export type TradeLogResp = {
  trades: LoggedTrade[];
  summary: TradeLogSummary;
  live_summary: TradeLogSummary;
  by_source: Partial<Record<TradeSource, number>>;
  by_origin: { live: number; backfilled: number };
  marked_at?: number | null;
  backfill?: BackfillProgress;
  rules: {
    notional: number;
    horizon_days: Record<string, number>;
    momentum_min_score: number;
    momentum_top: number;
    multibagger_top: number;
  };
};
export type BackfillProgress = {
  status: string; running: boolean; done: number; total: number;
  opened: number; settled: number; pct: number; symbol?: string;
  finished?: number; error?: string | null;
};

// Penny screen — low-priced scrips graded by tradeability and substance, not
// just listed by price. See penny_screen.py.
export type PennyRiskGrade = 'moderate' | 'elevated' | 'high' | 'extreme';
export type PennyLiquidity = 'tradeable' | 'thin' | 'illiquid' | 'unknown';
export type PennyRow = {
  symbol: string; name: string; exchange: string;
  price: number; chg?: number | null;
  turnover: number; turnover_cr: number;
  market_cap_cr?: number | null;
  eps?: number | null; pe?: number | null; pb?: number | null; roe?: number | null;
  debt_equity?: number | null; ocf_cr?: number | null;
  revenue_growth_pct?: number | null; sector?: string | null;
  risk_score: number; risk_grade: PennyRiskGrade;
  liquidity: PennyLiquidity; liquidity_note: string;
  flags: string[]; positives: string[];
  band?: string | null; has_fundamentals: boolean;
};
export type PennyBand = { key: string; label: string; lo: number; hi: number; note: string };
export type PennyResp = {
  band: string; band_label: string; band_note: string;
  rows: PennyRow[]; count: number; matches: number; in_band: number; truncated: boolean;
  grades: Partial<Record<PennyRiskGrade, number>>;
  liquidity_mix: Partial<Record<PennyLiquidity, number>>;
  with_fundamentals: number;
  bands: PennyBand[];
  thresholds: { tradeable: number; thin: number };
  universe: number; warming: boolean;
};

// Cases — TaurEye's own investment baskets. Built from the analyser's scored
// universe, struck once a year, managed by the engine in between (see cases.py).
export type CaseKind = 'multibagger' | 'sector' | 'cap' | 'strategy';
export type CaseSummary = {
  id: string; name: string; kind: CaseKind; theme?: string | null; blurb?: string | null;
  vintage: number; min_investment: number; count: number;
  return_pct?: number | null; cagr_pct?: number | null;
  held_since?: number | null; top: string[];
};
export type CaseLeg = {
  symbol: string; name?: string | null; weight: number;
  entry: number; entry_ts: number; price?: number | null; pl_pct?: number | null;
  shares: number; value: number; status: string;
  score?: number | null; sector?: string | null;
  alloc_shares?: number; alloc_value?: number; alloc_weight?: number;
};
export type CaseAction = {
  id: number; case_id: string; ts: number; action: 'add' | 'book' | 'exit' | 'rebalance';
  symbol?: string | null; price?: number | null; qty_pct?: number | null;
  pl_pct?: number | null; note?: string | null;
};
export type CaseDetail = {
  id: string; name: string; kind: CaseKind; theme?: string | null; blurb?: string | null;
  vintage: number; created: number; rebalanced: number; min_investment: number;
  constituents: CaseLeg[];
  reserve: { symbol: string; name?: string; score?: number | null; price?: number | null }[];
  return_pct?: number | null; cagr_pct?: number | null; held_since?: number | null;
  actions: CaseAction[];
  allocation?: { invested: number; cash: number; amount: number };
  rules: Record<string, number>;
};
export type CasesResp = {
  cases: CaseSummary[]; count: number; kinds: CaseKind[]; asof?: number;
  status?: string; progress?: { status: string; running: boolean; error?: string | null };
  rules: Record<string, number | string>;
};

// Scan up to 60 symbols per request; caller batches larger lists.
async function scanBatch(symbols: string[]): Promise<ScanResp> {
  return getJson<ScanResp>('/scan?symbols=' + encodeURIComponent(symbols.join(',')), 60000);
}

// How many batched requests may be in flight at once. Enough to hide
// round-trip latency on a mobile connection, small enough that one screen
// can't monopolise the VM's worker pool.
const SCAN_CONCURRENCY = 6;
// Symbols per /scan URL.
//
// This was 500, sized against nginx's request line WITH the 32k tuning
// drop-in applied. That drop-in is a separate PR and is not on the server, so
// the real limit is nginx's 8k default: 500 NSE symbols is a ~5.9k query
// string, and once the rest of the request line and the headers are added the
// whole thing is rejected with a 414 before Flask ever sees it. The client
// swallows the failure, so the screener sat at "technicals 0/1444" while the
// server's own health probe reported a working upstream and an empty queue —
// nothing was arriving to be queued.
//
// This is the SECOND time this bug has shipped: /fundamentals/bulk had it this
// morning and was fixed by batching at 150. Correctness must not depend on
// server tuning that may or may not be deployed, so the batch is now sized to
// fit comfortably inside the stock 8k limit — ~1.8k for 150 symbols — and the
// drop-in becomes headroom rather than a prerequisite.
const SCAN_BATCH = 150;
const BULK_CONCURRENCY = 4;

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
  // Trading date of the close this level and change are from.
  session?: string | null;
};
export type IndicesResp = {
  indices: IndexQuote[];
  asof: number;
  session?: string | null;
  cached?: boolean;
};
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
export type ValuationEstimate = {
  method: string;
  /** 'growth' prices the future (DCF, dividend); 'floor' assumes none (Graham, EPV). */
  kind: 'growth' | 'floor';
  value: number | null;
  note: string;
  inputs: Record<string, number | string | null>;
};
export type Valuation = {
  price: number | null;
  multiples: {
    pe: number | null; pb: number | null; ev_cr: number | null;
    ev_ebitda: number | null; ev_sales: number | null;
    earnings_yield_pct: number | null; fcf_yield_pct: number | null;
    dividend_yield_pct: number | null; peg: number | null; bvps: number | null;
  };
  growth: { used_pct: number | null; basis: string };
  estimates: ValuationEstimate[];
  fair_value: {
    low: number | null; mid: number | null; high: number | null;
    methods: number; upside_pct: number | null;
    floor: number | null; floor_methods: number;
  } | null;
  priced_in: { implied_growth_pct: number | null; assumed_growth_pct: number | null; note: string };
  peers: {
    sector: string | null; n: number | null;
    rows: { label: string; value: number | null; sector: number | null; diff_pct: number | null; read: string }[];
  } | null;
  verdict: 'undervalued' | 'fairly valued' | 'expensive' | 'unrated';
  reasons: string[];
  assumptions: { discount_rate_pct: number; terminal_growth_pct: number; horizon_years: number; growth_cap_pct: number };
  caveats: string[];
};

export type ReportResp = {
  valuation?: Valuation | null;
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
  // MACD + moving-average ladder — what the configurable MACD strategy
  // filters on. dN is the % distance from that SMA (negative = below it).
  macd?: number | null;
  macd_prev?: number | null;
  macd_bull_cross?: boolean | null;
  macd_bear_cross?: boolean | null;
  d20?: number | null;
  d50?: number | null;
  d200?: number | null;
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
export type StrategyHit = {
  key: string;
  label: string;
  score: number;
  note: string;
  /** Bar window this model spans (epoch secs) — the chart clips to it (/smc only). */
  focus?: { from: number; to: number };
};

// ── ICT / SMC chart geometry (from /smc) ─────────────────────────────────────
// A price band over a bar span. `t1: null` with `extend` runs to the right edge
// (a level still in play); `lo === hi` is a line, not a box. `owner` is the
// model key that produced it, or 'context' for the dealing range / OTE /
// volume imbalances / order blocks, which apply to every model.
export type SmcZone = {
  owner: string;
  kind: 'liquidity' | 'sweep' | 'fvg' | 'vi' | 'ob' | 'breaker' | 'structure'
      | 'displace' | 'range' | 'equilibrium' | 'premium' | 'discount' | 'ote'
      | 'divergence';
  label: string;
  bias: 'bullish' | 'bearish' | 'neutral';
  t0: number;
  t1: number | null;
  lo: number | null;
  hi: number | null;
  extend?: boolean;
  /** FVG only: 0 = untouched, 1 = fully rebalanced. */
  mitigated?: number;
  note?: string;
};

export type SmcLevel = { kind: string; label: string; price: number };
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
  /** Drawable ICT/SMC geometry: FVGs, liquidity, order blocks, the dealing range. */
  zones?: SmcZone[];
  /** Entry / stop / TP1 / TP2 as horizontal lines. */
  levels?: SmcLevel[];
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
  // MACD + the rest of the moving-average ladder (the radar forwarded only
  // d200 before, so a MACD/DMA screen had nothing to filter on).
  macd?: number | null;
  macd_bull_cross?: boolean | null;
  macd_bear_cross?: boolean | null;
  d20?: number | null;
  d50?: number | null;
  d150?: number | null;
  golden_cross?: boolean | null;
  death_cross?: boolean | null;
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
export type FundWarm = {
  running: boolean;
  cancel: boolean;
  total: number;
  done: number;
  ok: number;
  failed: number;
  skipped: number;
  started: number;
  updated: number;
  finished: number;
  universe: string;
  last_error: string;
  rate_per_min: number;
  eta_sec: number | null;
  elapsed_sec: number;
  pct: number;
  cache_size: number;
  cache_fresh: number;
  inflight: number;
  schema: string;
  workers: number;
};

export type ApiKey = {
  id: string;
  label: string;
  created: number;
  last_used: number | null;
  calls: number;
  active: boolean;
};

async function delJson<T>(path: string): Promise<T> {
  const res = await fetch(API_BASE + path, {
    method: 'DELETE',
    credentials: 'include',
    headers: authHeaders(),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error || 'HTTP ' + res.status);
  return data;
}

// ── user accounts (email + OTP) ──
export type MeResp = { user: { email: string } | null };
export type OtpRequestResp = { sent?: boolean; dev_code?: string; error?: string; detail?: string };
export type OtpVerifyResp = { user?: { email: string }; created?: boolean; token?: string; error?: string; detail?: string };
export type UserDataResp = { v: unknown; ts: number };
export type UserPutResp = { stored: boolean; ts?: number; server_newer?: boolean; v?: unknown };

// ── membership gate (username/password + plan) ──
export type Member = {
  username: string;
  uname: string;
  plan: string;
  features: string[];
  // Owner-flagged members hold owner rights (broker, alerts, developer keys)
  // without a separate passcode — one sign-in covers the whole app.
  owner?: boolean;
};
export type MemberResp = { member: Member | null; token?: string; error?: string; detail?: string };

// ── monetisation (preview-gated) ────────────────────────────────────────────
// Every endpoint below 404s on taureye.com and serves on 161.118.174.177 —
// the server decides from the Host header, so the client just asks /preview
// once and hides the nav entries when it is off.
export type PreviewResp = { preview: boolean; host: string; reason: string };

export type DailyStatus = {
  claimable: boolean;
  claimed_today: boolean;
  trading_day: boolean;
  day: string;
  streak: number;
  credits: number;
  next_milestone: number | null;
  next_milestone_bonus: number | null;
  milestones: Record<string, number>;
};

export type EarnWay = {
  key: string; label: string; credits: number; available: boolean; detail: string;
};

export type CreditPrice = { action: string; label: string; credits: number };

export type EarnResp = {
  earn: EarnWay[];
  prices: CreditPrice[];
  daily: DailyStatus;
  balance: number;
};

export type DailyClaim = DailyStatus & {
  ok: boolean;
  error?: string;
  awarded?: number;
  streak_bonus?: number;
  balance?: number;
};

export type SpendResp = {
  ok?: boolean; spent?: number; balance?: number; action?: string;
  error?: string; needed?: number; detail?: string;
};

export type GiftQuote = {
  balance: number; giftable: number; sent_today: number;
  daily_cap: number; remaining_today: number; minimum: number;
};

export type GiftResp = {
  ok?: boolean; amount?: number; to?: string; balance?: number;
  error?: string; detail?: string;
};

export type WalletResp = {
  account: string;
  balances: { credits: number; INR: number };
  history: { id: number; currency: string; amount: number; reason: string; ts: number }[];
};

export type ReferralResp = {
  code: string;
  count: number;
  credits_earned: number;
  referrals: { account: string; ts: number }[];
  referred_by: string;
  reward_referrer: number;
  reward_referee: number;
};

export type Plan = {
  key: string; name: string; price_paise: number; price_inr: number;
  period: string; credits_per_period: number; blurb: string; features: string[];
};
export type Subscription = {
  plan: string; status: string; source: string;
  provider: string | null; renews_at: number | null; expired: boolean;
};
export type PlansResp = {
  plans: Plan[]; current: Subscription;
  provider: string; provider_configured: boolean;
};
export type CheckoutResp = {
  intent_id: number; plan: string; amount_inr: number; provider: string;
  provider_configured: boolean; status: string; checkout_url: string | null; message: string;
};
export type PaywallResp = {
  feature: string; allowed: boolean; required_plan: string;
  plan: string; price_inr: number; signed_in: boolean;
};
export type PublicIntegrations = {
  google: { enabled: boolean; client_id: string; reason: string };
  supabase: { enabled: boolean; url: string; anon_key: string; reason: string };
  payments: { provider: string; enabled: boolean };
};
export type AnalyticsSummary = {
  days: number; events: number; people: number; retention_days: number;
  top_events: { event: string; n: number; people: number }[];
  daily: { day: string; events: number; people: number }[];
  by_plan: { plan: string; people: number; events: number }[];
};

export const api = {
  // monetisation — preview-gated; these throw 'not-found' on the live domain
  preview: () => getJson<PreviewResp>('/preview'),
  wallet: () => getJson<WalletResp>('/wallet'),
  walletEarn: () => getJson<EarnResp>('/wallet/earn'),
  giftQuote: () => getJson<GiftQuote>('/wallet/gift'),
  sendGift: (to: string, amount: number, message: string) =>
    postJson<GiftResp>('/wallet/gift', { to, amount, message }),
  walletHistory: (limit = 50) => getJson<WalletResp>(`/wallet/history?limit=${limit}`),
  walletDaily: () => postJson<DailyClaim>('/wallet/daily', {}),
  /** Charge for a metered action. `ref` must be stable for the same piece of
      work, so a retry after a dropped connection cannot double-charge. */
  walletSpend: (action: string, ref?: string) =>
    postJson<SpendResp>('/wallet/spend', { action, ref }),
  referral: () => getJson<ReferralResp>('/referral'),
  referralClaim: (code: string) =>
    postJson<{ ok: boolean; referrer: string; referrer_credits: number; referee_credits: number }>(
      '/referral/claim', { code }),
  billingPlans: () => getJson<PlansResp>('/billing/plans'),
  billingCheckout: (plan: string) => postJson<CheckoutResp>('/billing/checkout', { plan }),
  billingSubscription: () => getJson<Subscription>('/billing/subscription'),
  paywall: (feature: string) => getJson<PaywallResp>('/paywall/' + encodeURIComponent(feature)),
  integrationsPublic: () => getJson<PublicIntegrations>('/integrations/public'),
  analyticsSummary: (days = 30) => getJson<AnalyticsSummary>('/analytics/summary?days=' + days),
  // Fire-and-forget: analytics must never break the screen it rides along on.
  trackEvent: (event: string, props?: Record<string, unknown>) =>
    postJson<{ ok: boolean }>('/analytics/track', { event, props }).catch(() => ({ ok: false })),

  memberLogin: (username: string, password: string) =>
    postJson<MemberResp>('/auth/member/login', { username, password }),
  memberMe: () => getJson<MemberResp>('/auth/member'),
  memberLogout: () => postJson<MemberResp>('/auth/member/logout', {}),
  authMe: () => getJson<MeResp>('/auth/me'),
  otpRequest: (email: string) => postJson<OtpRequestResp>('/auth/otp/request', { email }),
  otpVerify: (email: string, code: string, consent: boolean) =>
    postJson<OtpVerifyResp>('/auth/otp/verify', { email, code, consent }),
  userLogout: () => postJson<{ user: null }>('/auth/logout', {}),
  accountDelete: async (): Promise<{ deleted: boolean }> => {
    const res = await fetch(API_BASE + '/auth/account', {
      method: 'DELETE',
      credentials: 'include',
      headers: authHeaders(),
    });
    const d = (await res.json().catch(() => ({}))) as { deleted?: boolean; error?: string };
    if (!res.ok) throw new Error(d.error || 'HTTP ' + res.status);
    return { deleted: !!d.deleted };
  },
  userDataGet: (kind: string) => getJson<UserDataResp>('/user/data/' + encodeURIComponent(kind)),
  userDataPut: async (kind: string, v: unknown, ts: number): Promise<UserPutResp> => {
    const res = await fetch(API_BASE + '/user/data/' + encodeURIComponent(kind), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
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
  sectorMedians: () =>
    cachedGet<{ sectors: Record<string, Record<string, number | null>>; count: number; min_sample: number }>(
      '/sector-medians', TTL.slow, false, 30000),
  tradeLog: (
    source?: TradeSource | 'all',
    status?: TradeStatus | 'all',
    origin?: 'live' | 'backfilled' | 'all',
  ) => {
    const q: string[] = [];
    if (source && source !== 'all') q.push('source=' + source);
    if (status && status !== 'all') q.push('status=' + status);
    if (origin && origin !== 'all') q.push('origin=' + origin);
    return getJson<TradeLogResp>('/tradelog' + (q.length ? '?' + q.join('&') : ''), 30000);
  },
  tradeLogReconcile: () =>
    postJson<{ started: boolean; open: number }>('/tradelog/reconcile', {}),
  tradeLogBackfill: (force = false) =>
    postJson<{ started: boolean; progress: BackfillProgress }>('/tradelog/backfill', { force }),
  pennyScreen: (opts?: { band?: string; minTurnover?: number; maxRisk?: string; limit?: number }) => {
    const q: string[] = [];
    if (opts?.band) q.push('band=' + encodeURIComponent(opts.band));
    if (opts?.minTurnover) q.push('min_turnover=' + Math.round(opts.minTurnover));
    if (opts?.maxRisk) q.push('max_risk=' + encodeURIComponent(opts.maxRisk));
    if (opts?.limit) q.push('limit=' + opts.limit);
    return getJson<PennyResp>('/penny/screen' + (q.length ? '?' + q.join('&') : ''), 40000);
  },
  cases: (refresh = false) =>
    cachedGet<CasesResp>('/cases' + (refresh ? '?refresh=1' : ''), TTL.slow, refresh, 30000),
  caseDetail: (id: string, amount?: number) =>
    getJson<CaseDetail>(
      '/cases/' + encodeURIComponent(id) + (amount ? '?amount=' + Math.round(amount) : ''),
      30000,
    ),
  fundWarmStatus: () => getJson<FundWarm>('/fundamentals/warm'),
  fundWarmStart: (scope: string) =>
    postJson<{ started: boolean; total?: number; universe?: string; reason?: string; progress?: FundWarm }>(
      '/fundamentals/warm', { scope }),
  fundWarmStop: () => postJson<{ stopping: boolean; progress?: FundWarm }>('/fundamentals/warm/stop', {}),
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
    cachedGet<MomentumScreenResp>(
      '/momentum/screen' + (refresh ? '?refresh=1' : ''), TTL.screen, refresh, 30000),
  mbScreen: (refresh = false) =>
    cachedGet<MbScreenResp>(
      '/multibagger/screen' + (refresh ? '?refresh=1' : ''), TTL.screen, refresh, 30000),
  patternsScreen: (index: string, refresh = false) =>
    cachedGet<PatternScreenResp>(
      `/patterns/screen?index=${encodeURIComponent(index)}` + (refresh ? '&refresh=1' : ''),
      TTL.screen, refresh, 30000),
  sectors: (level: SectorLevel = 'macro', refresh = false) => {
    const qs = new URLSearchParams();
    if (level && level !== 'macro') qs.set('level', level);
    if (refresh) qs.set('refresh', '1');
    const q = qs.toString();
    return cachedGet<SectorsResp>('/sectors' + (q ? '?' + q : ''), TTL.sectors, refresh, 30000);
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
  authLogin: (password: string) =>
    postJson<{ owner: boolean; token?: string }>('/auth/login', { password }),
  authLogout: () => postJson<{ owner: boolean }>('/auth/logout', {}),
  brokerStatus: () => getJson<BrokerStatus>('/broker/status'),
  brokerLtp: (symbols: string[]) =>
    getJson<{ data: LtpResp }>('/broker/ltp?symbols=' + encodeURIComponent(symbols.join(','))),
  brokerHoldings: () => getJson<{ holdings: BrokerHolding[] }>('/broker/holdings'),
  indices: (category?: string, force = false) =>
    cachedGet<IndicesResp>(
      '/indices' + (category ? '?category=' + encodeURIComponent(category) : ''),
      TTL.indices, force),
  holidays: () => cachedGet<HolidaysResp>('/holidays', TTL.slow),
  ping: () => getJson<Ping>('/ping'),
  version: () => getJson<Version>('/version'),
  universe: (force = false) => cachedGet<UniverseResp>('/universe', TTL.universe, force),
  ltp: (symbols: string[]) =>
    getJson<LtpResp>('/ltp?symbols=' + encodeURIComponent(symbols.join(','))),
  // Batched: every symbol used to go into ONE query string, so a wide universe
  // built a 13 KB request line and nginx rejected it (414) before Flask ever
  // saw it — the screener then showed "0 with financials" for the whole list.
  // 150 symbols keeps the URL near 1.4 KB, well inside any proxy's header
  // buffer. Same shape as scan()/returns(), which already batch.
  fundamentalsBulk: async (symbols: string[]): Promise<FundamentalsBulk> => {
    const merged: FundamentalsBulk = { data: {}, pending: [], cached: 0, total: 0 };
    let failed = 0;
    const slices: string[][] = [];
    for (let i = 0; i < symbols.length; i += 150) slices.push(symbols.slice(i, i + 150));

    await pooled(
      slices.map((slice) => async () => {
        try {
          const res = await getJson<FundamentalsBulk>(
            '/fundamentals/bulk?symbols=' + encodeURIComponent(slice.join(',')),
          );
          Object.assign(merged.data, res.data || {});
          merged.pending.push(...(res.pending || []));
          merged.cached += res.cached || 0;
          merged.total += res.total || slice.length;
          if (res.provider) merged.provider = res.provider;
        } catch {
          // One bad batch shouldn't lose the rest — treat its symbols as still
          // pending so the caller retries them rather than marking them absent.
          merged.pending.push(...slice);
          merged.total += slice.length;
          failed += 1;
        }
      }),
      BULK_CONCURRENCY,
    );
    // Every batch failing is a real outage, not "this data doesn't exist" —
    // let the caller show an error instead of silently blanking the column.
    if (failed && failed === slices.length) {
      throw new Error('Could not load company financials');
    }
    return merged;
  },
  history: (symbol: string, period = '5y', interval = '1d') =>
    getJson<HistoryResp>(
      `/history?symbol=${encodeURIComponent(symbol)}&interval=${interval}&period=${period}`,
      40000,
    ),
  fundamentals: (symbol: string) =>
    getJson<Fundamentals>('/fundamentals?symbol=' + encodeURIComponent(symbol)),
  graph: (symbol?: string, ai?: AiCreds) => fetchGraph(symbol, ai),
  indexConstituents: (name: string, force = false) =>
    cachedGet<IndexResp>('/index?name=' + encodeURIComponent(name), TTL.index, force),
  // Server-computed breadth + top gainers/losers (resilient: NSE pChange, else a
  // Yahoo batch quote, else last-good). Keeps the dashboard populated even when
  // the NSE constituent feed falls back to the symbols-only CSV.
  movers: (index = 'NIFTY 50', n = 6) =>
    getJson<MoversResp>('/movers?index=' + encodeURIComponent(index) + '&n=' + n),
  // Landing-page windows: NSE public-issue calendar + traded G-Sec/SGB quotes.
  ipos: () => cachedGet<IpoResp>('/ipos', TTL.slow),
  gsec: () => cachedGet<GsecResp>('/gsec', TTL.slow),
  news: (force = false) =>
    cachedGet<NewsResp>('/news' + (force ? '?force=1' : ''), TTL.news, force),
  tradeScan: (refresh = false) =>
    getJson<TradeScanResp>('/patterns/trade-scan' + (refresh ? '?refresh=1' : ''), 30000),
  sectorMembers: (sector: string, level = 'macro') =>
    getJson<SectorMembersResp>(
      '/sectors/members?sector=' + encodeURIComponent(sector) + '&level=' + encodeURIComponent(level),
      30000,
    ),
  // /returns caps at 50 symbols/call; batch and merge.
  returns: async (symbols: string[]): Promise<ReturnsResp> => {
    const merged: ReturnsResp = {};
    const slices: string[][] = [];
    for (let i = 0; i < symbols.length; i += 50) slices.push(symbols.slice(i, i + 50));
    await pooled(
      slices.map((slice) => async () => {
        try {
          Object.assign(
            merged,
            await getJson<ReturnsResp>(
              '/returns?symbols=' + encodeURIComponent(slice.join(',')),
              60000,
            ),
          );
        } catch {
          /* a failed slice leaves those symbols absent rather than failing all */
        }
      }),
      BULK_CONCURRENCY,
    );
    return merged;
  },
  // Scans any number of symbols. The server answers from cache without
  // blocking and names what it is still computing, so the batches here exist
  // to keep each URL under nginx's request-line limit — not to hide latency.
  // They are correspondingly large: 1447 symbols is 3 requests, not 121.
  //
  // `poll` re-asks for whatever came back pending until it drains or the
  // budget runs out, which is what actually fills the table. onBatch fires
  // with each batch's rows and overall progress.
  scan: async (
    symbols: string[],
    opts?: {
      batch?: number;
      // Lower it for background work so a bulk sweep can't crowd out the
      // fetch for the rows currently on screen.
      concurrency?: number;
      // Keep re-asking for pending symbols. Off for one-shot callers.
      poll?: boolean;
      pollMs?: number;
      pollRounds?: number;
      onBatch?: (data: Record<string, ScanRow>, done: number, total: number) => void;
    },
  ): Promise<ScanResp> => {
    const size = opts?.batch ?? SCAN_BATCH;
    const merged: Record<string, ScanRow> = {};
    let cached = 0;
    let computed = 0;
    let seen = 0;

    // One pass over a symbol list; returns whatever is still pending.
    const sweep = async (syms: string[], report: boolean): Promise<string[]> => {
      const slices: string[][] = [];
      for (let i = 0; i < syms.length; i += size) slices.push(syms.slice(i, i + size));
      const pending: string[] = [];
      await pooled(
        slices.map((slice) => async () => {
          try {
            const res = await scanBatch(slice);
            Object.assign(merged, res.data || {});
            cached += res.cached || 0;
            computed += res.computed || 0;
            pending.push(...(res.pending || []));
            if (report) {
              seen += slice.length;
              opts?.onBatch?.(res.data || {}, Math.min(seen, symbols.length), symbols.length);
            } else if (Object.keys(res.data || {}).length) {
              opts?.onBatch?.(res.data || {}, seen, symbols.length);
            }
          } catch {
            // One failed batch shouldn't kill the whole scan — report and move on.
            if (report) {
              seen += slice.length;
              opts?.onBatch?.({}, Math.min(seen, symbols.length), symbols.length);
            }
          }
        }),
        opts?.concurrency ?? SCAN_CONCURRENCY,
      );
      return pending;
    };

    let pending = await sweep(symbols, true);

    if (opts?.poll !== false) {
      // Collect what the server is computing behind the first answer. Bounded:
      // a symbol the upstream never answers for must not poll forever.
      // Scaled to the set: the server computes ~4 symbols a second through
      // its upstream gate, so a genuinely cold universe needs minutes of
      // polling. Bounded so a dead upstream can't poll forever.
      const rounds = opts?.pollRounds ?? Math.min(120, 10 + Math.ceil(symbols.length / 20));
      const gap = opts?.pollMs ?? 2500;
      for (let r = 0; r < rounds && pending.length; r++) {
        await new Promise((res) => setTimeout(res, gap));
        const before = pending.length;
        pending = (await sweep(pending, false)).filter((s) => !merged[s]);
        // No progress at all this round and nothing left running — give up
        // rather than spin out the remaining rounds against a dead upstream.
        if (pending.length >= before && !Object.keys(merged).length) break;
      }
    }

    return {
      data: merged,
      count: Object.keys(merged).length,
      pending,
      cached,
      computed,
    };
  },
  btStrategies: () => getJson<BtStrategiesResp>('/backtest/strategies'),
  btRun: (cfg: BtConfig) => postJson<{ run_id: string }>('/backtest/run', cfg),
  btStatus: (id: string) =>
    getJson<BtSnapshot>('/backtest/status?id=' + encodeURIComponent(id), 40000),
  btLast: () => getJson<BtLastResp>('/backtest/last'),
};
