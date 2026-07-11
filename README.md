# TaurEye — live NSE/BSE stock screener

A live Indian-equity stock screener. Since **v2.0.0** the frontend is a
**React Native (Expo) app** in `mobile/` that ships two ways from one
codebase: the live website (compiled with `react-native-web`, served by the
Flask backend) and a native mobile app (Expo Go / store builds). The Flask
backend (`server.py`) provides all data APIs. Self-hosted on an Oracle
Always-Free VM with push-to-deploy. Running version is shown in the header
and at `GET /version`. The pre-v2 single-file HTML UI is kept at **`/legacy`**.

## Features

- **Responsive by platform** — native left-sidebar layout on desktop/laptop
  (≥1024 px), native bottom-tab layout on phones and tablets.
- **Screener** — live technical screening via the `/scan` endpoint (RSI, MA
  distances, MACD, Williams %R, Bollinger %B, squeeze, rel. volume, 52-week
  distance, beta, pivots) with a 31-filter drawer, BUY/SELL/NEUTRAL signal
  engine, sortable table, and per-row tracking.
- **Stock Universe** — index-constituent browser (15 NSE indices) with live
  prices, 1Y/3Y/5Y returns, and a heatmap view.
- **Fundamentals data layer** — bulk, cached (`/fundamentals/bulk`, 7-day disk
  cache) so fundamental screening is instant. Sources, in order: **screener.in**
  (P/E, P/B, ROE, ROCE, dividend yield, market cap, debt/equity) → **yfinance**
  gap-fill (current ratio, forward P/E, sector) → optional **EODHD**
  (`EODHD_API_KEY` / `FUND_SOURCE`).
- **Analysis** — institutional upside-probability model (Monte Carlo +
  historical frequency across 1M/3M/6M/1Y), score/verdict, suggested holding
  term; plus strategy **backtesting** (7 strategies, SL/TP/trailing) with a
  price chart + buy/sell signal markers, equity curve, and trade log.
- **Charts** — native lightweight-charts (candles, volume, EMAs) and an
  embedded TradingView Advanced Chart.
- **Lists & tools** — Track List (entry-vs-current with exit hints), Portfolio
  (live P&L), Watchlist, and Calculator (position size / SIP / CAGR) — all
  stored on-device.
- **Monochrome UI** — colour reserved for branding, price up/down, and candles.

## Quick start (any machine)

Requires Python 3.11+ and Node.js (npm is only a task runner).

```bash
git clone https://github.com/alexOutcastX/QUANTHUNT_Prototype.git
cd QUANTHUNT_Prototype
npm run setup    # venv + Python deps       (Windows: npm run setup:win)
npm start        # run the server           (Windows: npm run start:win)
```

Open http://localhost:5000. (NSE/screener data works best from an Indian IP.)

## Scripts

| Command | What it does |
|---|---|
| `npm run setup` / `setup:win` | Create Python venv and install `requirements.txt` |
| `npm start` / `start:win` | Run the server from the venv (dev server) |
| `npm run serve` | Run under gunicorn (production WSGI) |
| `npm run docker:up` | Build + run in Docker |
| `npm run build:exe` | Build a standalone `quanthunt.exe` (Windows) |

## Hosting & deploy model

Self-hosted on an Oracle Always-Free VM (nginx → gunicorn systemd service).
See **[DEPLOY-ORACLE.md](DEPLOY-ORACLE.md)** for one-time VM setup.

```
feature/* ──PR──▶ main (CI, integration; does NOT deploy)
                    └── promote (fast-forward or PR) ──▶ production ──▶ auto-deploy to VM
```

- **`main`** — integration branch; PRs run CI (`.github/workflows/ci.yml`).
- **`production`** — the live website; a push here deploys to the VM.
- **Versioning / releases / rollback** — see **[RELEASING.md](RELEASING.md)**.
  Roll back with `deploy/rollback.sh` or by re-running *Deploy to VM* on an older ref.

