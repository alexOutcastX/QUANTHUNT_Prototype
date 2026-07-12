// Persistent saved screens backed by AsyncStorage. A saved screen captures the
// full screener state (index + active filters + sort) under a user-typed name,
// so a scan can be re-opened later. Also provides compact encode/decode helpers
// used by the web "Share" feature (base64 of the same state shape).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActiveFilters } from './screener';

const KEY = 'taureye.screener.saved.v1';
const CAP = 50;

export type ScreenState = {
  indexName: string;
  active: ActiveFilters;
  sortCol: string;
  sortDir: 1 | -1;
};

export type SavedScreen = ScreenState & {
  name: string;
  savedAt: number; // epoch ms
};

function coerceState(o: Record<string, unknown> | null | undefined): ScreenState | null {
  if (!o || typeof o !== 'object') return null;
  const indexName = typeof o.indexName === 'string' ? o.indexName : '';
  if (!indexName) return null;
  const active = (o.active && typeof o.active === 'object' ? o.active : {}) as ActiveFilters;
  const sortCol = typeof o.sortCol === 'string' ? o.sortCol : 'signal';
  const sortDir = o.sortDir === 1 ? 1 : -1;
  return { indexName, active, sortCol, sortDir };
}

export async function loadSavedScreens(): Promise<SavedScreen[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((e) => {
        const st = coerceState(e);
        if (!st || typeof e.name !== 'string' || !e.name) return null;
        return { ...st, name: e.name, savedAt: Number(e.savedAt) || 0 };
      })
      .filter((e): e is SavedScreen => e != null);
  } catch {
    return [];
  }
}

async function persist(list: SavedScreen[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* best-effort persistence */
  }
}

// Saves (or overwrites by name) a screen. Newest first, capped at CAP entries.
export async function saveScreen(
  list: SavedScreen[],
  name: string,
  state: ScreenState,
): Promise<SavedScreen[]> {
  const nm = name.trim();
  if (!nm) return list;
  const entry: SavedScreen = { ...state, name: nm, savedAt: Date.now() };
  const next = [entry, ...list.filter((s) => s.name !== nm)].slice(0, CAP);
  await persist(next);
  return next;
}

export async function deleteScreen(list: SavedScreen[], name: string): Promise<SavedScreen[]> {
  const next = list.filter((s) => s.name !== name);
  await persist(next);
  return next;
}

// ── Share encode/decode (web) ─────────────────────────────────────────────────
// Compact, URL-safe: base64 of the JSON state. Unicode-safe via encodeURIComponent.
export function encodeScreen(state: ScreenState): string {
  try {
    const json = JSON.stringify(state);
    const b64 = (globalThis as { btoa?: (s: string) => string }).btoa;
    if (!b64) return '';
    return b64(encodeURIComponent(json));
  } catch {
    return '';
  }
}

export function decodeScreen(encoded: string): ScreenState | null {
  try {
    const a64 = (globalThis as { atob?: (s: string) => string }).atob;
    if (!a64) return null;
    const json = decodeURIComponent(a64(encoded));
    return coerceState(JSON.parse(json));
  } catch {
    return null;
  }
}
