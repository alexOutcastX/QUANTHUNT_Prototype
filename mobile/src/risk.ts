// Per-trade risk score shared across every recommendation card + the Analyse
// verdict. Higher = riskier. Blends four things a trader actually cares about:
//   • how wide the stop is (bigger loss if wrong)
//   • the reward-to-risk ratio (thin R:R = risky)
//   • the worst historical drawdown of similar setups (max_dd)
//   • the model's own conviction (confidence / confluence score)
// It is a heuristic for triage, not a guarantee — see the disclaimers in-app.
import { theme } from './theme';

export type RiskInput = {
  rr?: number | null;
  stop_pct?: number | null; // signed %, e.g. -5.1
  max_dd?: number | null; // signed %, e.g. -22.3
  score?: number | null; // 0–100 confidence / confluence (higher = more sure)
};

export type RiskLevel = 'Low' | 'Moderate' | 'High' | 'Very high';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
// Linear map v in [a,b] → [0,max], clamped.
const band = (v: number, a: number, b: number, max: number) =>
  clamp(((v - a) / (b - a)) * max, 0, max);

export function tradeRisk(r: RiskInput): { score: number; level: RiskLevel; color: string } {
  const stop = r.stop_pct != null ? Math.abs(r.stop_pct) : 6; // unknown → mid
  const dd = r.max_dd != null ? Math.abs(r.max_dd) : 18;
  const rr = r.rr != null && isFinite(r.rr) ? r.rr : 1.2;
  const conf = r.score != null ? clamp(r.score, 0, 100) : 55;

  // Each component contributes to a 0–100 risk total.
  const stopRisk = band(stop, 2, 12, 34); // 2% → 0, 12%+ → 34
  const ddRisk = band(dd, 6, 32, 24); // shallow → 0, deep → 24
  const rrRisk = rr >= 3 ? 0 : rr >= 2 ? 8 : rr >= 1.5 ? 18 : rr >= 1 ? 28 : 34;
  const confRisk = band(80 - conf, 0, 45, 20); // high conviction lowers risk

  const score = Math.round(clamp(stopRisk + ddRisk + rrRisk + confRisk, 3, 99));
  const level: RiskLevel = score < 30 ? 'Low' : score < 52 ? 'Moderate' : score < 74 ? 'High' : 'Very high';
  const color = level === 'Low' ? theme.green : level === 'Moderate' ? '#e0a92e' : level === 'High' ? '#e6733a' : theme.red;
  return { score, level, color };
}