## Version history

Canonical per-version notes are in **[CHANGELOG.md](CHANGELOG.md)**. Summary:

### v2.1.0 — screener parity & polish

| Area | Change |
|---|---|
| Fix | Pending fundamentals poll until delivered (no more silent exclusions) |
| Screener | +6 live columns: Volume, Beta, Squeeze, S1–S3, R1–R3 |
| Screener | Filters + index persist across launches; CSV export (web download / native share) |
| Screener | Tap-a-symbol stock detail: chart + technicals + pivots + fundamentals |

### v2.0.0 — React Native rewrite (web + mobile from one codebase)

| Area | Change |
|---|---|
| Frontend | Complete rewrite in **React Native (Expo SDK 57)** in `mobile/`; old UI kept at `/legacy` |
| Web | Site served as an **RN-web** export from the same Flask server (SPA + fallback) |
| Layout | **Responsive shell** — desktop sidebar ≥1024 px, native bottom tabs on phones/tablets |
| Backend | New **`/scan`** endpoint — live per-symbol technicals (replaces the demo dataset) |
| Screener | 31-filter engine + signal engine ported 1:1 and driven by live `/scan` data |
| Analysis | Institutional model + 7-strategy backtester ported 1:1 (unit-tested) |
| New | Portfolio (live P&L) and Calculator (position size / SIP / CAGR) tabs |
| Fix | Blank web render from react/react-dom mismatch (React #527), caught pre-deploy in headless Chromium |
| Ops | Deploy smoke test also asserts the web shell serves at `/` |

### v1.0.0 — first tagged release
Built up over these milestones (newest first):

| Area | Change |
|---|---|
| Ops | Prod/dev branch split — `production` is the live site, `main` integrates |
| Ops | Release engineering — `VERSION`/`/version`, CI, safe deploys + `rollback.sh`, auto Tag & Release |
| Charts | Embedded **TradingView** tab + deep-link to your account |
| Charts | Backtest **price chart with buy/sell signal markers** |
| Analysis | **Analysis tab** — Monte-Carlo + historical upside probability, verdict, term; backtest relocated here |
| Data | screener.in debt/equity + yfinance gap-fill (current ratio, fwd P/E, sector) |
| Data | **screener.in** scraping as the default fundamentals source |
| Data | **Bulk fundamentals cache** (EODHD/yfinance) for instant fundamental screening |
| Screener | Large-fetch confirmation guard for fundamentals |
| Screener | **Advanced filters** — All Filters drawer, pinnable sidebar, fundamentals section |
| UI | Monochrome theme (colour only for branding, prices, candles) |
| UI | Full **TaurEye** rebrand (bull logo, wordmark, near-black theme) |
| Hosting | Mirror TaurEye's VM hosting (nginx + gunicorn) + Docker + push-to-deploy |
| Repo | Cloud-ready setup (lockfile, Linux scripts) |

Full commit-level history: `git log`, or the repo's Releases page.

## Files

- `server.py` — Flask backend (screener API, data fetch, indicators, `/scan`, `/fundamentals*`, `/version`; serves the web UI)
- `scanner.py` — live per-symbol technical scan for the screener (`/scan`)
- `fundamentals.py` — bulk fundamentals cache + provider chain (screener.in / yfinance / EODHD)
- `mobile/` — React Native (Expo) frontend; `mobile/dist/` is the committed web export served at `/`
- `StockScreenPro.html` — legacy single-file UI, served at `/legacy` (and fallback)
- `deploy/` — VM setup, nginx conf, systemd unit, rollback script
- `.github/workflows/` — `deploy.yml` (VM deploy), `ci.yml` (PR checks), `release.yml` (tag + release)
- `DEPLOY-ORACLE.md`, `RELEASING.md`, `CHANGELOG.md` — hosting, release/rollback, version notes
- `quanthunt.spec` — PyInstaller spec for `quanthunt.exe`
