// Node smoke tests for the pure TS engines (backtest, screener, analysis).
// CI bundles each with esbuild and runs assertions — no RN/browser needed.
// Run:  node mobile/tests/engines.test.js   (CI builds the bundles first)
const assert = require('assert');
const path = require('path');

const bt = require(path.join(__dirname, 'build', 'backtest.js'));
const scr = require(path.join(__dirname, 'build', 'screener.js'));
const costs = require(path.join(__dirname, 'build', 'costs.js'));

// ── backtest: custom strategy fires and produces trades ──
(function backtest() {
  const candles = [];
  let px = 100;
  for (let i = 0; i < 60; i++) {
    if (i >= 20 && i < 30) px -= 2;
    else if (i >= 30) px += 2;
    candles.push({ t: 1700000000 + i * 86400, o: px, h: px * 1.01, l: px * 0.99, c: px, v: 1000 });
  }
  const sig = bt.runCustomStrategy(candles, {
    buy: [{ ind: 'rsi', period: 5, op: 'lt', target: 'value', value: 25 }],
    sell: [{ ind: 'rsi', period: 5, op: 'gt', target: 'value', value: 75 }],
  });
  assert(sig.some((s) => s === 1), 'custom buy signal fires');
  const res = bt.runBacktest(candles, 'custom', [], {
    slType: 'none', slVal: 0, tpType: 'none', tpVal: 0, trail: false, trailPct: 0, capital: 100000,
  }, {
    buy: [{ ind: 'rsi', period: 5, op: 'lt', target: 'value', value: 25 }],
    sell: [{ ind: 'rsi', period: 5, op: 'gt', target: 'value', value: 75 }],
  });
  assert(res.trades.length >= 1, 'backtest produces >= 1 trade');
  // built-in EMA crossover also runs
  const ema = bt.runBacktest(candles, 'ema_cross', [5, 15], {
    slType: 'none', slVal: 0, tpType: 'none', tpVal: 0, trail: false, trailPct: 0, capital: 100000,
  });
  assert(Array.isArray(ema.markers), 'ema_cross returns markers');

  // with a cost model, charges drag net return below the frictionless run
  const gross = bt.runBacktest(candles, 'ema_cross', [5, 15], {
    slType: 'none', slVal: 0, tpType: 'none', tpVal: 0, trail: false, trailPct: 0, capital: 100000,
  });
  const net = bt.runBacktest(candles, 'ema_cross', [5, 15], {
    slType: 'none', slVal: 0, tpType: 'none', tpVal: 0, trail: false, trailPct: 0, capital: 100000,
  }, undefined, costs.DEFAULT_COSTS);
  if (net.trades.length) {
    assert(typeof net.stats.totalCharges === 'number' && net.stats.totalCharges > 0, 'costs booked');
    assert(net.stats.finalCapital < gross.stats.finalCapital, 'costs reduce net capital');
  }
  console.log('OK backtest');
})();

// ── costs: India charge model + slippage ──
(function costModel() {
  const m = costs.DEFAULT_COSTS;
  const ch = costs.tradeCharges(100000, 105000, m);
  assert(ch.total > 0 && ch.stt > 0 && ch.gst > 0, 'delivery charges positive');
  // delivery STT (both sides) exceeds intraday STT (sell side only) here
  const intra = costs.tradeCharges(100000, 105000, { ...m, segment: 'intraday' });
  assert(ch.stt > intra.stt, 'delivery STT > intraday STT');
  // slippage moves fills against the trader
  assert(costs.slip(100, 'buy', m) > 100, 'buy slips up');
  assert(costs.slip(100, 'sell', m) < 100, 'sell slips down');
  console.log('OK costs');
})();

// ── screener: a signal filter selects only rows with the flag ──
(function screener() {
  const rows = {
    A: { rsi: 20, d200: 5, golden_cross: true },
    B: { rsi: 80, d200: -5, golden_cross: false },
  };
  const def = scr.FILTER_DEFS.find((d) => d.key === 'golden_cross');
  assert(def, 'golden_cross filter exists');
  assert(def.get(rows.A) === true && def.get(rows.B) === false, 'signal filter discriminates');
  // calcSignal returns a verdict string
  const sig = scr.calcSignal(rows.A);
  assert(typeof sig === 'string' && sig.length, 'calcSignal returns a verdict');
  console.log('OK screener');
})();

console.log('ALL ENGINE TESTS PASSED');
