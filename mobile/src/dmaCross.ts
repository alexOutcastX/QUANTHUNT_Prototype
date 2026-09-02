// Stocks approaching a moving-average crossover.
//
// The screener can already tell you a cross HAS happened — `golden_cross` and
// friends are true on the day it does. That is the day everyone else sees it
// too. This module answers the question before it: which averages are about to
// meet, how far apart they still are, and whether they are actually closing.
//
// Closing is the part that matters and the part a distance alone cannot say.
// Two averages sitting 0.3% apart may have crossed last week and be separating;
// the same 0.3% with the gap halving each session is a cross in a few days. So
// the server sends each pair as [gap now, gap five sessions ago] (scanner.py,
// MA_PAIRS) and everything here is derived from that pair of numbers.
//
// Nothing in this file recommends a trade. A pending cross is a fact about two
// arithmetic means converging; whether it is worth acting on is not.

export type PairKey = '9_20' | '20_50' | '50_100' | '50_200';

export type PairDef = {
  key: PairKey;
  fast: number;
  slow: number;
  label: string;
  /** What the pair is normally read as, in one line. */
  blurb: string;
};

export const PAIRS: PairDef[] = [
  { key: '9_20', fast: 9, slow: 20, label: '9 / 20',
    blurb: 'The short-term turn — days, not weeks.' },
  { key: '20_50', fast: 20, slow: 50, label: '20 / 50',
    blurb: 'The swing turn most position traders watch.' },
  { key: '50_100', fast: 50, slow: 100, label: '50 / 100',
    blurb: 'The intermediate trend, between swing and primary.' },
  { key: '50_200', fast: 50, slow: 200, label: '50 / 200',
    blurb: 'The golden and death cross — the slowest and most watched.' },
];

export const PAIR_BY_KEY: Record<string, PairDef> = {};
PAIRS.forEach((p) => { PAIR_BY_KEY[p.key] = p; });

/** [gap now %, gap MA_GAP_LOOKBACK sessions ago %] — the shape scanner.py sends. */
export type GapPair = [number, number | null];
export type MaGaps = Partial<Record<PairKey, GapPair>>;

export type Direction = 'up' | 'down';

export type Approach = {
  symbol: string;
  name?: string;
  price?: number | null;
  chg?: number | null;
  pair: PairDef;
  /** Signed gap now, in percent. Negative = fast average below slow. */
  gap: number;
  /** How far apart they are, unsigned — what the list sorts on. */
  distance: number;
  /** The gap a week ago, when the feed carried one. */
  was: number | null;
  /** Up = fast is below and rising toward the slow average (a golden cross if
   *  it completes). Down = the reverse. */
  direction: Direction;
  /** Percentage points of gap closed per session, over the lookback. */
  speed: number | null;
  /** Sessions to contact at the current rate. Null when it is not closing, or
   *  when the feed gave no history to measure a rate from. */
  eta: number | null;
};

const LOOKBACK = 5;

const num = (v: unknown): number | null =>
  typeof v === 'number' && isFinite(v) ? v : null;

/**
 * Every pair of one symbol's averages that is within `within` percent and
 * genuinely converging.
 *
 * `within` is a half-width: 0.75 means "the averages are less than 0.75% apart".
 * A pair that is close but widening is dropped — it is the aftermath of a
 * cross, not the approach to one.
 */
export function approaches(
  row: { sym?: string; name?: string; price?: number | null; chg?: number | null; ma_gaps?: MaGaps | null },
  within: number,
): Approach[] {
  const sym = (row.sym || '').toUpperCase();
  const gaps = row.ma_gaps;
  if (!sym || !gaps) return [];
  const out: Approach[] = [];
  for (const pair of PAIRS) {
    const cell = gaps[pair.key];
    if (!Array.isArray(cell)) continue;
    const gap = num(cell[0]);
    if (gap == null) continue;
    const distance = Math.abs(gap);
    if (distance > within) continue;

    const was = num(cell[1]);
    // Widening means the cross already happened. Equal is kept: a gap holding
    // steady at a hair's breadth is still sitting on the line.
    if (was != null && Math.abs(was) < distance) continue;

    const speed = was != null ? (Math.abs(was) - distance) / LOOKBACK : null;
    // A rate of zero would divide to infinity, so it reports no estimate
    // rather than a number that means "never".
    const eta = speed != null && speed > 0 ? Math.max(1, Math.round(distance / speed)) : null;

    out.push({
      symbol: sym,
      name: row.name,
      price: row.price ?? null,
      chg: row.chg ?? null,
      pair,
      gap,
      distance,
      was,
      direction: gap < 0 ? 'up' : 'down',
      speed,
      eta,
    });
  }
  return out;
}

/**
 * The whole universe, nearest contact first.
 *
 * Ties break on the symbol so the order is stable between reloads — a list
 * that reshuffles under the reader is a list nobody trusts.
 */
export function scanApproaches(
  rows: Array<{ sym?: string; name?: string; price?: number | null; chg?: number | null; ma_gaps?: MaGaps | null }>,
  opts: { within: number; pair?: PairKey | 'all'; direction?: Direction | 'all' } = { within: 1 },
): Approach[] {
  const want = opts.pair && opts.pair !== 'all' ? opts.pair : null;
  const dir = opts.direction && opts.direction !== 'all' ? opts.direction : null;
  const out: Approach[] = [];
  for (const row of rows || []) {
    for (const a of approaches(row, opts.within)) {
      if (want && a.pair.key !== want) continue;
      if (dir && a.direction !== dir) continue;
      out.push(a);
    }
  }
  out.sort((a, b) => (a.distance - b.distance) || a.symbol.localeCompare(b.symbol));
  return out;
}

/** How many candidates each pair has, for the counts on the chips. */
export function countByPair(list: Approach[]): Record<string, number> {
  const out: Record<string, number> = { all: list.length };
  PAIRS.forEach((p) => { out[p.key] = 0; });
  list.forEach((a) => { out[a.pair.key] += 1; });
  return out;
}

/** "in ~3 sessions" / "any session now" / "" when there is no estimate. */
export function etaLabel(a: Approach): string {
  if (a.eta == null) return '';
  if (a.eta <= 1) return 'any session now';
  return `~${a.eta} sessions`;
}

/** What completing this cross would be called. */
export function crossName(a: Approach): string {
  if (a.pair.key === '50_200') return a.direction === 'up' ? 'Golden cross' : 'Death cross';
  return a.direction === 'up' ? 'Bullish cross' : 'Bearish cross';
}
