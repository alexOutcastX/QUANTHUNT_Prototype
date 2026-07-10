# QUANTHUNT_Prototype

Prototype investment app — stock screener with a Flask backend (`server.py`) and a single-file HTML UI (`StockScreenPro.html`). Data via yfinance with tvDatafeed (TradingView) fallback.

## Quick start (any machine)

Requires Python 3.11+ and Node.js (npm is only used as a task runner).

```bash
git clone https://github.com/alexOutcastX/QUANTHUNT_Prototype.git
cd QUANTHUNT_Prototype
npm run setup    # creates venv + installs Python deps  (Windows: npm run setup:win)
npm start        # runs the server                      (Windows: npm run start:win)
```

Then open http://localhost:5000 in a browser.

## Scripts

| Command | What it does |
|---|---|
| `npm run setup` / `setup:win` | Create Python venv and install `requirements.txt` (Linux/Mac vs Windows) |
| `npm start` / `start:win` | Run the server from the venv |
| `npm run start:global` | Run with system Python (no venv) |
| `npm run build:exe` | Build a standalone `quanthunt.exe` with PyInstaller (Windows) |

## Cloud editing (claude.ai/code)

This repo is set up for Claude Code cloud sessions: environment setup command is
`npm ci && npm run setup`, then `npm start` to run the app.

## Files

- `server.py` — Flask backend (screener API, data fetch, indicators)
- `StockScreenPro.html` — complete frontend UI, served by the backend
- `quanthunt.spec` — PyInstaller spec used to package `quanthunt.exe`
- `START_DEV.bat` — legacy Windows dev launcher
