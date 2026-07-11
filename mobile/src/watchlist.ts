// Persistent watchlist backed by AsyncStorage. Stores a de-duplicated,
// order-preserving list of uppercase NSE symbols.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'taureye.watchlist.v1';

export function normSymbol(s: string): string {
  return (s || '').trim().toUpperCase().replace(/^NSE:/, '');
}

export async function loadWatchlist(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function save(list: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* best-effort persistence */
  }
}

export async function addSymbol(list: string[], raw: string): Promise<string[]> {
  const sym = normSymbol(raw);
  if (!sym || list.includes(sym)) return list;
  const next = [...list, sym];
  await save(next);
  return next;
}

export async function removeSymbol(list: string[], sym: string): Promise<string[]> {
  const next = list.filter((s) => s !== sym);
  await save(next);
  return next;
}
