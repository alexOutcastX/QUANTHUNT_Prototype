// On-device price-target alerts. The server /alerts API is owner-only, so a
// per-user "set an alert" (with a live upside-remaining readout) lives locally,
// like the watchlist. Each alert stores a target price; the Alerts screen polls
// live quotes and shows the remaining upside to that target, dynamically.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'taureye.localalerts.v1';

export type LocalAlert = {
  id: string;
  sym: string;
  name?: string;
  target: number;       // target price
  entryPrice: number;   // price when the alert was set
  createdAt: number;    // epoch ms
};

const norm = (s: string) => (s || '').trim().toUpperCase().replace(/^NSE:/, '');
// Timestamps/randomness are fine on-device (this never runs in a resumable
// workflow); keep ids collision-resistant enough for a personal list.
const genId = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export async function loadLocalAlerts(): Promise<LocalAlert[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (a) => a && typeof a.sym === 'string' && typeof a.target === 'number' && isFinite(a.target),
    );
  } catch {
    return [];
  }
}

async function save(list: LocalAlert[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* best-effort */
  }
}

// Add (or replace) an alert for a symbol. One target alert per symbol; setting
// a new one updates the target/entry.
export async function addLocalAlert(
  list: LocalAlert[],
  rawSym: string,
  target: number,
  entryPrice: number,
  name?: string,
): Promise<LocalAlert[]> {
  const sym = norm(rawSym);
  if (!sym || !isFinite(target) || target <= 0) return list;
  const entry: LocalAlert = {
    id: genId(),
    sym,
    name,
    target,
    entryPrice: entryPrice > 0 ? entryPrice : target,
    createdAt: Date.now(),
  };
  const rest = list.filter((a) => a.sym !== sym);
  const next = [entry, ...rest];
  await save(next);
  return next;
}

export async function removeLocalAlert(list: LocalAlert[], id: string): Promise<LocalAlert[]> {
  const next = list.filter((a) => a.id !== id);
  await save(next);
  return next;
}

export function hasLocalAlert(list: LocalAlert[], rawSym: string): boolean {
  const sym = norm(rawSym);
  return list.some((a) => a.sym === sym);
}
