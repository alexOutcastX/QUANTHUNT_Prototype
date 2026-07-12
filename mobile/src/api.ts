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

export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE ??
  (Platform.OS === 'web' ? '' : 'http://161.118.174.177');

async function getJson<T>(path: string, timeoutMs = 25000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(API_BASE + path, { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
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
async function fetchGraph(symbol?: string): Promise<GraphResp> {
  const path = '/graph' + (symbol ? '?symbol=' + encodeURIComponent(symbol) : '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch(API_BASE + path, { signal: ctrl.signal });
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
export type IndexQuote = { key: string; name: string; level: number; chg: number; y1: number };
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

export const api = {
  brokerStatus: () => getJson<BrokerStatus>('/broker/status'),
  brokerHoldings: () => getJson<{ holdings: BrokerHolding[] }>('/broker/holdings'),
  indices: () => getJson<IndicesResp>('/indices'),
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
  graph: (symbol?: string) => fetchGraph(symbol),
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
