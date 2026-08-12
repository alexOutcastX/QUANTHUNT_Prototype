// MACD strategy filter — the tunable screen behind Momentum and Recommendations.
//
// The cases that matter are the ones where a filter can lie: a missing
// indicator must not pass a test it was never run against, and "turning up
// while still negative" has to mean exactly that rather than "any rise".
const assert = require('assert');
const {
  MACD_DEFAULTS, matchesMacd, rankMacd, dmaDistance, describeMacd,
} = require('./build/macd.js');

let passed = 0;
function ok(name, fn) {
  fn();
  console.log('OK ' + name);
  passed++;
}

const P = (over) => ({ ...MACD_DEFAULTS, ...over });
// A row sitting 5% below the 200-DMA with the histogram turning up: the
// default setup's ideal candidate.
const good = { rsi: 52, macd: -0.4, macd_prev: -0.9, d200: -5, d50: -2, d20: 1 };

ok('the default setup accepts the case it was designed for', () => {
  assert.strictEqual(matchesMacd(good, MACD_DEFAULTS), true);
});

ok('"approaching" means below the average but within the band', () => {
  const p = P({ side: 'approaching', near_pct: 8 });
  assert.strictEqual(matchesMacd({ ...good, d200: -5 }, p), true);
  assert.strictEqual(matchesMacd({ ...good, d200: -12 }, p), false, 'too far below');
  assert.strictEqual(matchesMacd({ ...good, d200: 3 }, p), false, 'already above');
});

ok('"below" and "above" are strict about which side of the line', () => {
  assert.strictEqual(matchesMacd({ ...good, d200: -30 }, P({ side: 'below' })), true);
  assert.strictEqual(matchesMacd({ ...good, d200: 1 }, P({ side: 'below' })), false);
  assert.strictEqual(matchesMacd({ ...good, d200: 20 }, P({ side: 'above' })), true);
  assert.strictEqual(matchesMacd({ ...good, d200: -1 }, P({ side: 'above' })), false);
});

ok('"just reclaimed" is above but still inside the band', () => {
  const p = P({ side: 'just_above', near_pct: 5 });
  assert.strictEqual(matchesMacd({ ...good, d200: 3 }, p), true);
  assert.strictEqual(matchesMacd({ ...good, d200: 9 }, p), false, 'too far above');
  assert.strictEqual(matchesMacd({ ...good, d200: -1 }, p), false, 'still below');
});

ok('a missing DMA distance fails every specific side test', () => {
  // Passing here would put a stock in the list that was never actually checked.
  for (const side of ['below', 'approaching', 'above', 'just_above']) {
    assert.strictEqual(matchesMacd({ ...good, d200: null }, P({ side })), false, side);
  }
  assert.strictEqual(matchesMacd({ ...good, d200: null }, P({ side: 'any' })), true);
});

ok('the DMA choice actually changes which field is read', () => {
  const row = { rsi: 50, macd: -0.1, macd_prev: -0.3, d20: -2, d50: -20, d150: -6, d200: -40 };
  assert.strictEqual(dmaDistance(row, 20), -2);
  assert.strictEqual(dmaDistance(row, 50), -20);
  assert.strictEqual(dmaDistance(row, 150), -6);
  assert.strictEqual(dmaDistance(row, 200), -40);
  const p = (dma) => P({ dma, side: 'approaching', near_pct: 8 });
  assert.strictEqual(matchesMacd(row, p(20)), true);
  assert.strictEqual(matchesMacd(row, p(50)), false);
  assert.strictEqual(matchesMacd(row, p(150)), true);
  assert.strictEqual(matchesMacd(row, p(200)), false);
});

