// Back navigation. Bundled from src/navIntent.ts by the CI esbuild step.
//
// The app has no router: navigate() swaps a module variable and the URL never
// changes. So until this existed, the browser's Back button had exactly one
// entry to go back to — the page you were on BEFORE the app — and pressing it
// left the site. Opening a dossier from a screen was one-way.
const assert = require('assert');
const nav = require('./build/nav.js');

let failures = 0;
function t(name, fn) {
  try {
    fn();
  } catch (e) {
    failures++;
    console.log(`FAIL  ${name} — ${e.message}`);
  }
}

// A stand-in for window.history: records pushes, and back() fires popstate
// exactly as a browser does.
function fakeHistory() {
  const listeners = [];
  const entries = [];
  globalThis.addEventListener = (type, fn) => {
    if (type === 'popstate') listeners.push(fn);
  };
  globalThis.history = {
    pushState: (s) => entries.push(s),
    back: () => {
      entries.pop();
      listeners.forEach((f) => f());
    },
  };
  return { entries };
}

function reset() {
  nav._resetNav();
  delete globalThis.history;
  delete globalThis.addEventListener;
}

// ── the stack ────────────────────────────────────────────────────────────────
t('a fresh app has nowhere to go back to', () => {
  reset();
  nav.initHistory('today');
  assert.strictEqual(nav.canGoBack(), false);
  assert.strictEqual(nav.goBack(), false, 'goBack claimed to move from the root');
});

t('navigating gives you somewhere to come back to', () => {
  reset();
  nav.initHistory('today');
  nav.navigate('screens', { sub: 'screener' });
  assert.strictEqual(nav.canGoBack(), true);
});

t('back restores the previous intent', () => {
  reset();
  nav.initHistory('today');
  nav.navigate('screens', { sub: 'screener' });
  nav.navigate('desk', { sub: 'inst', symbol: 'YESBANK' });
  assert.strictEqual(nav.peekNav().page, 'desk');
  nav.goBack();
  const p = nav.peekNav();
  assert.strictEqual(p.page, 'screens', 'back did not return to the screener');
  assert.strictEqual(p.sub, 'screener');
});

t('back walks all the way to the root and then stops', () => {
  reset();
  nav.initHistory('today');
  nav.navigate('screens', { sub: 'screener' });
  nav.navigate('desk', { sub: 'inst', symbol: 'YESBANK' });
  assert.strictEqual(nav.goBack(), true);
  assert.strictEqual(nav.goBack(), true);
  assert.strictEqual(nav.peekNav().page, 'today');
  // At the root the platform's own Back must take over — on Android that means
  // leaving the app, which is correct. Swallowing it would trap the user.
  assert.strictEqual(nav.goBack(), false);
});

t('re-selecting the tab you are on is not a history entry', () => {
  reset();
  nav.initHistory('today');
  nav.navigate('screens', { sub: 'screener' });
  nav.navigate('screens', { sub: 'screener' });
  nav.navigate('screens', { sub: 'screener' });
  nav.goBack();
  assert.strictEqual(nav.peekNav().page, 'today', 'tapping the same tab stacked entries');
});

t('a different symbol on the same page IS a separate entry', () => {
  reset();
  nav.initHistory('today');
  nav.openStock('RELIANCE');
  nav.openStock('TCS');
  nav.goBack();
  assert.strictEqual(nav.peekNav().symbol, 'RELIANCE');
});

t('replaying a back does not push a new entry', () => {
  reset();
  nav.initHistory('today');
  nav.navigate('a');
  nav.navigate('b');
  nav.goBack();          // -> a
  nav.goBack();          // -> today
  assert.strictEqual(nav.canGoBack(), false, 'going back grew the stack');
});

// ── browser integration ──────────────────────────────────────────────────────
t('each navigation pushes one real history entry', () => {
  reset();
  const h = fakeHistory();
  nav.initHistory('today');
  nav.navigate('screens', { sub: 'screener' });
  nav.navigate('desk', { sub: 'inst' });
  assert.strictEqual(h.entries.length, 2);
});

t('the browser back button restores the previous page', () => {
  reset();
  fakeHistory();
  nav.initHistory('today');
  nav.navigate('screens', { sub: 'screener' });
  nav.navigate('desk', { sub: 'inst', symbol: 'YESBANK' });
  globalThis.history.back();           // the browser, not our button
  assert.strictEqual(nav.peekNav().page, 'screens',
    'the browser back button did not bring the app with it');
});

t('goBack defers to the browser so the URL bar stays in step', () => {
  reset();
  const h = fakeHistory();
  nav.initHistory('today');
  nav.navigate('screens');
  nav.goBack();
  assert.strictEqual(h.entries.length, 0, 'goBack bypassed history and left the URL stale');
  assert.strictEqual(nav.peekNav().page, 'today');
});

t('listeners are notified on back, so the shell re-renders', () => {
  reset();
  fakeHistory();
  let hits = 0;
  nav.subscribeNav(() => { hits++; });
  nav.initHistory('today');
  nav.navigate('screens');
  const before = hits;
  nav.goBack();
  assert.ok(hits > before, 'nothing was told the page changed');
});

t('initHistory is idempotent', () => {
  reset();
  nav.initHistory('today');
  nav.navigate('screens');
  nav.initHistory('desk');            // a second shell mounting must not reset
  assert.strictEqual(nav.canGoBack(), true);
});

t('it works with no history object at all (native)', () => {
  reset();                             // no globalThis.history
  nav.initHistory('today');
  nav.navigate('screens', { sub: 'screener' });
  assert.strictEqual(nav.canGoBack(), true);
  assert.strictEqual(nav.goBack(), true);
  assert.strictEqual(nav.peekNav().page, 'today');
});

if (failures) {
  console.log(`\n${failures} NAV TEST(S) FAILED`);
  process.exit(1);
}
console.log('OK nav history');
