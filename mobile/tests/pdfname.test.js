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


// ── The bug the convention kept losing to ────────────────────────────────────
// The name was right everywhere except on disk. Save-as-PDF reads the TOP-LEVEL
// document's <title>, so printing our preview iframe named every download after
// the app shell: "TaurEye — live NSE/BSE terminal & screener" landed as
// TaurEye___live_NSE_BSE_terminal__screener.pdf regardless of the scrip.
const { borrowDocumentTitle } = require('./build/pdf.js');

const APP_TITLE = 'TaurEye — live NSE/BSE terminal & screener';

function withFakeDocument(fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
  const previous = globalThis.document;
  globalThis.document = { title: APP_TITLE };
  try {
    return fn(globalThis.document);
  } finally {
    if (had) globalThis.document = previous;
    else delete globalThis.document;
  }
}

ok('the tab takes the report name while the preview is open', () => {
  withFakeDocument((d) => {
    borrowDocumentTitle(docFileName('Dossier', 'RELIANCE'));
    assert.strictEqual(d.title, 'Taureye_Dossier_RELIANCE');
  });
});

ok('closing the preview hands the title back', () => {
  withFakeDocument((d) => {
    const restore = borrowDocumentTitle('Taureye_Dossier_TCS');
    restore();
    assert.strictEqual(d.title, APP_TITLE,
      'the app tab would keep a dossier name after the preview closed');
  });
});

ok('restoring twice does not resurrect a stale name', () => {
  withFakeDocument((d) => {
    const restore = borrowDocumentTitle('Taureye_Dossier_INFY');
    restore();
    d.title = 'something else entirely';
    restore();
    assert.strictEqual(d.title, 'something else entirely');
  });
});

ok('an ampersand scrip survives the whole round trip to the filename', () => {
  withFakeDocument((d) => {
    borrowDocumentTitle(docFileName('Dossier', 'M&M'));
    assert.strictEqual(d.title, 'Taureye_Dossier_M_M');
  });
});

ok('no filename means the tab is left alone', () => {
  withFakeDocument((d) => {
    borrowDocumentTitle('')();
    borrowDocumentTitle(null)();
    assert.strictEqual(d.title, APP_TITLE);
  });
});

ok('it is inert off the browser, where there is no document', () => {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
  const previous = globalThis.document;
  delete globalThis.document;
  try {
    borrowDocumentTitle('Taureye_Dossier_RELIANCE')();   // must not throw
  } finally {
    if (had) globalThis.document = previous;
  }
});

ok('the report itself still carries the name, for the native print path', () => {
  // Android routes through printReportNative, which uses the document's own
  // <title>; that path was already correct and must stay so.
  const shell = professionalShell('<p>x</p>', { fileName: 'Taureye_Dossier_RELIANCE' });
  assert.ok(shell.includes('<title>Taureye_Dossier_RELIANCE</title>'), 'report lost its title');
});

console.log(`\nALL PDF NAMING TESTS PASSED (${passed})`);
