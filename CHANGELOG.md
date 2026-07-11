# Changelog

All notable changes are recorded here. Versioning is [SemVer](https://semver.org):
`MAJOR.MINOR.PATCH`.

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

[2.0.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v2.0.0
[1.0.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v1.0.0
