// The DMA-crossover engine, executed against a real session's data.
//
// The source-level tests can see that the rules are written. They cannot see
// what the rules actually select, and this list has one property that is easy
// to get backwards and impossible to spot by reading: a pair that is CLOSE is
// not the same as a pair that is CLOSING. A gap of 0.2% that was 0.1% a week
// ago has already crossed and is separating — putting it on a "approaching a
// crossover" list is exactly wrong, and it looks identical to a real candidate
// in every field except the one this checks.
//
// So this compiles mobile/src/dmaCross.ts and runs it over synthesised gap data
// covering every arrangement the feed can produce, plus the real NIFTY 500
// fixture for the shape of the rows.
//
// Run: node e2e/dma.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(process.env.TMPDIR || '/tmp', `dma-engine-${process.pid}.cjs`);

function esbuild() {
  const candidates = [
    path.join(ROOT, 'node_modules', '.bin', 'esbuild'),
    path.join(ROOT, 'mobile', 'node_modules', '.bin', 'esbuild'),
  ];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) {
    console.error('esbuild not found. Run `npm ci` in the repository root.');
    process.exit(1);
  }
  return found;
}

execFileSync(esbuild(),
  [path.join(ROOT, 'mobile', 'src', 'dmaCross.ts'), '--bundle', '--format=cjs',
   '--platform=node', '--log-level=warning', '--outfile=' + OUT],
  { stdio: ['ignore', 'inherit', 'inherit'] });

const D = require(OUT);

let failures = 0;
const fail = (name, detail) => { failures++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); };
const pass = (name) => console.log(`PASS  ${name}`);
const check = (name, ok, detail) => (ok ? pass(name) : fail(name, detail));

const row = (sym, gaps, extra = {}) => ({ sym, name: sym + ' Ltd', price: 100, chg: 0.5, ma_gaps: gaps, ...extra });

console.log(`${D.PAIRS.length} pairs: ${D.PAIRS.map((p) => p.label).join(', ')}\n`);

// ── 1. the rule that defines the list ──
{
  const closing = row('CLOSING', { '20_50': [-0.4, -0.9] });
  const widening = row('WIDENING', { '20_50': [0.4, 0.1] });
  const got = D.scanApproaches([closing, widening], { within: 1 });
  check('a converging pair is listed and a separating one is not',
        got.length === 1 && got[0].symbol === 'CLOSING',
        JSON.stringify(got.map((a) => a.symbol)));
}
{
  // Exactly equal is kept: a gap holding steady on the line is still on it.
  const flat = row('FLAT', { '20_50': [0.3, 0.3] });
  check('a gap holding steady is kept',
        D.scanApproaches([flat], { within: 1 }).length === 1);
}

// ── 2. the threshold is a half-width, and it bites ──
{
  const rows = [
    row('IN', { '9_20': [0.4, 0.9] }),
    row('EDGE', { '9_20': [-1.0, -1.4] }),
    row('OUT', { '9_20': [1.6, 2.2] }),
  ];
  const at1 = D.scanApproaches(rows, { within: 1 }).map((a) => a.symbol);
  const at2 = D.scanApproaches(rows, { within: 2 }).map((a) => a.symbol);
  check('the threshold includes its own edge and excludes beyond it',
        at1.join() === 'IN,EDGE', at1.join());
  check('widening the threshold can only add rows',
        at2.length >= at1.length && at1.every((s) => at2.includes(s)), at2.join());
}

// ── 3. direction is read off the sign, never guessed ──
{
  const below = D.scanApproaches([row('UP', { '50_200': [-0.3, -0.8] })], { within: 1 })[0];
  const above = D.scanApproaches([row('DOWN', { '50_200': [0.3, 0.8] })], { within: 1 })[0];
  check('fast below slow reads as an upward cross', below.direction === 'up');
  check('fast above slow reads as a downward cross', above.direction === 'down');
  check('the 50/200 pair is named golden and death',
        D.crossName(below) === 'Golden cross' && D.crossName(above) === 'Death cross',
        `${D.crossName(below)} / ${D.crossName(above)}`);
  const fast = D.scanApproaches([row('X', { '9_20': [-0.3, -0.8] })], { within: 1 })[0];
  check('the faster pairs are not called golden crosses',
        D.crossName(fast) === 'Bullish cross', D.crossName(fast));
}

// ── 4. sessions-to-contact ──
{
  // 0.5% left, closing 0.5pp over five sessions = 0.1pp a session = 5 sessions.
  const a = D.scanApproaches([row('ETA', { '20_50': [-0.5, -1.0] })], { within: 1 })[0];
  check('the estimate is the remaining gap over the observed rate',
        a.eta === 5, `eta=${a.eta} speed=${a.speed}`);
  const none = D.scanApproaches([row('NOHIST', { '20_50': [-0.5, null] })], { within: 1 })[0];
  check('no history means no estimate rather than a made-up one',
        none && none.eta === null && none.was === null);
  check('a row with no history is still listed', !!none);
}

// ── 5. ordering and stability ──
{
  const rows = [
    row('FAR', { '9_20': [0.9, 1.4] }),
    row('NEAR', { '9_20': [0.1, 0.6] }),
    row('MID', { '9_20': [0.5, 1.0] }),
  ];
  const order = D.scanApproaches(rows, { within: 2 }).map((a) => a.symbol).join(',');
  check('nearest first', order === 'NEAR,MID,FAR', order);
  const tie = [row('BBB', { '9_20': [0.5, 1] }), row('AAA', { '9_20': [0.5, 1] })];
  const t1 = D.scanApproaches(tie, { within: 2 }).map((a) => a.symbol).join(',');
  const t2 = D.scanApproaches(tie.slice().reverse(), { within: 2 }).map((a) => a.symbol).join(',');
  check('ties break the same way whatever order the rows arrive in',
        t1 === 'AAA,BBB' && t1 === t2, `${t1} vs ${t2}`);
}

