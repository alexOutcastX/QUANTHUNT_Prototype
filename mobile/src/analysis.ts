// Institutional upside-probability model — ported 1:1 from the web app
// (StockScreenPro.html). Monte-Carlo GBM + historical rolling-window frequency,
// blended into a 0–100 institutional score. The empirical log-return mean (mu)
// already carries the −½σ² drift, so no extra correction is applied in the MC.

import { Fundamentals } from './api';

export type Stats = { mu: number; sigma: number };

export function teStats(C: number[]): Stats {
  if (!Array.isArray(C) || C.length < 2) return { mu: 0, sigma: 0 };
  const r: number[] = [];
  for (let i = 1; i < C.length; i++) {
    const a = C[i - 1];
    const b = C[i];
    if (a > 0 && b > 0 && isFinite(a) && isFinite(b)) r.push(Math.log(b / a));
  }
  if (r.length < 1) return { mu: 0, sigma: 0 };
  const mu = r.reduce((s, x) => s + x, 0) / r.length;
  let v = 0;
  for (const x of r) v += (x - mu) * (x - mu);
  const sigma = r.length > 1 ? Math.sqrt(v / (r.length - 1)) : 0;
  return { mu, sigma };
}

function randN(): number {
  // Box-Muller standard normal
  let u = 0;
  let w = 0;
  while (u === 0) u = Math.random();
  while (w === 0) w = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w);
}

function pctile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return pctile(s, 0.5);
}

export type MonteCarlo = {
  pReach: number;
  pUp: number;
  expRet: number;
  medRet: number;
  p5: number;
  p95: number;
  expMaxDD: number;
};

export function teMonteCarlo(
  C: number[],
  targetPct: number,
  horizonDays: number,
  N = 5000,
): MonteCarlo {
  const H = Math.max(1, Math.floor(horizonDays || 0));
  const { mu, sigma } = teStats(C);
  const thr = 1 + (targetPct || 0) / 100;
  const terms: number[] = [];
  const dds: number[] = [];
  let reach = 0;
  let up = 0;
  for (let n = 0; n < N; n++) {
    let p = 1;
    let pmax = 1;
    let peak = 1;
    let maxdd = 0;
    for (let t = 0; t < H; t++) {
      // mu already contains the empirical −½σ² drift, so no extra correction
      p *= Math.exp(mu + sigma * randN());
      if (p > pmax) pmax = p;
      if (p > peak) peak = p;
      const dd = p / peak - 1;
      if (dd < maxdd) maxdd = dd;
    }
    if (pmax >= thr) reach++;
    if (p > 1) up++;
    terms.push(p);
    dds.push(maxdd);
  }
  const sortedRet = terms.map((x) => x - 1).sort((a, b) => a - b);
  const expRet = terms.reduce((s, x) => s + x, 0) / N - 1;
  const expMaxDD = dds.reduce((s, x) => s + x, 0) / N;
  return {
    pReach: reach / N,
    pUp: up / N,
    expRet,
    medRet: median(terms) - 1,
    p5: pctile(sortedRet, 0.05),
    p95: pctile(sortedRet, 0.95),
    expMaxDD,
  };
}

export type HistFreq = { pReach: number; pUp: number; medRet: number; n: number };

export function teHistFreq(
  C: number[],
  targetPct: number,
  horizonDays: number,
): HistFreq {
  const H = Math.max(1, Math.floor(horizonDays || 0));
  const thr = 1 + (targetPct || 0) / 100;
  const rets: number[] = [];
  let reach = 0;
  let up = 0;
  let n = 0;
  if (Array.isArray(C)) {
    for (let i = 0; i + H < C.length; i++) {
      const startP = C[i];
      if (!(startP > 0)) continue;
      let wmax = -Infinity;
      for (let k = i + 1; k <= i + H; k++) if (C[k] > wmax) wmax = C[k];
      const terminal = C[i + H];
      if (wmax / startP >= thr) reach++;
      if (terminal > startP) up++;
      rets.push(terminal / startP - 1);
      n++;
    }
  }
  return { pReach: n ? reach / n : 0, pUp: n ? up / n : 0, medRet: median(rets), n };
}

export const IA_HORIZONS: { label: string; days: number }[] = [
  { label: '1M', days: 21 },
  { label: '3M', days: 63 },
  { label: '6M', days: 126 },
  { label: '1Y', days: 252 },
];

const clamp = (x: number) => Math.max(0, Math.min(100, x));

export type QualityScore = {
  score: number;
  parts: { k: string; s: number }[];
  hasData: boolean;
};

export function qualityScore(fund: Fundamentals | null): QualityScore {
  const parts: { k: string; s: number }[] = [];
  const norm = (v: number) => (v != null && Math.abs(v) <= 1 ? v * 100 : v); // fraction → percent
  if (fund) {
    if (fund.roe != null && isFinite(fund.roe)) {
      const roe = norm(fund.roe);
      parts.push({ k: 'ROE', s: clamp((roe / 25) * 100) });
    }
    if (fund.roce != null && isFinite(fund.roce)) {
      const roce = norm(fund.roce);
      parts.push({ k: 'ROCE', s: clamp((roce / 25) * 100) });
    }
    if (fund.debt_equity != null && isFinite(fund.debt_equity)) {
      const de = +fund.debt_equity;
      parts.push({ k: 'D/E', s: clamp(((2 - de) / 2) * 100) });
    }
    if (fund.pe != null && isFinite(fund.pe)) {
      const pe = +fund.pe;
      parts.push({ k: 'P/E', s: pe <= 0 ? 10 : clamp(100 - Math.abs(pe - 20) * 3) });
    }
  }
  const score = parts.length ? parts.reduce((a, b) => a + b.s, 0) / parts.length : 50;
  return { score, parts, hasData: parts.length > 0 };
}

