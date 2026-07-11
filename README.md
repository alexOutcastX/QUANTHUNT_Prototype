# TaurEye — live NSE/BSE stock screener

A live Indian-equity stock screener: Flask backend (`server.py`) serving a
single-file HTML UI (`StockScreenPro.html`). Screens the NSE/BSE universe on
technicals and fundamentals, models upside probability, backtests strategies,
and embeds TradingView. Self-hosted on an Oracle Always-Free VM with
push-to-deploy. Running version is shown in the header and at `GET /version`.

## Features

- **Screener** — filter the universe on technicals (RSI, MAs, MACD, Bollinger,
  squeeze, volume, 52-week distance, S/R…) via an "All Filters" drawer with
  pinnable, saved sidebar filters, plus a separate **Fundamentals** section.
- **Fundamentals data layer** — bulk, cached (`/fundamentals/bulk`, 7-day disk
  cache) so fundamental screening is instant. Sources, in order: **screener.in**
  (P/E, P/B, ROE, ROCE, dividend yield, market cap, debt/equity) → **yfinance**
  gap-fill (current ratio, forward P/E, sector) → optional **EODHD**
  (`EODHD_API_KEY` / `FUND_SOURCE`).
- **Analysis tab** — institutional upside-probability model (Monte Carlo +
  historical frequency across 1M/3M/6M/1Y), score/verdict, suggested holding
  term; plus strategy **backtesting** with a price chart + buy/sell signal markers.
- **TradingView tab** — embedded Advanced Chart (drawing tools, indicators) and a
  deep-link to your logged-in TradingView account.
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

- `server.py` — Flask backend (screener API, data fetch, indicators, `/fundamentals*`, `/version`)
- `fundamentals.py` — bulk fundamentals cache + provider chain (screener.in / yfinance / EODHD)
- `StockScreenPro.html` — complete frontend UI, served by the backend
- `deploy/` — VM setup, nginx conf, systemd unit, rollback script
- `.github/workflows/` — `deploy.yml` (VM deploy), `ci.yml` (PR checks), `release.yml` (tag + release)
- `DEPLOY-ORACLE.md`, `RELEASING.md`, `CHANGELOG.md` — hosting, release/rollback, version notes
- `quanthunt.spec` — PyInstaller spec for `quanthunt.exe`
