# App-wide Indian sector classification + the sectoral-heatmap aggregate.
#
# ONE taxonomy across the whole app: NSE's macro-economic sectors (~22), which
# are far finer than Yahoo's 11 GICS buckets — so the heatmap and every screener
# speak the same detailed language ("Automobile and Auto Components", "Capital
# Goods", "Realty", "Power", …) and a heatmap tap always routes into a screener
# that recognises the sector.
#
# Coverage is layered and best-effort — everything is cached to disk so a cold
# start is cheap and NSE is never hammered:
#   1. NSE index "Industry" classification — the authoritative macro sector for
#      every constituent of the broad NSE indices (union ≈ 1,000+ scrips).
#   2. Yahoo GICS sector translated to the nearest NSE macro sector — fills the
#      long tail (tiny NSE + BSE-only scrips the indices don't list). This layer
#      accumulates persistently as the multibagger sweep resolves each stock, so
#      coverage only ever grows and never resets between runs.
#
# The heatmap's day-change + weight come from the bhavcopy (close vs prev-close,
# value traded) for the WHOLE universe, so it maps thousands of scrips instantly
# and never depends on a rate-limited per-stock .info sweep.
import io
import csv
import json
import os
import threading
import time

# Broad NSE index constituent lists. Each CSV carries an "Industry" column with
# the macro-economic sector for every constituent. Their union is the investable
# NSE universe; overlaps are deduped (first writer wins, all agree anyway).
NSE_INDEX_FILES = [
    "ind_niftytotalmarket_list.csv",   # ~750 — the broadest single list
    "ind_nifty500list.csv",            # ~500
    "ind_niftymidcap150list.csv",      # ~150
    "ind_niftysmallcap250list.csv",    # ~250
    "ind_niftymicrocap250_list.csv",   # ~250 — the small tail
]
NSE_INDICES_PATH = "/content/indices/"   # under the nsearchives host

# The canonical NSE macro-economic sectors (title-cased for display). Anything a
# feed hands us is normalised toward one of these; unknowns pass through as-is.
NSE_SECTORS = [
    "Automobile and Auto Components",
    "Capital Goods",
    "Chemicals",
    "Construction",
    "Construction Materials",
    "Consumer Durables",
    "Consumer Services",
    "Diversified",
    "Fast Moving Consumer Goods",
    "Financial Services",
    "Forest Materials",
    "Healthcare",
    "Information Technology",
    "Media Entertainment & Publication",
    "Metals & Mining",
    "Oil Gas & Consumable Fuels",
    "Power",
    "Realty",
    "Services",
    "Telecommunication",
    "Textiles",
]

# Nearest NSE macro sector for each of Yahoo's 11 GICS sectors — used ONLY as a
# fallback for scrips absent from the NSE index classification, so the long tail
# still lands in a real bucket. Imperfect by nature (GICS "Consumer Cyclical"
# spans autos, retail and textiles) but consistent per symbol.
_GICS_TO_NSE = {
    "financial services": "Financial Services",
    "technology": "Information Technology",
    "healthcare": "Healthcare",
    "consumer cyclical": "Consumer Services",
    "consumer defensive": "Fast Moving Consumer Goods",
    "basic materials": "Metals & Mining",
    "energy": "Oil Gas & Consumable Fuels",
    "industrials": "Capital Goods",
    "real estate": "Realty",
    "utilities": "Power",
    "communication services": "Telecommunication",
}

# Common raw-label aliases → canonical, so slightly different spellings from the
# various NSE files all fold together.
_ALIASES = {
    "information technology": "Information Technology",
    "it": "Information Technology",
    "fmcg": "Fast Moving Consumer Goods",
    "fast moving consumer goods": "Fast Moving Consumer Goods",
    "automobile and auto components": "Automobile and Auto Components",
    "automobile": "Automobile and Auto Components",
    "oil gas & consumable fuels": "Oil Gas & Consumable Fuels",
    "oil & gas": "Oil Gas & Consumable Fuels",
    "metals & mining": "Metals & Mining",
    "media entertainment & publication": "Media Entertainment & Publication",
    "media": "Media Entertainment & Publication",
    "telecommunication": "Telecommunication",
    "telecom": "Telecommunication",
    "capital goods": "Capital Goods",
    "consumer durables": "Consumer Durables",
    "consumer services": "Consumer Services",
    "financial services": "Financial Services",
    "healthcare": "Healthcare",
    "chemicals": "Chemicals",
    "construction": "Construction",
    "construction materials": "Construction Materials",
    "power": "Power",
    "realty": "Realty",
    "services": "Services",
    "textiles": "Textiles",
    "forest materials": "Forest Materials",
    "diversified": "Diversified",
}