// ── 6. one symbol can be near on more than one pair ──
{
  const multi = row('MULTI', {
    '9_20': [-0.2, -0.7], '20_50': [-0.4, -0.9],
    '50_100': [-0.6, -1.1], '50_200': [-0.8, -1.3],
  });
  const got = D.scanApproaches([multi], { within: 1 });
  check('every converging pair of one symbol is its own row', got.length === 4, String(got.length));
  const keys = got.map((a) => a.pair.key).join(',');
  check('and they are ordered nearest first too', keys === '9_20,20_50,50_100,50_200', keys);
  const counts = D.countByPair(got);
  check('the chip counts add up to the list',
        counts.all === 4 && D.PAIRS.every((p) => counts[p.key] === 1), JSON.stringify(counts));
}

// ── 7. filters compose without losing rows ──
{
  const rows = [
    row('A', { '9_20': [-0.2, -0.7], '50_200': [0.3, 0.9] }),
    row('B', { '20_50': [-0.5, -0.9] }),
  ];
  const all = D.scanApproaches(rows, { within: 1 });
  const byPair = D.scanApproaches(rows, { within: 1, pair: '9_20' });
  const byDir = D.scanApproaches(rows, { within: 1, direction: 'up' });
  check('filtering by pair returns a subset', byPair.every((a) => a.pair.key === '9_20')
        && byPair.length <= all.length && byPair.length === 1, String(byPair.length));
  check('filtering by direction returns a subset',
        byDir.every((a) => a.direction === 'up') && byDir.length === 2, String(byDir.length));
}

// ── 8. junk from the feed cannot throw ──
{
  const junk = [
    {}, { sym: '' }, { sym: 'X' }, { sym: 'X', ma_gaps: null },
    { sym: 'X', ma_gaps: {} },
    { sym: 'X', ma_gaps: { '9_20': null } },
    { sym: 'X', ma_gaps: { '9_20': [] } },
    { sym: 'X', ma_gaps: { '9_20': [NaN, 1] } },
    { sym: 'X', ma_gaps: { '9_20': ['a', 'b'] } },
    { sym: 'X', ma_gaps: { '9_20': [Infinity, 1] } },
    { sym: 'X', ma_gaps: { unknown_pair: [0.1, 0.5] } },
    null, undefined,
  ];
  let threw = null;
  let got = [];
  try { got = D.scanApproaches(junk.filter(Boolean), { within: 1 }); } catch (e) { threw = e.message; }
  check('malformed rows are skipped, not fatal', !threw, threw);
  check('and none of them produce a candidate', got.length === 0, JSON.stringify(got));
}

// ── 9. against the real fixture's row shape ──
{
  const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'e2e', 'fixtures', 'screener_universe.json'), 'utf8'));
  // The fixture predates this feature, so no row carries gaps — which is
  // precisely the state of the first snapshot after deploy. It must come back
  // empty rather than throwing.
  let threw = null;
  let got = [];
  try { got = D.scanApproaches(fx.rows, { within: 1 }); } catch (e) { threw = e.message; }
  check('a snapshot with no gap data yields nothing and does not throw',
        !threw && got.length === 0, threw || `${got.length} rows`);

  // Now synthesise gaps onto those same real rows, so the sweep runs over
  // realistic symbols, prices and names rather than three hand-written stubs.
  const seeded = fx.rows.map((r, i) => ({
    ...r,
    ma_gaps: {
      '9_20': [((i % 7) - 3) * 0.3, ((i % 7) - 3) * 0.3 - Math.sign((i % 7) - 3 || 1) * 0.5],
      '20_50': [((i % 5) - 2) * 0.6, ((i % 5) - 2) * 0.6 * 1.8],
      '50_200': [((i % 11) - 5) * 0.4, ((i % 11) - 5) * 0.4 * 2],
    },
  }));
  let all = [];
  try { all = D.scanApproaches(seeded, { within: 1 }); } catch (e) { threw = e.message; }
  check('the real universe sweeps without throwing', !threw, threw);
  check('and it selects a subset rather than everything or nothing',
        all.length > 0 && all.length < seeded.length * D.PAIRS.length,
        `${all.length} of ${seeded.length * D.PAIRS.length} possible`);
  const bad = all.filter((a) => a.was != null && Math.abs(a.was) < a.distance);
  check('no separating pair survives the sweep', bad.length === 0,
        bad.slice(0, 3).map((a) => `${a.symbol} ${a.pair.key}`).join(', '));
  const overshoot = all.filter((a) => a.distance > 1);
  check('nothing outside the threshold survives the sweep', overshoot.length === 0,
        String(overshoot.length));
  const labelled = all.every((a) => typeof D.crossName(a) === 'string' && D.crossName(a).length > 0);
  check('every candidate can be named', labelled);
  const etas = all.map((a) => a.eta).filter((v) => v != null);
  check('every estimate is a positive whole number of sessions',
        etas.every((v) => Number.isInteger(v) && v >= 1), JSON.stringify(etas.slice(0, 5)));
}

fs.unlinkSync(OUT);
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL DMA CROSSOVER CHECKS PASSED');
process.exit(failures ? 1 : 0);