ok('"turning up" requires a rise AND a still-negative histogram', () => {
  const p = P({ side: 'any', macd: 'rising' });
  assert.strictEqual(matchesMacd({ rsi: 50, macd: -0.2, macd_prev: -0.5 }, p), true);
  assert.strictEqual(matchesMacd({ rsi: 50, macd: -0.6, macd_prev: -0.2 }, p), false, 'falling');
  assert.strictEqual(matchesMacd({ rsi: 50, macd: 0.9, macd_prev: 0.4 }, p), false,
    'already positive — the turn has fired, this is a different setup');
});

ok('a bullish cross prefers the server flag and falls back to the bars', () => {
  const p = P({ side: 'any', macd: 'bull_cross' });
  assert.strictEqual(matchesMacd({ rsi: 50, macd_bull_cross: true }, p), true);
  assert.strictEqual(matchesMacd({ rsi: 50, macd_bull_cross: false, macd: 0.5, macd_prev: -0.5 }, p),
    false, 'the explicit flag wins over inference');
  assert.strictEqual(matchesMacd({ rsi: 50, macd: 0.3, macd_prev: -0.2 }, p), true, 'inferred');
  assert.strictEqual(matchesMacd({ rsi: 50, macd: 0.3, macd_prev: 0.1 }, p), false, 'no sign change');
});

ok('the RSI band excludes both ends', () => {
  const p = P({ side: 'any', macd: 'any', rsi_min: 40, rsi_max: 65 });
  assert.strictEqual(matchesMacd({ rsi: 50 }, p), true);
  assert.strictEqual(matchesMacd({ rsi: 30 }, p), false);
  assert.strictEqual(matchesMacd({ rsi: 80 }, p), false);
  assert.strictEqual(matchesMacd({ rsi: 40 }, p), true, 'inclusive lower bound');
  assert.strictEqual(matchesMacd({ rsi: 65 }, p), true, 'inclusive upper bound');
});

ok('a 0-100 band ignores RSI entirely, including when it is missing', () => {
  const p = P({ side: 'any', macd: 'any', rsi_min: 0, rsi_max: 100 });
  assert.strictEqual(matchesMacd({ rsi: null }, p), true);
  const narrow = P({ side: 'any', macd: 'any', rsi_min: 40, rsi_max: 65 });
  assert.strictEqual(matchesMacd({ rsi: null }, narrow), false, 'unknown RSI cannot pass a band');
});

ok('ranking puts the closest to the crossover first', () => {
  const rows = [
    { symbol: 'FAR', d200: -20, macd: -1, macd_prev: -2 },
    { symbol: 'NEAR', d200: -1, macd: -1, macd_prev: -2 },
    { symbol: 'MID', d200: -7, macd: -1, macd_prev: -2 },
  ];
  const out = rankMacd(rows, P({ dma: 200 }));
  assert.deepStrictEqual(out.map((r) => r.symbol), ['NEAR', 'MID', 'FAR']);
});

ok('ties break toward the faster-improving histogram', () => {
  const rows = [
    { symbol: 'SLOW', d200: -5, macd: -0.9, macd_prev: -1.0 },
    { symbol: 'FAST', d200: -5, macd: -0.2, macd_prev: -1.0 },
  ];
  assert.deepStrictEqual(rankMacd(rows, P({ dma: 200 })).map((r) => r.symbol), ['FAST', 'SLOW']);
});

ok('ranking does not mutate the caller array', () => {
  const rows = [{ d200: -20 }, { d200: -1 }];
  const before = rows.slice();
  rankMacd(rows, MACD_DEFAULTS);
  assert.deepStrictEqual(rows, before);
});

ok('the summary line reflects the live settings', () => {
  const txt = describeMacd(P({ dma: 50, side: 'below', macd: 'bull_cross', rsi_min: 30, rsi_max: 70 }));
  assert.ok(txt.includes('50-DMA'), txt);
  assert.ok(txt.includes('RSI 30–70'), txt);
  const noRsi = describeMacd(P({ rsi_min: 0, rsi_max: 100 }));
  assert.ok(!noRsi.includes('RSI'), noRsi);
});

console.log(`\nALL MACD STRATEGY TESTS PASSED (${passed})`);
