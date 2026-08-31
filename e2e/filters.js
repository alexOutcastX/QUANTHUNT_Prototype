// Every screener filter, executed — not inspected.
//
// The source-level tests can see that a filter is declared and wired; they
// cannot see that it never matches anything. Three did not: PEG was served on
// 0 of 500 rows, so the PEG filter and the GARP strategy were empty screens
// rather than empty results, and Quality compounder required a ROCE the feed
// carries for 7.6% of the market.
//
// So this bundles the real engine and runs it over a real session's data
// (e2e/fixtures/screener_universe.json — a NIFTY 500 day exactly as the server
// served it, gaps included), one filter at a time and then in pairs. What it
// looks for:
//
//   * anything that throws
//   * a filter no row can answer — a menu entry that always returns nothing
//   * `between[min..max]` that drops rows which have a value, which would mean
//     the comparison itself is wrong
//   * AND that returns MORE than either side alone, or OR that returns fewer —
//     the two ways a boolean fold can be broken
//
// Run: node e2e/filters.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(process.env.TMPDIR || '/tmp', `screener-engine-${process.pid}.cjs`);

/**
 * Where esbuild lives.
 *
 * It is a root dev dependency, but this ran green locally and failed in CI,
 * which installs mobile/ and nothing else — the script assumed one layout and
 * got ENOENT in the other. Both are checked, and a miss says what to run
 * rather than throwing a spawn error at whoever reads the log next.
 */
function esbuild() {
  const candidates = [
    path.join(ROOT, 'node_modules', '.bin', 'esbuild'),
    path.join(ROOT, 'mobile', 'node_modules', '.bin', 'esbuild'),
  ];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) {
    console.error('esbuild not found. Run `npm ci` in the repository root.');
    console.error('Looked in:\n  ' + candidates.join('\n  '));
    process.exit(1);
  }
  return found;
}

// Compiled from source rather than from a checked-in build: the test must
// exercise the CURRENT engine, or it becomes a test of whatever was last
// compiled.
const compile = (entry, out) => execFileSync(esbuild(),
  [entry, '--bundle', '--format=cjs', '--platform=node',
   '--log-level=warning', '--outfile=' + out],
  { stdio: ['ignore', 'inherit', 'inherit'] });

compile(path.join(ROOT, 'mobile', 'src', 'screener.ts'), OUT);

const E = require(OUT);
const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'e2e', 'fixtures', 'screener_universe.json'), 'utf8'));
E.setSectorMedians(fx.sector_medians || {});

// The pattern filters read a bias the screen annotates only while a Patterns
// filter is active. Seeded so they are exercised rather than skipped.
const BIAS = ['bullish', 'bearish', 'neutral'];
const rows = fx.rows.map((r, i) => ({ ...r, _patBias: BIAS[i % 3] }));

let failures = 0;
const fail = (name, detail) => { failures++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); };
const pass = (name) => console.log(`PASS  ${name}`);

console.log(`${rows.length} rows from ${fx.captured}; ${E.FILTER_DEFS.length} filters\n`);

// ── what each filter can see in this session ──
const stats = new Map();
for (const d of E.FILTER_DEFS) {
  const vals = [];
  let threw = null;
  for (const r of rows) {
    try { vals.push(d.get(r)); } catch (e) { threw = threw || e.message; }
  }
  const nums = vals.filter((v) => typeof v === 'number' && isFinite(v)).sort((a, b) => a - b);
  stats.set(d.key, {
    d, threw, nums,
    trues: vals.filter((v) => v === true).length,
    bools: vals.filter((v) => typeof v === 'boolean').length,
    strs: vals.filter((v) => typeof v === 'string' && v !== ''),
  });
}

// ── 1. nothing throws, and every filter can be answered by something ──
const dead = [];
const threw = [];
for (const [key, s] of stats) {
  if (s.threw) { threw.push(`${key}: ${s.threw}`); continue; }
  const answerable = s.d.type === 'toggle' ? s.trues > 0
    : s.d.type === 'select' ? s.strs.length > 0
    : s.nums.length > 0;
  if (!answerable) dead.push(key);
}
threw.length ? fail('no filter throws on a real row', threw.join('; ')) : pass('no filter throws on a real row');
dead.length
  ? fail('every filter can match something in a real session',
         `${dead.length} cannot: ${dead.join(', ')}`)
  : pass('every filter can match something in a real session');

// ── 2. a range spanning everything keeps everything that has a value ──
const wrong = [];
for (const [key, s] of stats) {
  if (s.d.type !== 'range' || !s.nums.length) continue;
  const kept = E.applyExpr(rows, [{
    id: 'x', key, op: 'between', v1: String(s.nums[0]), v2: String(s.nums[s.nums.length - 1]), join: 'and',
  }]).length;
  if (kept < s.nums.length) wrong.push(`${key} kept ${kept}/${s.nums.length}`);
}
wrong.length
  ? fail('between[min..max] keeps every row that has a value', wrong.join('; '))
  : pass('between[min..max] keeps every row that has a value');

