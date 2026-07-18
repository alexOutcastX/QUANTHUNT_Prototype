// On-device paper-trade log (the "outcome tracker"). Tapping "Paper trade" on
// any setup records a simulated position at its entry / stop / target. The
// Results page tracks each against the live price and marks it a win when the
// target is hit or a loss when the stop is hit. No real orders, no login — it's
// a scoreboard for how the recommendations would have played out.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'taureye.papertrades.v1';

export type PaperSide = 'long' | 'short';
export type PaperStatus = 'open' | 'won' | 'lost';

export type PaperTrade = {
  id: string;
  symbol: string;
  name?: string;
  side: PaperSide;
  source: string; // which tab logged it (e.g. "HFT/ICT/SMC")
  entry: number;
  stop: number;
  target: number;
  created: number; // epoch ms
  status: PaperStatus;
  closed?: number; // epoch ms when it hit TP/SL
  exit?: number; // price it closed at
};

export async function loadPaperTrades(): Promise<PaperTrade[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as PaperTrade[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function save(list: PaperTrade[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(list.slice(0, 200)));
  } catch {
    /* ignore */
  }
}

// stable-ish id without Date.now/random restrictions in this codebase's lint —
// created timestamp + symbol is unique enough for a personal log.
export async function addPaperTrade(
  t: Omit<PaperTrade, 'id' | 'created' | 'status'>,
): Promise<PaperTrade[]> {
  const list = await loadPaperTrades();
  const created = Date.now();
  const trade: PaperTrade = { ...t, id: `${created}-${t.symbol}`, created, status: 'open' };
  const next = [trade, ...list.filter((x) => !(x.symbol === t.symbol && x.status === 'open'))];
  await save(next);
  return next;
}

export async function removePaperTrade(id: string): Promise<PaperTrade[]> {
  const list = await loadPaperTrades();
  const next = list.filter((t) => t.id !== id);
  await save(next);
  return next;
}

export async function clearPaperTrades(): Promise<PaperTrade[]> {
  await save([]);
  return [];
}

export function hasOpenPaper(list: PaperTrade[], symbol: string): boolean {
  return list.some((t) => t.symbol === symbol && t.status === 'open');
}

// P&L% of a trade at a given live price, respecting side.
export function paperPnlPct(t: PaperTrade, price: number): number {
  if (!t.entry) return 0;
  const raw = ((price - t.entry) / t.entry) * 100;
  return t.side === 'short' ? -raw : raw;
}

// Reconcile open trades against live prices: mark won if target reached, lost if
// stop reached. Returns the updated list (persists if anything changed).
export async function reconcilePaper(
  list: PaperTrade[],
  prices: Record<string, number | null | undefined>,
): Promise<PaperTrade[]> {
  let changed = false;
  const now = Date.now();
  const next = list.map((t) => {
    if (t.status !== 'open') return t;
    const px = prices[t.symbol];
    if (px == null || !isFinite(px)) return t;
    const hitTarget = t.side === 'short' ? px <= t.target : px >= t.target;
    const hitStop = t.side === 'short' ? px >= t.stop : px <= t.stop;
    if (hitTarget) {
      changed = true;
      return { ...t, status: 'won' as PaperStatus, closed: now, exit: t.target };
    }
    if (hitStop) {
      changed = true;
      return { ...t, status: 'lost' as PaperStatus, closed: now, exit: t.stop };
    }
    return t;
  });
  if (changed) await save(next);
  return next;
}
