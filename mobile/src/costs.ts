// India equity transaction-cost model — makes backtests realistic instead of
// frictionless. All rates are the standard NSE/BSE statutory charges plus a
// configurable brokerage and slippage. Pure functions; unit-tested on node.
//
// Charges modelled (per the SEBI / exchange schedule, equity segment):
//   - Brokerage      : min(flat ₹/order, bps% of turnover) per side
//   - STT            : delivery 0.1% both sides · intraday 0.025% sell side
//   - Exchange txn   : ~0.00297% (NSE) of turnover, both sides
//   - SEBI turnover  : 0.0001% (₹10/cr) both sides
//   - Stamp duty     : delivery 0.015% · intraday 0.003%, BUY side only
//   - GST            : 18% on (brokerage + exchange txn + SEBI)
// Slippage is applied to the fill PRICE (bps per side), separate from charges.

export type Segment = 'delivery' | 'intraday';

export type CostModel = {
  segment: Segment;
  brokerageFlat: number; // ₹ per executed order (e.g. 20 for a discount broker)
  brokerageBps: number; // and/or % of turnover per side (e.g. 3 = 0.03%)
  slippageBps: number; // price impact per side, in basis points
};

export const DEFAULT_COSTS: CostModel = {
  segment: 'delivery',
  brokerageFlat: 20,
  brokerageBps: 3, // 0.03%; effective brokerage is the lower of flat vs bps
  slippageBps: 5, // 0.05% per side
};

// Statutory rates as fractions of turnover.
const STT = { delivery: 0.001, intraday_sell: 0.00025 };
const EXCHANGE_TXN = 0.0000297; // NSE equity
const SEBI = 0.000001; // ₹10 per crore
const STAMP = { delivery: 0.00015, intraday: 0.00003 }; // buy side only
const GST = 0.18;

export type Charges = {
  brokerage: number;
  stt: number;
  exchange: number;
  sebi: number;
  stamp: number;
  gst: number;
  total: number;
};

function _brokerage(turnover: number, m: CostModel): number {
  const bps = turnover * (m.brokerageBps / 10000);
  // Discount-broker convention: whichever is lower, but never below zero.
  return Math.max(0, Math.min(m.brokerageFlat, bps || m.brokerageFlat));
}

/** Round-trip charges (₹) for a buy leg of `buyVal` and a sell leg of `sellVal`. */
export function tradeCharges(buyVal: number, sellVal: number, m: CostModel): Charges {
  const brokerage = _brokerage(buyVal, m) + _brokerage(sellVal, m);
  const stt =
    m.segment === 'delivery'
      ? STT.delivery * (buyVal + sellVal)
      : STT.intraday_sell * sellVal;
  const exchange = EXCHANGE_TXN * (buyVal + sellVal);
  const sebi = SEBI * (buyVal + sellVal);
  const stamp = (m.segment === 'delivery' ? STAMP.delivery : STAMP.intraday) * buyVal;
  const gst = GST * (brokerage + exchange + sebi);
  const total = brokerage + stt + exchange + sebi + stamp + gst;
  return {
    brokerage: r2(brokerage),
    stt: r2(stt),
    exchange: r2(exchange),
    sebi: r2(sebi),
    stamp: r2(stamp),
    gst: r2(gst),
    total: r2(total),
  };
}

/** Fill price after slippage: buys fill higher, sells fill lower. */
export function slip(price: number, side: 'buy' | 'sell', m: CostModel): number {
  const f = m.slippageBps / 10000;
  return side === 'buy' ? price * (1 + f) : price * (1 - f);
}

/** Total round-trip cost as a fraction of the buy notional — handy for
 *  turning a gross return into a net one. */
export function costFraction(buyVal: number, sellVal: number, m: CostModel): number {
  if (buyVal <= 0) return 0;
  return tradeCharges(buyVal, sellVal, m).total / buyVal;
}

function r2(x: number): number {
  return Math.round(x * 100) / 100;
}
