"""One-off harvester: build the bundled symbol -> 3-level sector classification.

Pulls BSE's active-equity scrip master (~4,900 scrips) for the code list, then
fetches ComHeadernew per scrip to read the full NSE-style hierarchy:
  IndustryNew -> Macro sector (~22)
  IGroup      -> Industry (~65)
  ISubGroup   -> Basic Industry (~200)

Writes sector_map.csv with header `symbol,macro,industry,basic`. Bounded
concurrency + retries; a scrip that fails is simply skipped. NOT imported by the
app — run manually to regenerate the bundle when the classification drifts.
"""
import csv
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "sector_map.csv")
LIST_URL = ("https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w"
            "?Group=&Scripcode=&industry=&segment=Equity&status=Active")
HDR_URL = "https://api.bseindia.com/BseIndiaAPI/api/ComHeadernew/w?quotetype=EQ&scripcode={}&seriesid="
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Accept": "application/json",
    "Referer": "https://www.bseindia.com/",
}


def fetch_list(sess):
    r = sess.get(LIST_URL, timeout=30)
    r.raise_for_status()
    rows = r.json()
    out = []
    for it in rows:
        code = (it.get("SCRIP_CD") or "").strip()
        sym = (it.get("scrip_id") or "").strip().upper()
        if code and sym:
            out.append((code, sym))
    return out


def fetch_one(sess, code, sym, retries=3):
    for attempt in range(retries):
        try:
            r = sess.get(HDR_URL.format(code), timeout=15)
            if r.status_code != 200:
                time.sleep(0.5 * (attempt + 1))
                continue
            ct = r.headers.get("Content-Type", "")
            if "json" not in ct and not r.text.lstrip().startswith("{"):
                # Akamai challenge page — back off harder.
                time.sleep(1.5 * (attempt + 1))
                continue
            d = r.json()
            symbol = (d.get("SecurityId") or sym or "").strip().upper()
            macro = (d.get("IndustryNew") or "").strip()
            industry = (d.get("IGroup") or "").strip()
            basic = (d.get("ISubGroup") or d.get("Industry") or "").strip()
            if symbol and macro:
                return (symbol, macro, industry, basic)
            return None
        except Exception:
            time.sleep(0.5 * (attempt + 1))
    return None


def main():
    sess = requests.Session()
    sess.headers.update(HEADERS)
    print("fetching scrip list…", flush=True)
    scrips = fetch_list(sess)
    print(f"{len(scrips)} active EQ scrips", flush=True)

    results = {}
    done = 0
    fails = 0
    t0 = time.time()
    # Modest concurrency to stay under Akamai's radar; a fresh Session per worker
    # is unnecessary (requests Session is thread-safe for plain GETs here).
    with ThreadPoolExecutor(max_workers=10) as pool:
        futs = {pool.submit(fetch_one, sess, code, sym): sym for code, sym in scrips}
        for fut in as_completed(futs):
            done += 1
            row = fut.result()
            if row:
                results[row[0]] = row
            else:
                fails += 1
            if done % 250 == 0:
                print(f"  {done}/{len(scrips)}  ok={len(results)} fail={fails}  "
                      f"{done/(time.time()-t0):.1f}/s", flush=True)

    print(f"harvested {len(results)} scrips ({fails} failed) in "
          f"{time.time()-t0:.0f}s", flush=True)

    # Write sorted for a stable, reviewable diff.
    with open(OUT, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["symbol", "macro", "industry", "basic"])
        for sym in sorted(results):
            _, macro, industry, basic = results[sym]
            w.writerow([sym, macro, industry, basic])
    print(f"wrote {OUT}", flush=True)

    # Coverage summary.
    macros = {}
    for _, m, ind, b in results.values():
        macros.setdefault(m, 0)
        macros[m] += 1
    print("macro sectors:", len(macros), flush=True)
    inds = {r[2] for r in results.values() if r[2]}
    basics = {r[3] for r in results.values() if r[3]}
    print(f"distinct industries: {len(inds)}  basic industries: {len(basics)}", flush=True)


if __name__ == "__main__":
    main()