_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sectors_cache.json")
_TTL = 24 * 3600          # re-fetch the classification once a day
# Bump when the set of classification SOURCES changes so a redeploy discards a
# cache built by older code and re-pulls everything. (2 = adds the BSE scrip
# master layer.) Without this, a still-fresh cache from the prior deploy blocks
# the new source from ever being fetched until its 24h TTL lapses.
CACHE_VERSION = 2
_lock = threading.Lock()
# symbol(upper) -> canonical NSE sector.
_map = {}
_fetched_ts = 0


def _canon(raw) -> str:
    """Normalise a raw sector/industry label to a canonical NSE macro sector.
    Unknown labels pass through trimmed + title-cased so nothing is dropped."""
    if not raw:
        return ""
    key = " ".join(str(raw).strip().split()).lower()
    if key in _ALIASES:
        return _ALIASES[key]
    # already canonical (case-insensitive match against the canonical set)?
    for s in NSE_SECTORS:
        if s.lower() == key:
            return s
    return " ".join(w.capitalize() for w in key.split())


def translate_gics(gics) -> str:
    """Yahoo GICS sector → nearest NSE macro sector (fallback layer)."""
    if not gics:
        return ""
    return _GICS_TO_NSE.get(str(gics).strip().lower(), _canon(gics))


# BSE's scrip master tags every listed company with a granular "Industry" (e.g.
# "IT - Software", "Auto Ancillaries", "Cement & Cement Products"). This folds
# those ~100 granular industries into our 22 macro sectors by keyword, so the
# whole BSE universe (~4,000 scrips the NSE index files never list) gets a
# sector. Rules are checked in order — put the specific ones first (cement before
# construction, ferrous before generic metals).
_INDUSTRY_RULES = [
    (("cement",), "Construction Materials"),
    (("bank", "finance", "nbfc", "insurance", "financial", "broking", "broker",
      "asset management", "housing", "holding compan", "investment", "capital market",
      "stock", "depositor", "fintech", "microfinance", "leasing"), "Financial Services"),
    # Healthcare before IT so "biotechnology" isn't caught by an IT keyword.
    (("pharma", "drug", "healthcare", "hospital", "biotech", "medical", "diagnostic",
      "health care", "life science"), "Healthcare"),
    (("it - ", "it-", "software", "information technology", "computers", "bpo",
      "it enabled", "internet", "e-commerce techn"), "Information Technology"),
    # Telecom before the broad "services" rule so "Telecom - Services" lands here.
    (("telecom", "telephone", "telecommunication"), "Telecommunication"),
    (("auto ", "auto-", "automobile", "tyre", "auto ancill", "auto compon", "two wheeler",
      "commercial vehicle", "passenger", "4 wheeler", "2/3 wheeler"), "Automobile and Auto Components"),
    (("cigarett", "tobacco", "food", "beverage", "sugar", "tea", "coffee", "dairy",
      "fmcg", "personal care", "household product", "breweries", "distilleries",
      "edible oil", "packaged food", "agro product", "agricultural food"),
     "Fast Moving Consumer Goods"),
    (("consumer durable", "consumer electronic", "household appliance", "footwear",
      "furniture", "jewel", "gems", "watches", "leisure product", "plywood boards"),
     "Consumer Durables"),
    (("media", "entertainment", "film", "broadcast", "publish", "print", "newspaper",
      "tv ", "television", "animation"), "Media Entertainment & Publication"),
    (("retail", "trading", "e-commerce", "hotel", "restaurant", "tourism", "leisure",
      "amusement", "education", "food service"), "Consumer Services"),
    (("logistic", "transport", "shipping", "port", "airline", "aviation", "courier",
      "warehous", "rail", "road ", "consultanc", "services", "staffing", "diversified commercial"),
     "Services"),
    (("realty", "real estate", "residential", "commercial complex", "township"), "Realty"),
    (("power", "electric util", "power generation", "renewable", "utilit", "distribution - electricity"),
     "Power"),
    (("oil", "gas", "petroleum", "refiner", "lng", "coal", " fuel", "petrochemical"),
     "Oil Gas & Consumable Fuels"),
    (("ferrous", "steel", "iron", "aluminium", "aluminum", "copper", "zinc", "lead",
      "mining", "metal", "mineral", "ore"), "Metals & Mining"),
    (("chemical", "fertiliz", "fertilis", "agrochemical", "pesticide", "paints",
      "dyes", "pigment", "specialty chem", "petrochem"), "Chemicals"),
    (("textile", "apparel", "garment", "fabric", "cotton", "yarn", "spinning",
      "readymade", "hosiery"), "Textiles"),
    (("paper", "forest", "wood", "timber", "jute"), "Forest Materials"),
    (("construction", "civil", "infrastructur", "roads", "epc", "engineering - construction"),
     "Construction"),
    (("capital good", "electrical equip", "heavy electrical", "industrial",
      "machinery", "engineering", "defence", "defense", "aerospace", "abrasives",
      "bearing", "casting", "compressor", "pump", "electricals", "electrode",
      "packaging", "container"), "Capital Goods"),
    (("diversified", "conglomerat", "miscellaneous"), "Diversified"),
]


def industry_to_macro(raw) -> str:
    """Map a granular exchange industry label (mainly BSE) to one of the 22 NSE
    macro sectors. Unmatched labels fall back to the alias/title-case pass-through
    so a scrip is still classified (never silently dropped)."""
    if not raw:
        return ""
    key = " ".join(str(raw).strip().split()).lower()
    if not key:
        return ""
    if key in _ALIASES:
        return _ALIASES[key]
    for keywords, sector in _INDUSTRY_RULES:
        for kw in keywords:
            if kw in key:
                return sector
    return _canon(raw)


def _load_disk():
    global _map, _fetched_ts
    try:
        with open(_FILE) as f:
            saved = json.load(f)
        # Discard a cache written by an older source set — leaving _map empty +
        # _fetched_ts 0 makes the next /sectors call re-pull every source.
        if saved.get("version") != CACHE_VERSION:
            return
        if isinstance(saved, dict) and isinstance(saved.get("map"), dict):
            _map = {str(k).upper(): v for k, v in saved["map"].items() if v}
            _fetched_ts = saved.get("fetched_ts", 0)
    except Exception:
        pass


_load_disk()


def _save_disk():
    try:
        with open(_FILE + ".tmp", "w") as f:
            json.dump({"version": CACHE_VERSION, "map": _map, "fetched_ts": _fetched_ts}, f)
        os.replace(_FILE + ".tmp", _FILE)
    except Exception:
        pass


def _parse_index_csv(text: str):
    """Yield (symbol, canonical_sector) from an NSE index constituent CSV."""
    reader = csv.DictReader(io.StringIO(text))
    cols = {(c or "").strip().lower(): c for c in (reader.fieldnames or [])}
    sym_c = cols.get("symbol")
    ind_c = cols.get("industry") or cols.get("macro-economic sector") or cols.get("sector")
    if not sym_c or not ind_c:
        return
    for row in reader:
        sym = (row.get(sym_c) or "").strip().upper()
        sec = _canon(row.get(ind_c))
        if sym and sec:
            yield sym, sec


