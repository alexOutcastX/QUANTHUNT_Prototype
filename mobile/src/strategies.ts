// Stock-selection strategies for the Long-term and Short-term recommendation
// screens. Each strategy re-ranks / filters the candidate pool by a named,
// well-known approach and carries a detailed explanation shown in the ⓘ popup.
// The default ("balanced") applies no strategy — the ⓘ button only highlights
// once a specific strategy is chosen.
import type { Recommendation } from './api';
import type { InfoContent } from './ui';

export type Strategy<T> = {
  id: string;
  name: string;
  info: InfoContent;
  apply: (rows: T[]) => T[];
};

const DISC =
  'For research and education only — a screener that surfaces candidates by a named method, not investment advice. Always confirm on your own chart, size to your risk and use a stop.';

// ── Long-term strategies (over the Recommendation candidate pool) ────────────
type Rec = Recommendation;
const byDesc = (f: (r: Rec) => number) => (a: Rec, b: Rec) => f(b) - f(a);
const conf = (r: Rec) => r.confidence ?? 0;
const fund = (r: Rec) => r.fundamental_score ?? 0;
const mom = (r: Rec) => r.momentum_score ?? 0;
const pat = (r: Rec) => r.pattern_score ?? 0;
const rr = (r: Rec) => r.rr ?? 0;

export const LONG_STRATEGIES: Strategy<Rec>[] = [
  {
    id: 'balanced',
    name: 'Balanced (default)',
    info: {
      about:
        'The default blend — every candidate that passed the Multibagger analyser, ranked by an overall confidence that combines fundamentals, live momentum and the current chart pattern. Pick a specific strategy below to re-rank the same pool around one philosophy.',
      sections: [
        { heading: 'What it favours', bullets: [
          'A balance of quality, trend and setup — no single factor dominates.',
          'Higher confidence = more of the model lines up at once.',
        ] },
      ],
      disclaimer: DISC,
    },
    apply: (rows) => [...rows].sort(byDesc(conf)),
  },
  {
    id: 'minervini',
    name: 'Minervini Trend Template',
    info: {
      about:
        "Mark Minervini's Trend Template — buy strength, not hope. It keeps only names in a confirmed stage-2 advance (strong momentum, not under 'avoid') and ranks them by trend strength, so you fish where the leaders are.",
      sections: [
        { heading: 'The 8 rules it leans on', bullets: [
          'Price above the 50, 150 and 200-day moving averages.',
          '150-DMA above the 200-DMA, and the 200-DMA itself rising.',
          '50-DMA above both the 150 and 200-DMA (proper stacking).',
          'At least 30% above the 52-week low, within 25% of the 52-week high.',
          'Strong relative strength vs the broad market.',
        ] },
        { heading: 'How to trade it', bullets: [
          'Enter on a proper breakout from a tight base, on volume.',
          'Leaders emerge from strength — avoid buying fresh lows.',
        ] },
      ],
      disclaimer: DISC,
    },
    apply: (rows) => rows.filter((r) => mom(r) >= 55 && r.action !== 'AVOID').sort(byDesc(mom)),
  },
  {
    id: 'growth',
    name: 'Growth compounder (CANSLIM-style)',
    info: {
      about:
        'A fundamentals-first cut — the strongest businesses in the pool by the Multibagger fundamental score (profit growth, ROE, cash flow, low debt), in the spirit of CANSLIM / quality-growth investing.',
      sections: [
        { heading: 'What it favours', bullets: [
          'High and accelerating profit (PAT) growth.',
          'Strong return on equity and real free cash flow.',
          'Low debt / borrowings — survives to keep compounding.',
        ] },
        { heading: 'How to trade it', bullets: [
          'Build gradually; great compounders reward patience over timing.',
          'Let the fundamentals — not the daily tape — drive the hold.',
        ] },
      ],
      disclaimer: DISC,
    },
    apply: (rows) => rows.filter((r) => fund(r) >= 55).sort(byDesc(fund)),
  },
  {
    id: 'breakout',
    name: 'Breakout / chart-pattern',
    info: {
      about:
        'A price-structure cut — candidates with the strongest active chart pattern (flags, bases, double-bottoms), ranked by pattern score. For traders who lead with the chart.',
      sections: [
        { heading: 'What it favours', bullets: [
          'A high-confidence bullish pattern on the daily chart.',
          'A clean level to trade against for a tight stop.',
        ] },
        { heading: 'How to trade it', bullets: [
          'Enter on the breakout, not in anticipation of it.',
          'Invalidation is the other side of the pattern — respect the stop.',
        ] },
      ],
      disclaimer: DISC,
    },
    apply: (rows) => rows.filter((r) => pat(r) >= 55).sort(byDesc(pat)),
  },
  {
    id: 'momentum',
    name: 'Momentum leaders',
    info: {
      about:
        'Pure momentum — the names with the strongest live trend and thrust, ranked by momentum score. Winners tend to keep winning; this rides that.',
      sections: [
        { heading: 'What it favours', bullets: [
          'Price extended above rising moving averages with strong RSI/thrust.',
          'Relative strength versus the broad market.',
        ] },
        { heading: 'How to trade it', bullets: [
          'Momentum reverses fast — keep stops tight and trail winners.',
          'Avoid chasing a vertical move; wait for the first orderly pullback.',
        ] },
      ],
      disclaimer: DISC,
    },
    apply: (rows) => rows.filter((r) => mom(r) >= 60).sort(byDesc(mom)),
  },
  {
    id: 'highrr',
    name: 'High reward : risk',
    info: {
      about:
        'The most asymmetric setups — candidates whose target-to-stop distance is at least ~2.5:1, ranked by reward-to-risk. Fewer, cleaner bets where the math is in your favour.',
      sections: [
        { heading: 'What it favours', bullets: [
          'A large distance to target versus a tight, well-defined stop.',
          'You can be right less than half the time and still come out ahead.',
        ] },
        { heading: 'How to trade it', bullets: [
          'The edge only exists if you actually honour the stop.',
          'Position-size so a full stop is a small, survivable loss.',
        ] },
      ],
      disclaimer: DISC,
    },
    apply: (rows) => rows.filter((r) => rr(r) >= 2.5).sort(byDesc(rr)),
  },
];

