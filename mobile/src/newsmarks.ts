// Saved headlines — a watchlist for news.
//
// A story you want to come back to has, until now, had nowhere to go: the feed
// scrolls past within the hour and the tab you left open is not a system. This
// is the same shape as the watchlist and syncs the same way (the key is
// registered in session.ts), so a headline saved on a phone is there on a
// desktop.
//
// The item is stored whole rather than as a link. The archive prunes at a
// month and publishers move URLs; something you deliberately kept should
// outlive both, and a title and a source are enough to find it again.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'taureye.newsmarks.v1';
const MAX = 300;

export type SavedNews = {
  id: string;
  title: string;
  link: string;
  source?: string;
  ts?: number | null;
  summary?: string;
  /** When it was saved, which is the order the list reads in. */
  saved: number;
};

const listeners = new Set<() => void>();
let cache: SavedNews[] | null = null;

export function subscribeNewsmarks(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function emit() {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* one bad subscriber must not stop the rest */
    }
  });
}

/** Identity is the link — titles get edited after publication. */
export function newsId(link: string): string {
  return (link || '').trim().toLowerCase();
}

function clean(raw: string | null): SavedNews[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const seen = new Set<string>();
    const out: SavedNews[] = [];
    for (const x of arr) {
      const e = x as Record<string, unknown>;
      const link = typeof e?.link === 'string' ? e.link : '';
      const title = typeof e?.title === 'string' ? e.title : '';
      const id = newsId(link);
      if (!id || !title || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        link,
        title,
        source: typeof e.source === 'string' ? e.source : undefined,
        ts: typeof e.ts === 'number' ? e.ts : null,
        summary: typeof e.summary === 'string' ? e.summary : undefined,
        saved: typeof e.saved === 'number' ? e.saved : 0,
      });
    }
    return out.sort((a, b) => b.saved - a.saved);
  } catch {
    return [];
  }
}

export async function loadNewsmarks(): Promise<SavedNews[]> {
  if (cache) return cache;
  cache = clean(await AsyncStorage.getItem(KEY).catch(() => null));
  return cache;
}

/** What is saved right now, without waiting — null until the first load. */
export function newsmarksNow(): SavedNews[] | null {
  return cache;
}

async function write(list: SavedNews[]): Promise<SavedNews[]> {
  cache = list.slice(0, MAX);
  await AsyncStorage.setItem(KEY, JSON.stringify(cache)).catch(() => {});
  emit();
  return cache;
}

export async function toggleNewsmark(item: {
  title: string;
  link: string;
  source?: string;
  ts?: number | null;
  summary?: string;
}): Promise<boolean> {
  const list = await loadNewsmarks();
  const id = newsId(item.link);
  if (!id || !item.title) return false;
  const had = list.some((x) => x.id === id);
  await write(
    had
      ? list.filter((x) => x.id !== id)
      : [{ ...item, id, saved: Math.floor(Date.now() / 1000) }, ...list],
  );
  return !had;
}

export async function removeNewsmark(id: string): Promise<void> {
  await write((await loadNewsmarks()).filter((x) => x.id !== id));
}

export function isSaved(link: string): boolean {
  const id = newsId(link);
  return !!cache && cache.some((x) => x.id === id);
}
