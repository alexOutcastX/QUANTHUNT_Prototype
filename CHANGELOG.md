# Changelog

All notable changes are recorded here. Versioning is [SemVer](https://semver.org):
`MAJOR.MINOR.PATCH`.

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

[2.5.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v2.5.0
[2.4.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v2.4.0
[2.3.1]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v2.3.1
[2.3.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v2.3.0
[2.2.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v2.2.0
[2.1.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v2.1.0
[2.0.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v2.0.0
[1.0.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v1.0.0
