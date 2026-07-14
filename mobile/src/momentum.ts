// Momentum radar — breakout-soon & pullback-reversal setup detection.
//
// Classifies a scanned stock (Row from /scan) into one of the classic
// technical setups and scores it 0-100 with an indicative follow-through
// probability. The models are the textbook ones:
//
//  BREAKOUT WATCH — volatility compression before expansion: TTM squeeze ON
//  (Bollinger inside Keltner), price pressing the 52-week high / R1 pivot,
//  rising relative volume, aligned moving averages, RSI in the 55-70 power
//  zone. (O'Neil-style base + Carter's squeeze.)
//
//  BREAKOUT FIRED — the trigger bar: squeeze released with positive
//  momentum, fresh 52-week high, Camarilla H4 break, volume spike.
//
//  PULLBACK REVERSAL — buy-the-dip in an intact uptrend: price above the
//  200-DMA with an orderly 20-DMA pullback, RSI/W%R/Bollinger %B washed out,
//  sitting on the S1 pivot, ideally on quiet volume (healthy dip), with a
//  MACD turn as the entry cue. (Minervini/Raschke-style trend pullback.)
import { Row } from './screener';

export type SetupKind = 'breakout' | 'fired' | 'pullback';
export type MomentumRead = {
  setup: SetupKind;
  score: number; // 0-100 technical setup quality
  probability: number; // indicative follow-through probability %
  signals: string[]; // what the chart shows (contributing factors)
  cautions: string[]; // what argues against the setup
};

export const SETUP_LABEL: Record<SetupKind, string> = {
  breakout: 'BREAKOUT WATCH',
  fired: 'BREAKOUT FIRED',
  pullback: 'PULLBACK REVERSAL',
};

const nn = (v: number | null | undefined): number | null =>
  v == null || !isFinite(v) ? null : v;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function breakoutRead(r: Row): MomentumRead | null {
  const signals: string[] = [];
  const cautions: string[] = [];
  let score = 0;
  let fired = false;

  if (r.sqzFire && (nn(r.sqzMom) ?? 0) > 0) {
    score += 25;
    fired = true;
    signals.push('TTM squeeze just FIRED with positive momentum — compression is releasing upward.');
  } else if (r.sqzOn) {
    score += 18;
    signals.push('TTM squeeze ON — Bollinger bands inside Keltner channel, volatility coiling for a move.');
  }

  const ph = nn(r.pct_from_high);
  if (ph != null) {
    if (ph >= -3) {
      score += 20;
      signals.push(`Pressing the 52-week high (${ph.toFixed(1)}% away) — minimal overhead supply.`);
    } else if (ph >= -8) {
      score += 12;
      signals.push(`Within ${Math.abs(ph).toFixed(1)}% of the 52-week high — late-stage base.`);
    } else if (ph < -35) {
      cautions.push(`${Math.abs(ph).toFixed(0)}% below the 52-week high — heavy overhead supply to chew through.`);
      score -= 8;
    }
  }
  if (r.new_high_52w) {
    score += 12;
    fired = true;
    signals.push('Fresh 52-week high on the latest bar — breakout in progress.');
  }
  if (r.cam_break_up) {
    score += 8;
    fired = true;
    signals.push('Camarilla H4 breakout — price cleared the upper day-structure band.');
  }

  const rv = nn(r.relvol);
  if (rv != null) {
    if (rv >= 2) {
      score += 15;
      signals.push(`Volume ${rv.toFixed(1)}× average — institutions participating.`);
    } else if (rv >= 1.3) {
      score += 8;
      signals.push(`Volume ${rv.toFixed(1)}× average — accumulation building.`);
    } else if (fired && rv < 0.9) {
      cautions.push('Breakout attempt on below-average volume — follow-through is unreliable without volume.');
      score -= 6;
    }
  }

  const d20 = nn(r.d20), d50 = nn(r.d50), d200 = nn(r.d200);
  if (d20 != null && d50 != null && d200 != null && d20 > 0 && d50 > 0 && d200 > 0) {
    score += 12;
    signals.push('Price above the 20/50/200-DMA stack — full trend alignment.');
  } else if (d200 != null && d200 < 0) {
    cautions.push('Still below the 200-DMA — breakouts against the primary trend fail more often.');
    score -= 6;
  }

  const rsi = nn(r.rsi);
  if (rsi != null) {
    if (rsi >= 55 && rsi <= 70) {
      score += 8;
      signals.push(`RSI ${rsi.toFixed(0)} — in the 55-70 power zone, strong but not stretched.`);
    } else if (rsi > 78) {
      cautions.push(`RSI ${rsi.toFixed(0)} — extended; chasing here risks buying the blow-off.`);
      score -= 5;
    }
  }

  if (r.macd_bull_cross) {
    score += 8;
    signals.push('MACD bullish cross on the latest bar.');
  } else if ((nn(r.macd) ?? 0) > 0) {
    score += 4;
    signals.push('MACD histogram positive — momentum on the buyers’ side.');
  }

  const price = nn(r.price), r1 = nn(r.r1);
  if (price != null && r1 != null && r1 > price && (r1 - price) / r1 <= 0.02) {
    score += 8;
    signals.push('Sitting right under the R1 pivot — a clean trigger level overhead.');
  }
  if (r.gap_up) {
    score += 4;
    signals.push('Gapped up today — demand imbalance at the open.');
  }
  if ((nn(r.chg) ?? 0) < -3) {
    cautions.push('Down sharply today — wait for the setup to stabilise.');
    score -= 6;
  }

  if (signals.length < 2) return null;
  score = clamp(Math.round(score), 0, 100);
  return {
    setup: fired ? 'fired' : 'breakout',
    score,
    probability: clamp(Math.round(30 + 0.4 * score + (fired ? 4 : 0)), 25, 75),
    signals,
    cautions,
  };
}

