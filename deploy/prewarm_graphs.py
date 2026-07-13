#!/usr/bin/env python3
"""Pre-warm the Terminal's relationship-graph cache.

Calls the live server's /graph?symbol=X endpoint for a list of companies so
each graph is generated once and cached on the VM for 30 days (TTL in
ai_graph.py). After a run, real visitors open those companies with zero AI
tokens spent. Re-running is safe: already-cached symbols return instantly
without spending anything.

Stdlib only (urllib) — no pip installs needed.

Auth: pass your own key (BYOK, no rate limit) with --provider/--key, OR omit
them to use the server's own ANTHROPIC_API_KEY (rate-limited to ~10/hour).

Examples
--------
  # Warm NIFTY 50 with your own Anthropic key
  python deploy/prewarm_graphs.py --base https://your-host \
      --provider anthropic --key sk-ant-... --index "NIFTY 50"

  # Warm a custom list with Gemini
  python deploy/prewarm_graphs.py --base https://your-host \
      --provider gemini --key AIza... --symbols RELIANCE,TCS,INFY,HDFCBANK

  # Use the server's own key (slower — rate-limited)
  python deploy/prewarm_graphs.py --base https://your-host --index "NIFTY 50"
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# Fallback if --index can't be expanded via the server (network hiccup).
NIFTY50_FALLBACK = [
    "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "INFY", "HINDUNILVR", "ITC",
    "SBIN", "BHARTIARTL", "KOTAKBANK", "LT", "AXISBANK", "BAJFINANCE", "ASIANPAINT",
    "MARUTI", "SUNPHARMA", "TITAN", "ULTRACEMCO", "WIPRO", "NESTLEIND",
]


def _get(url, headers, timeout):
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read().decode())


def expand_index(base, name, timeout):
    url = base + "/index?name=" + urllib.parse.quote(name)
    try:
        _, d = _get(url, {}, timeout)
        syms = [c.get("symbol") for c in (d.get("data") or []) if c.get("symbol")]
        return syms
    except Exception as e:
        print("  ! couldn't expand %s (%s) — using fallback list" % (name, e))
        return NIFTY50_FALLBACK if name.upper().replace(" ", "") in ("NIFTY50",) else []


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", required=True, help="live server base URL, e.g. https://your-host")
    ap.add_argument("--symbols", help="comma-separated tickers (overrides --index)")
    ap.add_argument("--index", help="index name to expand, e.g. 'NIFTY 50'")
    ap.add_argument("--provider", default="", help="anthropic | gemini | grok | openai (BYOK)")
    ap.add_argument("--key", default="", help="your API key for --provider (BYOK, no rate limit)")
    ap.add_argument("--model", default="", help="optional model override")
    ap.add_argument("--delay", type=float, default=1.5, help="seconds between calls (default 1.5)")
    ap.add_argument("--timeout", type=float, default=120, help="per-request timeout seconds")
    args = ap.parse_args()

    base = args.base.rstrip("/")
    if args.symbols:
        symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
    elif args.index:
        symbols = expand_index(base, args.index, args.timeout)
    else:
        ap.error("pass --symbols or --index")

    if not symbols:
        print("No symbols to warm."); return 1

    headers = {}
    if args.key:
        headers["X-AI-Key"] = args.key
        if args.provider:
            headers["X-AI-Provider"] = args.provider
        if args.model:
            headers["X-AI-Model"] = args.model

    print("Warming %d graphs on %s%s\n" % (
        len(symbols), base, "" if args.key else " (server key — rate-limited)"))
    generated = cached_or_ok = minimal = failed = 0
    for i, sym in enumerate(symbols, 1):
        url = base + "/graph?symbol=" + urllib.parse.quote(sym)
        try:
            status, d = _get(url, headers, args.timeout)
            src = d.get("source", "?")
            if status == 429 or d.get("error") == "rate-limited":
                wait = 65
                print("  [%d/%d] %-12s rate-limited — sleeping %ds" % (i, len(symbols), sym, wait))
                time.sleep(wait)
                status, d = _get(url, headers, args.timeout)
                src = d.get("source", "?")
            if src == "ai":
                generated += 1; tag = "ok (ai graph)"
            elif src in ("demo", "curated"):
                cached_or_ok += 1; tag = "curated (no AI needed)"
            elif src == "minimal":
                minimal += 1; tag = "minimal (no edges — key/provider issue?)"
            else:
                cached_or_ok += 1; tag = src
            print("  [%d/%d] %-12s %s" % (i, len(symbols), sym, tag))
        except urllib.error.HTTPError as e:
            failed += 1
            body = ""
            try:
                body = json.loads(e.read().decode()).get("detail", "")
            except Exception:
                pass
            print("  [%d/%d] %-12s FAILED %s %s" % (i, len(symbols), sym, e.code, body))
        except Exception as e:
            failed += 1
            print("  [%d/%d] %-12s FAILED %s" % (i, len(symbols), sym, e))
        if i < len(symbols):
            time.sleep(args.delay)

    print("\nDone. ai-graphs=%d  curated=%d  minimal=%d  failed=%d" % (
        generated, cached_or_ok, minimal, failed))
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
