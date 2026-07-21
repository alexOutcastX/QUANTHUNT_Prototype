"""Recovery pass for harvest_sectors.py — re-fetch only the scrips missing from
the current sector_map.csv (the tail that Akamai throttled), at low concurrency
with generous backoff, and merge them in. Idempotent; safe to re-run."""
import csv
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "sector_map.csv")
LIST_URL = ("https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w"
            "?Group=&Scripcode=&industry=&segment=Equity&status=Active")
HDR_URL = "https://api.bseindia.com/BseIndiaAPI/api/ComHeadernew/w?quotetype=EQ&scripcode={}&seriesid="
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Accept": "application/json",
    "Referer": "https://www.bseindia.com/",
}


def load_existing():
    rows = {}
    with open(OUT, newline="") as f:
        r = csv.reader(f)
        next(r, None)
        for row in r:
            if len(row) >= 4:
                rows[row[0].strip().upper()] = tuple(row)
    return rows


def fetch_one(sess, code, sym, retries=5):
    for attempt in range(retries):
        try:
            r = sess.get(HDR_URL.format(code), timeout=20)
            if r.status_code != 200 or not r.text.lstrip().startswith("{"):
                time.sleep(1.0 * (attempt + 1))
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
            time.sleep(1.0 * (attempt + 1))
    return None


def main():
    sess = requests.Session()
    sess.headers.update(HEADERS)
    existing = load_existing()
    print(f"{len(existing)} already mapped", flush=True)

    rows = sess.get(LIST_URL, timeout=30).json()
    missing = [((it.get("SCRIP_CD") or "").strip(), (it.get("scrip_id") or "").strip().upper())
               for it in rows
               if (it.get("scrip_id") or "").strip().upper() not in existing
               and (it.get("SCRIP_CD") or "").strip()]
    print(f"{len(missing)} missing to recover", flush=True)

    recovered = {}
    with ThreadPoolExecutor(max_workers=3) as pool:
        futs = {pool.submit(fetch_one, sess, c, s): s for c, s in missing}
        done = 0
        for fut in as_completed(futs):
            done += 1
            row = fut.result()
            if row:
                recovered[row[0]] = row
            if done % 50 == 0:
                print(f"  {done}/{len(missing)} recovered={len(recovered)}", flush=True)

    print(f"recovered {len(recovered)} of {len(missing)}", flush=True)
    existing.update(recovered)

    with open(OUT, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["symbol", "macro", "industry", "basic"])
        for sym in sorted(existing):
            row = existing[sym]
            w.writerow([row[0], row[1], row[2], row[3]])
    print(f"total now {len(existing)} scrips", flush=True)


if __name__ == "__main__":
    main()