function pullbackRead(r: Row): MomentumRead | null {
  const d20 = nn(r.d20), d50 = nn(r.d50), d200 = nn(r.d200);
  // The whole setup requires an intact primary uptrend to pull back INTO.
  if (d200 == null || d200 <= 0) return null;
  if (r.death_cross || r.cam_break_down) return null;

  const signals: string[] = [];
  const cautions: string[] = [];
  let score = 0;

  if (d200 > 5) {
    score += 15;
    signals.push(`Established uptrend — price ${d200.toFixed(1)}% above the 200-DMA.`);
  } else {
    score += 8;
    signals.push('Primary uptrend intact (above the 200-DMA).');
  }
  if (d50 != null && d50 > 0) {
    score += 10;
    signals.push('Intermediate trend healthy — still above the 50-DMA.');
  }

  if (d20 != null && d20 < 0 && d20 > -8) {
    score += 15;
    signals.push(`Orderly pullback — ${Math.abs(d20).toFixed(1)}% under the 20-DMA, not a breakdown.`);
  } else if (d20 != null && d20 <= -8) {
    cautions.push(`Deep ${Math.abs(d20).toFixed(1)}% break below the 20-DMA — sharper than a routine dip.`);
    score -= 4;
  }

  const rsi = nn(r.rsi);
  if (rsi != null) {
    if (rsi < 30) {
      score += 18;
      signals.push(`RSI ${rsi.toFixed(0)} — washed-out oversold inside an uptrend.`);
    } else if (rsi <= 45) {
      score += 12;
      signals.push(`RSI ${rsi.toFixed(0)} — reset to the pullback zone.`);
    }
    if (rsi < 22) cautions.push('RSI extremely low — sometimes the dip IS the breakdown; confirm before entry.');
  }
  if ((nn(r.willr) ?? 0) <= -80) {
    score += 10;
    signals.push('Williams %R below -80 — short-term selling exhausted.');
  }
  const bb = nn(r.bollb);
  if (bb != null && bb <= 0.25) {
    score += 10;
    signals.push(`Bollinger %B ${bb.toFixed(2)} — hugging the lower band, stretched rubber band.`);
  }

  const price = nn(r.price), s1 = nn(r.s1);
  if (price != null && s1 != null && price > s1 && (price - s1) / s1 <= 0.03) {
    score += 12;
    signals.push('Sitting on the S1 support pivot — defined risk, clean invalidation level.');
  }

  const rv = nn(r.relvol);
  if (rv != null && rv < 1) {
    score += 6;
    signals.push(`Pullback on quiet volume (${rv.toFixed(1)}×) — sellers lack conviction.`);
  } else if (rv != null && rv >= 2 && (nn(r.chg) ?? 0) < 0) {
    cautions.push(`Heavy volume (${rv.toFixed(1)}×) on the decline — distribution, not a quiet dip.`);
    score -= 8;
  }

  if (r.macd_bull_cross) {
    score += 10;
    signals.push('MACD bullish cross — the turn may already be starting.');
  }

  if (signals.length < 3) return null;
  score = clamp(Math.round(score), 0, 100);
  return {
    setup: 'pullback',
    score,
    probability: clamp(Math.round(30 + 0.4 * score), 25, 72),
    signals,
    cautions,
  };
}

// Best qualifying setup for a stock, or null when nothing is set up.
export function classify(r: Row): MomentumRead | null {
  const b = breakoutRead(r);
  const p = pullbackRead(r);
  const best = (b?.score ?? -1) >= (p?.score ?? -1) ? b : p;
  return best && best.score >= 45 ? best : null;
}
