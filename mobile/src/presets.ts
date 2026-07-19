// Preset scan library — one-tap, ready-to-run screens, ported from taureye's
// preset design. Every preset is a FACTUAL CONDITION (what the data shows),
// never a recommendation: names describe the filter, not an action.
//
// A preset is just a bundle of ActiveFilters entries; tapping it merges them
// in, tapping again removes exactly those keys. Presets therefore stack, and
// remain editable in the All Filters drawer afterwards.
import { ActiveFilters, FilterValue } from './screener';

export type Preset = {
  id: string;
  name: string;
  desc: string;
  group: 'Trend' | 'Momentum' | 'Breakouts' | 'Volume' | 'Fundamentals' | 'Strategies' | 'Candlesticks';
  filters: Record<string, FilterValue>;
};

export const PRESETS: Preset[] = [
  // ── Trend ──
  { id: 'golden-cross', name: 'Golden cross today', desc: '50-DMA crossed above the 200-DMA on the latest bar', group: 'Trend', filters: { golden_cross: true } },
  { id: 'death-cross', name: 'Death cross today', desc: '50-DMA crossed below the 200-DMA on the latest bar', group: 'Trend', filters: { death_cross: true } },
  { id: 'above-200dma', name: 'Above 200-DMA', desc: 'Price above the 200-day moving average', group: 'Trend', filters: { d200: { min: 0 } } },
  { id: 'above-all-dmas', name: 'Above 20/50/200-DMA', desc: 'Price above all three moving averages', group: 'Trend', filters: { d20: { min: 0 }, d50: { min: 0 }, d200: { min: 0 } } },
  { id: 'below-200dma', name: 'Below 200-DMA', desc: 'Price below the 200-day moving average', group: 'Trend', filters: { d200: { max: 0 } } },
  // ── Momentum ──
  { id: 'rsi-oversold', name: 'RSI below 30', desc: '14-day RSI in the oversold zone', group: 'Momentum', filters: { rsi: { max: 30 } } },
  { id: 'rsi-overbought', name: 'RSI above 70', desc: '14-day RSI in the overbought zone', group: 'Momentum', filters: { rsi: { min: 70 } } },
  { id: 'up3-2x-volume', name: 'Up 3%+ on 2× volume', desc: 'Day change above +3% with twice the average volume', group: 'Momentum', filters: { chg: { min: 3 }, relvol: { min: 2 } } },
  { id: 'macd-bull-cross', name: 'MACD bullish cross', desc: 'MACD line crossed above its signal line on the latest bar', group: 'Momentum', filters: { macd_bull_cross: true } },
  // ── Breakouts ──
  { id: 'new-52w-high', name: 'New 52-week high', desc: 'Made a fresh 52-week high on the latest bar', group: 'Breakouts', filters: { new_high_52w: true } },
  { id: 'near-52w-high', name: 'Within 5% of 52w high', desc: 'Closing price within 5% of the 52-week high', group: 'Breakouts', filters: { pct_from_high: { min: -5 } } },
  { id: 'gap-up', name: 'Gapped up today', desc: "Opened above the previous bar's high", group: 'Breakouts', filters: { gap_up: true } },
  { id: 'near-52w-low', name: 'Within 10% of 52w low', desc: 'Closing price within 10% of the 52-week low', group: 'Breakouts', filters: { pct_from_low: { max: 10 } } },
  { id: 'squeeze-fired', name: 'Squeeze fired', desc: 'TTM squeeze released on the latest bar', group: 'Breakouts', filters: { sqzFire: true } },
  // ── Volume ──
  { id: 'volume-spike', name: 'Volume spike', desc: "Today's volume at least 2.5× the 20-day average", group: 'Volume', filters: { volume_spike: true } },
  { id: '3x-rel-volume', name: '3× relative volume', desc: 'Volume at least three times the 20-day average', group: 'Volume', filters: { relvol: { min: 3 } } },
  { id: 'squeeze-on', name: 'Squeeze ON', desc: 'Bollinger bands inside Keltner channel (coiling)', group: 'Volume', filters: { sqzOn: true } },
  // ── Fundamentals (fetches company data on first use) ──
  { id: 'low-pe', name: 'P/E below 20', desc: 'Trailing price-to-earnings under 20', group: 'Fundamentals', filters: { pe: { max: 20 } } },
  { id: 'quality-roe', name: 'ROE above 15%', desc: 'Return on equity above 15%', group: 'Fundamentals', filters: { roe: { min: 15 } } },
  { id: 'low-debt', name: 'D/E below 0.5', desc: 'Debt-to-equity under 0.5', group: 'Fundamentals', filters: { debt_equity: { max: 0.5 } } },

  // ── Strategies ── (multi-rule chart strategies computed server-side)
  { id: 'minervini', name: 'Minervini Trend Template', desc: 'All 8 of Mark Minervini’s trend-template rules: price above the 50/150/200-DMA (50>150>200), a rising 200-DMA, ≥30% above the 52w low, within 25% of the 52w high, and positive relative strength', group: 'Strategies', filters: { minervini: true } },
  { id: 'stage2-uptrend', name: 'Stage-2 uptrend (price>150>200, rising)', desc: 'Price above the 150 & 200-DMA with the 200-DMA rising — the core of a stage-2 advance', group: 'Strategies', filters: { d150: { min: 0 }, d200: { min: 0 }, dma200_rising: true } },
  { id: 'near-high-strong-rs', name: 'Near highs + strong 6m return', desc: 'Within 15% of the 52-week high with a positive 6-month return', group: 'Strategies', filters: { pct_from_high: { min: -15 }, ret_6m: { min: 0 } } },

  // ── Candlesticks ── (pattern on the latest daily bar)
  { id: 'cs-bullish', name: 'Any bullish candle', desc: 'Hammer, bullish engulfing, piercing, morning star or three white soldiers on the latest bar', group: 'Candlesticks', filters: { cs_bullish: true } },
  { id: 'cs-bearish', name: 'Any bearish candle', desc: 'Shooting star, bearish engulfing, dark cloud, evening star or three black crows on the latest bar', group: 'Candlesticks', filters: { cs_bearish: true } },
  { id: 'cs-bull-engulf', name: 'Bullish engulfing', desc: 'A bullish candle whose body engulfs the prior bearish candle', group: 'Candlesticks', filters: { cs_bull_engulf: true } },
  { id: 'cs-bear-engulf', name: 'Bearish engulfing', desc: 'A bearish candle whose body engulfs the prior bullish candle', group: 'Candlesticks', filters: { cs_bear_engulf: true } },
  { id: 'cs-hammer', name: 'Hammer', desc: 'Small body at the top with a long lower shadow — bullish reversal after a decline', group: 'Candlesticks', filters: { cs_hammer: true } },
  { id: 'cs-shooting-star', name: 'Shooting star', desc: 'Small body at the bottom with a long upper shadow — bearish reversal after an advance', group: 'Candlesticks', filters: { cs_shooting_star: true } },
  { id: 'cs-morning-star', name: 'Morning star', desc: 'Three-bar bullish reversal after a downtrend', group: 'Candlesticks', filters: { cs_morning_star: true } },
  { id: 'cs-evening-star', name: 'Evening star', desc: 'Three-bar bearish reversal after an uptrend', group: 'Candlesticks', filters: { cs_evening_star: true } },
  { id: 'cs-doji', name: 'Doji (indecision)', desc: 'Open and close nearly equal — indecision, potential turning point', group: 'Candlesticks', filters: { cs_doji: true } },
  { id: 'cs-three-white', name: 'Three white soldiers', desc: 'Three rising bullish candles — strong reversal / continuation', group: 'Candlesticks', filters: { cs_three_white: true } },
  { id: 'cs-three-black', name: 'Three black crows', desc: 'Three falling bearish candles — strong bearish signal', group: 'Candlesticks', filters: { cs_three_black: true } },
];

const sameVal = (a: FilterValue | undefined, b: FilterValue): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

// A preset is "active" when every one of its entries is present verbatim.
export function presetActive(active: ActiveFilters, p: Preset): boolean {
  return Object.entries(p.filters).every(([k, v]) => sameVal(active[k], v));
}

export function togglePreset(active: ActiveFilters, p: Preset): ActiveFilters {
  const next = { ...active };
  if (presetActive(active, p)) {
    Object.keys(p.filters).forEach((k) => delete next[k]);
  } else {
    Object.assign(next, p.filters);
  }
  return next;
}