export type HorizonRow = {
  label: string;
  days: number;
  mc: MonteCarlo;
  hist: HistFreq;
};

export type Assessment = {
  sym: string;
  name: string;
  price: number;
  target: number;
  verdict: string;
  score: number;
  termLabel: string;
  driftAnn: number;
  sigmaAnn: number;
  rows: HorizonRow[];
  qual: QualityScore;
  note: string;
};

function buildNote(d: {
  sym: string;
  name: string;
  target: number;
  verdict: string;
  score: number;
  termLabel: string;
  trendScore: number;
  qual: QualityScore;
  sigmaAnn: number;
  driftAnn: number;
  bestReachRow: HorizonRow;
}): string {
  const trendTxt =
    d.trendScore >= 66
      ? 'trades above its 200-day average, confirming a constructive long-term trend'
      : d.trendScore <= 34
        ? 'trades below its 200-day average, signalling a weak long-term trend'
        : 'trades near its 200-day average, a neutral trend';
  const valTxt = !d.qual.hasData
    ? 'Fundamental data was unavailable, so valuation was scored neutrally'
    : d.qual.score >= 66
      ? 'Fundamentals look healthy'
      : d.qual.score <= 40
        ? 'Fundamentals look stretched or weak'
        : 'Fundamentals are mixed';
  const volTxt = d.sigmaAnn <= 0.3 ? 'relatively low' : d.sigmaAnn >= 0.5 ? 'elevated' : 'moderate';
  const b = d.bestReachRow;
  const probTxt = b
    ? `Over its most favourable ${b.label} horizon, simulations give a ${(b.mc.pReach * 100).toFixed(0)}% chance of touching +${d.target}%`
    : '';
  return `${d.name} (${d.sym}) ${trendTxt}. Annualised volatility is ${volTxt} at ${(d.sigmaAnn * 100).toFixed(0)}%, with a modelled annual drift of ${(d.driftAnn * 100).toFixed(0)}%. ${valTxt}. ${probTxt}. On a blended institutional score of ${d.score}/100 the assessment is "${d.verdict}", best expressed over a ${d.termLabel.toLowerCase()} horizon.`;
}

// Runs the full assessment on a close series + optional fundamentals.
// ema200 comes from the last candle's TA overlay (may be null).
export function assess(
  sym: string,
  C: number[],
  price: number,
  ema200: number | null,
  target: number,
  fund: Fundamentals | null,
): Assessment {
  const { mu, sigma } = teStats(C);
  const sigmaAnn = sigma * Math.sqrt(252);
  const driftAnn = mu * 252;

  const rows: HorizonRow[] = IA_HORIZONS.map((h) => ({
    label: h.label,
    days: h.days,
    mc: teMonteCarlo(C, target, h.days, 5000),
    hist: teHistFreq(C, target, h.days),
  }));

  let bestReach = 0;
  let bestReachRow = rows[0];
  rows.forEach((r) => {
    if (r.mc.pReach > bestReach) {
      bestReach = r.mc.pReach;
      bestReachRow = r;
    }
  });

  // Suggested term: maximise risk-adjusted upside pReach / (sigma*sqrt(H))
  let bestRA = -Infinity;
  let bestTermDays = 21;
  rows.forEach((r) => {
    const denom = sigma * Math.sqrt(r.days) || 1e-9;
    const ra = r.mc.pReach / denom;
    if (ra > bestRA) {
      bestRA = ra;
      bestTermDays = r.days;
    }
  });
  const termLabel =
    bestTermDays <= 21 ? 'Short (≤1M)' : bestTermDays >= 252 ? 'Long (~1Y)' : 'Medium (3–6M)';

  // Sub-scores (0–100)
  let trendScore = 50;
  if (ema200 && price > 0) trendScore = clamp(50 + (price / ema200 - 1) * 500);
  let momScore = 50;
  if (C.length > 63) {
    const mom63 = C[C.length - 1] / C[C.length - 1 - 63] - 1;
    momScore = clamp(50 + mom63 * 250);
  }
  const volScore = clamp(100 - sigmaAnn * 100 * 1.5);
  const qual = qualityScore(fund);
  const probScore = clamp(bestReach * 100);

  const score = Math.round(
    trendScore * 0.25 + momScore * 0.15 + volScore * 0.15 + qual.score * 0.25 + probScore * 0.2,
  );
  const verdict =
    score >= 70 ? 'Strong Accumulate' : score >= 55 ? 'Accumulate' : score >= 40 ? 'Hold' : 'Avoid';

  const name = fund && (fund.name || fund.longName) ? fund.name || fund.longName || sym : sym;

  return {
    sym,
    name,
    price,
    target,
    verdict,
    score,
    termLabel,
    driftAnn,
    sigmaAnn,
    rows,
    qual,
    note: buildNote({
      sym,
      name,
      target,
      verdict,
      score,
      termLabel,
      trendScore,
      qual,
      sigmaAnn,
      driftAnn,
      bestReachRow,
    }),
  };
}
