// Persistent watchlists backed by AsyncStorage.
//
// A "store" holds MULTIPLE named lists (id + name + de-duplicated, uppercase NSE
// symbols) plus an "active" list id. The active list is the one the rest of the
// app (Screener / Chart / Dashboard) reads and writes through the legacy
// single-list API (`loadWatchlist` / `addSymbol` / `removeSymbol`), which is kept
// intact so those callers don't need to know about multiple lists.
//
// v1 data (a bare `string[]` under the old key) is migrated once into a default
// "Watchlist" list the first time the store is loaded.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_V1 = 'taureye.watchlist.v1';
const KEY = 'taureye.watchlist.v2';

export function normSymbol(s: string): string {
  return (s || '').trim().toUpperCase().replace(/^NSE:/, '');
}

export type Watchlist = { id: string; name: string; symbols: string[] };
export type WatchlistStore = { activeId: string; lists: Watchlist[] };

let idCounter = 0;
function genId(): string {
  idCounter += 1;
  return 'wl_' + Date.now().toString(36) + '_' + idCounter.toString(36);
}

function cleanSymbols(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    if (typeof x !== 'string') continue;
    const s = normSymbol(x);
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

function coerceStore(raw: string | null): WatchlistStore | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== 'object' || !Array.isArray(o.lists)) return null;
    const lists: Watchlist[] = (o.lists as unknown[])
      .map((l) => {
        const e = l as Record<string, unknown>;
        if (!e || typeof e !== 'object' || typeof e.id !== 'string' || typeof e.name !== 'string') {
          return null;
        }
        return { id: e.id, name: e.name, symbols: cleanSymbols(e.symbols) };
      })
      .filter((l): l is Watchlist => l != null);
    if (!lists.length) return null;
    const activeId =
      typeof o.activeId === 'string' && lists.some((l) => l.id === o.activeId)
        ? o.activeId
        : lists[0].id;
    return { activeId, lists };
  } catch {
    return null;
  }
}

async function saveStore(store: WatchlistStore): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* best-effort persistence */
  }
}

// Migrate a legacy v1 `string[]` (or nothing) into a fresh single-list store.
async function migrateV1(): Promise<WatchlistStore> {
  let symbols: string[] = [];
  try {
    const raw = await AsyncStorage.getItem(KEY_V1);
    if (raw) symbols = cleanSymbols(JSON.parse(raw));
  } catch {
    /* start empty */
  }
  const list: Watchlist = { id: genId(), name: 'Watchlist', symbols };
  const store: WatchlistStore = { activeId: list.id, lists: [list] };
  await saveStore(store);
  return store;
}

async function loadStore(): Promise<WatchlistStore> {
  try {
    const store = coerceStore(await AsyncStorage.getItem(KEY));
    if (store) return store;
  } catch {
    /* fall through to migration */
  }
  return migrateV1();
}

function activeList(store: WatchlistStore): Watchlist | undefined {
  return store.lists.find((l) => l.id === store.activeId) ?? store.lists[0];
}

// ── Multi-list API (used by WatchlistScreen) ─────────────────────────────────

export async function getWatchlistStore(): Promise<WatchlistStore> {
  return loadStore();
}

export async function getWatchlists(): Promise<Watchlist[]> {
  return (await loadStore()).lists;
}

export async function getActiveWatchlistId(): Promise<string> {
  return (await loadStore()).activeId;
}

export async function setActiveWatchlist(id: string): Promise<WatchlistStore> {
  const store = await loadStore();
  if (store.lists.some((l) => l.id === id)) {
    store.activeId = id;
    await saveStore(store);
  }
  return store;
}

export async function createWatchlist(name: string): Promise<WatchlistStore> {
  const store = await loadStore();
  const nm = (name || '').trim() || 'Untitled';
  const list: Watchlist = { id: genId(), name: nm, symbols: [] };
  store.lists.push(list);
  store.activeId = list.id; // newly created list becomes active
  await saveStore(store);
  return store;
}

export async function renameWatchlist(id: string, name: string): Promise<WatchlistStore> {
  const store = await loadStore();
  const nm = (name || '').trim();
  const list = store.lists.find((l) => l.id === id);
  if (list && nm) {
    list.name = nm;
    await saveStore(store);
  }
  return store;
}

// Deleting the last remaining list clears it instead of removing it, so there is
// always at least one list for the legacy single-list API to operate on.
export async function deleteWatchlist(id: string): Promise<WatchlistStore> {
  const store = await loadStore();
  if (store.lists.length <= 1) {
    const only = store.lists.find((l) => l.id === id);
    if (only) {
      only.symbols = [];
      await saveStore(store);
    }
    return store;
  }
  store.lists = store.lists.filter((l) => l.id !== id);
  if (!store.lists.some((l) => l.id === store.activeId)) {
    store.activeId = store.lists[0].id;
  }
  await saveStore(store);
  return store;
}

export async function addSymbolToWatchlist(id: string, raw: string): Promise<WatchlistStore> {
  const store = await loadStore();
  const sym = normSymbol(raw);
  const list = store.lists.find((l) => l.id === id);
  if (list && sym && !list.symbols.includes(sym)) {
    list.symbols = [...list.symbols, sym];
    await saveStore(store);
  }
  return store;
}

export async function removeSymbolFromWatchlist(id: string, sym: string): Promise<WatchlistStore> {
  const store = await loadStore();
  const list = store.lists.find((l) => l.id === id);
  const norm = normSymbol(sym);
  if (list) {
    list.symbols = list.symbols.filter((s) => s !== sym && s !== norm);
    await saveStore(store);
  }
  return store;
}

// ── Legacy single-list API — operates on the ACTIVE list ─────────────────────
// Kept identical in signature/behavior so ScreenerScreen / ChartScreen /
// DashboardScreen keep working without change.

export async function loadWatchlist(): Promise<string[]> {
  const store = await loadStore();
  const list = activeList(store);
  return list ? [...list.symbols] : [];
}

export async function addSymbol(list: string[], raw: string): Promise<string[]> {
  const sym = normSymbol(raw);
  if (!sym || list.includes(sym)) return list;
  const next = [...list, sym];
  const store = await loadStore();
  const active = activeList(store);
  if (active) {
    active.symbols = next;
    await saveStore(store);
  }
  return next;
}

export async function removeSymbol(list: string[], sym: string): Promise<string[]> {
  const next = list.filter((s) => s !== sym);
  const store = await loadStore();
  const active = activeList(store);
  if (active) {
    active.symbols = next;
    await saveStore(store);
  }
  return next;
}
