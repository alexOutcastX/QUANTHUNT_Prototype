// Persistent institutional-strategy scan store — same shape as swingStore, but
// keyed to the Institutional tab. Scan the mid/large-cap universe once, cache
// on-device, re-scan only on Update List; the visible list holds names that
// matched at least one algorithmic strategy, ranked by their confluence score.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { InstitutionalRec } from './api';

const CACHE_KEY = 'taureye.inst.cache.v1';
const DEPTH_KEY = 'taureye.inst.depth.v1';

export const DEPTH_OPTIONS = [25, 50, 75, 100] as const;
export const DEFAULT_DEPTH = 50;
export const MAX_DEPTH = 100;

export type InstCache = {
  asof: number;
  depth: number;
  recs: InstitutionalRec[]; // qualifying strategy matches to display
  scanned: string[]; // every symbol analysed
};

let cache: InstCache | null = null;
let depth = DEFAULT_DEPTH;
let hydrated = false;

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export function subscribeInst(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const up = (s: string) => (s || '').trim().toUpperCase();

export async function hydrateInst(): Promise<void> {
  if (hydrated) return;
  try {
    const [c, d] = await Promise.all([AsyncStorage.getItem(CACHE_KEY), AsyncStorage.getItem(DEPTH_KEY)]);
    if (c) {
      const parsed = JSON.parse(c);
      if (parsed && Array.isArray(parsed.recs) && Array.isArray(parsed.scanned)) cache = parsed;
    }
    const dn = d ? parseInt(d, 10) : NaN;
    if (isFinite(dn) && dn > 0) depth = Math.min(MAX_DEPTH, dn);
  } catch {
    /* corrupt cache — start fresh */
  }
  hydrated = true;
  emit();
}

export function isHydrated(): boolean {
  return hydrated;
}
export function getCache(): InstCache | null {
  return cache;
}
export function hasCache(): boolean {
  return !!cache;
}
export function getScanned(): Set<string> {
  return new Set((cache?.scanned || []).map(up));
}
export function getDepth(): number {
  return depth;
}
export function setDepth(n: number): void {
  depth = Math.max(1, Math.min(MAX_DEPTH, Math.round(n)));
  AsyncStorage.setItem(DEPTH_KEY, String(depth)).catch(() => {});
  emit();
}

async function saveCache(next: InstCache): Promise<void> {
  cache = next;
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota errors */
  }
  emit();
}

// Merge freshly-analysed reads into the cache: qualifying matches are upserted
// into the visible list; every analysed symbol joins `scanned`.
export async function mergeInst(analysed: InstitutionalRec[], depthUsed: number, asof: number): Promise<void> {
  const prev = cache || { asof, depth: depthUsed, recs: [], scanned: [] };
  const bySym = new Map(prev.recs.map((r) => [up(r.symbol), r]));
  const scanned = new Set(prev.scanned.map(up));
  for (const r of analysed) {
    const s = up(r.symbol);
    scanned.add(s);
    if (r.qualifies) bySym.set(s, r);
    else bySym.delete(s);
  }
  const recs = [...bySym.values()].sort((a, b) => b.score - a.score);
  await saveCache({ asof, depth: depthUsed, recs, scanned: [...scanned] });
}
