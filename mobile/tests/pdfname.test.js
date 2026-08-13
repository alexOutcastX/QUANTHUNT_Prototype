// Export filename convention: Taureye_<Kind>_<Subject>
//
// The cases that matter are real NSE scrips whose tickers contain characters a
// filesystem or browser will not take — M&M, L&TFH, BAJAJ-AUTO, NIFTY 500.
const assert = require('assert');
const { docFileName, professionalShell } = require('./build/pdf.js');

let passed = 0;
function ok(name, fn) {
  fn();
  console.log('OK ' + name);
  passed++;
}

ok('the dossier name matches the required convention', () => {
  assert.strictEqual(docFileName('Dossier', 'RELIANCE'), 'Taureye_Dossier_RELIANCE');
  assert.strictEqual(docFileName('Dossier', 'TCS'), 'Taureye_Dossier_TCS');
});

ok('an ampersand ticker does not produce a doubled separator', () => {
  // M&M and L&TFH are real scrips; "M__M" would look like a bug to the user.
  assert.strictEqual(docFileName('Dossier', 'M&M'), 'Taureye_Dossier_M_M');
  assert.strictEqual(docFileName('Dossier', 'L&TFH'), 'Taureye_Dossier_L_TFH');
});

ok('hyphens and dots survive — they are valid and meaningful', () => {
  assert.strictEqual(docFileName('Dossier', 'BAJAJ-AUTO'), 'Taureye_Dossier_BAJAJ-AUTO');
  assert.strictEqual(docFileName('Dossier', 'M&MFIN.NS'), 'Taureye_Dossier_M_MFIN.NS');
});

ok('spaces become underscores rather than breaking the download', () => {
  assert.strictEqual(docFileName('Momentum', 'NIFTY 500'), 'Taureye_Momentum_NIFTY_500');
});

ok('characters a filesystem rejects are stripped', () => {
  for (const bad of ['A/B', 'A\\B', 'A:B', 'A*B', 'A?B', 'A"B', 'A<B', 'A>B', 'A|B']) {
    const out = docFileName('Dossier', bad);
    assert.strictEqual(out, 'Taureye_Dossier_A_B', `${bad} -> ${out}`);
    for (const ch of '/\\:*?"<>|') assert.ok(!out.includes(ch), `${out} still contains ${ch}`);
  }
});

ok('leading and trailing junk does not leave dangling underscores', () => {
  assert.strictEqual(docFileName('Dossier', '  RELIANCE  '), 'Taureye_Dossier_RELIANCE');
  assert.strictEqual(docFileName('Dossier', '!!RELIANCE!!'), 'Taureye_Dossier_RELIANCE');
});

ok('a missing subject yields a valid two-part name, not a trailing separator', () => {
  assert.strictEqual(docFileName('Backtest'), 'Taureye_Backtest');
  assert.strictEqual(docFileName('Backtest', ''), 'Taureye_Backtest');
  assert.strictEqual(docFileName('Backtest', null), 'Taureye_Backtest');
  assert.strictEqual(docFileName('Backtest', '   '), 'Taureye_Backtest');
});

ok('the brand casing is exactly Taureye', () => {
  // Requested spelling: not TaurEye, not TAUREYE.
  assert.ok(docFileName('Dossier', 'X').startsWith('Taureye_'));
});

ok('the printed document carries the filename as its title', () => {
  // Without this the browser's Save-as-PDF invents its own name and the
  // convention only ever applied on Android.
  const html = professionalShell('<html><head></head><body><h1>x</h1></body></html>', {
    docType: 'Institutional dossier',
    fileName: 'Taureye_Dossier_RELIANCE',
  });
  assert.ok(html.includes('<title>Taureye_Dossier_RELIANCE</title>'), 'title tag missing');
});

ok('a title is only injected when a filename was given', () => {
  const html = professionalShell('<html><head></head><body>x</body></html>', {});
  assert.ok(!html.includes('<title>'), 'unexpected empty title');
});

ok('a filename with markup characters cannot break the title tag', () => {
  const html = professionalShell('<html><head></head><body>x</body></html>', {
    fileName: docFileName('Dossier', '<script>x</script>'),
  });
  assert.ok(!html.includes('<script>x</script>'), 'markup leaked into the document');
});

console.log(`\nALL PDF NAMING TESTS PASSED (${passed})`);
