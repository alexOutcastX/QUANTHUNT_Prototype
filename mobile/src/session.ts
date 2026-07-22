// User session + cloud sync.
//
// The device's AsyncStorage stays the source the screens read (zero churn in
// the feature code); this module mirrors an allowlisted set of those keys to
// the server for a signed-in user:
//   - on sign-in / app start with a valid session: PULL each kind — the copy
//     with the newer timestamp wins, so a fresh device inherits the account
//     and an offline-edited device pushes its changes;
//   - afterwards every local write to a synced key is debounced and PUSHED
//     (AsyncStorage.setItem is wrapped once, so watchlist.ts, localalerts.ts,
//     paperTrades.ts and paperSim.ts need no changes).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';

// local AsyncStorage key -> server document kind (users.py DATA_KINDS)
const SYNC_KEYS: Record<string, string> = {
  'taureye.watchlist.v1': 'watchlist_v1',
  'taureye.watchlist.v2': 'watchlist_v2',
  'taureye.localalerts.v1': 'localalerts_v1',
  'taureye.papertrades.v1': 'papertrades_v1',
  'taureye.papersim.v1': 'papersim_v1',
};
const TS_PREFIX = 'taureye.sync.ts.';

export type SyncState = 'off' | 'syncing' | 'synced' | 'error';

let email: string | null = null;
let state: SyncState = 'off';
let lastSync = 0;
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

export function subscribeSession(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export function sessionEmail(): string | null {
  return email;
}
export function syncState(): { state: SyncState; lastSync: number } {
  return { state, lastSync };
}

async function localTs(key: string): Promise<number> {
  const v = await AsyncStorage.getItem(TS_PREFIX + key).catch(() => null);
  return v ? Number(v) || 0 : 0;
}

// ── push (debounced per key) ─────────────────────────────────────────────────
const pushTimers: Record<string, ReturnType<typeof setTimeout>> = {};

function schedulePush(key: string) {
  if (!email) return;
  if (pushTimers[key]) clearTimeout(pushTimers[key]);
  pushTimers[key] = setTimeout(async () => {
    try {
      const raw = await AsyncStorage.getItem(key);
      if (raw == null) return;
      const ts = Math.floor(Date.now() / 1000);
      const res = await api.userDataPut(SYNC_KEYS[key], JSON.parse(raw), ts);
      if (res.stored) {
        await AsyncStorage.setItem(TS_PREFIX + key, String(ts));
      } else if (res.server_newer && res.v != null) {
        // another device pushed something newer since our last pull — take it
        await AsyncStorage.setItem(key, JSON.stringify(res.v));
        await AsyncStorage.setItem(TS_PREFIX + key, String(res.ts ?? ts));
      }
      state = 'synced';
      lastSync = Date.now();
    } catch {
      state = 'error';
    }
    emit();
  }, 1500);
}

// Wrap AsyncStorage.setItem ONCE so every existing module's writes to synced
// keys schedule a push without those modules knowing sync exists.
let wrapped = false;
function wrapStorage() {
  if (wrapped) return;
  wrapped = true;
  const orig = AsyncStorage.setItem.bind(AsyncStorage);
  AsyncStorage.setItem = (async (key: string, value: string) => {
    const r = await orig(key, value);
    if (key in SYNC_KEYS) schedulePush(key);
    return r;
  }) as typeof AsyncStorage.setItem;
}

// ── pull / reconcile ─────────────────────────────────────────────────────────
export async function syncNow(): Promise<void> {
  if (!email) return;
  state = 'syncing';
  emit();
  try {
    await Promise.all(
      Object.entries(SYNC_KEYS).map(async ([key, kind]) => {
        const [remote, mineTs, raw] = await Promise.all([
          api.userDataGet(kind).catch(() => null),
          localTs(key),
          AsyncStorage.getItem(key).catch(() => null),
        ]);
        const remoteTs = remote?.ts ?? 0;
        if (remote && remote.v != null && remoteTs > mineTs) {
          await AsyncStorage.setItem(key, JSON.stringify(remote.v));
          await AsyncStorage.setItem(TS_PREFIX + key, String(remoteTs));
        } else if (raw != null && (!remote || remote.v == null || mineTs > remoteTs)) {
          // first login from this device (or local is newer): seed the server
          const ts = mineTs || Math.floor(Date.now() / 1000);
          const res = await api.userDataPut(kind, JSON.parse(raw), ts).catch(() => null);
          if (res?.stored) await AsyncStorage.setItem(TS_PREFIX + key, String(ts));
        }
      }),
    );
    state = 'synced';
    lastSync = Date.now();
  } catch {
    state = 'error';
  }
  emit();
}

// ── session lifecycle ────────────────────────────────────────────────────────
export async function refreshSession(): Promise<string | null> {
  try {
    const me = await api.authMe();
    email = me.user?.email ?? null;
  } catch {
    /* offline — keep whatever we had */
  }
  if (email) {
    wrapStorage();
    syncNow();
  } else {
    state = 'off';
  }
  emit();
  return email;
}

export function onSignedIn(userEmail: string) {
  email = userEmail;
  wrapStorage();
  state = 'syncing';
  emit();
  syncNow();
}

export async function signOut(): Promise<void> {
  try {
    await api.userLogout();
  } catch {
    /* clearing locally regardless */
  }
  email = null;
  state = 'off';
  emit();
}

export async function deleteAccount(): Promise<void> {
  await api.accountDelete();
  email = null;
  state = 'off';
  emit();
}
