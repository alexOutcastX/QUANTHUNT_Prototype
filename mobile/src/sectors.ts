// Canonical sector taxonomy shared by every screener + the sectoral heatmap.
//
// The whole app now speaks NSE's macro-economic sectors (~21) rather than
// Yahoo's 11 GICS buckets. The backend classifies every scrip into one of these
// (from the NSE index "Industry" files, with a GICS-translation fallback for the
// long tail — see sectors.py), so a per-stock `sector` field and the heatmap
// tiles use the same detailed labels, and a heatmap tap always routes into a
// screener that recognises the sector. `mergeSectors` still folds in any extra
// label the live data throws up so nothing is ever un-selectable.

export const CANONICAL_SECTORS: string[] = [
  'Automobile and Auto Components',
  'Capital Goods',
  'Chemicals',
  'Construction',
  'Construction Materials',
  'Consumer Durables',
  'Consumer Services',
  'Diversified',
  'Fast Moving Consumer Goods',
  'Financial Services',
  'Forest Materials',
  'Healthcare',
  'Information Technology',
  'Media Entertainment & Publication',
  'Metals & Mining',
  'Oil Gas & Consumable Fuels',
  'Power',
  'Realty',
  'Services',
  'Telecommunication',
  'Textiles',
];

// Short display + heat-tile label for each canonical sector (keeps tiles
// legible — the full NSE names are long).
export const SECTOR_SHORT: Record<string, string> = {
  'Automobile and Auto Components': 'Auto',
  'Capital Goods': 'Capital Goods',
  Chemicals: 'Chemicals',
  Construction: 'Construction',
  'Construction Materials': 'Constr. Materials',
  'Consumer Durables': 'Consumer Dur.',
  'Consumer Services': 'Consumer Svc.',
  Diversified: 'Diversified',
  'Fast Moving Consumer Goods': 'FMCG',
  'Financial Services': 'Financials',
  'Forest Materials': 'Forest Mat.',
  Healthcare: 'Healthcare',
  'Information Technology': 'IT',
  'Media Entertainment & Publication': 'Media',
  'Metals & Mining': 'Metals & Mining',
  'Oil Gas & Consumable Fuels': 'Oil & Gas',
  Power: 'Power',
  Realty: 'Realty',
  Services: 'Services',
  Telecommunication: 'Telecom',
  Textiles: 'Textiles',
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
