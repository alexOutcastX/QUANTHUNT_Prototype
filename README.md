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

### v2.11.0 — Feature-gap close-out

| Area | Change |
|---|---|
| UX | **Symbol autocomplete** (full-universe type-ahead) in Chart / Institutional / TradingView / Terminal; desktop **ticker strip** |
| Backtest | **Custom strategy builder** — user-defined BUY/SELL rules, persisted, full risk engine |
| Screener | **Camarilla H3/H4/L3/L4** + H4-breakout / L4-breakdown signal filters, detail + CSV |
| Universe | **LARGE / MID / SMALL CAP** segments (NIFTY 500 mcap rank) with MCap column |
| New pages | **Indices** (live levels via `/indices`) and **Market Holidays** (`/holidays`, open/closed status) |

### v2.10.0 — Production hardening

| Area | Change |
|---|---|
| Web | Installable **PWA** (manifest, icons, service worker, offline shell) + SEO/OG meta |
| Backend | Per-IP **rate limits** on /scan /news /graph, AI generations 10/hr/IP, `/health`, security headers |
| Ops | `deploy/enable-https.sh` (domain + Let's Encrypt), `deploy/backup.sh` (nightly), `/legal.html` disclaimer/privacy page |

### v2.9.0 — Terminal wired to real data (AI graphs)

| Area | Change |
|---|---|
| Terminal | `/graph?symbol=X` generates a relationship graph for **any company** via the Claude API (`ai_graph.py`), validated + disk-cached 30 days; curated cluster remains the fallback |
| Terminal | GO on any NSE symbol; data-mode badge; generation progress + error surfacing; whole workspace (window/compare/news/pop-outs/quotes) works on AI graphs |
| Ops | Enable with `ANTHROPIC_API_KEY` in `/opt/quanthunt/.env` (+ optional `GRAPH_AI_MODEL`); `graph_cache.json` survives deploys |

### v2.8.0 — Terminal news panel

| Area | Change |
|---|---|
| Terminal | Left-docked **news panel** — company + market headlines (`/news`: Google News + ET/Moneycontrol/Livemint RSS), ⟳ update button, hourly auto-refresh, ↗ pop-out |
| Terminal | Toolbar **◧ NEWS / ▤ CHART toggles** show/hide the news panel and research window (persisted) |
| Terminal | **⛶ FULL CHART** on the window chart opens a full-screen chart in a browser tab; graph auto-zooms to fit |

### v2.7.0 — Terminal docking & pop-outs

| Area | Change |
|---|---|
| Terminal | Research window dockable: float ❐ / dock-bottom ⬓ / dock-right ◨, drag divider to resize the split; graph reflows; mode persists |
| Terminal | ↗ on the window header and on every tab opens that view as a standalone browser tab (`/research.html`) — company research page or comparison report |

### v2.6.0 — Terminal workspace

| Area | Change |
|---|---|
| Terminal | INPUTS/OUTPUTS edge highlighting; node menu (open graph / open in window / add to compare) |
| Terminal | Floating draggable-resizable multi-tab window: candle chart + screener.in fundamentals per company |
| Terminal | COMPARE tab: metric table + Quality/Trend/Momentum sub-scores + starred FINAL SCORE |

### v2.5.0 — Terminal: relationship graph

| Area | Change |
|---|---|
| New | **Terminal** tab — interactive supply-chain/relationship graph (suppliers, customers, financiers, competitors, group) with command line and walk-the-graph navigation |
| Backend | `/graph` endpoint (curated demo dataset, AI-ready response shape) |

### v2.4.0 — top nav + fundamentals in the table

| Area | Change |
|---|---|
| Layout | Desktop: branding bar + horizontal **pages bar** on top; full-width content (sidebar removed) |
| Screener | 7 sortable **fundamental columns** (MCap, P/E, P/B, ROE, ROCE, D/E, Div%) always populated + in CSV |

### v2.3.0 — true cross detection

| Area | Change |
|---|---|
| Backend | `/scan` detects 11 real events on the latest bar: golden/death cross, 20/50 cross, MACD cross, gaps, new 52w high/low, volume spike |
| Screener | "Signals" filter group, true-event presets, NL idioms mapped to real flags, signals in stock detail + CSV |

### v2.2.0 — easy filter selection

| Area | Change |
|---|---|
| Screener | 15 one-tap **preset scans** (stackable chips, taureye-style) |
| Screener | **Plain-English screener** — "rsi below 30 and above 200 dma" → filters, offline parser with live feedback |

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
