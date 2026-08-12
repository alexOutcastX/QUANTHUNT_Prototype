// MACD strategy — the one screen where YOU set the thresholds.
//
// Every other strategy in the app is a fixed predicate. This one is tunable,
// because "slowly crossing the DMAs" is not a single rule: which average
// matters, how far below it still counts as "approaching", and what RSI band
// you consider constructive are all judgement calls that differ per trader and
// per market.
//
// It works on anything carrying the MACD + moving-average ladder, which both
// the momentum radar and the long-term recommendation list now emit. The
// distances (d20/d50/d200) are PERCENTAGES from that SMA, so negative means
// price is below it.

/** The fields the filter needs. Everything is optional — a symbol whose
 *  history was too short to compute an indicator must not silently pass a
 *  filter it was never actually tested against. */
export type MacdRow = {
  rsi?: number | null;
  macd?: number | null;              // histogram: MACD line − signal line
  macd_prev?: number | null;         // one bar ago, for slope
  macd_bull_cross?: boolean | null;
  macd_bear_cross?: boolean | null;
  d20?: number | null;
  d50?: number | null;
  d150?: number | null;
  d200?: number | null;
};

export type DmaPeriod = 20 | 50 | 150 | 200;

/** Where price must sit relative to the chosen moving average. */
export type DmaSide =
  | 'any'
  | 'below'        // still under it — early / bottom-fishing
  | 'approaching'  // below, but within `near_pct` — "slowly crossing up"
  | 'above'        // reclaimed it
  | 'just_above';  // above, but within `near_pct` — fresh reclaim

/** What the MACD itself must be doing. */
export type MacdMode =
  | 'any'
  | 'bull_cross'    // histogram flipped negative → positive on this bar
  | 'bear_cross'
  | 'rising'        // histogram increasing, still below zero — the turn building
  | 'positive'      // histogram above zero
  | 'negative';

export type MacdParams = {
  dma: DmaPeriod;
  side: DmaSide;
  near_pct: number;     // width of "approaching" / "just above", in %
  rsi_min: number;
  rsi_max: number;
  macd: MacdMode;
};

export const MACD_DEFAULTS: MacdParams = {
  dma: 200,
  side: 'approaching',
  near_pct: 8,
  rsi_min: 40,
  rsi_max: 65,
  macd: 'rising',
};

export const DMA_CHOICES: DmaPeriod[] = [20, 50, 150, 200];

export const SIDE_LABELS: Record<DmaSide, string> = {
  any: 'Any position',
  below: 'Below the DMA',
  approaching: 'Below, closing in',
  above: 'Above the DMA',
  just_above: 'Just reclaimed it',
};

export const MACD_LABELS: Record<MacdMode, string> = {
  any: 'Any MACD',
  bull_cross: 'Bullish cross (today)',
  bear_cross: 'Bearish cross (today)',
  rising: 'Turning up (below zero)',
  positive: 'Histogram positive',
  negative: 'Histogram negative',
};

/** The % distance from the chosen average, or null when it wasn't computed. */
export function dmaDistance(row: MacdRow, dma: DmaPeriod): number | null {
  const v = dma === 20 ? row.d20 : dma === 50 ? row.d50 : dma === 150 ? row.d150 : row.d200;
  return v == null ? null : v;
}

function sideOk(dist: number | null, side: DmaSide, near: number): boolean {
  if (side === 'any') return true;
  // Unknown distance fails every specific test. Treating "we couldn't measure
  // it" as a pass would put stocks in the list that were never checked.
  if (dist == null) return false;
  switch (side) {
    case 'below': return dist < 0;
    case 'approaching': return dist < 0 && dist >= -Math.abs(near);
    case 'above': return dist > 0;
    case 'just_above': return dist > 0 && dist <= Math.abs(near);
    default: return true;
  }
}

function macdOk(row: MacdRow, mode: MacdMode): boolean {
  if (mode === 'any') return true;
  const h = row.macd;
  const p = row.macd_prev;
  switch (mode) {
    case 'bull_cross':
      // Prefer the server's flag; fall back to the two histogram bars when a
      // feed carries the values but not the flag.
      if (row.macd_bull_cross != null) return !!row.macd_bull_cross;
      return h != null && p != null && p <= 0 && h > 0;
    case 'bear_cross':
      if (row.macd_bear_cross != null) return !!row.macd_bear_cross;
      return h != null && p != null && p >= 0 && h < 0;
    case 'rising':
      // The "slowly crossing" case: momentum improving while still negative,
      // i.e. the turn is forming but has not fired yet.
      return h != null && p != null && h > p && h <= 0;
    case 'positive': return h != null && h > 0;
    case 'negative': return h != null && h < 0;
    default: return true;
  }
}

function rsiOk(rsi: number | null | undefined, min: number, max: number): boolean {
  if (min <= 0 && max >= 100) return true;   // band wide open — don't require RSI
  if (rsi == null) return false;
  return rsi >= min && rsi <= max;
}

/** Does this row pass the configured MACD screen? */
export function matchesMacd(row: MacdRow, p: MacdParams): boolean {
  return sideOk(dmaDistance(row, p.dma), p.side, p.near_pct)
    && macdOk(row, p.macd)
    && rsiOk(row.rsi, p.rsi_min, p.rsi_max);
}

/**
 * Rank: closest to the crossover first.
 *
 * The interesting name is the one about to resolve, not the one furthest from
 * the average — so rows sort by absolute distance from the chosen DMA, with a
 * rising histogram breaking ties.
 */
export function rankMacd<T extends MacdRow>(rows: T[], p: MacdParams): T[] {
  return [...rows].sort((a, b) => {
    const da = Math.abs(dmaDistance(a, p.dma) ?? 999);
    const db = Math.abs(dmaDistance(b, p.dma) ?? 999);
    if (da !== db) return da - db;
    const sa = (a.macd ?? 0) - (a.macd_prev ?? 0);
    const sb = (b.macd ?? 0) - (b.macd_prev ?? 0);
    return sb - sa;
  });
}

/** One-line description of the active settings, for the UI summary. */
export function describeMacd(p: MacdParams): string {
  const bits = [
    `${SIDE_LABELS[p.side].toLowerCase()} (${p.dma}-DMA)`,
    MACD_LABELS[p.macd].toLowerCase(),
  ];
  if (!(p.rsi_min <= 0 && p.rsi_max >= 100)) bits.push(`RSI ${p.rsi_min}–${p.rsi_max}`);
  return bits.join(' · ');
}
