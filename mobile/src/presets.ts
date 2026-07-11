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
  group: 'Trend' | 'Momentum' | 'Breakouts' | 'Volume' | 'Fundamentals';
  filters: Record<string, FilterValue>;
};

export const PRESETS: Preset[] = [
  // ── Trend ──
  { id: 'above-200dma', name: 'Above 200-DMA', desc: 'Price above the 200-day moving average', group: 'Trend', filters: { d200: { min: 0 } } },
  { id: 'above-all-dmas', name: 'Above 20/50/200-DMA', desc: 'Price above all three moving averages', group: 'Trend', filters: { d20: { min: 0 }, d50: { min: 0 }, d200: { min: 0 } } },
  { id: 'below-200dma', name: 'Below 200-DMA', desc: 'Price below the 200-day moving average', group: 'Trend', filters: { d200: { max: 0 } } },
  // ── Momentum ──
  { id: 'rsi-oversold', name: 'RSI below 30', desc: '14-day RSI in the oversold zone', group: 'Momentum', filters: { rsi: { max: 30 } } },
  { id: 'rsi-overbought', name: 'RSI above 70', desc: '14-day RSI in the overbought zone', group: 'Momentum', filters: { rsi: { min: 70 } } },
  { id: 'up3-2x-volume', name: 'Up 3%+ on 2× volume', desc: 'Day change above +3% with twice the average volume', group: 'Momentum', filters: { chg: { min: 3 }, relvol: { min: 2 } } },
  { id: 'macd-positive', name: 'MACD positive', desc: 'MACD histogram above zero', group: 'Momentum', filters: { macd: { min: 0 } } },
  // ── Breakouts ──
  { id: 'near-52w-high', name: 'Within 5% of 52w high', desc: 'Closing price within 5% of the 52-week high', group: 'Breakouts', filters: { pct_from_high: { min: -5 } } },
  { id: 'near-52w-low', name: 'Within 10% of 52w low', desc: 'Closing price within 10% of the 52-week low', group: 'Breakouts', filters: { pct_from_low: { max: 10 } } },
  { id: 'squeeze-fired', name: 'Squeeze fired', desc: 'TTM squeeze released on the latest bar', group: 'Breakouts', filters: { sqzFire: true } },
  // ── Volume ──
  { id: '3x-rel-volume', name: '3× relative volume', desc: 'Volume at least three times the 20-day average', group: 'Volume', filters: { relvol: { min: 3 } } },
  { id: 'squeeze-on', name: 'Squeeze ON', desc: 'Bollinger bands inside Keltner channel (coiling)', group: 'Volume', filters: { sqzOn: true } },
  // ── Fundamentals (fetches company data on first use) ──
  { id: 'low-pe', name: 'P/E below 20', desc: 'Trailing price-to-earnings under 20', group: 'Fundamentals', filters: { pe: { max: 20 } } },
  { id: 'quality-roe', name: 'ROE above 15%', desc: 'Return on equity above 15%', group: 'Fundamentals', filters: { roe: { min: 15 } } },
  { id: 'low-debt', name: 'D/E below 0.5', desc: 'Debt-to-equity under 0.5', group: 'Fundamentals', filters: { debt_equity: { max: 0.5 } } },
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
