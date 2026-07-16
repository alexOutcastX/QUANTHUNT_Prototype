// Persistent recommendation-scan store.
//
// The recommendation fan-out (per-symbol /recommendation over the Multibagger
// candidates) is slow, so we run it rarely and cache the result on-device:
//   • first launch after install → scan once, then cache
//   • every later visit / reload  → serve the cache (no re-scan)
//   • only the "Update List" button re-scans
//
// A rebuild is *incremental*: symbols already analysed ("scanned") are skipped
// unless the user toggled them back in via the Multibagger list ("include in
// scan"). New candidates are always analysed. The cache persists until the next
// explicit update.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Recommendation } from './api';

const CACHE_KEY = 'taureye.reco.cache.v1';
const DEPTH_KEY = 'taureye.reco.depth.v1';
const INCLUDE_KEY = 'taureye.reco.include.v1';

export const DEPTH_OPTIONS = [25, 50, 75, 100] as const;
export const DEFAULT_DEPTH = 50;
export const MAX_DEPTH = 100;

export type ScanCache = {
  asof: number; // ms since epoch of the last scan
  depth: number; // scan depth used
  recs: Recommendation[]; // BUY recommendations to display
  scanned: string[]; // every symbol analysed (BUY or not) — skipped on rebuild
};

let cache: ScanCache | null = null;
let include: string[] = []; // symbols the user forced back into the next scan
let depth = DEFAULT_DEPTH;
let hydrated = false;

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export function subscribeScan(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const up = (s: string) => (s || '').trim().toUpperCase();

// One-time hydrate from AsyncStorage. Safe to call repeatedly.
export async function hydrateScan(): Promise<void> {
  if (hydrated) return;
  try {
    const [c, d, inc] = await Promise.all([
      AsyncStorage.getItem(CACHE_KEY),
      AsyncStorage.getItem(DEPTH_KEY),
      AsyncStorage.getItem(INCLUDE_KEY),
    ]);
    if (c) {
      const parsed = JSON.parse(c);
      if (parsed && Array.isArray(parsed.recs) && Array.isArray(parsed.scanned)) cache = parsed;
    }
    const dn = d ? parseInt(d, 10) : NaN;
    if (isFinite(dn) && dn > 0) depth = Math.min(MAX_DEPTH, dn);
    if (inc) {
      const p = JSON.parse(inc);
      if (Array.isArray(p)) include = p.map(up);
    }
  } catch {
    /* corrupt cache — start fresh */
  }
  hydrated = true;
  emit();
}

export function isHydrated(): boolean {
  return hydrated;
}
export function getCache(): ScanCache | null {
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

// ── "include in scan" toggle (per symbol) ────────────────────────────────────
export function getIncluded(): Set<string> {
  return new Set(include.map(up));
}
export function isIncluded(sym: string): boolean {
  return include.map(up).includes(up(sym));
}
export function toggleInclude(sym: string): void {
  const s = up(sym);
  include = include.map(up).includes(s) ? include.filter((x) => up(x) !== s) : [...include, s];
  AsyncStorage.setItem(INCLUDE_KEY, JSON.stringify(include)).catch(() => {});
  emit();
}
function clearIncluded(syms: string[]): void {
  const drop = new Set(syms.map(up));
  include = include.filter((x) => !drop.has(up(x)));
  AsyncStorage.setItem(INCLUDE_KEY, JSON.stringify(include)).catch(() => {});
}

// Persist a fresh scan result (called by RecommendationsScreen after a scan).
export async function saveScan(next: ScanCache): Promise<void> {
  cache = next;
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota errors */
  }
  emit();
}

// Merge a batch of freshly-analysed recommendations into the cache. BUYs are
// upserted into the visible list; every analysed symbol joins `scanned`; any
// symbol that was toggled "include" is cleared now that it's been re-scanned.
export async function mergeScan(
  analysed: Recommendation[],
  depthUsed: number,
  asof: number,
): Promise<void> {
  const prev = cache || { asof, depth: depthUsed, recs: [], scanned: [] };
  const bySym = new Map(prev.recs.map((r) => [up(r.symbol), r]));
  const scanned = new Set(prev.scanned.map(up));
  for (const r of analysed) {
    const s = up(r.symbol);
    scanned.add(s);
    if (r.action === 'BUY') bySym.set(s, r);
    else bySym.delete(s);
  }
  const recs = [...bySym.values()].sort((a, b) => b.confidence - a.confidence);
  clearIncluded(analysed.map((r) => r.symbol));
  await saveScan({ asof, depth: depthUsed, recs, scanned: [...scanned] });
}
