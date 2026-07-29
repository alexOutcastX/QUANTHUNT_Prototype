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
const swr = require(path.join(__dirname, 'build', 'swr.js'));

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

// ── swr: the client read cache that makes a revisit instant ──
(async function readCache() {
  let calls = 0;
  const fetcher = async () => { calls += 1; return { n: calls }; };

  const a = await swr.swr('k1', 60000, fetcher);
  await swr.swr('k1', 60000, fetcher);
  assert(calls === 1, `fresh hit refetched (${calls} calls)`);

  // Past the TTL the STALE value returns immediately and a refresh runs behind
  // it — that is what stops a tab switch showing a spinner.
  const c = await swr.swr('k1', 0, fetcher);
  assert(c.n === a.n, 'stale-while-revalidate did not serve the cached value');
  await new Promise((r) => setTimeout(r, 40));
  assert(calls === 2, 'background refresh did not run');
  const d = await swr.swr('k1', 60000, fetcher);
  assert(d.n === 2, 'refreshed value was not adopted');

  await swr.swr('k1', 60000, fetcher, { force: true });
  assert(calls === 3, 'force did not bypass the cache');

  // Concurrent callers of one key share a single request.
  let shared = 0;
  const slow = async () => { shared += 1; await new Promise((r) => setTimeout(r, 20)); return shared; };
  await Promise.all([swr.swr('k2', 60000, slow), swr.swr('k2', 60000, slow), swr.swr('k2', 60000, slow)]);
  assert(shared === 1, `duplicate in-flight requests (${shared})`);

  // A failed fetch must not poison the key.
  let threw = false;
  try { await swr.swr('k3', 60000, async () => { throw new Error('boom'); }); } catch { threw = true; }
  assert(threw, 'a failing fetch should reject');
  const ok = await swr.swr('k3', 60000, async () => ({ ok: true }));
  assert(ok.ok, 'key stayed poisoned after a failure');

  assert(swr.peek('k1') !== null, 'peek should return a cached value');
  assert(swr.peek('nope') === null, 'peek should return null for an unknown key');
  swr.invalidate('k1');
  assert(swr.peek('k1') === null, 'invalidate did not clear the key');
  console.log('OK swr cache');

  // ── pooled: bounded concurrency, order preserved ──
  let live = 0, peak = 0;
  const jobs = Array.from({ length: 20 }, (_, i) => async () => {
    live += 1; peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 5));
    live -= 1;
    return i;
  });
  const out = await swr.pooled(jobs, 4);
  assert(peak <= 4, `concurrency limit exceeded (peak ${peak})`);
  assert(peak > 1, 'jobs ran serially — parallelism is the whole point');
  assert(out.join(',') === jobs.map((_, i) => i).join(','), 'pooled did not preserve order');
  assert((await swr.pooled([], 4)).length === 0, 'empty job list should return empty');
  console.log('OK pooled');

  console.log('ALL ENGINE TESTS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });

