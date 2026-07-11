# Changelog

All notable changes are recorded here. Versioning is [SemVer](https://semver.org):
`MAJOR.MINOR.PATCH`.

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

[1.0.0]: https://github.com/alexOutcastX/QUANTHUNT_Prototype/releases/tag/v1.0.0