def refresh_classification(fetch_text, bse_rows=None, force: bool = False) -> int:
    """(Re)build the classification map from two layers, merged in priority order
    so authoritative data always wins:

      1. BSE scrip master (`bse_rows`: iterable of (symbol, raw_industry)) — the
         broad base, covering the ~4,000+ BSE-listed universe the NSE index files
         never reach. Granular industries are folded into the 22 macro sectors.
      2. NSE index "Industry" files (`fetch_text(url)` returns the CSV body) — the
         most authoritative macro-sector source; overwrites the BSE layer.

    Both are best-effort — a failed source just contributes nothing. The result
    is merged into (never wholesale replaces) the existing map, so the Yahoo
    long-tail accumulated via record() survives a refresh. Returns the total
    number of symbols mapped."""
    global _fetched_ts
    with _lock:
        fresh = _map and (time.time() - _fetched_ts) < _TTL
    if fresh and not force:
        return len(_map)

    # Layer 1 — BSE scrip master (lower priority, broadest coverage).
    added = {}
    try:
        for sym, ind in (bse_rows or []):
            s = (sym or "").strip().upper()
            sec = industry_to_macro(ind)
            if s and sec:
                added[s] = sec
    except Exception:
        pass

    # Layer 2 — NSE index Industry files (authoritative; overwrite the BSE layer).
    for name in NSE_INDEX_FILES:
        try:
            text = fetch_text(NSE_INDICES_PATH + name)
            if not text or "," not in text[:200]:
                continue
            for sym, sec in _parse_index_csv(text):
                added[sym] = sec
        except Exception:
            continue

    with _lock:
        _map.update(added)
        _fetched_ts = time.time()
        _save_disk()
        return len(_map)


def record(symbol, gics) -> None:
    """Fold a Yahoo-resolved GICS sector into the long-tail layer (translated to
    an NSE macro sector). Only fills gaps — an authoritative NSE-index mapping is
    never overwritten. Called by the multibagger sweep for whole-universe reach.
    """
    if not symbol or not gics:
        return
    sym = str(symbol).strip().upper()
    sec = translate_gics(gics)
    if not sec:
        return
    with _lock:
        # Fill gaps only — never clobber an authoritative index-file mapping (or
        # an earlier translated guess) with a new guess. Persistence is batched
        # via flush() so a whole-universe sweep doesn't thrash the disk.
        if not _map.get(sym):
            _map[sym] = sec


def flush() -> None:
    """Persist the accumulated long-tail additions (call once after a sweep)."""
    with _lock:
        _save_disk()


def sector_of(symbol, gics=None) -> str:
    """The app-wide NSE macro sector for a symbol: the authoritative index-file
    mapping if known, else the translated Yahoo GICS hint, else ''. Pure lookup —
    never hits the network."""
    if symbol:
        s = _map.get(str(symbol).strip().upper())
        if s:
            return s
    return translate_gics(gics) if gics else ""


def map_size() -> int:
    with _lock:
        return len(_map)


# ── Heatmap aggregate ────────────────────────────────────────────────────────
def _acc(acc: dict, sector: str, chg, weight) -> None:
    """Fold one scrip into the per-sector accumulator (in place). Value-weights
    the day change by traded value, falling back to equal weight."""
    if not sector:
        return
    a = acc.setdefault(sector, {"count": 0, "weight": 0.0, "chg_w": 0.0, "chg_den": 0.0})
    a["count"] += 1
    w = float(weight) if isinstance(weight, (int, float)) and weight and weight > 0 else 0.0
    a["weight"] += w
    if isinstance(chg, (int, float)):
        d = w if w > 0 else 1.0
        a["chg_w"] += float(chg) * d
        a["chg_den"] += d


def sectors_from_acc(acc: dict) -> list:
    """Reduce the accumulator to display rows: one per sector with its count,
    total traded value and value-weighted average day change. Biggest count
    first. Pure — unit-tested with no data deps."""
    out = []
    for sec, a in acc.items():
        out.append({
            "sector": sec,
            "count": a["count"],
            "market_cap_cr": round(a["weight"], 2) if a["weight"] else None,
            "chg": round(a["chg_w"] / a["chg_den"], 2) if a["chg_den"] else None,
        })
    out.sort(key=lambda x: -x["count"])
    return out


def build_heatmap(universe: list) -> dict:
    """Aggregate the full NSE+BSE universe into NSE macro sectors. Each universe
    item may carry: symbol, chg (day %), turnover (traded value, the weight) and
    an optional Yahoo `sector` hint for the fallback classification. Pure over
    the current in-memory classification map."""
    acc = {}
    mapped = 0
    total = 0
    for it in (universe or []):
        sym = it.get("symbol")
        if not sym:
            continue
        total += 1
        sec = sector_of(sym, it.get("sector"))
        if not sec:
            continue
        mapped += 1
        _acc(acc, sec, it.get("chg"), it.get("turnover"))
    return {
        "universe": total,
        "mapped": mapped,
        "sectors": sectors_from_acc(acc),
    }