// ── 3. pairs: AND cannot widen, OR cannot narrow ──
const probe = (d) => {
  const s = stats.get(d.key);
  if (d.type === 'toggle') return { key: d.key, op: 'is' };
  if (d.type === 'select') return { key: d.key, op: 'has', v1: s.strs[0] };
  return { key: d.key, op: 'gt', v1: String(s.nums[Math.floor(s.nums.length / 2)]) };
};
const usable = E.FILTER_DEFS.filter((d) => {
  const s = stats.get(d.key);
  return d.type === 'toggle' ? s.trues > 0 : d.type === 'select' ? s.strs.length : s.nums.length > 2;
});
const bad = [];
let pairs = 0;
for (let i = 0; i < usable.length; i++) {
  for (let j = i + 1; j < usable.length; j++) {
    const a = probe(usable[i]);
    const b = probe(usable[j]);
    const A = E.applyExpr(rows, [{ id: 'a', join: 'and', ...a }]).length;
    const B = E.applyExpr(rows, [{ id: 'b', join: 'and', ...b }]).length;
    const AND = E.applyExpr(rows, [{ id: 'a', join: 'and', ...a }, { id: 'b', join: 'and', ...b }]).length;
    const OR = E.applyExpr(rows, [{ id: 'a', join: 'and', ...a }, { id: 'b', join: 'or', ...b }]).length;
    pairs++;
    if (AND > Math.min(A, B)) bad.push(`${a.key} AND ${b.key}: ${A}&${B} -> ${AND}`);
    if (OR < Math.max(A, B)) bad.push(`${a.key} OR ${b.key}: ${A}|${B} -> ${OR}`);
  }
}
bad.length
  ? fail(`${pairs} filter pairs combine correctly`, bad.slice(0, 6).join('; '))
  : pass(`${pairs} filter pairs combine correctly`);

// ── 4. all of them at once, which is the deepest chain the UI can build ──
try {
  const chain = usable.map((d, i) => ({ id: 'c' + i, join: 'and', ...probe(d) }));
  const out = E.applyExpr(rows, chain);
  if (!Array.isArray(out)) throw new Error('did not return an array');
  pass(`all ${chain.length} filters ANDed at once (-> ${out.length} rows)`);
} catch (e) {
  fail('all filters ANDed at once', e.message);
}

// ── 5. the shipped presets are screens, not empty sets ──
const presetOut = path.join(process.env.TMPDIR || '/tmp', `screener-presets-${process.pid}.cjs`);
compile(path.join(ROOT, 'mobile', 'src', 'presets.ts'), presetOut);
const P = require(presetOut);
const emptyPresets = [];
for (const p of P.PRESETS) {
  const n = E.applyExpr(rows, E.filtersToExpr(p.filters, 'preset:' + p.id)).length;
  if (n === 0) emptyPresets.push(`${p.id} (${p.name})`);
}
// A preset for a rare event can legitimately be empty on one session; a third
// of the menu cannot.
if (emptyPresets.length > P.PRESETS.length / 3) {
  fail('the preset menu offers screens that return something',
       `${emptyPresets.length}/${P.PRESETS.length} empty: ${emptyPresets.slice(0, 8).join(', ')}`);
} else {
  pass(`${P.PRESETS.length - emptyPresets.length}/${P.PRESETS.length} presets return rows` +
       (emptyPresets.length ? ` (empty today: ${emptyPresets.join(', ')})` : ''));
}

// ── 6. the numbers are in the units the labels claim ──
//
// The bug this guards against did not throw and did not empty a screen: it
// served yfinance's debtToEquity percentage under a filter labelled "x", and
// a rescaling heuristic turned Reliance's 0.46% dividend yield into 46.0. Both
// filters "worked" — they just answered a different question than the one on
// screen, and no source-level test can see that.
const UNITS = [
  { key: 'debt_equity', label: 'Debt / Equity (x)', ceiling: 5,
    why: 'a ratio; NSE gearing above 5x is rare, above 30x is a percentage' },
  { key: 'dividend_yield', label: 'Dividend yield (%)', ceiling: 15,
    why: 'a percent; no NSE company yields 15%' },
  { key: 'roe', label: 'ROE (%)', ceiling: 100, why: 'a percent, not a ratio' },
  { key: 'pe', label: 'P/E (x)', ceiling: 500, why: 'a multiple' },
];
const offScale = [];
for (const u of UNITS) {
  const def = E.DEF_BY_KEY[u.key];
  const vals = rows.map((r) => def.get(r)).filter((v) => typeof v === 'number' && isFinite(v));
  if (!vals.length) continue;
  vals.sort((a, b) => a - b);
  const median = vals[Math.floor(vals.length / 2)];
  // The median, not the maximum: one outlier is a bad row, a median off the
  // scale is the whole column in the wrong unit.
  if (median > u.ceiling) {
    offScale.push(`${u.label} median ${median} > ${u.ceiling} — ${u.why}`);
  }
}
offScale.length
  ? fail('the numbers are in the units their labels claim', offScale.join('; '))
  : pass('the numbers are in the units their labels claim');

fs.unlinkSync(OUT);
fs.unlinkSync(presetOut);
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL FILTER CHECKS PASSED');
process.exit(failures ? 1 : 0);
