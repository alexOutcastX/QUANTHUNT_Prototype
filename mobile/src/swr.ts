// Client-side read cache — stale-while-revalidate, memory + disk.
//
// The server already answers cached reads in single-digit milliseconds. What
// made the app feel slow was the client: every screen threw its data away on
// unmount and re-fetched the whole thing on the next visit, so switching tabs
// paid the full network cost again, and a cold app launch painted nothing until
// the network answered.
//
// This module fixes both:
//   • MEMORY — a repeat visit inside the same session returns instantly, with
//     no request at all while the entry is fresh.
//   • DISK — the last value survives a reload/relaunch, so a screen can paint
//     real data on first frame instead of a spinner.
//   • STALE-WHILE-REVALIDATE — past the TTL the cached value is returned
//     immediately AND a refresh runs behind it, so the user reads something
//     truthful now and it updates in place a moment later.
//
// Writes are never cached. Anything the user changes goes straight through.
import AsyncStorage from '@react-native-async-storage/async-storage';

type Entry<T> = { v: T; ts: number };

const PREFIX = 'taureye.swr.';
const mem = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
const hydrated = new Set<string>();

// Anything older than this is never served, even as stale — a price from
// yesterday shown without comment is worse than a spinner.
const MAX_STALE_MS = 24 * 60 * 60 * 1000;

export type SwrOpts = {
  /** Serve a stale hit instantly and refresh behind it. Default true. */
  staleOk?: boolean;
  /** Skip the cache entirely (pull-to-refresh). */
  force?: boolean;
  /** Called when a background refresh produces a newer value. */
  onFresh?: (v: unknown) => void;
};

function fresh(e: Entry<unknown> | undefined, ttl: number): boolean {
  return !!e && Date.now() - e.ts < ttl;
}

function usable(e: Entry<unknown> | undefined): boolean {
  return !!e && Date.now() - e.ts < MAX_STALE_MS;
}

/** Cached value without touching the network — for a first paint. */
export function peek<T>(key: string): T | null {
  const e = mem.get(key) as Entry<T> | undefined;
  return usable(e) ? (e as Entry<T>).v : null;
}

/** Pull one key off disk into memory. Runs once per key per session. */
async function hydrate(key: string): Promise<void> {
  if (hydrated.has(key) || mem.has(key)) return;
  hydrated.add(key);
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return;
    const e = JSON.parse(raw) as Entry<unknown>;
    // A later in-session write always wins over what was on disk.
    if (e && typeof e.ts === 'number' && usable(e) && !mem.has(key)) mem.set(key, e);
  } catch {
    /* unreadable entry — treat as absent */
  }
}

function persist(key: string, e: Entry<unknown>): void {
  AsyncStorage.setItem(PREFIX + key, JSON.stringify(e)).catch(() => {
    /* quota or serialisation — the memory copy still works */
  });
}

export async function swr<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  opts: SwrOpts = {},
): Promise<T> {
  const { staleOk = true, force = false, onFresh } = opts;

  if (force) return run(key, fetcher, onFresh);

  await hydrate(key);
  const hit = mem.get(key) as Entry<T> | undefined;

  if (fresh(hit, ttlMs)) return (hit as Entry<T>).v;

  if (staleOk && usable(hit)) {
    // Return what we have now; refresh behind it. The refresh is deliberately
    // not awaited, and its failure is swallowed — the user already has a value,
    // and an error toast over good data would be noise.
    run(key, fetcher, onFresh).catch(() => {});
    return (hit as Entry<T>).v;
  }

  return run(key, fetcher, onFresh);
}

function run<T>(key: string, fetcher: () => Promise<T>, onFresh?: (v: unknown) => void): Promise<T> {
  // Two screens asking for the same key at once share one request.
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;

  const p = fetcher()
    .then((v) => {
      const e: Entry<unknown> = { v, ts: Date.now() };
      mem.set(key, e);
      persist(key, e);
      onFresh?.(v);
      return v;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, p);
  return p;
}

/** Drop one key, or everything under a prefix (after a mutation). */
export function invalidate(prefix: string): void {
  for (const k of [...mem.keys()]) {
    if (k === prefix || k.startsWith(prefix)) {
      mem.delete(k);
      hydrated.delete(k);
      AsyncStorage.removeItem(PREFIX + k).catch(() => {});
    }
  }
}

/** Wipe the whole read cache (sign-out, or a "clear data" action). */
export async function clearAll(): Promise<void> {
  mem.clear();
  hydrated.clear();
  try {
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith(PREFIX)));
  } catch {
    /* ignore */
  }
}

// ── bounded concurrency ──────────────────────────────────────────────────────
/**
 * Run `jobs` with at most `limit` in flight.
 *
 * The batch loops used to be `for (…) await`, which serialises every request:
 * a 500-symbol scan is 42 batches of 12, so the screen waited 42 round-trips
 * end to end even though the server answered each in milliseconds. Running a
 * few at once collapses that to a handful of waves. The limit is deliberately
 * modest — the point is to hide round-trip latency, not to flood the VM.
 */
export async function pooled<T>(
  jobs: (() => Promise<T>)[],
  limit = 6,
  onEach?: (r: T, done: number, total: number) => void,
): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      out[i] = await jobs[i]();
      done += 1;
      onEach?.(out[i], done, jobs.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return out;
}
