// Node smoke tests for the pure TS engines (screener, costs, analysis).
// CI bundles each with esbuild and runs assertions — no RN/browser needed.
// Run:  node mobile/tests/engines.test.js   (CI builds the bundles first)
//
// The backtest engine moved server-side (backtest_engine.py) and is covered by
// tests/test_backtest_engine.py in the Python suite.
const assert = require('assert');
const path = require('path');

const scr = require(path.join(__dirname, 'build', 'screener.js'));
const costs = require(path.join(__dirname, 'build', 'costs.js'));

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
