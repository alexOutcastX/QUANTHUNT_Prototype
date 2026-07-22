// Ticker configuration — what the strip shows, and how it moves.
//
// Stored in the synced prefs document (taureye.prefs.v1 → server kind
// prefs_v1), so a signed-in user's ticker follows them across devices.
// Static mode renders a fixed, non-moving row and therefore hard-caps the
// instrument count; scrolling mode allows a longer list.
import AsyncStorage from '@react-native-async-storage/async-storage';

export type TickerKind = 'index' | 'global' | 'currency' | 'commodity' | 'stock';
export type TickerItem = { kind: TickerKind; key: string; label: string };
export type TickerMode = 'scroll' | 'static';
export type TickerConfig = { mode: TickerMode; items: TickerItem[] };

export const STATIC_MAX = 6;   // fits one 1280px row without truncation
export const SCROLL_MAX = 30;

const PREFS_KEY = 'taureye.prefs.v1';

// Default: the domestic index sweep the ticker always showed.
export const DEFAULT_TICKER: TickerConfig = {
  mode: 'scroll',
  items: [
    { kind: 'index', key: 'NIFTY50', label: 'NIFTY 50' },
    { kind: 'index', key: 'SENSEX', label: 'BSE SENSEX' },
    { kind: 'index', key: 'BANKNIFTY', label: 'NIFTY Bank' },
    { kind: 'index', key: 'NIFTYIT', label: 'NIFTY IT' },
    { kind: 'index', key: 'NIFTYAUTO', label: 'NIFTY Auto' },
    { kind: 'index', key: 'NIFTYPHARMA', label: 'NIFTY Pharma' },
    { kind: 'index', key: 'NIFTYFMCG', label: 'NIFTY FMCG' },
    { kind: 'index', key: 'NIFTYMETAL', label: 'NIFTY Metal' },
    { kind: 'index', key: 'NIFTYENERGY', label: 'NIFTY Energy' },
    { kind: 'index', key: 'NIFTYREALTY', label: 'NIFTY Realty' },
    { kind: 'index', key: 'NIFTYMIDCAP', label: 'NIFTY Midcap 100' },
    { kind: 'currency', key: 'USDINR', label: 'USD/INR' },
  ],
};

let config: TickerConfig | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* ignore */
    }
  });
}

export function subscribeTicker(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function maxItems(mode: TickerMode): number {
  return mode === 'static' ? STATIC_MAX : SCROLL_MAX;
}

export async function loadTickerConfig(): Promise<TickerConfig> {
  if (config) return config;
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    const prefs = raw ? (JSON.parse(raw) as { ticker?: TickerConfig }) : {};
    const t = prefs.ticker;
    if (t && Array.isArray(t.items) && (t.mode === 'scroll' || t.mode === 'static')) {
      config = { mode: t.mode, items: t.items.slice(0, maxItems(t.mode)) };
      return config;
    }
  } catch {
    /* fall through to default */
  }
  config = DEFAULT_TICKER;
  return config;
}

export async function saveTickerConfig(next: TickerConfig): Promise<void> {
  config = { mode: next.mode, items: next.items.slice(0, maxItems(next.mode)) };
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    const prefs = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    prefs.ticker = config;
    // The session sync wrapper mirrors this write to the account (prefs_v1).
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* config still applied in-memory */
  }
  emit();
}

// The pickable catalogue (index/global/currency/commodity map straight onto
// /indices categories; stocks are added by symbol search).
export const CATALOGUE: { kind: TickerKind; title: string; options: { key: string; label: string }[] }[] = [
  {
    kind: 'index',
    title: 'Indian indices',
    options: DEFAULT_TICKER.items.filter((i) => i.kind === 'index').map(({ key, label }) => ({ key, label }))
      .concat([{ key: 'NIFTYNEXT50', label: 'NIFTY Next 50' }]),
  },
  {
    kind: 'global',
    title: 'Global indices',
    options: [
      { key: 'SP500', label: 'S&P 500' },
      { key: 'DJIA', label: 'Dow Jones' },
      { key: 'NASDAQ', label: 'Nasdaq' },
      { key: 'FTSE100', label: 'FTSE 100' },
      { key: 'DAX', label: 'DAX' },
      { key: 'CAC40', label: 'CAC 40' },
      { key: 'NIKKEI225', label: 'Nikkei 225' },
      { key: 'HANGSENG', label: 'Hang Seng' },
      { key: 'SHANGHAI', label: 'Shanghai' },
      { key: 'STOXX50E', label: 'Euro Stoxx 50' },
    ],
  },
  {
    kind: 'currency',
    title: 'Currencies',
    options: [
      { key: 'USDINR', label: 'USD/INR' },
      { key: 'EURINR', label: 'EUR/INR' },
      { key: 'GBPINR', label: 'GBP/INR' },
      { key: 'JPYINR', label: 'JPY/INR' },
      { key: 'DXY', label: 'Dollar Index' },
      { key: 'BTCUSD', label: 'Bitcoin' },
    ],
  },
  {
    kind: 'commodity',
    title: 'Commodities',
    options: [
      { key: 'GOLD', label: 'Gold' },
      { key: 'SILVER', label: 'Silver' },
      { key: 'BRENT', label: 'Brent Crude' },
      { key: 'WTI', label: 'WTI Crude' },
      { key: 'NATGAS', label: 'Natural Gas' },
      { key: 'COPPER', label: 'Copper' },
    ],
  },
];

// /indices category per item kind (stocks quote via /ltp instead).
export const KIND_CATEGORY: Record<Exclude<TickerKind, 'stock'>, string> = {
  index: 'domestic',
  global: 'international',
  currency: 'currency',
  commodity: 'commodity',
};
