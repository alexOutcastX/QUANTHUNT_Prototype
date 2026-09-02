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

/** [gap now %, gap 5 sessions ago %, how far the gap moves in a session] —
 *  the shape scanner.py sends. The third element arrived later than the first
 *  two, so a snapshot built before it simply has a shorter array. */
export type GapPair = [number, number | null, (number | null)?];
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
  /** How far the gap moves in a typical session, in percentage points. */
  sigma: number | null;
  /** Modelled chance of the averages touching within the horizon, 0-1.
   *  Null when the feed carries no volatility to model with. */
  probability: number | null;
};

const LOOKBACK = 5;

/** The default horizon a probability is quoted over, in sessions. */
export const DEFAULT_HORIZON = 10;
export const HORIZONS = [5, 10, 20];

/**
 * The standard normal CDF.
 *
 * Abramowitz & Stegun 7.1.26 for erf, good to about 1.5e-7 — far finer than a
 * number rounded to a whole percent needs, and it keeps this file dependency
 * free so the engine can be compiled and swept on its own.
 */
function normCdf(x: number): number {
  const z = x / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  const erf = z >= 0 ? y : -y;
  return 0.5 * (1 + erf);
}

/**
 * The chance the two averages touch within `horizon` sessions.
 *
 * The gap is treated as a random walk with drift: it is `distance` points from
 * zero, closing at `drift` points a session, and moving `sigma` points in a
 * typical session. That is the first-passage problem for arithmetic Brownian
 * motion, and it has a closed form — no simulation, no fitted constants.
 *
 * WHAT THIS IS NOT: a gap between two moving averages is not a random walk.
 * Both averages are smoothed, so the gap is smoother and more persistent than
 * the model assumes, and the model will read high on a pair that is drifting
 * steadily. It is a consistent way to RANK candidates by how likely they are
 * to complete, not a forecast of any one of them. The card says so on itself.
 */
export function crossProbability(
  distance: number, drift: number | null, sigma: number | null, horizon: number,
): number | null {
  if (sigma == null || !isFinite(sigma) || horizon <= 0) return null;
  const d = Math.abs(distance);
  const mu = drift == null || !isFinite(drift) ? 0 : drift;

  // Already touching: the answer is one, and the formula divides by zero here.
  if (d === 0) return 1;

  // A gap that does not move cannot be modelled probabilistically — it either
  // arrives on the straight line or it never does.
  if (sigma <= 0) return mu > 0 && d / mu <= horizon ? 1 : 0;

  const s = sigma * Math.sqrt(horizon);
  const a = normCdf((-d + mu * horizon) / s);
  // The reflection term. exp() overflows for a fast drift over a wide gap, and
  // the product is a probability either way, so it is clamped rather than
  // allowed to become Infinity * 0.
  const exponent = (2 * mu * d) / (sigma * sigma);
  const b = exponent > 700 ? 1 : Math.exp(exponent) * normCdf((-d - mu * horizon) / s);
  const p = a + b;
  return p <= 0 ? 0 : p >= 1 ? 1 : p;
}

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
  horizon: number = DEFAULT_HORIZON,
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

    const sigma = num(cell[2] as number | null | undefined);
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
      sigma,
      probability: crossProbability(distance, speed, sigma, horizon),
    });
  }
  return out;
}

export type SortKey = 'near' | 'probability' | 'time';

export const SORTS: { key: SortKey; label: string; note: string }[] = [
  { key: 'near', label: 'Nearest', note: 'Smallest gap between the two averages.' },
  { key: 'probability', label: 'Probability', note: 'Most likely to complete within the horizon.' },
  { key: 'time', label: 'Soonest', note: 'Fewest sessions to contact at the rate the gap is closing.' },
];

/**
 * The comparator for one sort key.
 *
 * Every one of them ends on the symbol, so the order is stable between
 * reloads — a list that reshuffles under the reader is a list nobody trusts.
 * And rows with nothing to sort on go last rather than sorting as zero: an
 * unknown probability is not a low one, and an unknown ETA is not an immediate
 * one. Sorting them as such would put the least-known rows at the top.
 */
function compare(key: SortKey) {
  return (a: Approach, b: Approach): number => {
    if (key === 'probability') {
      const pa = a.probability == null ? -1 : a.probability;
      const pb = b.probability == null ? -1 : b.probability;
      if (pa !== pb) return pb - pa;                    // likeliest first
    } else if (key === 'time') {
      const ta = a.eta == null ? Infinity : a.eta;
      const tb = b.eta == null ? Infinity : b.eta;
      if (ta !== tb) return ta - tb;                    // soonest first
    }
    // 'near' outright, and the tiebreak for the other two: a closer pair is
    // the better row when the headline number cannot separate them.
    if (a.distance !== b.distance) return a.distance - b.distance;
    return a.symbol.localeCompare(b.symbol) || a.pair.key.localeCompare(b.pair.key);
  };
}

/**
 * The whole universe, ordered by the chosen key.
 */
export function scanApproaches(
  rows: Array<{ sym?: string; name?: string; price?: number | null; chg?: number | null; ma_gaps?: MaGaps | null }>,
  opts: {
    within: number; pair?: PairKey | 'all'; direction?: Direction | 'all';
    horizon?: number; sort?: SortKey;
  } = { within: 1 },
): Approach[] {
  const want = opts.pair && opts.pair !== 'all' ? opts.pair : null;
  const dir = opts.direction && opts.direction !== 'all' ? opts.direction : null;
  const horizon = opts.horizon || DEFAULT_HORIZON;
  const out: Approach[] = [];
  for (const row of rows || []) {
    for (const a of approaches(row, opts.within, horizon)) {
      if (want && a.pair.key !== want) continue;
      if (dir && a.direction !== dir) continue;
      out.push(a);
    }
  }
  out.sort(compare(opts.sort || 'near'));
  return out;
}

/** "62%" — or an em dash where the feed carries no volatility to model with. */
export function probabilityLabel(a: Approach): string {
  return a.probability == null ? '—' : `${Math.round(a.probability * 100)}%`;
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
