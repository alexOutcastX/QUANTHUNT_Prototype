// Full paper-trading simulator: a virtual cash account you can buy/sell any
// scrip with, tracking realized + unrealized P&L against live prices. Long-only
// (buy then sell) — the outcome tracker (paperTrades.ts) covers directional
// setups; this is a portfolio you actively manage. All on-device (AsyncStorage).
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'taureye.papersim.v1';
export const START_CASH = 1_000_000; // ₹10,00,000 starting virtual capital

export type SimPosition = { symbol: string; qty: number; avg: number };
export type SimTrade = {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  ts: number;
  realized?: number; // set on sells
};
export type SimState = {
  cash: number;
  start: number;
  created: number;
  positions: SimPosition[];
  trades: SimTrade[];
};

const fresh = (start = START_CASH): SimState => ({
  cash: start,
  start,
  created: Date.now(),
  positions: [],
  trades: [],
});

export async function loadSim(): Promise<SimState> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return fresh();
    const s = JSON.parse(raw) as SimState;
    if (!s || typeof s.cash !== 'number' || !Array.isArray(s.positions)) return fresh();
    s.trades = Array.isArray(s.trades) ? s.trades : [];
    return s;
  } catch {
    return fresh();
  }
}

async function save(s: SimState): Promise<SimState> {
  try {
    // Bound the trade log so storage never grows unbounded.
    const trimmed = { ...s, trades: s.trades.slice(-500) };
    await AsyncStorage.setItem(KEY, JSON.stringify(trimmed));
    return trimmed;
  } catch {
    return s;
  }
}

export async function resetSim(start = START_CASH): Promise<SimState> {
  return save(fresh(start));
}

const uid = () => `${Date.now()}-${Math.round(Math.random() * 1e6)}`;

// Buy `qty` of `symbol` at `price`. Averages into an existing position.
export async function buy(
  s: SimState,
  symbol: string,
  qty: number,
  price: number,
): Promise<{ ok: boolean; reason?: string; state: SimState }> {
  symbol = symbol.toUpperCase().trim();
  if (!(qty > 0) || !(price > 0)) return { ok: false, reason: 'Enter a valid quantity', state: s };
  const cost = qty * price;
  if (cost > s.cash + 1e-6) return { ok: false, reason: 'Not enough virtual cash', state: s };
  const positions = s.positions.slice();
  const i = positions.findIndex((p) => p.symbol === symbol);
  if (i >= 0) {
    const p = positions[i];
    const totalQty = p.qty + qty;
    positions[i] = { symbol, qty: totalQty, avg: (p.avg * p.qty + price * qty) / totalQty };
  } else {
    positions.push({ symbol, qty, avg: price });
  }
  const trade: SimTrade = { id: uid(), symbol, side: 'buy', qty, price, ts: Date.now() };
  const next = { ...s, cash: s.cash - cost, positions, trades: [...s.trades, trade] };
  return { ok: true, state: await save(next) };
}

// Sell `qty` of `symbol` at `price`, realizing P&L vs the average cost.
export async function sell(
  s: SimState,
  symbol: string,
  qty: number,
  price: number,
): Promise<{ ok: boolean; reason?: string; state: SimState }> {
  symbol = symbol.toUpperCase().trim();
  const positions = s.positions.slice();
  const i = positions.findIndex((p) => p.symbol === symbol);
  if (i < 0) return { ok: false, reason: 'No open position', state: s };
  const p = positions[i];
  if (!(qty > 0) || qty > p.qty + 1e-6) return { ok: false, reason: `You hold ${p.qty}`, state: s };
  const realized = qty * (price - p.avg);
  const remain = p.qty - qty;
  if (remain <= 1e-6) positions.splice(i, 1);
  else positions[i] = { ...p, qty: remain };
  const trade: SimTrade = { id: uid(), symbol, side: 'sell', qty, price, ts: Date.now(), realized };
  const next = { ...s, cash: s.cash + qty * price, positions, trades: [...s.trades, trade] };
  return { ok: true, state: await save(next) };
}

// Portfolio metrics given a live-price map.
export function metrics(s: SimState, prices: Record<string, number | null | undefined>) {
  let holdings = 0;
  let unrealized = 0;
  for (const p of s.positions) {
    const px = prices[p.symbol];
    const mark = px != null && isFinite(px) ? px : p.avg;
    holdings += p.qty * mark;
    unrealized += p.qty * (mark - p.avg);
  }
  const realized = s.trades.reduce((a, t) => a + (t.realized || 0), 0);
  const equity = s.cash + holdings;
  const pnl = equity - s.start;
  const pnlPct = s.start ? (pnl / s.start) * 100 : 0;
  return { holdings, unrealized, realized, equity, pnl, pnlPct, invested: holdings };
}
