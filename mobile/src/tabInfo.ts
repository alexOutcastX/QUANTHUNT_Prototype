// "About this tab" content shown in the ⓘ popup on each strategy screen.
// Keeps the long explanatory copy out of the header (just an icon there) and
// gives every screen the same shape: an overview, the strategies it runs, how
// to trade the output safely, and a disclaimer that always renders last in a
// red box. See InfoContent / ScreenTitle in ui.tsx.
import type { InfoContent } from './ui';

// Shared closing line — this is a screener, not advice. Repeated (tab-specific
// wording) so each disclaimer reads naturally on its own.
const SAFETY_COMMON =
  'Always confirm on your own chart, size positions to your risk, and use a stop. A screener surfaces candidates — it does not time your entry or manage the trade for you.';

export const SHORT_TERM_INFO: InfoContent = {
  about:
    'Swing-trade radar for mid & large caps that are near a high-probability pullback reversal or oversold bounce. It scans daily structure and ranks setups by confluence, then projects an entry, stop, targets and an estimated time-to-target for each scrip.',
  sections: [
    {
      heading: 'Strategies used',
      bullets: [
        'Pullback-to-support reversals inside an established uptrend',
        'Oversold bounces (RSI reset) with a momentum turn confirmation',
        'Moving-average reclaim / bounce off a rising 20/50 DMA',
        'Chart-pattern confluence (flags, double-bottoms) scored into the rank',
        'Momentum-scaled drift to estimate a realistic time-to-target (ETA)',
      ],
    },
    {
      heading: 'How to trade it safely',
      bullets: [
        'Treat each card as a setup to verify, not a signal to buy blindly.',
        'Enter near the suggested level — chasing a gap-up wrecks the risk/reward.',
        'Place your stop below the listed support; never widen it to stay in.',
        'Scale out at the first target; trail the rest, don’t hope for the last target.',
        'Skip the trade if broad market/sector is against you that day.',
      ],
    },
  ],
  disclaimer:
    'For research and education only. This is a technical screener, not investment advice or a recommendation to buy or sell. Swing trading carries real risk of loss. ' +
    SAFETY_COMMON,
};

export const INSTITUTIONAL_INFO: InfoContent = {
  about:
    'Mid & large caps screened the way systematic/quant desks do — through rules-based algorithmic strategies rather than gut feel. Each stock that surfaces shows which strategy flagged it, so you can see the “why” behind the pick.',
  sections: [
    {
      heading: 'Strategies used',
      bullets: [
        'Cross-sectional momentum — relative strength vs the universe',
        'Trend-following — price above rising long-term moving averages',
        'Breakout — range/volatility compression resolving with volume',
        'Mean-reversion — statistically stretched pullbacks in an uptrend',
        'Statistical-arbitrage style signals on relative dislocation',
      ],
    },
    {
      heading: 'How to trade it safely',
      bullets: [
        'Different strategies suit different regimes — a trend pick in a chop market can whipsaw.',
        'Diversify across names rather than concentrating in one signal.',
        'Momentum/breakout names move fast — define your stop before entering.',
        'Mean-reversion names can keep falling; wait for the turn to confirm.',
        'Position size for volatility, not conviction.',
      ],
    },
  ],
  disclaimer:
    'For research and education only. These are algorithmic screens inspired by published quant/institutional strategies — not investment advice, and not affiliated with any fund. Systematic strategies underperform in the wrong regime and can lose money. ' +
    SAFETY_COMMON,
};

export const SMC_INFO: InfoContent = {
  about:
    'A daily-timeframe screen built on the concepts behind Smart-Money Concepts (SMC) and Inner-Circle-Trader (ICT) methodology: where liquidity sits, how market structure shifts, and where price left an imbalance. Candidates are long-biased and confluence-scored on daily NSE structure.',
  sections: [
    {
      heading: 'Strategies / models used',
      bullets: [
        'Break of Structure (BOS) / Change of Character (CHoCH) on the daily',
        'Fair-Value Gaps (FVG) / imbalances as pullback entry zones',
        'Order blocks — the last down-candle before an up-move',
        'Liquidity sweeps of prior highs/lows before a reversal',
        'Premium/discount (equilibrium) positioning within the range',
      ],
    },
    {
      heading: 'Honest limits',
      bullets: [
        'ICT is built for intraday/session timing (killzones, sessions). Those cannot be automated from daily data, so this screen applies the structural concepts on the daily timeframe only.',
        'Session-based and order-flow models are flagged as manual — treat the popup detail as a starting map, not an intraday signal.',
      ],
    },
    {
      heading: 'How to trade it safely',
      bullets: [
        'Drop to your own lower timeframe to refine the actual entry.',
        'Only take the setup if structure still agrees when you look — screens lag.',
        'Stop goes beyond the swept liquidity / order block, not at a round number.',
        'One clean setup beats forcing confluence that isn’t really there.',
      ],
    },
  ],
  disclaimer:
    'For research and education only. This is a structural screener using publicly-described SMC/ICT concepts — not investment advice, and not affiliated with any trader or trademark. These concepts are discretionary and unproven in the statistical sense; trading them carries real risk of loss. ' +
    SAFETY_COMMON,
};

