// API client for the TaurEye / QuantHunt Flask backend.
//
// Base URL defaults to the Oracle VM. Override at build/run time with
// EXPO_PUBLIC_API_BASE (e.g. your https domain once certbot is set up).
//
// NOTE: iOS ATS and Android block cleartext http in release builds. For
// production point this at an https URL. In Expo Go dev, http works.
export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE || 'http://161.118.174.177';

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

export const api = {
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
  indexConstituents: (name: string) =>
    getJson<IndexResp>('/index?name=' + encodeURIComponent(name)),
  returns: (symbols: string[]) =>
    getJson<ReturnsResp>('/returns?symbols=' + encodeURIComponent(symbols.join(',')), 60000),
  // Scans any number of symbols by batching into 60-symbol requests and merging.
  scan: async (symbols: string[]): Promise<ScanResp> => {
    const merged: Record<string, ScanRow> = {};
    let cached = 0;
    let computed = 0;
    for (let i = 0; i < symbols.length; i += 60) {
      const res = await scanBatch(symbols.slice(i, i + 60));
      Object.assign(merged, res.data || {});
      cached += res.cached || 0;
      computed += res.computed || 0;
    }
    return { data: merged, count: Object.keys(merged).length, cached, computed };
  },
};
