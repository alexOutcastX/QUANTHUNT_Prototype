// Persistent portfolio backed by AsyncStorage. Each holding is a symbol with a
// quantity and average buy price, tagged with a holding group (e.g. "Core"
// long-term positions vs an active "Trading" book) so buys and sells operate
// on the selected group and long-term positions can't be sold by mistake.
// Live valuation is layered on top at render time from /ltp quotes.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'taureye.portfolio.v1';
const GROUPS_KEY = 'taureye.portfolio.groups.v1';

export type Holding = { symbol: string; qty: number; avg: number; group?: string };

// Rows saved before groups existed have no group — they belong to the default.
export const DEFAULT_GROUP = 'Core';
export const groupOf = (h: Holding): string => h.group || DEFAULT_GROUP;

export function normSymbol(s: string): string {
  return (s || '').trim().toUpperCase().replace(/^NSE:/, '');
}

export async function loadPortfolio(): Promise<Holding[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((h) => h && typeof h.symbol === 'string')
      .map((h) => ({
        symbol: h.symbol,
        qty: Number(h.qty) || 0,
        avg: Number(h.avg) || 0,
        ...(typeof h.group === 'string' && h.group.trim() ? { group: h.group.trim() } : {}),
      }));
  } catch {
    return [];
  }
}

async function save(list: Holding[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* best-effort persistence */
  }
}

// Custom group names, kept even while empty so a freshly-created group
// survives until its first buy.
export async function loadGroups(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(GROUPS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((g) => typeof g === 'string' && g.trim()) : [];
  } catch {
    return [];
  }
}

export async function saveGroups(groups: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
  } catch {
    /* best-effort persistence */
  }
}

// Adds a lot to a group. If the symbol already exists IN THAT GROUP, blends
// into a weighted average so buying the same stock twice reflects the true
// cost basis; the same symbol may be held separately in other groups.
export async function addHolding(
  list: Holding[],
  rawSym: string,
  qty: number,
  price: number,
  group?: string,
): Promise<Holding[]> {
  const symbol = normSymbol(rawSym);
  const g = (group || DEFAULT_GROUP).trim() || DEFAULT_GROUP;
  if (!symbol || !(qty > 0) || !(price > 0)) return list;
  const idx = list.findIndex((h) => h.symbol === symbol && groupOf(h) === g);
  let next: Holding[];
  if (idx >= 0) {
    const cur = list[idx];
    const totQty = cur.qty + qty;
    const avg = (cur.qty * cur.avg + qty * price) / totQty;
    next = list.map((h, i) => (i === idx ? { ...cur, qty: totQty, avg } : h));
  } else {
    next = [...list, { symbol, qty, avg: price, ...(g !== DEFAULT_GROUP ? { group: g } : {}) }];
  }
  await save(next);
  return next;
}

// Removes a holding from ONE group only — positions of the same symbol parked
// in other groups are untouched (the whole point of grouping).
export async function removeHolding(list: Holding[], symbol: string, group?: string): Promise<Holding[]> {
  const next = group == null
    ? list.filter((h) => h.symbol !== symbol)
    : list.filter((h) => !(h.symbol === symbol && groupOf(h) === group));
  await save(next);
  return next;
}

// Re-files a holding into another group; if the symbol already exists there,
// the lots merge into a weighted average.
export async function moveHolding(
  list: Holding[],
  symbol: string,
  fromGroup: string,
  toGroup: string,
): Promise<Holding[]> {
  const to = toGroup.trim() || DEFAULT_GROUP;
  const src = list.find((h) => h.symbol === symbol && groupOf(h) === fromGroup);
  if (!src || fromGroup === to) return list;
  const dst = list.find((h) => h.symbol === symbol && groupOf(h) === to);
  let next: Holding[];
  if (dst) {
    const totQty = dst.qty + src.qty;
    const avg = totQty > 0 ? (dst.qty * dst.avg + src.qty * src.avg) / totQty : 0;
    next = list
      .filter((h) => h !== src)
      .map((h) => (h === dst ? { ...dst, qty: totQty, avg } : h));
  } else {
    next = list.map((h) => (h === src ? { symbol, qty: src.qty, avg: src.avg, ...(to !== DEFAULT_GROUP ? { group: to } : {}) } : h));
  }
  await save(next);
  return next;
}

// Merge broker-synced holdings into the local list: broker rows win by
// symbol (their qty/avg are the demat truth) and keep whichever group the
// symbol already lives in; symbols new to the portfolio land in the default
// group. Manual rows not held at the broker are kept.
export async function importHoldings(
  list: Holding[],
  imported: { symbol: string; qty: number; avg_price?: number | null }[],
): Promise<Holding[]> {
  const next = [...list];
  for (const b of imported) {
    const symbol = normSymbol(b.symbol);
    if (!symbol || !b.qty) continue;
    const matches = next.filter((h) => h.symbol === symbol);
    // A symbol deliberately split across groups is the user's own accounting —
    // overwriting one row with the broker's TOTAL would double-count, so leave
    // manual splits alone.
    if (matches.length > 1) continue;
    if (matches.length === 1) {
      const idx = next.indexOf(matches[0]);
      next[idx] = { ...matches[0], qty: b.qty, avg: b.avg_price ?? matches[0].avg };
    } else {
      next.push({ symbol, qty: b.qty, avg: b.avg_price ?? 0 });
    }
  }
  await save(next);
  return next;
}
