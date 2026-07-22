// Calibration — turns the paper-trade outcome log into the number that
// actually matters to a professional: the realised hit-rate and average R of
// each engine's setups, with the sample size stated. Scores without this are
// marketing; with it they're a measurable claim.
import { PaperTrade } from './paperTrades';

export type EngineCal = {
  source: string;
  n: number;        // trades logged
  closed: number;   // reached target or stop
  wins: number;
  hitRate: number | null;  // wins / closed, null under MIN_SAMPLE
  avgR: number | null;     // mean realised R multiple over closed trades
};

// Below this many closed trades the hit-rate is noise, not evidence — the UI
// must say "insufficient sample", never show a percentage.
export const MIN_SAMPLE = 20;

// Realised R of a closed trade: +reward/risk on a win, −1 on a loss (stopped
// at the planned stop). Uses the trade's own recorded geometry.
export function tradeR(t: PaperTrade): number | null {
  if (t.status === 'open') return null;
  const risk = Math.abs(t.entry - t.stop);
  if (!isFinite(risk) || risk <= 0) return null;
  if (t.status === 'lost') return -1;
  return Math.abs(t.target - t.entry) / risk;
}

export function calibrate(trades: PaperTrade[]): { engines: EngineCal[]; overall: EngineCal } {
  const by: Record<string, PaperTrade[]> = {};
  for (const t of trades) {
    const k = t.source || 'Unlabelled';
    (by[k] = by[k] || []).push(t);
  }
  const calc = (source: string, list: PaperTrade[]): EngineCal => {
    const closedTrades = list.filter((t) => t.status !== 'open');
    const wins = closedTrades.filter((t) => t.status === 'won').length;
    const rs = closedTrades.map(tradeR).filter((r): r is number => r != null);
    const enough = closedTrades.length >= MIN_SAMPLE;
    return {
      source,
      n: list.length,
      closed: closedTrades.length,
      wins,
      hitRate: enough ? wins / closedTrades.length : null,
      avgR: enough && rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    };
  };
  const engines = Object.entries(by)
    .map(([s, l]) => calc(s, l))
    .sort((a, b) => b.closed - a.closed);
  return { engines, overall: calc('All engines', trades) };
}