// ── Short-term strategies (over the swing candidate pool) ────────────────────
// Typed structurally so ShortTermScreen's SwingRec matches without a shared type.
export type SwingLike = {
  action?: string;
  probability?: number | null;
  momentum?: number | null;
  upside_pct?: number | null;
  rsi?: number | null;
  rr?: number | null;
};
const sBy = (f: (r: SwingLike) => number) => (a: SwingLike, b: SwingLike) => f(b) - f(a);
const sProb = (r: SwingLike) => r.probability ?? 0;
const sMom = (r: SwingLike) => r.momentum ?? 0;
const sUp = (r: SwingLike) => r.upside_pct ?? 0;
const sRr = (r: SwingLike) => r.rr ?? 0;
const sRsi = (r: SwingLike) => (r.rsi == null ? 50 : r.rsi);

export const SHORT_STRATEGIES: Strategy<SwingLike>[] = [
  {
    id: 'balanced',
    name: 'Balanced (default)',
    info: {
      about:
        'The default swing radar — every setup that passed the scan, ranked by the probability the target is reached before the stop (trend + momentum + RSI confluence).',
      sections: [{ heading: 'What it favours', bullets: ['A confluence of trend, momentum and RSI — no single trigger.'] }],
      disclaimer: DISC,
    },
    apply: (rows) => [...rows].sort(sBy(sProb)),
  },
  {
    id: 'momentum',
    name: 'Momentum thrust',
    info: {
      about: 'Swing names with the strongest short-term thrust, ranked by momentum — riding an in-force move rather than fading it.',
      sections: [
        { heading: 'What it favours', bullets: ['Accelerating price with strong momentum readings.', 'Continuation over reversal.'] },
        { heading: 'How to trade it', bullets: ['Enter on a shallow pullback, not the vertical part of the move.', 'Trail the stop under each higher low.'] },
      ],
      disclaimer: DISC,
    },
    apply: (rows) => rows.filter((r) => sMom(r) >= 55).sort(sBy(sMom)),
  },
  {
    id: 'oversold',
    name: 'Oversold bounce',
    info: {
      about: 'Mean-reversion — setups where RSI reset into oversold territory and momentum is curling back up, playing the snap-back toward the mean.',
      sections: [
        { heading: 'What it favours', bullets: ['RSI recovering from oversold (typically < 40).', 'A momentum turn confirming the bounce.'] },
        { heading: 'How to trade it', bullets: ['Bounces are quick — take the first target and reduce.', 'Skip if the broader trend is strongly down.'] },
      ],
      disclaimer: DISC,
    },
    apply: (rows) => rows.filter((r) => sRsi(r) <= 45).sort((a, b) => sRsi(a) - sRsi(b)),
  },
  {
    id: 'upside',
    name: 'Biggest upside to target',
    info: {
      about: 'Ranks swing setups by the projected percentage move to the first target — for when you want the most room, accepting they may take longer.',
      sections: [{ heading: 'What it favours', bullets: ['A wide distance from entry to the first target.'] }],
      disclaimer: DISC,
    },
    apply: (rows) => [...rows].sort(sBy(sUp)),
  },
  {
    id: 'highrr',
    name: 'High reward : risk',
    info: {
      about: 'The most asymmetric swing setups — reward-to-risk of at least ~2:1, ranked by R:R.',
      sections: [{ heading: 'What it favours', bullets: ['Large target distance versus a tight stop.', 'Positive expectancy even with a modest hit-rate.'] }],
      disclaimer: DISC,
    },
    apply: (rows) => rows.filter((r) => sRr(r) >= 2).sort(sBy(sRr)),
  },
];
