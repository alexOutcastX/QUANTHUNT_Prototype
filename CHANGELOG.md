# Changelog

All notable changes are recorded here. Versioning is [SemVer](https://semver.org):
`MAJOR.MINOR.PATCH`.

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