export const RECOMMENDATIONS_INFO: InfoContent = {
  about:
    'Multibagger-style candidates run through fundamentals, momentum and chart patterns, then translated into an actionable buy setup with entry, support/resistance, next target and ETA. Use the tabs to switch between long, short, institutional and SMC views.',
  sections: [
    {
      heading: 'Strategies used',
      bullets: [
        'Fundamental quality + growth screen to shortlist the universe',
        'Momentum & relative-strength ranking on the shortlist',
        'Chart-pattern confirmation for entry timing',
        'Support/resistance and next-target levels for the trade plan',
        'Momentum-scaled ETA so the time-to-target isn’t a flat guess',
      ],
    },
    {
      heading: 'How to trade it safely',
      bullets: [
        'These are setups to verify, not orders to place.',
        'Enter near the listed support — don’t chase strength.',
        'Respect the stop implied by the support level.',
        'Book partial profit at the first target; let winners run with a trail.',
        'Match the tab to your horizon — long vs short vs intraday-style models differ.',
      ],
    },
  ],
  disclaimer:
    'For research and education only. This is a screener, not investment advice or a solicitation to buy or sell any security. “Recommendation” here means a technical/fundamental setup, not a guarantee. Markets can and do go against every setup. ' +
    SAFETY_COMMON,
};

export const MULTIBAGGER_INFO: InfoContent = {
  about:
    'A fixed screen for long-term compounders plus a one-click potential analyser you can point at any stock. The scoring draws on the classic multibagger playbooks — Peter Lynch’s categories, Mark Mayer-style quality, and the academic 100-bagger studies.',
  sections: [
    {
      heading: 'What it looks for',
      bullets: [
        'Durable earnings growth and reinvestment runway',
        'Reasonable valuation relative to that growth (Lynch’s PEG lens)',
        'Quality: margins, return on capital, low dilution',
        'Manageable leverage and clean balance sheet',
        'Early-stage size — room to compound many times over',
      ],
    },
    {
      heading: 'How to use it safely',
      bullets: [
        'Multibaggers are a multi-year thesis, not a trade — expect deep drawdowns along the way.',
        'The score is a starting filter; read the actual business before buying.',
        'Diversify — most candidates won’t become 100-baggers.',
        'Never over-position on a single small-cap; liquidity dries up fast.',
      ],
    },
  ],
  disclaimer:
    'For research and education only. This is a quantitative screen, not investment advice or a stock tip. Long-term investing carries risk of permanent capital loss, and small/mid-caps are especially volatile and illiquid. Do your own diligence. ' +
    SAFETY_COMMON,
};

export const MOMENTUM_INFO: InfoContent = {
  about:
    'A momentum radar across the whole NSE + BSE universe, surfacing breakout and pullback-reversal setups. Each name carries a technical score and an estimated follow-through probability so you can rank what’s actually moving.',
  sections: [
    {
      heading: 'Strategies used',
      bullets: [
        'Breakout — price clearing a defined range on expanding volume',
        'Pullback-reversal — momentum resuming after a shallow dip',
        'Relative-strength / technical scoring across the universe',
        'Follow-through probability from recent momentum persistence',
        'Sector & market-cap tags to gauge where the strength is rotating',
      ],
    },
    {
      heading: 'How to trade it safely',
      bullets: [
        'Momentum reverses hard — a stop isn’t optional here.',
        'Higher score ≠ safer; it just means stronger recent move.',
        'Avoid chasing a name that’s already extended far from support.',
        'Confirm volume — a breakout on thin volume often fails.',
      ],
    },
  ],
  disclaimer:
    'For research and education only. This is a technical screener, not investment advice. Momentum strategies can suffer sharp, sudden reversals and losses. ' +
    SAFETY_COMMON,
};

export const SHAREHOLDERS_INFO: InfoContent = {
  about:
    'A grounded ownership graph. Every link is a real, cited public record — nothing is inferred by a model. Coverage is intentionally partial (only what is filed/disclosed) rather than a fabricated-complete picture.',
  sections: [
    {
      heading: 'The four tabs',
      bullets: [
        'Institutional / HNI — funds and large clients from NSE bulk/block deal records, each edge cited & dated.',
        'By stock — a company’s ownership split (promoter / FII / DII / public) from NSE quarterly filings, plus who traded it.',
        'Promoters — promoter groups and every listed company they control, from shareholding-pattern filings.',
        'Political — disclosed political funding via electoral bonds (donor side), from the ECI/SBI March-2024 release.',
      ],
    },
    {
      heading: 'What is not here',
      bullets: [
        'Retail shareholders — never disclosed by name anywhere; only the aggregate public % exists.',
        'Board interlocks / related-party trees — need structured filings parsing (a follow-up).',
        'Electoral-bond recipient parties — the matched bond-number set is a follow-up; donor totals only for now.',
      ],
    },
  ],
  disclaimer:
    'For research and education only, not investment advice. Promoter stakes are approximate and drift between quarters — verify on the exchange. Electoral-bond entries are the value of bonds PURCHASED (donor side) per the official ECI/SBI disclosure; buying bonds was legal and inclusion implies no wrongdoing or any specific party link.',
};

export const PATTERN_INFO: InfoContent = {
  about:
    'Scans a stock’s full price history for classic chart patterns and reports each one with its start/end, a confidence score, historical continuation odds, and the measured-move target the pattern projects.',
  sections: [
    {
      heading: 'What it detects',
      bullets: [
        'Continuation patterns — flags, pennants, triangles, rectangles',
        'Reversal patterns — double top/bottom, head & shoulders',
        'Each match dated with start/end so you can verify it on the chart',
        'Confidence + continuation probability from historical behaviour',
        'Measured-move target derived from the pattern’s own geometry',
      ],
    },
    {
      heading: 'How to use it safely',
      bullets: [
        'Patterns are probabilities, not promises — many fail or fake out.',
        'Wait for the breakout/breakdown to confirm before acting.',
        'Use the measured move as a guide, not a guarantee.',
        'A pattern against the broader trend is lower-odds — respect the trend.',
      ],
    },
  ],
  disclaimer:
    'For research and education only. Pattern recognition is inherently probabilistic and not investment advice. Historical continuation odds do not predict the future, and patterns fail regularly. ' +
    SAFETY_COMMON,
};
