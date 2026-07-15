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

export type ReturnsRow = { ret1y?: number | null; ret3y?: number | null; ret5y?: number | null };
export type ReturnsResp = Record<string, ReturnsRow>;

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

export const api = {
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
  optionChain: (symbol: string, expiry?: string) =>
    getJson<OptionChain>(
      '/derivatives/option-chain?symbol=' + encodeURIComponent(symbol) +
        (expiry ? '&expiry=' + encodeURIComponent(expiry) : ''),
      30000,
    ),
  multibagger: (symbol: string) =>
    getJson<MultibaggerReport>('/multibagger?symbol=' + encodeURIComponent(symbol), 60000),
  chartPatterns: (symbol: string, period = '2y') =>
    getJson<ChartPatternsResp>(
      `/chart-patterns?symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}`,
      45000,
    ),
  momentumScreen: (refresh = false) =>
    getJson<MomentumScreenResp>('/momentum/screen' + (refresh ? '?refresh=1' : ''), 30000),
  mbScreen: (refresh = false) =>
    getJson<MbScreenResp>('/multibagger/screen' + (refresh ? '?refresh=1' : ''), 30000),
  riskPortfolio: (holdings: RiskHolding[], conf = 0.95) =>
    postJson<RiskReport>('/risk/portfolio', { holdings, conf }),
  corpAnnouncements: (s: string) => getJson<{ items: Announcement[]; source: string }>('/corporate/announcements?symbol=' + encodeURIComponent(s)),
  corpActions: (s: string) => getJson<{ items: CorpAction[]; source: string }>('/corporate/actions?symbol=' + encodeURIComponent(s)),
  corpShareholding: (s: string) => getJson<{ latest: Shareholding | null; source: string }>('/corporate/shareholding?symbol=' + encodeURIComponent(s)),
  corpDeals: () => getJson<{ bulk: Deal[]; block: Deal[]; source: string }>('/corporate/deals'),
  authStatus: () => getJson<AuthStatus>('/auth/status'),
  authLogin: (password: string) => postJson<{ owner: boolean }>('/auth/login', { password }),
  authLogout: () => postJson<{ owner: boolean }>('/auth/logout', {}),
  brokerStatus: () => getJson<BrokerStatus>('/broker/status'),
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
};
