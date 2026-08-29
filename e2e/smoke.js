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

    // 2 · the tab strip is the four places you BROWSE to.
    //
    // Home and Symbol are destinations without tabs: the wordmark is the way
    // home, and a company page is opened by a row or by search, never by
    // picking "Symbol" and seeing whatever stock you last looked at. Both
    // screens still exist — 2b proves the tabless ones still resolve.
    const tabs = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="nav-tab"]')]
        .map((e) => e.getAttribute('aria-label')));
    check(
      'the tab strip is the four browse destinations',
      JSON.stringify(tabs) === JSON.stringify(['Screens', 'Desk', 'Backtest', 'Terminal']),
      JSON.stringify(tabs),
    );
    check('signing in lands on the home page', /MARKET BREADTH/i.test(
      await page.evaluate(() => document.body.innerText)));

    // 2b · the wordmark is the way home, from wherever you are.
    await page.evaluate(() => document.querySelector('[aria-label="Terminal"]').click());
    await page.waitForTimeout(2200);
    check('a tab still navigates away from home', !/MARKET BREADTH/i.test(
      await page.evaluate(() => document.body.innerText)));
    await page.evaluate(() => {
      const el = document.querySelector('[aria-label="TaurEye — go to the home page"]');
      if (el) el.click();
    });
    await page.waitForTimeout(2200);
    check('the wordmark goes home', /MARKET BREADTH/i.test(
      await page.evaluate(() => document.body.innerText)));

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
    // One toolbar row now, not two pill bars: which screener, over what
    // universe, looking for what.
    check(
      'the screening console has one toolbar row',
      /SCREEN[\s\S]{0,60}UNIVERSE[\s\S]{0,60}PRESET SCANS/i.test(bodyText),
      bodyText.slice(0, 200),
    );
    check(
      'it opens on the golden crossover',
      /Golden cross/i.test(bodyText),
      bodyText.slice(0, 300),
    );

    // Switching screener is the SCREEN dropdown. Defined here because 4b uses
    // it too — reaching Penny is no longer a pill on a bar.
    const pickScreen = async (label) => {
      await page.evaluate(() => {
        const el = document.querySelector('[aria-label="Choose a screener"]');
        if (el) el.click();
      });
      await page.waitForTimeout(600);
      return page.evaluate((l) => {
        const el = document.querySelector(`[aria-label="${l}"]`);
        if (el) { el.click(); return true; }
        return false;
      }, label);
    };

    // 4a · the screener table actually carries DATA.
    //
    // The regression this guards against shipped: every price column rendered
    // '—' because the constituent feed carried no quotes and the technical
    // sweep was asked for the whole universe at once, so it never landed. The
    // fixture now answers /index the way production does — a quoteless CSV list
    // that the server backfills from the bhavcopy — so a blank table here means
    // the client dropped the prices it was handed.
    // Clear the default screen first. The console now opens on the golden
    // crossover, and the fixture has no crosses — so the table is legitimately
    // empty and there would be no prices to check.
    //
    // Toggled off through the preset menu rather than "Clear all": that button
    // is desktop-only (mobile keeps the filter builder in a popup), and this
    // suite runs at 400px.
    const tapText = (t) =>
      page.evaluate((x) => {
        const el = [...document.querySelectorAll('*')]
          .filter((n) => !n.children.length && (n.textContent || '').trim() === x).pop();
        if (el) { (el.closest('[role="button"]') || el.parentElement).click(); return true; }
        return false;
      }, t);
    // An empty table DURING the sweep is not an empty result. With the console
    // opening on a filtered screen, "No matches — loosen or clear a filter"
    // was the first thing on every load, blaming the screen for something that
    // was merely unfinished.
    const scanState = await page.evaluate(() => {
      const t = document.body.innerText;
      const line = (t.match(/\d+ symbols[^\n]*/) || [''])[0];
      // "60/60 technicals" when finished, "technicals 0/60…" while running.
      const m = line.match(/(\d+)\/(\d+) technicals/) || line.match(/technicals (\d+)\/(\d+)/);
      return {
        line,
        noMatches: /No matches/.test(t),
        scanning: /Still scanning/.test(t),
        swept: !!m && m[1] === m[2],
      };
    });
    check(
      '"No matches" is only claimed once the sweep has actually finished',
      !scanState.noMatches || scanState.swept,
      JSON.stringify(scanState),
    );
    check(
      'and the two states are never claimed at once',
      !(scanState.noMatches && scanState.scanning),
      JSON.stringify(scanState),
    );

    check('the preset menu opens from the toolbar', await tapText('PRESET SCANS'));
    await page.waitForTimeout(600);
    // Drawn over everything, not merely high in its own stacking context. It
    // shipped once looking transparent, which was the results table painted on
    // top of an opaque menu.
    check(
      'the preset menu is the element on top where it is drawn',
      await page.evaluate(() => {
        const el = [...document.querySelectorAll('*')]
          .find((e) => !e.children.length && (e.textContent || '').trim() === 'Golden cross today');
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
      }),
    );
    check('a preset can be toggled back off', await tapText('Golden cross today'));
    await page.waitForTimeout(500);
    await tapText('✕ Close');
    await page.waitForTimeout(2500);
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

    // 8j · TradingView, where the chart actually opens.
    //
    // The Charts page was the only route to a chart page, so removing that menu
    // entry orphaned it; the chart people open is the symbol sheet behind every
    // row's chart glyph. Its TradingView control used to navigate OUT to
    // tradingview.com — off the app, with no way back to the row underneath.
    // It swaps the chart in place now. Checked here, where the table has rows.
    const openedSheet = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[role="button"]')]
        .find((e) => (e.getAttribute('aria-label') || '').startsWith('Chart for '));
      if (!el) return false;
      el.click();
      return true;
    });
    await page.waitForTimeout(2500);
    const sheet = await page.evaluate(() => document.body.innerText);
    check(
      'a row opens the symbol sheet with its chart',
      openedSheet && /TradingView/.test(sheet) && /Technicals/i.test(sheet),
      sheet.slice(0, 200),
    );
    const urlBeforeTv = page.url();
    await page.evaluate(() => {
      const el = document.querySelector('[aria-label="Show this symbol on TradingView"]');
      if (el) el.click();
    });
    await page.waitForTimeout(1500);
    const stayed = page.url() === urlBeforeTv;
    const swapped = await page.evaluate(() =>
      !!document.querySelector('[aria-label="Back to the TaurEye chart"]'));
    check(
      'TradingView opens inside the sheet, not off the site',
      stayed && swapped,
      JSON.stringify({ stayed, swapped, url: page.url() }),
    );
    await page.evaluate(() => {
      const el = document.querySelector('[aria-label="Back to the TaurEye chart"]');
      if (el) el.click();
    });
    await page.waitForTimeout(1200);
    check(
      'and you can switch back',
      await page.evaluate(() =>
        !!document.querySelector('[aria-label="Show this symbol on TradingView"]')),
    );
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('div,span')]
        .find((e) => (e.textContent || '').trim() === '✕' && e.offsetParent !== null);
      if (el) (el.closest('[role="button"]') || el.parentElement).click();
    });
    await page.waitForTimeout(900);


    // 4b · Penny tab — graded by the real screen in the fixture server, so a
    // grading regression shows up as a missing warning rather than a cheap
    // stock quietly reading as safe.
    check('the screen dropdown reaches Penny', await pickScreen('Penny'));
    await page.waitForTimeout(2500);
    const penny = await page.evaluate(() => document.body.innerText);
    check('Penny tab renders', /Read this before you use this screen/i.test(penny), penny.slice(0, 200));
    check('Penny grades liquidity and risk', /ILLIQUID|TRADEABLE/.test(penny) && /EXTREME RISK|HIGH RISK|MODERATE RISK/.test(penny));
    check('Penny offers a volume floor', /cr\+\/day/.test(penny));

    // 5 · the company page, reached the way it is reached now.
    //
    // This used to click the Symbol tab. That tab is gone, and the search bar
    // is the reason it could go — so the suite opens a company the way a user
    // does, which also proves the screen did not go with the tab.
    await page.locator('[aria-label="Search symbols and pages"]').first().click();
    await page.waitForTimeout(900);
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
      /SCREEN|UNIVERSE|PRESET SCANS/i.test(afterBack.text),
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

    // 8a · numbers from a session that has already ended say WHICH session.
    //
    // On a Saturday every quote is Friday's close. The page used to call that
    // change "today" — a statement about a session that had not happened —
    // and, worse, computed it as Friday against Friday, so the whole dashboard
    // read +0.00%. The fixture stamps its quotes with a fixed past date, so
    // the "not today" wording has to appear here.
    await page.evaluate(() => {
      const el = document.querySelector('[aria-label="TaurEye — go to the home page"]');
      if (el) el.click();
    });
    await page.waitForTimeout(2500);
    const dash = await page.evaluate(() => document.body.innerText);
    check(
      'movers name the session they are from',
      /Top gainers\s*·\s*Thu 23 Jul/i.test(dash),
      dash.slice(0, 300),
    );
    check(
      'the breadth card names the session too',
      /Thu 23 Jul\s*·\s*delayed/i.test(dash),
      (dash.match(/.{0,60}delayed.{0,20}/g) || []).join(' | '),
    );

    // 8a2 · the home page's new shape, at a width where it has two columns.
    //
    // The rail is the claim worth measuring: news, feeds, portfolio and
    // watchlist moved out of the main column so the market data leads. A
    // regression here looks like "everything still renders", which is exactly
    // why the check is geometric rather than textual.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForTimeout(1200);
    const rail = await page.evaluate(() => {
      // Section titles are uppercased by CSS; the DOM keeps the written casing.
      const leaf = (t) => [...document.querySelectorAll('*')]
        .find((e) => !e.children.length && (e.textContent || '').trim() === t);
      const card = (t) => {
        let el = leaf(t);
        while (el && el.getBoundingClientRect().width < 120) el = el.parentElement;
        return el;
      };
      const news = card('News');
      const breadth = card('Market breadth \u00b7 NIFTY 500');
      if (!news || !breadth) return null;
      const n = news.getBoundingClientRect();
      const m = breadth.getBoundingClientRect();
      return { newsLeft: Math.round(n.left), newsW: Math.round(n.width), mainRight: Math.round(m.right) };
    });
    check(
      'news sits in a narrow rail beside the market data',
      !!rail && rail.newsLeft > rail.mainRight - 5 && rail.newsW < 420,
      JSON.stringify(rail),
    );

    const aria = (label) =>
      page.evaluate((l) => {
        const el = document.querySelector(`[aria-label="${l}"]`);
        if (el) { el.click(); return true; }
        return false;
      }, label);

    // Saving a headline, and finding it again.
    const saved = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[aria-label^="Save "]')][0];
      if (el) { el.click(); return true; }
      return false;
    });
    check('a headline can be saved', saved);
    await page.waitForTimeout(700);
    await aria('Saved');
    await page.waitForTimeout(700);
    check(
      'the saved tab holds it',
      !/Nothing saved yet/.test(await page.evaluate(() => document.body.innerText)),
    );
    await aria('Archive');
    await page.waitForTimeout(1500);
    check(
      'the archive tab reads recorded history',
      /Archived headline|Recorded back to/i.test(
        await page.evaluate(() => document.body.innerText)),
    );
    await aria('Latest');
    await page.waitForTimeout(500);

    // The movers slider: the whole market first, then indices.
    const movers = await page.evaluate(() => document.body.innerText);
    check(
      'the movers panel leads with the whole market',
      /MOVERS[\s\S]{0,120}ACROSS THE MARKET/i.test(movers),
      movers.slice(movers.search(/MOVERS/i), movers.search(/MOVERS/i) + 200),
    );
    check(
      'it states the floor it ranked over and what it excluded',
      /names over ₹1cr turnover/i.test(movers) && /corporate actions? excluded/i.test(movers),
    );
    check(
      'market movers are whole-market names, not index constituents',
      /MKTUP1/.test(movers) && /MKTDN1/.test(movers),
    );

    // …and the customisation that is the point of it.
    check('add opens the index picker', await aria('Add an index to this slider'));
    await page.waitForTimeout(700);
    check('an index can be added to the slider', await aria('Add NIFTY BANK'));
    await page.waitForTimeout(2000);
    check(
      'the added index gets its own panel',
      await aria('Remove NIFTY BANK from the slider'),
    );
    await page.waitForTimeout(500);

    // 8b · the sign-out control in the chrome, and the width budget it lives in.
    //
    // Two things are measured here that source-level tests cannot see. First,
    // the header nav is a horizontal ScrollView: an over-subscribed bar does
    // not overflow visibly, it silently scrolls, and the last tab is simply
    // not on screen. Nothing looks broken, which is why it needs measuring.
    // Second, the confirmation hangs off the bottom of the bar over the ticker
    // strip — it has to actually be the element under the cursor, not painted
    // beneath the page.
    // 8k · the phone header holds the account controls and a real search box.
    //
    // The account name and sign-out used to live in a strip above the tab bar,
    // at 10px and half off the edge — the two account controls, in the one
    // place nobody looks for account controls. Search was a 16px magnifier
    // competing with three other glyphs. The strip now holds the disclaimer
    // alone, which is what lets "centred" mean centred.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1200);
    const phone = await page.evaluate(() => {
      const g = (sel) => {
        const e = document.querySelector(sel);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { t: Math.round(r.top), l: Math.round(r.left), r: Math.round(r.right),
                 w: Math.round(r.width), text: (e.textContent || '').trim() };
      };
      return {
        acct: g('[aria-label^="Signed in as"]'),
        out: g('[data-testid="header-signout"]'),
        search: g('[aria-label="Search symbols and pages"]'),
        legal: g('[aria-label="Disclaimer and legal terms"]'),
        vw: window.innerWidth,
      };
    });
    check(
      'the phone header carries the account name and the way out',
      !!phone.acct && phone.acct.t < 120 && !!phone.out && phone.out.t < 120,
      JSON.stringify(phone),
    );
    check(
      'the name is a name, not a truncation',
      !!phone.acct && /^Taureye$/.test(phone.acct.text),
      JSON.stringify(phone.acct),
    );
    check(
      'both sit fully on screen',
      !!phone.acct && phone.acct.l >= 0 && !!phone.out && phone.out.r <= phone.vw,
      JSON.stringify(phone),
    );
    check(
      'search is a labelled box, not a lone glyph',
      !!phone.search && phone.search.w > phone.vw * 0.55
        && /Search symbols/.test(phone.search.text),
      JSON.stringify(phone.search),
    );
    check(
      'and the disclaimer strip is actually centred',
      !!phone.legal
        && Math.abs((phone.legal.l + phone.legal.r) / 2 - phone.vw / 2) <= 2,
      JSON.stringify({ legal: phone.legal, vw: phone.vw }),
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(1000);

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

    // 8e · the Desk landing page.
    //
    // Desk opened onto the Watchlist — one of its destinations, an overview of
    // none of them — so the first thing it showed was a bar of tabs asking you
    // to choose before anything had been said. It now opens on a page, and the
    // three screens that stopped being tabs moved to where they are used.
    const openDeskSection = async (label) => {
      await page.evaluate(() => {
        const el = document.querySelector('[aria-label="Desk"]');
        if (el) el.click();
      });
      await page.waitForTimeout(1400);
      await page.evaluate(() => {
        const el = [...document.querySelectorAll('[role="button"]')].find((e) =>
          (e.getAttribute('aria-label') || '').startsWith('Sections menu'));
        if (el) el.click();
      });
      await page.waitForTimeout(800);
      await tap(label);
      // Each of these pages fetches before it has anything to show.
      await page.waitForTimeout(4500);
      return page.evaluate(() => document.body.innerText);
    };

    // The sections are a hamburger and a left drawer at every width — a pill
    // row spends a band of the page on the nine sections you are not on, and
    // has no room for the one-line description each one carries.
    await page.evaluate(() => {
      const el = document.querySelector('[aria-label="Desk"]');
      if (el) el.click();
    });
    await page.waitForTimeout(4500);
    const landed = await page.evaluate(() => document.body.innerText);
    check(
      'pressing Desk lands on the Desk home',
      /Corporate calendar/i.test(landed),
      landed.slice(0, 300),
    );
    check(
      'the section pill row is gone',
      !/Watchlist[\s\S]{0,25}Portfolio[\s\S]{0,25}Paper trades/.test(landed),
      (landed.match(/Watchlist[\s\S]{0,80}/) || [''])[0],
    );
    // The button lives in the page's own title row, not in a band above it —
    // a band pushes every heading down behind a strip that repeats it.
    const btnRow = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('[role="button"]')].find((e) =>
        (e.getAttribute('aria-label') || '').startsWith('Sections menu'));
      const h1 = [...document.querySelectorAll('*')]
        .find((e) => !e.children.length && (e.textContent || '').trim() === 'Desk'
          && e.getBoundingClientRect().top > 60);
      if (!btn || !h1) return { found: false, btn: !!btn, h1: !!h1 };
      const b = btn.getBoundingClientRect();
      const t = h1.getBoundingClientRect();
      return {
        found: true,
        sameRow: Math.abs((b.top + b.bottom) / 2 - (t.top + t.bottom) / 2) < 16,
        leftOfTitle: b.right <= t.left + 2,
        square: Math.abs(b.width - b.height) < 2,
        headingTop: Math.round(t.top),
        btnTop: Math.round(b.top),
      };
    });
    check(
      'the hamburger sits in the page title row, left of the heading',
      btnRow.found && btnRow.sameRow && btnRow.leftOfTitle,
      JSON.stringify(btnRow),
    );
    check(
      'so the heading is not pushed down behind a band of its own',
      btnRow.found && btnRow.headingTop < 200,
      JSON.stringify(btnRow),
    );

    await page.evaluate(() => {
      const el = [...document.querySelectorAll('[role="button"]')].find((e) =>
        (e.getAttribute('aria-label') || '').startsWith('Sections menu'));
      if (el) el.click();
    });
    await page.waitForTimeout(900);
    const drawer = await page.evaluate(() => {
      const t = [...document.querySelectorAll('*')]
        .find((e) => !e.children.length && (e.textContent || '').trim() === 'DESK');
      if (!t) return { found: false };
      // Walk out to the panel itself: pinned to the left edge and running to
      // the foot of the page. Stopping at the first element with left 0 lands
      // on the drawer's own header row, which is neither.
      let n = t;
      while (n) {
        const b = n.getBoundingClientRect();
        if (b.left <= 1 && b.height > 200 && b.width > 200 && b.width < 420) break;
        n = n.parentElement;
      }
      if (!n) return { found: false };
      const r = n.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + 20, r.top + 120);
      // Whatever sits at the very top of the window must NOT be the drawer:
      // the wordmark, the search box and the destination tabs are how you
      // leave the Desk, and a menu for switching sections of it must not sit
      // on top of them.
      const topLeft = document.elementFromPoint(8, 20);
      return {
        found: true,
        left: Math.round(r.left),
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        viewportH: window.innerHeight,
        onTop: !!hit && n.contains(hit),
        clearsChrome: r.top > 24 && !!topLeft && !n.contains(topLeft),
        text: (n.textContent || '').slice(0, 400),
      };
    });
    check(
      'the drawer opens against the left edge of the page, not the window',
      drawer.found && drawer.left === 0 && drawer.clearsChrome,
      JSON.stringify({ ...drawer, text: undefined }),
    );
    check(
      'it runs to the foot of the page and is drawn over it',
      drawer.onTop && Math.abs(drawer.bottom - drawer.viewportH) < 90,
      JSON.stringify({ ...drawer, text: undefined }),
    );
    check(
      'the app chrome stays reachable behind it',
      await page.evaluate(() => {
        const el = document.querySelector('[aria-label="Screens"]');
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
        return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
      }),
    );
    check(
      'it lists every section with what it is for',
      /Watchlist/.test(drawer.text || '') && /Reports/.test(drawer.text || '') &&
        /live quotes/.test(drawer.text || ''),
      (drawer.text || '').slice(0, 200),
    );
    // Picking a section closes it; leaving and coming back lands on Home again.
    await tap('Portfolio');
    await page.waitForTimeout(3000);
    const picked = await page.evaluate(() => document.body.innerText);
    check(
      'picking a section switches the page and closes the drawer',
      /Holdings/.test(picked) && !/Corporate calendar/i.test(picked),
      picked.slice(0, 200),
    );
    await page.evaluate(() => {
      const el = document.querySelector('[aria-label="Screens"]');
      if (el) el.click();
    });
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      const el = document.querySelector('[aria-label="Desk"]');
      if (el) el.click();
    });
    await page.waitForTimeout(4500);
    const back = await page.evaluate(() => document.body.innerText);
    check(
      'coming back to Desk lands on Home, not on the last section',
      /Corporate calendar/i.test(back) && !/Holdings/.test(back),
      back.slice(0, 200),
    );

    // Four Desk screens open on their own chrome and have no title row to sit
    // beside; with no button at all there would be no way off them.
    await openDeskSection('Shareholders');
    check(
      'a screen with no heading of its own keeps a labelled way out',
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[role="button"]')].find((e) =>
          (e.getAttribute('aria-label') || '').startsWith('Sections menu'));
        if (!btn) return false;
        const r = btn.getBoundingClientRect();
        const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
        return !!hit && (btn.contains(hit) || hit.contains(btn))
          && /Shareholders/.test(btn.textContent || '');
      }),
    );

    // The Desk home is laid out like every other Desk screen: no gutters of
    // its own, and its heading at the same height. It used to be capped at
    // 1480 and centred, so on a wide monitor it was the one page in the app
    // that did not start at the left edge.
    const geo = async (heading) => page.evaluate((h) => {
      const btn = [...document.querySelectorAll('[role="button"]')].find((e) =>
        (e.getAttribute('aria-label') || '').startsWith('Sections menu'));
      const t = [...document.querySelectorAll('*')].find((e) => !e.children.length
        && (e.textContent || '').trim() === h && e.getBoundingClientRect().top > 60);
      return {
        btnLeft: btn ? Math.round(btn.getBoundingClientRect().left) : null,
        headTop: t ? Math.round(t.getBoundingClientRect().top) : null,
      };
    }, heading);
    await openDeskSection('Watchlist');
    const wlGeo = await geo('Watchlist');
    const homeGeo = await (async () => { await openDeskSection('Home'); return geo('Desk'); })();
    check(
      'the Desk home starts at the same left edge as its siblings',
      homeGeo.btnLeft !== null && homeGeo.btnLeft === wlGeo.btnLeft,
      JSON.stringify({ home: homeGeo, watchlist: wlGeo }),
    );
    check(
      'and its heading sits at the same height',
      homeGeo.headTop !== null && Math.abs(homeGeo.headTop - wlGeo.headTop) < 4,
      JSON.stringify({ home: homeGeo, watchlist: wlGeo }),
    );

    const desk = await openDeskSection('Home');
    check(
      'the Desk opens on a page, not on a bar of tabs',
      /Corporate calendar/i.test(desk) && /Market days/i.test(desk),
      desk.slice(0, 300),
    );
    check(
      'the corporate calendar lists dated actions',
      /CORP1/.test(desk) && /Interim Dividend/i.test(desk) && /in \d+d/.test(desk),
      (desk.match(/CORPORATE CALENDAR[\s\S]{0,220}/i) || [''])[0],
    );
    // Every kind the calendar covers gets a chip, whether or not this window
    // holds one. Filtering the row down to what is present read as a missing
    // feature: in a quiet month it said "All · Dividend · Split" and there was
    // no way to tell whether bonus issues were absent or simply not covered.
    const chips = await page.evaluate(() =>
      [...document.querySelectorAll('[role="button"]')]
        .map((e) => e.getAttribute('aria-label') || '')
        .filter((a) => /, \d+ action/.test(a)));
    for (const kind of ['Dividend', 'Bonus', 'Split', 'Rights', 'Buyback', 'IPO', 'Other']) {
      check(
        `the calendar offers a ${kind} filter`,
        chips.some((c) => c.startsWith(kind + ',')),
        JSON.stringify(chips),
      );
    }
    check(
      'a kind with nothing in it says zero rather than vanishing',
      chips.some((c) => /^(Rights|Buyback), 0 actions$/.test(c)),
      JSON.stringify(chips),
    );
    check(
      'public issues are in the calendar, with their close date',
      /OPENCO/.test(desk) && /LATERCO/.test(desk) && /closes/.test(desk),
      (desk.match(/OPENCO[\s\S]{0,90}/) || [''])[0],
    );
    check(
      'and a book that has already closed is in neither view',
      !/CLOSEDCO/.test(desk),
      (desk.match(/CLOSEDCO[\s\S]{0,60}/) || [''])[0],
    );
    // An IPO is filed under the day its book OPENS, so a live issue's date is
    // in the past. The row must count down to its close, not print "in -2d".
    check(
      'a book already open counts down to its close',
      /OPENCO/.test(desk) && !/in -\d+d/.test(desk) && /closes in 3d/.test(desk),
      (desk.match(/[^\n]*\n[^\n]*\nOPENCO/) || [''])[0] + ' | neg: '
        + JSON.stringify(desk.match(/in -\d+d/g)),
    );
    // And an empty one explains itself rather than showing a blank list.
    await page.evaluate(() => {
      const el = document.querySelector('[aria-label="Rights, 0 actions"]');
      if (el) el.click();
    });
    await page.waitForTimeout(800);
    const emptyKind = await page.evaluate(() => document.body.innerText);
    check(
      'tapping an empty kind says why it is empty',
      /No rights actions/i.test(emptyKind) && /No rights issues announced/i.test(emptyKind),
      (emptyKind.match(/No rights[\s\S]{0,120}/) || [''])[0],
    );
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('[role="button"]')]
        .find((e) => (e.getAttribute('aria-label') || '').startsWith('All,'));
      if (el) el.click();
    });
    await page.waitForTimeout(700);
    check(
      'market days name the next holidays and say the calendar is indicative',
      /Independence Day/i.test(desk) && /verify against NSE circulars/i.test(desk),
      (desk.match(/MARKET DAYS[\s\S]{0,220}/i) || [''])[0],
    );
    check(
      'announcements sit at the bottom, renamed',
      /Announcements from the Dev/i.test(desk) &&
        desk.search(/Announcements from the Dev/i) > desk.search(/Corporate calendar/i),
    );
    // Methodology is offered folded, and opens in place rather than linking
    // away — sending someone to another page to read the method is how the
    // method goes unread.
    check(
      'methodology is offered folded',
      /Methodology/i.test(desk) && !/House view \(Symbol page\)/i.test(desk),
      (desk.match(/METHODOLOGY[\s\S]{0,120}/i) || [''])[0],
    );
    // The heading is uppercased by CSS; the DOM text is not.
    await tap('Methodology');
    await page.waitForTimeout(1200);
    const folded = await page.evaluate(() => document.body.innerText);
    check(
      'and it expands in place, without leaving the page',
      /House view \(Symbol page\)/i.test(folded) && /Corporate calendar/i.test(folded),
      folded.slice(0, 200),
    );

    // 8f · the two screens that became modes of the page that uses them.
    // (That they are no longer tabs of their own is asserted against the
    // source in tests/test_desk_layout.py — this checks they still render.)
    await openDeskSection('Paper trades');
    await tap('Calibration');
    await page.waitForTimeout(2500);
    const cal = await page.evaluate(() => document.body.innerText);
    check(
      'Calibration is a mode of the Paper trades page',
      /Paper trades/i.test(cal) && /insufficient sample|Your log|closed trades/i.test(cal),
      cal.slice(0, 300),
    );

    const pf = await openDeskSection('Portfolio');
    check('Portfolio offers a Risk tab', /Risk/i.test(pf), pf.slice(0, 300));
    await tap('Risk');
    await page.waitForTimeout(2500);
    const risk = await page.evaluate(() => document.body.innerText);
    check(
      'Risk runs inside Portfolio, under its heading',
      /Portfolio/i.test(risk) && /Holdings/i.test(risk) && /Value at risk|Run risk|Confidence/i.test(risk),
      risk.slice(0, 400),
    );

    // 8g · the disclaimer opens over the app, not instead of it.
    //
    // It used to hand the browser to /legal.html: on the web that replaced the
    // app, and in a standalone install it opened a document with nothing to go
    // back to. You could read the disclaimer and then you were stuck in it.
    const urlBefore = page.url();
    const pageBefore = await page.evaluate(() => document.body.innerText);
    await page.evaluate(() => {
      const el = document.querySelector('[aria-label="Disclaimer and legal terms"]');
      if (el) el.click();
    });
    await page.waitForTimeout(1200);
    const legal = await page.evaluate(() => document.body.innerText);
    check('the disclaimer opens inside the app', /Disclaimer & Privacy/i.test(legal), legal.slice(0, 200));
    check('without leaving the page', page.url() === urlBefore, page.url() + ' vs ' + urlBefore);
    check(
      'and carries the whole notice',
      /SEBI-registered investment adviser/.test(legal) && /PRIVACY/.test(legal)
        && /TRADEMARKS/.test(legal) && /without warranty of any kind/.test(legal),
      legal.slice(0, 200),
    );
    check(
      'it is the thing drawn on top',
      await page.evaluate(() => {
        const t = [...document.querySelectorAll('*')].find((e) => !e.children.length
          && (e.textContent || '').trim() === 'Disclaimer & Privacy');
        if (!t) return false;
        const r = t.getBoundingClientRect();
        const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
        return !!hit && (hit === t || t.contains(hit) || hit.contains(t));
      }),
    );
    await page.evaluate(() => {
      const el = document.querySelector('[aria-label="Close the disclaimer"]');
      if (el) el.click();
    });
    await page.waitForTimeout(900);
    const dismissed = await page.evaluate(() => document.body.innerText);
    check('close dismisses it', !/Disclaimer & Privacy/i.test(dismissed), dismissed.slice(0, 150));
    check(
      'and hands back the page you were on',
      dismissed.slice(0, 400) === pageBefore.slice(0, 400),
      dismissed.slice(0, 120),
    );

    // 8h · what the Desk's "More" menu held, in the places it dissolved into.
    //
    // Seven entries, each a page nobody opened twice. The menu is gone; these
    // check that its contents did not go with it. The bulk-deals card is here
    // for a sharper reason: the deals feed answering without its `bulk` key
    // threw inside render and blanked the entire app, and a blank page is not
    // something a source-level test can see.
    await page.evaluate(() => {
      const el = document.querySelector('[aria-label="TaurEye — go to the home page"]');
      if (el) el.click();
    });
    await page.waitForTimeout(4000);
    const homeText = await page.evaluate(() => document.body.innerText);
    check(
      'index levels are on the app home',
      /INDEX LEVELS/i.test(homeText) && /Domestic/.test(homeText),
      (homeText.match(/INDEX LEVELS[\s\S]{0,120}/i) || [''])[0],
    );
    check(
      "the session's bulk and block deals are on the app home",
      /BULK & BLOCK DEALS/i.test(homeText) && /BULKCO/.test(homeText) && /BLOCKCO/.test(homeText),
      (homeText.match(/BULK & BLOCK DEALS[\s\S]{0,140}/i) || [''])[0],
    );

    const deskAgain = await openDeskSection('Home');
    check(
      'the corporate card covers the market and one company',
      /The market/.test(deskAgain) && /A company/.test(deskAgain),
      (deskAgain.match(/CORPORATE CALENDAR[\s\S]{0,120}/i) || [''])[0],
    );
    await tap('A company');
    await page.waitForTimeout(2500);
    const company = await page.evaluate(() => document.body.innerText);
    check(
      "one company's filings open in that card",
      /Shareholding pattern/i.test(company) && /Announcements/i.test(company)
        && /CORPORATE CALENDAR/i.test(company),
      company.slice(0, 250),
    );

    const sections = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[role="button"]')].find((e) =>
        (e.getAttribute('aria-label') || '').startsWith('Sections menu'));
      if (el) el.click();
      return null;
    });
    void sections;
    await page.waitForTimeout(800);
    check(
      'the Desk no longer offers a More section',
      await page.evaluate(() => ![...document.querySelectorAll('[role="menuitem"]')]
        .some((e) => (e.textContent || '').trim().startsWith('More'))),
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // 8i · the signed-in name in the bar, and where it goes.
    const acct = await page.evaluate(() => {
      const el = document.querySelector('[aria-label^="Signed in as"]');
      return el ? { label: el.getAttribute('aria-label'), text: (el.textContent || '').trim() } : null;
    });
    check(
      'the bar says who is signed in',
      !!acct && /Taureye/i.test(acct.text),
      JSON.stringify(acct),
    );
    await page.evaluate(() => {
      const el = document.querySelector('[aria-label^="Signed in as"]');
      if (el) el.click();
    });
    await page.waitForTimeout(3000);
    check(
      'and tapping it opens the account page',
      /(SIGNED IN AS|Sign in|CLOUD SYNC)/i.test(await page.evaluate(() => document.body.innerText)),
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
