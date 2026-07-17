// Persistent ICT/SMC scan store — same shape as institutionalStore, keyed to
// the HFT/ICT/SMC tab. Scan the mid/large-cap universe once, cache on-device,
// re-scan only on Update List; the visible list holds names that produced an
// SMC long setup, ranked by their confluence score.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SmcRec } from './api';

const CACHE_KEY = 'taureye.smc.cache.v1';
const DEPTH_KEY = 'taureye.smc.depth.v1';

export const DEPTH_OPTIONS = [25, 50, 75, 100] as const;
export const DEFAULT_DEPTH = 50;
export const MAX_DEPTH = 100;

export type SmcCache = {
  asof: number;
  depth: number;
  recs: SmcRec[];
  scanned: string[];
};

let cache: SmcCache | null = null;
let depth = DEFAULT_DEPTH;
let hydrated = false;

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export function subscribeSmc(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const up = (s: string) => (s || '').trim().toUpperCase();

export async function hydrateSmc(): Promise<void> {
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
export function getCache(): SmcCache | null {
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

async function saveCache(next: SmcCache): Promise<void> {
  cache = next;
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota errors */
  }
  emit();
}

export async function mergeSmc(analysed: SmcRec[], depthUsed: number, asof: number): Promise<void> {
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
