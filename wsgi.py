"""Production WSGI entrypoint (gunicorn).

`server.py` starts the universe prefetch only inside its ``if __name__ ==
"__main__"`` block, which does NOT run when a WSGI server imports the app. This
module reproduces that warm-up so a containerized/gunicorn deployment behaves
like ``npm start``: the process pre-fetches the screening universe on boot
rather than on the first request.

Run with:  gunicorn wsgi:app
"""
from __future__ import annotations

import threading

from server import (_prefetch_universe, app, start_alert_loop, start_backfill,
                    start_corp_warm, start_fund_warm, start_scan_warm,
                    start_snapshots)

# Warm the universe cache in the background so the first /universe request is
# fast, mirroring server.py's __main__ behaviour. Daemon so it never blocks
# shutdown.
threading.Thread(
    target=_prefetch_universe, name="universe-prefetch", daemon=True
).start()

# Keep the screener's technical scan cache hot for the default index so the
# first /scan responses are instant (see server.start_scan_warm).
start_scan_warm()
start_snapshots()

# The record-date index behind the corporate calendar's "announced" column —
# one big NSE read every six hours, never on a request (see start_corp_warm).
start_corp_warm()

# Scrape and cache company fundamentals up front so the valuation and growth
# filters have data on the first screen open (see server.start_fund_warm).
# No-op unless FUND_WARM names an index or ALL.
start_fund_warm()

# Evaluate server-side price/technical alerts on a background loop so they fire
# (→ webhook + FCM push) without the app open (see server.start_alert_loop).
start_alert_loop()

# Seed the Historic track record by replaying the engines over the last 30
# trading days, once ever (see server.start_backfill / backfill.py). Every
# replayed row is flagged so it is never mixed with a live call.
start_backfill()

__all__ = ["app"]
