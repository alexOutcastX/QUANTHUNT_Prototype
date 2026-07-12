// Index + market-cap-segment names understood by the Terminal command line
// (and the Universe browser). One list so autocomplete and routing agree.
export const INDEX_NAMES = [
  'NIFTY 50', 'NIFTY 100', 'NIFTY 200', 'NIFTY 500', 'NIFTY BANK', 'NIFTY IT',
  'NIFTY AUTO', 'NIFTY PHARMA', 'NIFTY FMCG', 'NIFTY METAL',
  'NIFTY MIDCAP 100', 'NIFTY MIDCAP 150', 'NIFTY SMALLCAP 100',
  'NIFTY SMALLCAP 250', 'NIFTY MICROCAP 250',
];

export const SEGMENT_NAMES = ['LARGE CAP', 'MID CAP', 'SMALL CAP'];

// Resolve loose command-line input ("nifty50", "bank", "midcap") to a
// canonical index/segment name, or null if it isn't one.
export function resolveIndex(raw: string): string | null {
  const q = raw.trim().toUpperCase().replace(/\s+/g, ' ');
  if (!q) return null;
  const all = [...INDEX_NAMES, ...SEGMENT_NAMES];
  const exact = all.find((n) => n === q || n.replace(/ /g, '') === q.replace(/ /g, ''));
  if (exact) return exact;
  // common shorthand: "BANK" → NIFTY BANK, "MIDCAP 100" → NIFTY MIDCAP 100
  const prefixed = all.find((n) => n === 'NIFTY ' + q || n.replace(/ /g, '') === ('NIFTY' + q).replace(/ /g, ''));
  return prefixed || null;
}
