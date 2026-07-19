// Canonical sector taxonomy shared by every screener + the sectoral heatmap.
//
// The app's per-stock sector comes from the fundamentals feed (Yahoo `sector`),
// which uses the 11 GICS sectors. Screens historically built their sector-filter
// chips only from sectors *present in the current results*, so a sector with no
// current match was un-selectable — and the heatmap couldn't route into it. This
// module gives every screen the full, exhaustive list so any sector is always a
// valid filter, and `mergeSectors` folds in any extra label the live data throws
// up (defensive: a feed occasionally returns a non-GICS string).

export const CANONICAL_SECTORS: string[] = [
  'Basic Materials',
  'Communication Services',
  'Consumer Cyclical',
  'Consumer Defensive',
  'Energy',
  'Financial Services',
  'Healthcare',
  'Industrials',
  'Real Estate',
  'Technology',
  'Utilities',
];

// Short display + heat-tile label for each canonical sector (keeps tiles legible).
export const SECTOR_SHORT: Record<string, string> = {
  'Basic Materials': 'Materials',
  'Communication Services': 'Comms',
  'Consumer Cyclical': 'Consumer Cyc.',
  'Consumer Defensive': 'Consumer Def.',
  Energy: 'Energy',
  'Financial Services': 'Financials',
  Healthcare: 'Healthcare',
  Industrials: 'Industrials',
  'Real Estate': 'Real Estate',
  Technology: 'Technology',
  Utilities: 'Utilities',
};

// The exhaustive, de-duplicated, sorted sector list: the canonical set unioned
// with whatever sectors are present in the caller's current rows.
export function mergeSectors(present: Array<string | null | undefined>): string[] {
  const set = new Set<string>(CANONICAL_SECTORS);
  present.forEach((s) => {
    const v = (s || '').trim();
    if (v) set.add(v);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export const shortSector = (s: string): string => SECTOR_SHORT[s] || s;
