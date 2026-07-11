// Persistent portfolio backed by AsyncStorage. Each holding is a symbol with a
// quantity and average buy price. Live valuation is layered on top at render
// time from /ltp quotes.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'taureye.portfolio.v1';

export type Holding = { symbol: string; qty: number; avg: number };

export function normSymbol(s: string): string {
  return (s || '').trim().toUpperCase().replace(/^NSE:/, '');
}

export async function loadPortfolio(): Promise<Holding[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((h) => h && typeof h.symbol === 'string')
      .map((h) => ({ symbol: h.symbol, qty: Number(h.qty) || 0, avg: Number(h.avg) || 0 }));
  } catch {
    return [];
  }
}

async function save(list: Holding[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* best-effort persistence */
  }
}

// Adds a lot. If the symbol already exists, blends into a weighted average so
// buying the same stock twice reflects the true cost basis.
export async function addHolding(
  list: Holding[],
  rawSym: string,
  qty: number,
  price: number,
): Promise<Holding[]> {
  const symbol = normSymbol(rawSym);
  if (!symbol || !(qty > 0) || !(price > 0)) return list;
  const idx = list.findIndex((h) => h.symbol === symbol);
  let next: Holding[];
  if (idx >= 0) {
    const cur = list[idx];
    const totQty = cur.qty + qty;
    const avg = (cur.qty * cur.avg + qty * price) / totQty;
    next = list.map((h, i) => (i === idx ? { symbol, qty: totQty, avg } : h));
  } else {
    next = [...list, { symbol, qty, avg: price }];
  }
  await save(next);
  return next;
}

export async function removeHolding(list: Holding[], symbol: string): Promise<Holding[]> {
  const next = list.filter((h) => h.symbol !== symbol);
  await save(next);
  return next;
}
