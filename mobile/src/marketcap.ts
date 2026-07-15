// Market-cap classification shared by the Multibagger / Momentum lists and the
// heatmaps, so a stock is tagged consistently everywhere.
//
// Bands are approximate absolute proxies for SEBI's rank-based definition
// (Large = ~top 100 by m-cap, Mid = ~101–250, Small = the rest). Rank-based is
// the exact rule but needs the fully-ranked universe; these ₹-crore cutoffs are
// close enough for a visual tag and don't need a universe fetch per row.
import { theme } from './theme';

export type CapKey = 'large' | 'mid' | 'small' | 'micro';
export type CapBand = { key: CapKey; label: string; short: string; color: string };

const LARGE: CapBand = { key: 'large', label: 'Large Cap', short: 'LARGE', color: '#4f9dff' };
const MID: CapBand = { key: 'mid', label: 'Mid Cap', short: 'MID', color: theme.green };
const SMALL: CapBand = { key: 'small', label: 'Small Cap', short: 'SMALL', color: '#f5a623' };
const MICRO: CapBand = { key: 'micro', label: 'Micro Cap', short: 'MICRO', color: theme.muted2 };

// mcapCr = market capitalisation in ₹ crore.
export function capBand(mcapCr?: number | null): CapBand | null {
  if (mcapCr == null || !Number.isFinite(mcapCr)) return null;
  if (mcapCr >= 50000) return LARGE;
  if (mcapCr >= 17000) return MID;
  if (mcapCr >= 1000) return SMALL;
  return MICRO;
}

export const CAP_ORDER: CapKey[] = ['large', 'mid', 'small', 'micro'];
