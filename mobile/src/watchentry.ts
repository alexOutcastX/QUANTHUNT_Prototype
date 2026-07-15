// Per-symbol "entry" data for the Watchlist — the price and time a symbol was
// added, so the list can show the move since it was added (the old Track List
// feature, folded into the Watchlist). Optional `dir` preserves BUY/SELL calls
// migrated from the retired Track List.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TrackDir } from './tracklist';

const KEY = 'taureye.watchlist.entries.v1';
const TRACK_KEY = 'taureye.tracklist.v1';

export type WatchEntry = { price: number | null; ts: number; dir?: TrackDir };
export type EntryMap = Record<string, WatchEntry>;

const norm = (s: string) => (s || '').trim().toUpperCase().replace(/^NSE:/, '');

export async function loadEntries(): Promise<EntryMap> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return {};
    const o = JSON.parse(raw);
    if (o && typeof o === 'object') return o as EntryMap;
  } catch {
    /* ignore */
  }
  return {};
}

export async function saveEntries(m: EntryMap): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* best-effort */
  }
}

// Record an entry the first time we see a symbol (never overwrites an existing
// one, so the reference price stays put once set). Returns a new map if it
// changed, else the same reference.
export function withEntry(m: EntryMap, rawSym: string, price: number | null, ts: number): EntryMap {
  const sym = norm(rawSym);
  if (!sym || m[sym]) return m;
  return { ...m, [sym]: { price: price != null && isFinite(price) ? price : null, ts } };
}

export function dropEntry(m: EntryMap, rawSym: string): EntryMap {
  const sym = norm(rawSym);
  if (!m[sym]) return m;
  const next = { ...m };
  delete next[sym];
  return next;
}

// Fold Track List calls (BUY/SELL with entry price) into watchlist entries.
// The Track List UI is retired, but the Screener / Multibagger row buttons
// still record calls here — this surfaces them in the Watchlist (with the
// entry price + a BUY/SELL tag). Called on every load; only adds calls not
// already represented, so it never fights a user's manual removals (removing a
// symbol from the Watchlist also untracks it — see WatchlistScreen.onRemove).
// Returns { map, symbols } (symbols to ensure in the active list) or null.
export async function syncTrackList(
  m: EntryMap,
): Promise<{ map: EntryMap; symbols: string[] } | null> {
  try {
    const raw = await AsyncStorage.getItem(TRACK_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || !arr.length) return null;
    const next: EntryMap = { ...m };
    const symbols: string[] = [];
    let changed = false;
    for (const e of arr) {
      const sym = norm(e?.sym || '');
      if (!sym) continue;
      symbols.push(sym);
      if (!next[sym]) {
        next[sym] = {
          price: Number(e.addedPrice) > 0 ? Number(e.addedPrice) : null,
          ts: Number(e.addedAt) || 0,
          dir: e.dir === 'buy' || e.dir === 'sell' ? e.dir : undefined,
        };
        changed = true;
      }
    }
    if (!symbols.length) return null;
    return { map: changed ? next : m, symbols };
  } catch {
    return null;
  }
}
