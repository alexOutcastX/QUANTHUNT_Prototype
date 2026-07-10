# QuantHunt — Flask screener, containerized for a cloud host (e.g. Oracle
# Always-Free ARM). Serves the app on :5000 via gunicorn — a production WSGI
# server — instead of Flask's built-in dev server that `npm start` uses.
FROM python:3.11-slim

# git:             requirements.txt installs tvDatafeed straight from GitHub.
# ca-certificates: HTTPS fetches to NSE / yfinance.
# curl:            container healthcheck.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn

COPY . .

ENV PORT=5000 \
    PYTHONUNBUFFERED=1

EXPOSE 5000

# One worker, many threads: the universe and price caches are per-process in
# memory, so multiple workers would each re-fetch from NSE and defeat the cache.
# Threads give concurrency for the I/O-bound upstream calls, matching the dev
# server's threaded=True. Raise the timeout since some NSE/yfinance calls are slow.
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "8", "--timeout", "120", "wsgi:app"]
