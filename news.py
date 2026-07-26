# Latest-news aggregation for the Terminal news panel.
#
# Sources (all free RSS, no API keys):
#   - Google News India search feed for the centred company (symbol-specific)
#   - Economic Times Markets / Moneycontrol / Livemint market-wide feeds
#
# Results are cached in-memory for an hour per key; the panel's update button
# sends force=1 which bypasses the hourly TTL but still rate-limits refetches
# to once every FORCE_MIN seconds so a click-happy user can't hammer the feeds.

import html
import re
import threading
import time
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus
from urllib.request import Request, urlopen

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
}

MARKET_FEEDS = [
    ("ET Markets", "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms"),
    ("Moneycontrol", "https://www.moneycontrol.com/rss/buzzingstocks.xml"),
    ("Livemint", "https://www.livemint.com/rss/markets"),
]

TTL = 3600          # normal cache lifetime (auto-refresh cadence)
FORCE_MIN = 120     # minimum seconds between forced refetches per key
MAX_ITEMS = 40
FEED_TIMEOUT = 8

SUMMARY_MAX = 400   # characters kept from the feed's standfirst

_cache: dict = {}   # key -> {"ts": epoch, "items": [...]}
_lock = threading.Lock()

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def clean_summary(raw: str) -> str:
    """Feed <description> reduced to plain text for the article popup.

    Publisher descriptions arrive as HTML fragments — a thumbnail <img>, a
    wrapping <p>, sometimes a trailing "Read more" anchor — and are often
    double-escaped, so entities need unwrapping both before and after tags are
    stripped. Anything left is collapsed to a single paragraph and truncated on
    a word boundary; the popup is a preview, not a reader.
    """
    if not raw:
        return ""
    txt = html.unescape(raw)
    txt = _TAG_RE.sub(" ", txt)
    txt = html.unescape(txt)          # entities that were themselves escaped
    txt = _WS_RE.sub(" ", txt).strip()
    if len(txt) > SUMMARY_MAX:
        cut = txt[:SUMMARY_MAX]
        sp = cut.rfind(" ")
        txt = (cut[:sp] if sp > SUMMARY_MAX // 2 else cut).rstrip(" ,;:.") + "…"
    return txt


def parse_feed(raw: bytes, feed_name: str, is_symbol_feed: bool = False) -> list:
    """Parse an RSS/Atom byte payload into news items. Never raises."""
    items = []
    try:
        root = ET.fromstring(raw)
    except Exception:
        return items
    for it in root.iter("item"):
        # Feeds often double-encode entities ("&amp;amp;"), which XML parsing
        # only unwraps once — unescape so titles never show raw "&amp;".
        title = html.unescape((it.findtext("title") or "").strip())
        link = (it.findtext("link") or "").strip()
        src = (it.findtext("source") or "").strip() or feed_name
        ts = 0
        pub = it.findtext("pubDate")
        if pub:
            try:
                ts = int(parsedate_to_datetime(pub).timestamp())
            except Exception:
                ts = 0
        # Standfirst for the article popup. Atom calls it <summary>; a few
        # feeds only carry the body in content:encoded.
        summary = clean_summary(
            it.findtext("description")
            or it.findtext("summary")
            or it.findtext("{http://purl.org/rss/1.0/modules/content/}encoded")
            or "")
        # Google News descriptions are just a list of links to the same story —
        # markup with no prose, which strips down to the headline again.
        if summary and summary.lower() == title.lower():
            summary = ""
        if title and link:
            items.append({"title": title, "link": link, "source": src,
                          "ts": ts, "sym": is_symbol_feed, "summary": summary})
    return items


def _fetch_feed(feed_name: str, url: str, is_symbol_feed: bool, out: list):
    try:
        raw = urlopen(Request(url, headers=UA), timeout=FEED_TIMEOUT).read()
    except Exception:
        return
    out.extend(parse_feed(raw, feed_name, is_symbol_feed))


def _dedupe(items: list) -> list:
    seen, out = set(), []
    for it in items:
        k = it["title"].lower()[:80]
        if k in seen:
            continue
        seen.add(k)
        out.append(it)
    return out


def get_news(symbol: str = "", query: str = "", force: bool = False) -> dict:
    """Merged, deduped, newest-first news for a symbol (plus market feeds)."""
    key = symbol.upper() or "_market"
    now = time.time()
    with _lock:
        c = _cache.get(key)
        if c and (now - c["ts"]) < (FORCE_MIN if force else TTL):
            return {"symbol": symbol, "items": c["items"], "fetched": c["ts"],
                    "cached": True}

    feeds = [(n, u, False) for n, u in MARKET_FEEDS]
    if symbol:
        q = (query or symbol).strip()
        gq = quote_plus('"%s" stock india' % q)
        feeds.insert(0, ("Google News",
                         "https://news.google.com/rss/search?q=" + gq +
                         "&hl=en-IN&gl=IN&ceid=IN:en", True))

    results: list = []
    threads = [threading.Thread(target=_fetch_feed, args=(n, u, s, results), daemon=True)
               for n, u, s in feeds]
    for t in threads:
        t.start()
    for t in threads:
        t.join(FEED_TIMEOUT + 2)

    items = _dedupe(sorted(results, key=lambda i: i["ts"], reverse=True))[:MAX_ITEMS]
    with _lock:
        if items or key not in _cache:
            _cache[key] = {"ts": now, "items": items}
        else:
            items = _cache[key]["items"]  # keep last-good on a total fetch failure
    return {"symbol": symbol, "items": items, "fetched": int(now), "cached": False}
