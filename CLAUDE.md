# QUANTHUNT_Prototype

Stock screener prototype for Indian markets. Flask backend (`server.py`, ~1500 lines) serves a single-file HTML UI (`StockScreenPro.html`) on port 5000. Data comes from yfinance with a tvDatafeed (TradingView) fallback.

## Setup (Linux / cloud)

```bash
npm run setup     # python3 venv + pip install -r requirements.txt
npm start         # run server on http://localhost:5000
```

On Windows use `npm run setup:win` / `npm run start:win` instead.

## Notes

- All backend logic lives in `server.py`; the entire frontend is `StockScreenPro.html` (served by Flask). There is no build step for the UI — edit the HTML directly.
- `requirements.txt` installs tvDatafeed from GitHub (not on PyPI); git must be available during setup.
- `quanthunt.spec` is the PyInstaller spec for packaging a standalone exe (`npm run build:exe`, Windows only).
- Python 3.11+ required.
