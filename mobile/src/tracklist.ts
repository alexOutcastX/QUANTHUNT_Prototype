// Persistent track list backed by AsyncStorage. Stocks are tracked as BUY or
// SELL with the price/time at which they were added, so return-since-entry can
// be shown live.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'taureye.tracklist.v1';

export type TrackDir = 'buy' | 'sell';
export type TrackEntry = {
  sym: string;
  dir: TrackDir;
  addedAt: number; // epoch ms
  addedPrice: number;
};

export function normSymbol(s: string): string {
  return (s || '').trim().toUpperCase().replace(/^NSE:/, '');
}

export async function loadTrack(): Promise<TrackEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((e) => e && typeof e.sym === 'string' && (e.dir === 'buy' || e.dir === 'sell'))
      .map((e) => ({
        sym: e.sym,
        dir: e.dir,
        addedAt: Number(e.addedAt) || 0,
        addedPrice: Number(e.addedPrice) || 0,
      }));
  } catch {
    return [];
  }
}

async function save(list: TrackEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* best-effort */
  }
}

// Adds (or re-enters) a symbol. Same symbol+direction → no-op. Same symbol,
// different direction → re-entry at the new price/time.
export async function addTrack(
  list: TrackEntry[],
  rawSym: string,
  dir: TrackDir,
  price: number,
  now: number,
): Promise<TrackEntry[]> {
  const sym = normSymbol(rawSym);
  if (!sym) return list;
  const existing = list.find((e) => e.sym === sym);
  if (existing && existing.dir === dir) return list;
  const entry: TrackEntry = { sym, dir, addedAt: now, addedPrice: price > 0 ? price : 0 };
  const next = existing
    ? list.map((e) => (e.sym === sym ? entry : e))
    : [...list, entry];
  await save(next);
  return next;
}

export async function removeTrack(list: TrackEntry[], sym: string): Promise<TrackEntry[]> {
  const next = list.filter((e) => e.sym !== sym);
  await save(next);
  return next;
}
