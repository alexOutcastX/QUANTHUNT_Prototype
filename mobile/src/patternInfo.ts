// Plain-language explainers for the classic chart patterns the recogniser
// detects (patterns.py). Keyed by the human label shown on the card. `what`
// describes the shape; `implies` the textbook expectation once it resolves.
// Educational only — patterns are probabilistic, never guarantees.

export type PatternDesc = { what: string; implies: string };

const NEUTRAL: PatternDesc = {
  what: 'A recognised chart formation in the price action.',
  implies: 'Direction depends on how it resolves — watch the key level for confirmation.',
};

// Normalise a label so "Inverse Head & Shoulders" and "Inverse Head and
// Shoulders" (and casing/spacing variants) map to the same entry.
export function normPattern(label: string): string {
  return (label || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const RAW: Record<string, PatternDesc> = {
  'rounding top': {
    what: 'A slow, dome-shaped rollover: buying momentum fades and an uptrend gradually curves into a downtrend, forming a rounded arch of highs.',
    implies: 'A bearish reversal. A break below the base of the dome (the key level) typically projects a measured move down.',
  },
  'rounding bottom': {
    what: 'A gentle, saucer-shaped base: selling pressure slowly exhausts and a downtrend curves into an uptrend.',
    implies: 'A bullish reversal. A break above the rim (the key level) projects a measured move up.',
  },
  'double top': {
    what: 'Two roughly equal peaks with a trough between them — price fails twice at the same resistance.',
    implies: 'A bearish reversal, confirmed when price closes below the trough (the neckline / key level).',
  },
  'double bottom': {
    what: 'Two roughly equal troughs with a peak between them — price holds twice at the same support.',
    implies: 'A bullish reversal, confirmed when price closes above the middle peak (the neckline / key level).',
  },
  'triple top': {
    what: 'Three failed attempts at the same resistance level — an even stronger rejection than a double top.',
    implies: 'A bearish reversal on a close below the support connecting the troughs.',
  },
  'triple bottom': {
    what: 'Three successful defences of the same support level — a strong base.',
    implies: 'A bullish reversal on a close above the resistance connecting the peaks.',
  },
  'head and shoulders': {
    what: 'Three peaks — a higher middle peak (head) flanked by two lower peaks (shoulders) — sharing a common support (the neckline).',
    implies: 'A classic bearish reversal. A break below the neckline projects the head-to-neckline height downward.',
  },
  'inverse head and shoulders': {
    what: 'Three troughs — a lower middle trough (head) flanked by two higher troughs (shoulders) — sharing a common resistance (the neckline).',
    implies: 'A bullish reversal. A break above the neckline projects the head-to-neckline height upward.',
  },
  'ascending triangle': {
    what: 'A flat resistance line with a rising support line — higher lows pressing into a ceiling.',
    implies: 'Usually a bullish continuation; a breakout above the flat top projects the triangle height up.',
  },
  'descending triangle': {
    what: 'A flat support line with a falling resistance line — lower highs pressing onto a floor.',
    implies: 'Usually a bearish continuation; a breakdown below the flat base projects the triangle height down.',
  },
  'symmetrical triangle': {
    what: 'Converging trendlines — lower highs and higher lows — as the range tightens into a coil.',
    implies: 'A continuation of the prior trend most often; trade the breakout direction, target the triangle height.',
  },
  'rising wedge': {
    what: 'Two upward-sloping converging lines, with the lows rising faster than the highs — momentum narrowing.',
    implies: 'A bearish pattern (reversal in an uptrend, continuation in a downtrend); resolves with a downside break.',
  },
  'falling wedge': {
    what: 'Two downward-sloping converging lines, with the highs falling faster than the lows.',
    implies: 'A bullish pattern; resolves with an upside break out of the wedge.',
  },
  'bull flag': {
    what: 'A sharp rally (the pole) followed by a shallow, downward-drifting consolidation channel (the flag).',
    implies: 'A bullish continuation; a break above the flag projects roughly the pole height higher.',
  },
  'bear flag': {
    what: 'A sharp drop (the pole) followed by a shallow, upward-drifting consolidation channel.',
    implies: 'A bearish continuation; a break below the flag projects roughly the pole height lower.',
  },
  'bull pennant': {
    what: 'A strong advance followed by a small symmetrical-triangle consolidation.',
    implies: 'A bullish continuation on a breakout above the pennant.',
  },
  'bear pennant': {
    what: 'A strong decline followed by a small symmetrical-triangle consolidation.',
    implies: 'A bearish continuation on a breakdown below the pennant.',
  },
  'ascending channel': {
    what: 'Price trending up between two parallel rising lines — an orderly uptrend.',
    implies: 'Bullish while it holds; buy near the lower rail, watch for a breakdown that ends the trend.',
  },
  'descending channel': {
    what: 'Price trending down between two parallel falling lines — an orderly downtrend.',
    implies: 'Bearish while it holds; a break above the upper rail signals the downtrend may be ending.',
  },
  'cup and handle': {
    what: 'A rounded "cup" base followed by a small downward "handle" drift near the rim.',
    implies: 'A bullish continuation; a break above the rim/handle projects the cup depth upward.',
  },
  'v-top': {
    what: 'A sharp, near-vertical rally that reverses abruptly to the downside with no rounding.',
    implies: 'A fast bearish reversal — high momentum, often little warning; manage risk tightly.',
  },
  'v-bottom': {
    what: 'A sharp, near-vertical sell-off that reverses abruptly to the upside.',
    implies: 'A fast bullish reversal — high momentum; confirmation comes from follow-through buying.',
  },
};

export const PATTERN_DESC: Record<string, PatternDesc> = Object.fromEntries(
  Object.entries(RAW).map(([k, v]) => [normPattern(k), v]),
);

export function describePattern(label: string): PatternDesc {
  return PATTERN_DESC[normPattern(label)] || NEUTRAL;
}
