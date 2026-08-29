// Headless smoke suite — the quality floor that blocks regressions like the
// blank-icon and stretched-toolbar builds that previously reached production.
// Runs against fake_server.py (serves mobile/dist + deterministic API stubs),
// so it needs no network and no live backend.
//
// Checks: app boots · five tabs render · SVG icons have path children ·
// screener renders without a wall of leading blank rows · Symbol page renders
// RELIANCE · command palette opens.
//
// Usage: node e2e/smoke.js  (starts fake_server itself on PORT or 5056)
/* eslint-disable no-console */
const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.PORT || 5056;
const ROOT = path.join(__dirname, '..');
const pw = require(path.join(ROOT, 'mobile', 'node_modules', 'playwright-core'));

const EXEC =
  process.env.CHROMIUM_PATH ||
  (require('fs').existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

(async () => {
  const server = spawn('python3', [path.join(ROOT, 'fake_server.py'), String(PORT)], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  // Wait until the server actually answers — a fixed sleep is a race on cold
  // CI runners (this exact race failed the first CI run of this suite).
  const http = require('http');
  const up = await new Promise((resolve) => {
    const deadline = Date.now() + 30000;
    const poll = () => {
      const req = http.get({ host: '127.0.0.1', port: PORT, path: '/ping', timeout: 1000 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => (Date.now() > deadline ? resolve(false) : setTimeout(poll, 400)));
      req.on('timeout', () => { req.destroy(); Date.now() > deadline ? resolve(false) : setTimeout(poll, 400); });
    };
    poll();
  });
  if (!up) {
    console.error('fake_server never came up on port', PORT);
    server.kill();
    process.exit(1);
  }

  const browser = await pw.chromium.launch({
    executablePath: EXEC,
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 860 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    // Screen chunks requested at any point, for the idle-prefetch check below.
    const chunks = new Set();
    page.on('request', (r) => {
      const m = r.url().match(/\/([A-Za-z]+)-[a-f0-9]{16,}\.js$/);
      if (m) chunks.add(m[1]);
    });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(3500);

    // 1 · boots
    const boots = await page.evaluate(() => !!document.getElementById('root')?.children.length);
    check('app boots (#root populated)', boots);

    // 1b · membership gate fronts the app: wrong password is rejected, the
    // placeholder credential signs in and unlocks the shell.
    const gated = (await page.locator('text=Members only').count()) > 0;
    check('login gate fronts the app', gated);
    // Text-locator clicks are flaky on RN-web touchables — dispatch the click
    // on the exact element instead (same workaround as the other checks).
    const clickSignIn = () =>
      page.evaluate(() => {
        const el = [...document.querySelectorAll('div,span')]
          .filter((e) => (e.textContent || '').trim() === 'SIGN IN')
          .pop();
        if (el) el.click();
      });
    if (gated) {
      await page.fill('[data-testid="login-user"]', 'Taureye');
      await page.fill('[data-testid="login-pw"]', 'wrong-password');
      await clickSignIn();
      await page.waitForTimeout(900);
      check(
        'wrong password rejected',
        (await page.locator('text=Wrong username or password').count()) > 0,
      );
      await page.fill('[data-testid="login-pw"]', 'TaureyePW');
      await clickSignIn();
      await page.waitForTimeout(3000);
      check(
        'placeholder credentials unlock the app',
        (await page.locator('text=Members only').count()) === 0,
      );
    }

    // 2 · five tabs
    for (const tab of ['Today', 'Screens', 'Symbol', 'Desk', 'Terminal']) {
      const n = await page.locator(`text=${tab}`).count();
      check(`tab renders: ${tab}`, n > 0);
    }

    // 3 · icons draw (the RNW createElement regression shipped empty <svg>)
    const svg = await page.evaluate(() => ({
      total: document.querySelectorAll('svg').length,
      withPath: [...document.querySelectorAll('svg')].filter((s) => s.querySelector('path')).length,
    }));
    check('SVG icons have path children', svg.withPath >= 5, JSON.stringify(svg));

    // 4 · screener renders without leading blank rows
    await page.locator('text=Screens').last().click();
    await page.waitForTimeout(2500);
    const bodyText = await page.evaluate(() => document.body.innerText);
    check('Screens hub renders', /Screener|Momentum|Multibagger/.test(bodyText));

    // 4a · the screener table actually carries DATA.
    //
    // The regression this guards against shipped: every price column rendered
    // '—' because the constituent feed carried no quotes and the technical
    // sweep was asked for the whole universe at once, so it never landed. The
    // fixture now answers /index the way production does — a quoteless CSV list
    // that the server backfills from the bhavcopy — so a blank table here means
    // the client dropped the prices it was handed.
    const table = await page.evaluate(() => {
      const t = document.body.innerText;
      const dash = (t.match(/^—$/gm) || []).length;
      return { text: t, dash };
    });
    check(
      'screener shows prices, not em-dashes',
      /1,000\.00|1,137\.50|1,275\.00/.test(table.text),
      table.text.slice(0, 300),
    );
    check(
      'screener names the session its quotes came from',
      /28 Jul close/.test(table.text),
      (table.text.match(/\d+ symbols[^\n]*/) || [''])[0],
    );
    // Technicals for the visible page arrive in one wave; the status line has
    // to show real progress rather than sitting on 0.
    await page.waitForTimeout(2500);
    const techLine = await page.evaluate(
      () => (document.body.innerText.match(/\d+ symbols[^\n]*/) || [''])[0],
    );
    const got = Number((techLine.match(/technicals (\d+)/) || [, '0'])[1]) ||
      (/\/(\d+) technicals/.test(techLine) ? Number(techLine.match(/(\d+)\/\d+ technicals/)[1]) : 0);
    check('screener fills technicals for the visible page', got > 0, techLine);

    // 4b · Penny tab — graded by the real screen in the fixture server, so a
    // grading regression shows up as a missing warning rather than a cheap
    // stock quietly reading as safe.
    const tapEl = async (t) =>
      page.evaluate((txt) => {
        const el = [...document.querySelectorAll('div,span,a,button')].filter(
          (n) => (n.textContent || '').trim() === txt && n.offsetParent !== null,
        );
        const last = el.pop();
        if (last) last.click();
        return !!last;
      }, t);
    await tapEl('Penny');
    await page.waitForTimeout(2500);
    const penny = await page.evaluate(() => document.body.innerText);
    check('Penny tab renders', /Read this before you use this screen/i.test(penny), penny.slice(0, 200));
    check('Penny grades liquidity and risk', /ILLIQUID|TRADEABLE/.test(penny) && /EXTREME RISK|HIGH RISK|MODERATE RISK/.test(penny));
    check('Penny offers a volume floor', /cr\+\/day/.test(penny));

    // 5 · Symbol page renders RELIANCE from the fake scan
    await page.locator('text=Symbol').last().click();
    await page.waitForTimeout(1200);
    const input = page.locator('input').first();
    await input.fill('RELIANCE');
    await input.press('Enter');
    await page.waitForTimeout(2500);
    const symText = await page.evaluate(() => document.body.innerText);
    check('Symbol page shows RELIANCE', symText.includes('RELIANCE'));
    check('Symbol page shows the tab set', /Overview/.test(symText) && /Technicals/.test(symText));

    // 5b · Back actually goes back INSIDE the app.
    //
    // Nothing used to touch history, so the browser's Back button had only the
    // page before the app to return to — pressing it left the site, and opening
    // a dossier from a screen was one-way. We're on Symbol here (from the check
    // above), so going back must land on the screener, not on about:blank.
    const backEl = () =>
      page.evaluate(() => !!document.querySelector('[aria-label="Back"]'));
    check('a Back affordance appears once you have navigated', await backEl());
    await page.goBack();                       // the BROWSER's back button
    await page.waitForTimeout(1800);
    const afterBack = await page.evaluate(() => ({
      url: location.href,
      text: document.body.innerText,
    }));
    check(
      'browser back stays inside the app',
      /127\.0\.0\.1/.test(afterBack.url),
      afterBack.url,
    );
    check(
      'browser back returns to the previous screen',
      /Screener|Multibagger|Momentum|Penny/.test(afterBack.text),
      afterBack.text.slice(0, 160),
    );

    // 5c · the idle prefetch warms chunks nobody navigated to.
    //
    // Splitting the app made first paint cheap but moved the cost to the moment
    // a tab is opened — the worst time, since the user is already waiting. The
    // prefetch removes that, and it is checked here because it failed silently
    // once already: Metro's web import() does not always return a Promise, the
    // .catch() on it threw, and the whole loop died having warmed nothing.
    //
    // These screens are Desk sub-tabs this suite never opens, so a request for
    // them can only have come from the prefetch.
    const unvisited = ['CalculatorScreen', 'HolidaysScreen', 'MethodologyScreen'];
    const warmed = unvisited.filter((c) => chunks.has(c));
    check(
      'idle prefetch warms screens nobody opened',
      warmed.length > 0,
      `none of ${unvisited.join('/')} were fetched (${chunks.size} chunks seen)`,
    );

    // 6 · command palette opens from the header search button
    await page.locator('[aria-label="Search symbols and pages"]').first().click({ timeout: 5000 })
      .catch(() => {});
    await page.waitForTimeout(800);
    const palette = await page
      .locator('input[placeholder*="Search a stock"]')
      .count()
      .catch(() => 0);
    check('command palette opens', palette > 0);

    // 7 · Paper trades → Historic renders the server's track record. The fake
    // server serves this from the REAL ledger, so a settlement regression shows
    // up here as a missing outcome badge rather than as a wrong number nobody
    // notices.
    const tap = async (t) =>
      page.evaluate((txt) => {
        const el = [...document.querySelectorAll('div,span,a,button')].filter(
          (n) => (n.textContent || '').trim() === txt && n.offsetParent !== null,
        );
        const last = el.pop();
        if (last) last.click();
        return !!last;
      }, t);
    // At phone width the Desk sub-tabs live behind the drawer, so route through
    // the command palette that check 6 just opened.
    await page.locator('input[placeholder*="Search a stock"]').first().fill('Paper trades');
    await page.waitForTimeout(700);
    await tap('Paper trades');
    await page.waitForTimeout(2500);
    await tap('Historic');
    await page.waitForTimeout(2200);
    const hist = await page.evaluate(() => document.body.innerText);
    check('Historic tab lists the recorded trades', /TARGET HIT/.test(hist) && /STOPPED/.test(hist), hist.slice(0, 200));
    check('Historic reports the record', /win rate/i.test(hist) && /total p\/l/i.test(hist));
    check(
      'Historic covers all three engines',
      /Recommendations/.test(hist) && /Momentum/.test(hist) && /Multibagger/.test(hist),
    );

    // 8 · Cases — the engine's baskets, served by the real case engine in the
    // fixture server, so a construction or management regression shows up as a
    // missing basket or a missing action rather than a silently wrong weight.
    await tap('Cases');
    await page.waitForTimeout(2500);
    const cases = await page.evaluate(() => document.body.innerText);
    check('Cases tab lists baskets', /CASES/i.test(cases) && /flagship|leaders|core/i.test(cases), cases.slice(0, 200));
    check('Cases show a minimum investment', /min investment/i.test(cases));
    check('Cases cover every kind', /Sector/.test(cases) && /Market cap/.test(cases) && /Strategy/.test(cases));

    await tap('Multibagger');
    await page.waitForTimeout(1200);
    await tap('Tap for constituents, allocation & the engine log');
    await page.waitForTimeout(2000);
    const one = await page.evaluate(() => document.body.innerText);
    check('a case opens its constituents', /CONSTITUENTS/i.test(one) && /WEIGHT/i.test(one));
    check('the engine action log renders', /What the engine has done/i.test(one) && /BOOKED|EXITED|ADDED|REBALANCED/.test(one));

    // 8b · the sign-out control in the chrome, and the width budget it lives in.
    //
    // Two things are measured here that source-level tests cannot see. First,
    // the header nav is a horizontal ScrollView: an over-subscribed bar does
    // not overflow visibly, it silently scrolls, and the last tab is simply
    // not on screen. Nothing looks broken, which is why it needs measuring.
    // Second, the confirmation hangs off the bottom of the bar over the ticker
    // strip — it has to actually be the element under the cursor, not painted
    // beneath the page.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(900);
    const signOut = page.locator('[data-testid="header-signout"]');
    check('sign-out sits in the app chrome', (await signOut.count()) === 1);

    const bar = await page.evaluate(() => {
      const disc = [...document.querySelectorAll('*')].find(
        (e) => e.textContent === 'DISCLAIMER' && !e.children.length,
      );
      const btn = document.querySelector('[data-testid="header-signout"]');
      if (!disc || !btn) return null;
      let row = disc.parentElement;
      while (row && getComputedStyle(row).flexDirection !== 'row') row = row.parentElement;
      const kids = [...row.children];
      const rb = row.getBoundingClientRect();
      const last = kids[kids.length - 1].getBoundingClientRect();
      const scroller = kids.find((k) => k.scrollWidth > k.clientWidth + 1 && k.clientWidth > 150);
      const d = disc.getBoundingClientRect();
      const b = btn.getBoundingClientRect();
      return {
        overflow: Math.round(Math.max(0, last.right - (rb.right - parseFloat(getComputedStyle(row).paddingRight)))),
        navClip: scroller ? scroller.scrollWidth - scroller.clientWidth : 0,
        wallet: kids.length,
        besideDisclaimer: Math.abs((d.top + d.bottom) / 2 - (b.top + b.bottom) / 2) < 20 && b.left >= d.right - 5,
      };
    });
    check('sign-out is beside the disclaimer', !!bar && bar.besideDisclaimer, JSON.stringify(bar));
    check('the header bar does not overflow at 1440', !!bar && bar.overflow === 0, JSON.stringify(bar));
    check('no nav tab is scrolled out of the header', !!bar && bar.navClip === 0, JSON.stringify(bar));

    await signOut.click();
    await page.waitForTimeout(400);
    check(
      'one press asks rather than signing out',
      (await page.locator('text=Sign out of TaurEye?').count()) === 1 &&
        (await page.locator('text=Members only').count()) === 0,
    );
    check(
      'the confirmation is the element on top, not painted under the page',
      await page.evaluate(() => {
        const el = [...document.querySelectorAll('*')].find(
          (e) => e.textContent === 'Sign out of TaurEye?' && !e.children.length,
        );
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
        return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
      }),
    );
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('div,span')]
        .filter((e) => (e.textContent || '').trim() === 'Stay').pop();
      if (el) el.click();
    });
    await page.waitForTimeout(400);
    check(
      'Stay closes the confirmation and keeps you signed in',
      (await page.locator('text=Sign out of TaurEye?').count()) === 0 &&
        (await page.locator('text=Members only').count()) === 0,
    );

    // 9 · no uncaught page errors during the whole run
    check('no uncaught page errors', errors.length === 0, errors[0]);
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL SMOKE CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('smoke crashed:', e);
  process.exit(1);
});
