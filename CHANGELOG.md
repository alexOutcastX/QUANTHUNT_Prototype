# Changelog

All notable changes are recorded here. Versioning is [SemVer](https://semver.org):
`MAJOR.MINOR.PATCH`.

## [3.7.0] — 2026-07-12
Accuracy, alerts, and a public API — the roadmap's final phase.

### New
- **Backtest accuracy**: an India transaction-cost model (`costs.ts`) —
  brokerage, STT (delivery/intraday), exchange txn, SEBI turnover, GST,
  stamp duty, plus per-side **slippage** — applied per trade. Backtest
  gains a **Realistic costs** toggle and a **Costs (charges)** stat, so
  strategy returns are net of what you'd actually pay.
- **Server-side alerts** (`alerts.py`, Lists → Alerts): price ≥/≤,
  day-% ≥/≤, RSI ≥/≤ rules per symbol, stored server-side, evaluated
  against live quotes ("Check now"), with pause / re-arm / delete.
  Owner-only; fired alerts POST to an `ALERT_WEBHOOK` if configured
  (push/email plug in via the same seam).
- **Public data API** (`apikeys.py`, Tools → API): `/api/v1/quote` and
  `/api/v1/indices`, gated by a hashed **X-API-Key** and rate-limited.
  The owner issues keys (shown once, stored as SHA-256) and can revoke.
- New `OwnerGate` component gates the owner-only surfaces behind the
  passcode.

### Tests
- `costs.ts` (charge model + slippage) added to the JS engine suite;
  `alerts.py` + `apikeys.py` unit-tested (rule eval, CRUD, fire-once,
  key issue/verify/revoke, hashing). CI now runs 61 Python cases + the
  JS engine tests.

## [3.6.0] — 2026-07-12
The Palantir layer — a **grounded entity graph** of institutional
activity, where every link is traceable to a real NSE record.

### New
- **Entity graph** (Tools → Entities): institution ⇄ company **link
  analysis** built *only* from NSE **bulk/block deal** records — nothing
  model-inferred. Two lenses: **Institutions** (ranked by how many stocks
  they touch, each expandable to their positions) and **By stock** (who's
  accumulating vs distributing a name). Every edge carries **citations**
  (the raw dated deal rows: side / qty / price) and a **time range**, with
  **entity resolution** collapsing account-string variants (e.g.
  "ABC Mutual Fund A/C Growth" → ABC).
- New endpoint `GET /entity-graph` (`entity_graph.py`) with `?entity=` and
  `?symbol=` pivots; company nodes enriched with time-stamped shareholding.
- Honest scope: board interlocks / promoter-group / related-party edges
  need structured filings parsing and are **not** faked — tracked as a
  follow-up in ROADMAP.md.

### Tests
- `entity_graph.py` unit-tested (entity resolution, deal aggregation,
  net-flow, breadth, symbol/entity pivots, citations, as-of range) — CI
  now runs 48 Python cases + the JS engine tests.

## [3.5.0] — 2026-07-12
Derivatives desk + portfolio risk — two new **Analysis** surfaces.

### New
- **Derivatives screen** (Analysis → Derivatives): live F&O **option
  chain** for indices (NIFTY / BANKNIFTY / FINNIFTY / MIDCPNIFTY) and
  equities, with the analytics a desk reads — **PCR**, **max-pain**,
  **ATM IV**, per-strike OI / change-in-OI / IV / LTP ladder (ATM
  highlighted), and an expiry switcher. Plus a multi-leg **payoff
  builder**: tap CALL/PUT LTPs to stage legs, flip buy/sell, and see net
  premium, breakeven(s), max profit/loss and an at-expiry payoff chart.
- **Portfolio risk screen** (Analysis → Risk): enter holdings and get
  **1-day VaR** (historical + parametric, 90/95/99%), annualised
  **volatility**, **beta vs NIFTY**, **max drawdown**, **Sharpe**,
  position **weights**, and per-symbol **correlation** to the portfolio.
- New endpoints: `GET /derivatives/option-chain` (`derivatives.py`,
  PCR/max-pain/ATM from NSE's public option-chain feed) and
  `POST /risk/portfolio` (`risk.py`, pure-maths analytics over 1Y daily
  closes + NIFTY benchmark).

### Tests
- `derivatives.py` (chain parsing, PCR, max-pain math, expiry selection,
  endpoint routing) and `risk.py` (returns, VaR, beta, correlation,
  drawdown, portfolio weights, full report) unit-tested — CI now runs 39
  Python cases + the JS engine tests.

## [3.4.0] — 2026-07-12
Institutional data from free public NSE feeds — a new **Corporate** surface.

### New
- **Corporate screen** (Tools → Corporate): per-company **shareholding
  pattern** (promoter / FII / DII / public + promoter pledge),
  **corporate actions** (dividends / splits / bonuses with ex/record
  dates), and **announcements**; plus a market-wide **bulk / block
  deals** feed. Type any NSE symbol.
- New endpoints `/corporate/announcements|actions|shareholding|deals`
  (`corporate.py`): defensive parsers + 6h cache, last-good on failure,
  fetched live from NSE public feeds (best from an Indian IP — the VM).

### Tests
- Corporate parsers unit-tested (announcements, actions, shareholding
  normalisation, bulk/block deals, cache + last-good-on-failure) — CI
  now runs 18 Python cases + the JS engine tests.

## [3.3.0] — 2026-07-12
Data platform: persistent SQLite store, observability, and a real
CI-gated test suite.

### Backend
- **`store.py`** — thread-safe SQLite persistence (stdlib): key/value +
  append-only snapshots. Survives restarts; git-ignored and
  rsync-excluded on deploy. `/indices` now records an hourly level
  snapshot per index, exposed at **`/indices/history?key=…`** — the app
  starts building its own long-run series.
- **Observability**: per-request metrics + structured access log for
  slow/error requests, a global JSON error handler (no stack traces
  leaked), enriched **`/health`** (db, auth, request/error counters) and
  an owner-only **`/metrics`** endpoint.

### CI / tests
- Test suite expanded and wired as a CI gate: Python (auth, holidays,
  store — 13 cases) plus **JS engine tests** (backtest custom-strategy +
  built-ins, screener signal filters) bundled with esbuild and run on
  Node. Regressions in the math now fail CI.

## [3.2.0] — 2026-07-12
Security foundation: owner authentication + broker lockdown + tighter CORS.

### Security
- **Owner passcode** (`APP_PASSWORD`): a stdlib signed-cookie session
  (`auth.py`, no new deps). `/auth/login|logout|status`.
- **Broker endpoints are now private** — `/broker/holdings`, `/broker/ltp`
  and `/broker/logout` require the owner session. Previously anyone who
  could reach a connected instance could read the owner's holdings. With
  no passcode set, broker features are disabled entirely rather than left
  publicly reachable.
- **CORS** tightened from `*` to same-origin (configurable via
  `CORS_ORIGINS`); credentials enabled for the owner cookie.
- Portfolio broker card gains an **UNLOCK** step (passcode) before
  connect/sync.

### CI / tests
- New CI **security** job: `pip-audit` + `npm audit` (non-blocking).
- First real **unit tests** (stdlib-only: auth cookie/rotation, market
  open/closed logic) run as a CI gate; more follow in v3.3.0.
- `.env.example`, `.well-known/security.txt`, and a committed **ROADMAP.md**
  tracking the institutional/Bloomberg-Palantir build-out.

## [3.1.1] — 2026-07-12
Fix: the Terminal loads **any** NSE company, not just the curated 29.

### Fixed
- Typing a company outside the curated set (e.g. HDFCBANK, SBIN) no
  longer sat on TMCV. `/graph?symbol=X` now returns a **minimal graph**
  (the company as the centre node, no edges) when relationship data
  isn't available — instead of a 404 the client refused to navigate on.
  The Terminal centres on the company and **auto-opens its workspace**
  (live chart + fundamentals) with the news panel following it; a
  "LIVE DATA" badge and a note explain that full relationship edges need
  the AI key.
- With an AI key set, a failed generation also falls back to the minimal
  graph (company still loads) instead of erroring.

## [3.1.0] — 2026-07-12
The Terminal absorbs the Universe: indices and market-cap segments are
now first-class Terminal commands.

### Terminal
- Type an **index or segment** in the command line — `NIFTY 50`, `BANK`,
  `MIDCAP 100`, `LARGE CAP` — and a **market-browser tab** opens in the
  workspace window (dockable/floatable like every tab): constituents
  with live CMP, day %, 1Y/3Y/5Y returns, heat-tinted rows, sortable
  columns; segments classify the NIFTY 500 by market-cap rank with an
  MCap column.
- Every row acts: click the **symbol → its relationship graph**, ▤ opens
  the company research tab, ⇄ adds it to compare. Quick ∿ index chips
  sit ahead of the company chips; autocomplete suggests indices too.
- ↗ pops any index tab out to a standalone browser page
  (`/research.html?view=index&name=…`) with the same sortable table,
  symbols linking to research pages.

### Navigation
- **Universe leaves the top-level nav** (now redundant) — the page
  survives under Tools for anyone who wants the old table. Desktop is
  down to 7 groups.

### Plumbing
- HtmlView gains a message channel (iframe postMessage / WebView
  onMessage) so embedded workspace rows can drive app navigation.

## [3.0.0] — 2026-07-12
Complete UI/UX overhaul — same features, redesigned app. Major version
because the navigation and visual language changed.

### Design system (DESIGN.md, theme.ts, ui.tsx)
- Readable type scale (nothing under 10px; body 12–14px): system sans
  for labels/headings, mono reserved for data — prices, symbols,
  numbers. Refined dark palette with surface elevation, consistent
  spacing/radius tokens, shared primitives (Card, StatTile, ChipBtn,
  Btn, ScreenTitle, EmptyState, Loading).

### Navigation
- New **Dashboard** landing page: market open/closed, index tiles,
  NIFTY 50 movers, your watchlist with live quotes, latest headlines —
  each linking onward.
- Desktop pages bar consolidated 13 → **8 groups** (Dashboard ·
  Screener · Universe · Terminal · Analysis · Charts · Lists · Tools)
  with an underline active state; mobile tabs: Home / Screener /
  Terminal / Analysis / More.

### Screens
- Every screen restyled: pill chips with white active fill, 44px table
  rows with surface-band headers, card-grouped forms (Backtest is now
  Strategy/Data/Risk cards), StatTile result rows (backtest stats,
  portfolio summary, analysis verdict), press feedback everywhere,
  helpful empty/loading/error states instead of bare spinners.
- Terminal workspace typography enlarged throughout (panels, news,
  window, menus); standalone research/legal pages and PWA colours
  synced to the new palette.

## [2.13.0] — 2026-07-12
BYOB broker connect (Phase 1): Zerodha Kite, strictly read-only.

### Portfolio
- **Connect your own Zerodha account** (bring-your-own Kite Connect app
  key): a broker card in Portfolio handles the daily Kite login, then
  **SYNC HOLDINGS** imports your demat holdings (qty + average price)
  into the live-P&L portfolio — broker rows win by symbol, manual rows
  are kept.

### Backend (broker.py — read-only by design)
- `/broker/status`, `/broker/callback` (token exchange with SHA-256
  checksum), `/broker/holdings`, `/broker/ltp`, `/broker/logout`. Only
  session/token, portfolio/holdings and quote/ltp are ever called —
  **no order code exists**.
- API secret never leaves `.env`; the daily access token is held in
  memory + a 0600 file (`broker_token.json`, git-ignored,
  deploy-excluded); expired sessions auto-disconnect cleanly.
- All broker endpoints rate-limited; login failures logged without
  token contents.

## [2.12.0] — 2026-07-12
Native mobile build setup (EAS).

### Mobile
- **eas.json** build profiles: `preview` (sideloadable Android APK, points
  at the VM) and `production` (Play Store .aab, auto-incrementing
  versionCode, requires the HTTPS domain).
- **app.json** completed for store builds: bundle ids
  (`com.taureye.app`), splash screen, dark UI style, adaptive-icon
  background matched to the theme, tablet + orientation support.
- **BUILD-MOBILE.md** — the full path from `eas login` to an APK on your
  phone (~15 min), plus Play Store / iOS steps and the Expo Go + PWA
  no-cost alternatives.

## [2.11.0] — 2026-07-12
Feature-gap close-out: autocomplete, custom strategies, Camarilla,
market-cap segments, Indices & Holidays pages, ticker strip.

### New
- **Symbol autocomplete** everywhere a symbol is typed (Chart, Institutional,
  TradingView, Terminal command line): type-ahead over the full NSE/BSE
  universe with symbol + company-name matching.
- **Custom strategy builder** in Backtest: build your own BUY/SELL rules
  (close/RSI/EMA/SMA/MACD-hist/volume × >/<
  /cross-above/cross-below × value or another MA), AND semantics,
  persisted across launches, backtested with the same SL/TP/trailing engine.
- **Camarilla levels** (H3/H4/L3/L4 from the previous session) in /scan,
  stock detail and CSV, plus two true event flags — H4 breakout / L4
  breakdown — as one-tap Signals filters.
- **Market-cap segments** in Universe: LARGE/MID/SMALL CAP chips classify the
  NIFTY 500 by market-cap rank (SEBI-style 100/150/rest) with an MCap column.
- **Indices page**: 12 major indices with live level, day % and 1Y % (new
  `/indices` endpoint, 5-min cache).
- **Market Holidays page**: NSE 2026 calendar with live market OPEN/CLOSED
  status and next holiday (new `/holidays` endpoint; indicative list).
- **Scrolling ticker strip** on the desktop shell: live index levels marquee.

## [2.10.0] — 2026-07-12
Production hardening: PWA install, rate limiting, health checks, legal page,
HTTPS/backup tooling.

### Web / PWA
- The site is now an **installable PWA**: web manifest, 192/512 icons,
  apple-touch-icon, theme colour, and a service worker (cache-first for the
  immutable JS bundle, network-first for data, offline shell fallback).
- Proper SEO/OG meta (title, description, share card).

### Backend
- **Per-IP rate limiting**: /scan (200/5min), /news (30/5min), /graph
  (60/5min), and **AI graph generations capped at 10/hour/IP** so the
  Anthropic key can't be drained; nginx template adds 20 r/s edge burst
  protection. 429s carry a retry hint.
- New **/health** endpoint: uptime, cache sizes, AI availability.
- Security headers (nosniff, frame, referrer policy) on every response.

### Ops & legal
- **deploy/enable-https.sh** — one-command domain + Let's Encrypt setup;
  DEPLOY-ORACLE.md gains HTTPS / AI-key / backups / monitoring sections.
- **deploy/backup.sh** — nightly cron archive of .env + runtime caches (7 kept).
- New **/legal.html** — disclaimer ("not investment advice"), data-accuracy
  notes (incl. AI graphs), and privacy statement; linked from the desktop
  brand bar.

## [2.9.0] — 2026-07-12
Terminal wired to real data: AI-generated relationship graphs for **any**
company (bring your Anthropic API key), with the curated cluster as the
always-available fallback.

### Terminal
- Type **any NSE symbol** and GO: `/graph?symbol=X` generates the
  company's relationship graph with Claude (suppliers, customers,
  financiers, competitors, group companies with notes + confidence),
  validated server-side and **disk-cached for 30 days** — first request
  ~15s, then instant. The whole workspace works on AI graphs: node menu,
  research window, compare, news panel, pop-outs, live quotes.
- Header badge shows the data mode (CURATED + AI / AI GRAPH / DEMO
  DATA); AI graphs carry their own disclaimer; generation shows a
  progress state and failures surface the server's reason without
  losing the current graph.
- Without a key everything still works on the curated demo cluster, and
  the prompt tells you exactly what to configure.

### Backend
- New `ai_graph.py`: Claude Messages API over plain HTTPS (no SDK),
  strict JSON prompt, sanitising validator (edge types, confidence,
  self-edges, unknown endpoints, sparse graphs rejected), concurrent
  requests for the same symbol deduped to one generation.
- **Enable it**: add `ANTHROPIC_API_KEY=sk-ant-…` to
  `/opt/quanthunt/.env` on the VM and restart the service
  (`sudo systemctl restart quanthunt`). Optional: `GRAPH_AI_MODEL`
  (default `claude-sonnet-5`).
- `graph_cache.json` survives deploys (rsync-excluded) and is
  git-ignored.

## [2.8.0] — 2026-07-12
Terminal news panel + toolbar toggles + full-chart pop-out.

### Terminal
- **News panel** fixed to the left of the graph (mirror of the right
  relations panel): latest headlines for the centred company (tagged)
  merged with market-wide news, each linking to the article. Refreshes
  on the ⟳ **update button** and **automatically every hour**; shows
  when it last updated. ↗ opens the feed as a standalone browser tab.
- **Toolbar toggles** next to INPUTS/OUTPUTS/ALL: **◧ NEWS** shows/hides
  the news panel, **▤ CHART** shows/hides the research window (opens it
  on the centre company if no tabs yet). Both persist across reloads.
- **⛶ FULL CHART** button on the research window's chart opens a
  full-screen chart (`/research.html?view=chart`) in a browser tab —
  previously the small in-window chart had no full view.
- Graph now **auto-zooms to fit** once forces settle, so nodes never
  land off-canvas when the news panel or a docked window shrinks the
  graph area.

### Backend
- New **`/news`** endpoint (`news.py`): merges a symbol-specific Google
  News India feed with ET Markets / Moneycontrol / Livemint market RSS —
  deduped, newest first, no API keys. Cached an hour per symbol;
  `force=1` (the update button) refetches with server-side rate
  limiting; keeps last-good items if every feed fails.
- `research.html` gains `?view=news` (feed page with UPDATE button +
  hourly auto-refresh) and `?view=chart` (full-screen 1-year chart).

## [2.7.0] — 2026-07-12
Terminal window docking + open-anything-as-a-browser-tab.

### Terminal
- The research window is now **dockable inside the graph layout**: three
  header buttons switch between ❐ floating (drag/resize anywhere), ⬓
  docked to the bottom, and ◨ docked to the right of the graph. Docked
  modes reflow the graph into the remaining space and add a drag divider
  to resize the split; the chosen mode, split size, and floating
  position/size all persist across reloads.
- **Open as browser tab**: an ↗ button on the window header — and on
  every individual window tab — opens that view as a full browser
  tab/window. Company tabs open a standalone research page
  (`/research.html?symbol=…`: 1-year candle+volume chart, screener.in
  provider-chain fundamentals, company profile); the COMPARE tab opens a
  standalone comparison report (`/research.html?symbols=…`) with the
  same metric table, sub-scores and FINAL SCORE.

### Backend
- New static **`/research.html`** page (served by the existing Flask
  static fallback) powering the pop-outs — same `/history`,
  `/fundamentals` and `/scan` APIs, TaurEye terminal styling, works as a
  shareable deep link.

## [2.6.0] — 2026-07-12
Terminal workspace: node menu, inputs/outputs highlighting, and a
floating multi-tab research window with comparison scoring.

### Terminal
- **INPUTS / OUTPUTS / ALL** buttons on the graph: highlight what flows
  into the centre company (suppliers, financiers) or out of it
  (customers, financed demand), dimming everything else.
- **Node menu**: clicking a bubble now offers ⌾ Open graph · ▤ Open in
  window · ⇄ Add to compare (instead of instantly re-centring).
- **Floating research window** docked in the graph area — draggable,
  resizable, closeable, with a tab strip. Each company tab shows a
  6-month candle chart plus fundamentals from the **screener.in
  provider chain** (P/E, P/B, ROE, ROCE, D/E, dividend yield, market
  cap, 52-week range, sector, company profile, source shown).
- **Compare tab**: add companies from the node menu and a COMPARE (n)
  tab builds a metric table (price, day %, market cap, P/E, P/B, ROE,
  ROCE, D/E, dividend yield, RSI, vs 200-DMA) with transparent
  Quality / Trend / Momentum sub-scores and a **FINAL SCORE** row —
  best company starred. Factual composite, not advice.
- Window tabs, compare list, position and size persist across reloads
  (localStorage).

### Backend
- `/fundamentals` now overlays the screener.in provider chain
  (synchronous `fundamentals.get_one`, disk-cached 7 days) over the
  yfinance payload, and reports the source used.

## [2.5.0] — 2026-07-11
New **Terminal** tab — Bloomberg-style company relationship graph
(supply-chain intelligence), demo dataset now, AI mode ready.

### Terminal
- Interactive force-directed relationship graph: centre any company and
  see its **suppliers, customers/demand exposure, financiers,
  competitors and group companies** as typed, annotated edges (e.g.
  TMCV ← steel from Tata Steel/JSW; trucks financed by Chola; fleets at
  VRL/TCI). Click any node to walk the graph hop by hop; drag, zoom,
  edge-type legend, per-edge confidence tags.
- Command line ("> TMCV · GO") with the available-symbol chip row;
  listed nodes show live price/day-change from /ltp.
- Curated demo dataset (~29 companies, 45 edges around the
  auto/steel/logistics/finance cluster) served by a new `/graph`
  endpoint whose response shape is AI-ready — a Claude-generated graph
  for any company plugs in later without frontend changes.
- Clearly labelled indicative/demo data with a persistent disclaimer.
- Desktop pages bar + mobile More menu entries.

## [2.4.0] — 2026-07-11
Desktop layout rework + fundamentals in the table.

### Layout (desktop/laptop)
- The left sidebar is gone: a **branding bar** sits on top with a
  **pages bar** below it (Screener · Universe · Institutional ·
  Backtest · Chart · TradingView · Track List · Portfolio · Watchlist ·
  Calculator), and content now uses the **full window width**. Phones
  and tablets keep the native bottom-tab layout.

### Screener
- Seven **fundamental columns** fill the freed width: Mkt Cap (cr),
  P/E, P/B, ROE%, ROCE%, D/E, Div Yield % — all sortable, exported in
  CSV (with Sector), and populated for **every** loaded index (bulk
  fundamentals now always stream in, not only when a fundamental
  filter is active; missing values sort to the bottom).

## [2.3.1] — 2026-07-11
Reliability fix: the live site's screener showed "HTTP 502 / no matches"
when NSE Direct refused the VM's requests (datacenter IPs are routinely
blocked).

