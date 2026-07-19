"""On-demand scrape of a company's shareholding pattern and balance sheet from
screener.in — the reliable source for Indian promoter / FII / DII splits and
borrowings that Yahoo and the bot-blocked NSE feeds don't give us.

The HTML parsers are pure-Python (regex, no BeautifulSoup) so they are unit
tested on a saved sample; the network fetch lazily uses requests and is fully
guarded so a markup change or a block just yields an empty result, never a 500.
"""
import logging
import re

log = logging.getLogger("screenerin")

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/122.0 Safari/537.36")
_URL = "https://www.screener.in/company/{sym}/"


def _clean(s):
    return re.sub(r"<[^>]+>", "", s or "").replace("&nbsp;", " ").replace("&amp;", "&").strip()


def _pct(s):
    m = re.search(r"-?\d+(?:\.\d+)?", (s or "").replace(",", ""))
    return round(float(m.group(0)), 2) if m else None


def _cr(s):
    """Parse a '1,234' / '1,234.5' rupee-crore figure to a float."""
    m = re.search(r"-?\d[\d,]*(?:\.\d+)?", s or "")
    return round(float(m.group(0).replace(",", "")), 2) if m else None


def _section(html, sec_id):
    m = re.search(r'id="%s".*?</section>' % re.escape(sec_id), html or "", re.S)
    return m.group(0) if m else ""


def _first_table_rows(section):
    t = re.search(r'<table[^>]*class="[^"]*data-table[^"]*"[^>]*>(.*?)</table>', section, re.S)
    if not t:
        return []
    return re.findall(r"<tr[^>]*>(.*?)</tr>", t.group(1), re.S)


def parse_shareholding(html):
    """Latest-quarter promoter / FII / DII / government / public %."""
    out = {}
    for row in _first_table_rows(_section(html, "shareholding")):
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
        if len(cells) < 2:
            continue
        label = _clean(cells[0]).lower()
        val = _pct(_clean(cells[-1]))
        if val is None:
            continue
        if "promoter" in label:
            out["promoter"] = val
        elif "fii" in label or "foreign" in label:
            out["fii"] = val
        elif "dii" in label or "domestic" in label:
            out["dii"] = val
        elif "government" in label:
            out["government"] = val
        elif "public" in label:
            out["public"] = val
    return out


def parse_balance(html):
    """Latest-year borrowings / reserves / equity capital / total liabilities (₹ cr)."""
    out = {}
    for row in _first_table_rows(_section(html, "balance-sheet")):
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
        if len(cells) < 2:
            continue
        label = _clean(cells[0]).lower()
        val = _cr(_clean(cells[-1]))
        if val is None:
            continue
        if "borrowing" in label:
            out["borrowings"] = val
        elif "reserve" in label:
            out["reserves"] = val
        elif "equity capital" in label:
            out["equity_capital"] = val
        elif "total liabilities" in label or "total assets" in label:
            out["total_liabilities"] = val
    return out


def _fetch(symbol):
    import requests
    sym = re.sub(r"[^A-Z0-9&-]", "", (symbol or "").upper().strip())
    if not sym:
        return ""
    headers = {"User-Agent": _UA, "Accept-Language": "en-IN,en;q=0.9"}
    for suffix in ("consolidated/", ""):
        try:
            r = requests.get(_URL.format(sym=sym) + suffix, headers=headers, timeout=8)
            if r.status_code == 200 and "shareholding" in r.text:
                return r.text
        except Exception as e:
            log.debug("screener.in fetch %s failed: %s", sym, e)
    return ""


def financials(symbol):
    """Scrape shareholding + balance sheet for `symbol`. Never raises; returns
    {shareholding:{}, balance:{}} (possibly empty) with the source url."""
    try:
        html = _fetch(symbol)
        if not html:
            return {"symbol": symbol, "shareholding": {}, "balance": {},
                    "source": "screener.in", "ok": False}
        return {
            "symbol": symbol,
            "shareholding": parse_shareholding(html),
            "balance": parse_balance(html),
            "source": "screener.in",
            "url": _URL.format(sym=re.sub(r"[^A-Z0-9&-]", "", symbol.upper())),
            "ok": True,
        }
    except Exception as e:
        log.error("screener.in financials %s: %s", symbol, e)
        return {"symbol": symbol, "shareholding": {}, "balance": {}, "error": str(e), "ok": False}