### Fixed
- `/index` now falls back through a chain: NSE Direct (live quotes) →
  **niftyindices.com constituent CSV** (official symbol lists, rarely
  blocked) → last-good **disk cache**. With the CSV/cache paths the
  screener stays fully live — /scan supplies prices and technicals.
- Deploy rsync no longer deletes `fund_cache.json` / `index_cache.json`
  on the VM (caches now survive deploys).
- Screener note honestly says "N symbols" instead of "N live quotes"
  when the constituent source had no quotes.

## [2.3.0] — 2026-07-11
True cross/event detection — real signals computed on the latest bar, not
proxies.

### Backend
- `/scan` now detects eleven true events per symbol from real history:
  **golden cross** and **death cross** (50-DMA crossing the 200-DMA on the
  latest bar), 20-DMA crossing the 50-DMA (both directions), **MACD
  bullish/bearish cross**, **gap up/down** (open vs previous bar's range),
  **new 52-week high/low** (fresh extreme on the latest bar), and
  **volume spike** (≥2.5× the 20-day average). Cross flags fire only on
  the exact event bar — verified with crafted series.

### Screener
- New **Signals** filter group (11 one-tap toggles) at the top of the
  All Filters drawer.
- Presets upgraded to true events: Golden/Death cross today, MACD
  bullish cross, New 52-week high, Gapped up today, Volume spike
  (20 presets total).
- Plain-English screener maps the idioms to real flags — "golden
  crossover" is no longer a proxy; also understands "death cross",
  "20 dma crossed above 50", "macd bullish cross", "gapped up",
  "new 52 week high", "breakout", "volume spike".
- Stock detail view shows a "Signals today" line when events fired.
- CSV export includes all 11 flags (42 columns).

## [2.2.0] — 2026-07-11
Filter selection made taureye-easy: one-tap preset scans and a
plain-English screener.

### Screener
- **Preset scans**: 15 curated one-tap screens on a "Scans" chip row
  (Trend / Momentum / Breakouts / Volume / Fundamentals — e.g. Above
  200-DMA, RSI below 30, Up 3%+ on 2× volume, Within 5% of 52w high,
  Squeeze fired, P/E below 20). Presets stack, toggle off cleanly, and
  stay editable in the All Filters drawer.
- **Natural-language screener** in the filter drawer: type
  "rsi below 30 and above 200 dma" or "large cap oversold" and the
  deterministic, offline parser (ported from taureye's design) turns it
  into filters — with live feedback on what was understood vs ignored.
  Understands operators/synonyms, between-ranges, ₹/cr/lakh/k units,
  DMA distance, 52-week range, squeeze, cap tiers, day change, N× volume,
  fundamentals (P/E, ROE, D/E…) and sector names with aliases
  ("pharma sector", "it sector").

## [2.1.0] — 2026-07-11
Closes the main React-vs-legacy gaps found in the two-UI analysis.

### Fixed
- **Pending fundamentals now arrive**: the screener polls `/fundamentals/bulk`
  until the server-side warm queue drains (bounded rounds), instead of one
  fire-and-forget call that left warming stocks permanently excluded by
  strict fundamental filters.

### Screener
- Six new live columns the `/scan` endpoint already provided: Volume,
  Beta, Squeeze state (ON/FIRED), stacked Support (S1–S3) and Resistance
  (R1–R3) zones.
- Active filters and the selected index persist across launches
  (AsyncStorage / localStorage).
- **CSV export** of the filtered, sorted table — real file download on web,
  OS share sheet on mobile (31 data columns).
- **Stock detail view**: tap any symbol for a 6-month candle chart, live
  technicals, pivots, and fundamentals with company profile — the RN
  counterpart of the legacy report modal.

## [2.0.0] — 2026-07-11
Complete frontend rewrite in **React Native (Expo SDK 57)**. The same codebase
now ships as the live website (via `react-native-web`) and as a native mobile
app; the Flask backend is reused unchanged. Major version because the entire
UI was replaced.

### Frontend (mobile/)
- New Expo + TypeScript app in `mobile/` — theme, typed API client, and all
  screens: Screener, Stock Universe, Analysis (Institutional + Backtest),
  Charts (native lightweight-charts + TradingView), Track List, Portfolio,
  Watchlist, Calculator.
- **Responsive shell** — native left-sidebar layout on desktop/laptop
  (≥1024 px), native bottom-tab layout on phones/tablets. Verified in headless
  Chromium at 1440/820/390 px.
- Cross-platform `HtmlView` — `react-native-webview` on native, `<iframe
  srcDoc>` on web — so chart/TradingView/backtest screens work in-browser.
- 1:1 ports of the analysis engines: institutional probability model
  (Monte-Carlo + historical), strategy backtester (7 strategies, SL/TP/
  trailing, brokerage), screener signal engine (`calcSignal`) and the full
  31-filter registry. All unit-tested.
- New on-device (AsyncStorage) stores: Track List, Portfolio (weighted-average
  cost basis, live P&L), Watchlist.
- New Calculator tab: risk-based position sizing, SIP future value, CAGR.

### Backend
- New **`/scan`** endpoint (`scanner.py`): live per-symbol technicals computed
  from real history — SMA distances, RSI, MACD, Williams %R, Bollinger %B,
  volume/relvol, 52-week levels, beta vs NIFTY 50, TTM squeeze, classic
  pivots. 5-min cache, threaded, 60 symbols/call. Replaces the old demo
  dataset with genuinely live screening data.
- `/` now serves the exported RN-web bundle (`mobile/dist`, committed); the
  legacy single-file UI remains at **`/legacy`** and as an automatic fallback.

### Fixed
- Blank web render from a react/react-dom version mismatch (React error #527)
  — caught by in-browser verification before deploy.

### Ops
- Deploy smoke test now also asserts the web shell is served at `/`.

## [1.0.0] — 2026-07-11
First tagged release. TaurEye-branded live NSE/BSE screener, self-hosted on an
Oracle Always-Free VM with push-to-deploy.

### Hosting & ops
- Runs on the Oracle VM behind nginx → gunicorn (systemd service).
- GitHub Actions push-to-deploy with a post-deploy `/ping` smoke test.
- Docker + compose provided as an alternative.

### Branding & UI
- Full TaurEye rebrand (bull logo, wordmark, near-black theme, favicons).
- Monochrome UI — colour reserved for branding, price up/down, and chart candles.

### Screener
- "All Filters" drawer (Trend / Momentum / Volatility / Volume / Structure /
  Fundamentals), pinnable to a customizable sidebar; state saved to localStorage.
- Fundamentals data layer: bulk cache (`/fundamentals/bulk`, 7-day disk cache)
  sourced from **screener.in** (incl. debt/equity) with a yfinance gap-fill, and
  optional EODHD via `EODHD_API_KEY` / `FUND_SOURCE`.

### Analysis
- New "Analysis" tab: institutional upside-probability model (Monte Carlo +
  historical frequency, 1M/3M/6M/1Y), score/verdict, and suggested holding term.
- Strategy Backtest (relocated here) with a price chart + buy/sell signal markers.

### Charts
- Embedded TradingView Advanced Chart tab, plus deep-link to the user's
  logged-in TradingView account.

[3.4.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v3.4.0
[3.3.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v3.3.0
[3.2.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v3.2.0
[3.1.1]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v3.1.1
[3.1.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v3.1.0
[3.0.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v3.0.0
[2.13.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v2.13.0
[2.12.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v2.12.0
[2.11.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v2.11.0
[2.10.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v2.10.0
[2.9.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v2.9.0
[2.8.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v2.8.0
[2.7.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v2.7.0
[2.6.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v2.6.0
[2.5.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v2.5.0
[2.4.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v2.4.0
[2.3.1]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v2.3.1
[2.3.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v2.3.0
[2.2.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v2.2.0
[2.1.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v2.1.0
[2.0.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v2.0.0
[1.0.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v1.0.0
