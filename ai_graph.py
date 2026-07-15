# AI-generated company-relationship graphs for the Terminal tab.
#
# When ANTHROPIC_API_KEY is set (VM: /opt/quanthunt/.env), /graph?symbol=X
# generates a relationship graph for ANY Indian listed company by asking
# Claude for a strictly-shaped JSON graph, validating it, and caching it on
# disk for 30 days. Without a key the Terminal falls back to the curated
# demo dataset in relations.py. Plain HTTPS via requests — no SDK needed.

import hashlib
import json
import os
import re
import threading
import time

try:
    import requests
except ImportError:            # only needed at generation time, not on import
    requests = None            # keeps the module importable in stdlib-only CI

API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
MODEL = os.environ.get("GRAPH_AI_MODEL", "claude-sonnet-5").strip()
CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "graph_cache.json")
# Committed seed graphs (hand-generated, no API key needed). Merged into the
# runtime cache on first load so common companies are served instantly and
# keylessly — see _merge_seed(). Shipped with the app (not gitignored).
SEED_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "graph_cache.seed.json")
TTL = 30 * 86400          # regenerate monthly — relationships move slowly
TIMEOUT = 55              # fail fast enough that a slow/unreachable provider
                          # surfaces an error well inside the client's wait
EDGE_TYPES = {"supplies", "group", "competitor", "finances", "invests"}

# Bring-your-own-key providers. Each user picks one and pastes their own key;
# the default model is used unless they override it. anthropic also backs the
# optional server key (ANTHROPIC_API_KEY).
PROVIDERS = ("anthropic", "gemini", "grok", "openai")
DEFAULT_MODELS = {
    "anthropic": MODEL,
    "gemini": "gemini-2.0-flash",
    "grok": "grok-2-latest",
    "openai": "gpt-4o-mini",
}

_lock = threading.Lock()
_cache = None             # symbol -> {"ts": epoch, "companies": {...}, "edges": [...]}
_inflight: dict = {}      # symbol -> threading.Event, so concurrent requests wait


def available() -> bool:
    return bool(API_KEY)


def _load() -> dict:
    global _cache
    if _cache is None:
        try:
            with open(CACHE_FILE) as f:
                _cache = json.load(f)
        except Exception:
            _cache = {}
        _merge_seed()
    return _cache


def _merge_seed():
    """Merge committed seed graphs into the runtime cache.

    The seed is the curated baseline for its (NIFTY-100) symbols and wins over
    stale runtime entries — including legacy ones cached on disk before the seed
    existed, which is why we can't simply skip symbols already present. A genuine
    BYOK/AI generation (marked src="ai") always wins and is preserved. Seed
    entries are versioned (a hash of the seed file) so a refreshed seed replaces
    the previous seed's copies. Kept in memory only — never written to CACHE_FILE.
    """
    try:
        with open(SEED_FILE, "rb") as f:
            raw = f.read()
        seed = json.loads(raw)
    except Exception:
        return
    ver = hashlib.md5(raw).hexdigest()[:12]
    now = int(time.time())
    for sym, g in (seed or {}).items():
        sym = str(sym).upper().strip()
        if not isinstance(g, dict):
            continue
        comps, edges = g.get("companies"), g.get("edges")
        if not (comps and edges):
            continue
        existing = _cache.get(sym)
        if existing is not None:
            ex_edges = len(existing.get("edges") or [])
            # Preserve a BYOK/AI graph only while it is at least as rich as the
            # seed — a stale sparse entry (e.g. an old AI graph cached before the
            # symbol was seeded) must not shadow the fuller curated seed.
            if existing.get("src") == "ai" and ex_edges >= len(edges):
                continue
            # An up-to-date seed copy that isn't sparser is already correct.
            if (existing.get("src") == "seed" and existing.get("ver") == ver
                    and ex_edges >= len(edges)):
                continue
            # else: legacy/no-src, stale-version, or sparser entry — refresh it.
        _cache[sym] = {"ts": now, "companies": comps, "edges": edges,
                       "src": "seed", "ver": ver}


def cached_graph(symbol: str):
    """Return a fresh cached/seeded graph for a symbol, or None. No key needed."""
    symbol = symbol.upper().strip()
    with _lock:
        c = _load().get(symbol)
    if c and time.time() - c.get("ts", 0) < TTL:
        return {"companies": c["companies"], "edges": c["edges"]}
    return None


def _save():
    try:
        with open(CACHE_FILE + ".tmp", "w") as f:
            json.dump(_cache, f)
        os.replace(CACHE_FILE + ".tmp", CACHE_FILE)
    except Exception:
        pass


PROMPT = """You are an equity analyst mapping business relationships for an Indian-markets terminal.

Produce the business-relationship graph for the Indian listed company with NSE symbol "%s".

Return ONLY a JSON object, no prose, exactly this shape:
{"companies": {"<ID>": {"name": "<full name>", "listed": true|false}, ...},
 "edges": [{"src": "<ID>", "dst": "<ID>", "type": "supplies|group|competitor|finances",
            "note": "<short factual note>", "confidence": "high|medium|low"}, ...]}

Rules:
- Include the centre company "%s" itself plus 8-16 genuinely related companies:
  its major suppliers, customers / demand drivers, financiers, listed competitors,
  and group/parent companies.
- IDs: use the exact NSE trading symbol for listed companies (listed: true);
  short uppercase identifiers for unlisted entities (listed: false).
- type semantics: "supplies" means src supplies goods/services to dst;
  "finances" means src finances dst or dst's customers; "group" = same
  promoter group / parent-subsidiary; "competitor" = direct competitor;
  "invests" means src holds an equity stake in dst (investor → investee) —
  include the centre's major shareholders (promoter/holding company, notable
  institutions like LIC/GIC, foreign parents, government for PSUs) and any
  listed companies the centre itself holds a strategic stake in.
- Every edge endpoint must exist in companies. No self-edges.
- notes: <= 90 characters, concrete and factual (what is supplied / the nature
  of the tie). confidence reflects how well-established the relationship is.
- Only include relationships you are reasonably confident actually exist."""


def _extract_json(text: str) -> dict:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("no JSON in model output")
    return json.loads(m.group(0))


def _validate(symbol: str, data: dict) -> dict:
    companies, edges = {}, []
    for k, v in (data.get("companies") or {}).items():
        k = re.sub(r"[^A-Z0-9&-]", "", str(k).upper())[:20]
        if not k or not isinstance(v, dict):
            continue
        companies[k] = {"name": str(v.get("name") or k)[:90], "listed": bool(v.get("listed"))}
    for e in data.get("edges") or []:
        if not isinstance(e, dict):
            continue
        src = re.sub(r"[^A-Z0-9&-]", "", str(e.get("src", "")).upper())[:20]
        dst = re.sub(r"[^A-Z0-9&-]", "", str(e.get("dst", "")).upper())[:20]
        etype = e.get("type")
        if src not in companies or dst not in companies or src == dst or etype not in EDGE_TYPES:
            continue
        conf = e.get("confidence")
        edges.append({
            "src": src, "dst": dst, "type": etype,
            "note": str(e.get("note") or "")[:120],
            "confidence": conf if conf in ("high", "medium", "low") else "medium",
        })
    if symbol not in companies:
        raise ValueError("centre company missing from AI graph")
    if len(edges) < 2:
        raise ValueError("AI graph too sparse (%d edges)" % len(edges))
    return {"companies": companies, "edges": edges}


def _call_anthropic(key: str, model: str, prompt: str) -> str:
    r = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                 "content-type": "application/json"},
        json={"model": model, "max_tokens": 2000,
              "messages": [{"role": "user", "content": prompt}]},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    return "".join(b.get("text", "") for b in r.json().get("content", [])
                   if b.get("type") == "text")


def _call_openai_compat(base_url: str, key: str, model: str, prompt: str) -> str:
    # OpenAI Chat Completions shape — also used by xAI Grok (api.x.ai).
    r = requests.post(
        base_url,
        headers={"authorization": "Bearer " + key, "content-type": "application/json"},
        json={"model": model, "max_tokens": 2000,
              "messages": [{"role": "user", "content": prompt}]},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


def _call_gemini(key: str, model: str, prompt: str) -> str:
    r = requests.post(
        "https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent" % model,
        headers={"content-type": "application/json", "x-goog-api-key": key},
        json={"contents": [{"parts": [{"text": prompt}]}]},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    cands = r.json().get("candidates") or []
    parts = (cands[0].get("content", {}).get("parts", []) if cands else [])
    return "".join(p.get("text", "") for p in parts)


def _generate(symbol: str, api_key: str = "", provider: str = "", model: str = "",
              context: str = "") -> dict:
    provider = (provider or "anthropic").strip().lower()
    if provider not in PROVIDERS:
        provider = "anthropic"
    # anthropic can fall back to the server key; other providers are BYOK only.
    key = (api_key or (API_KEY if provider == "anthropic" else "")).strip()
    if not key:
        raise RuntimeError("no API key")
    if requests is None:
        raise RuntimeError("requests library unavailable")
    model = (model or DEFAULT_MODELS[provider]).strip()
    prompt = PROMPT % (symbol, symbol)
    # Ground the model with the company's real identity (name/industry/sector)
    # so lesser-known small-caps still map to their actual business relationships
    # instead of coming back empty.
    if context:
        prompt += ("\n\nKnown facts about %s — use these to identify its REAL "
                   "suppliers, customers, competitors and group companies: %s"
                   % (symbol, context[:300]))
    if provider == "gemini":
        text = _call_gemini(key, model, prompt)
    elif provider == "grok":
        text = _call_openai_compat("https://api.x.ai/v1/chat/completions", key, model, prompt)
    elif provider == "openai":
        text = _call_openai_compat("https://api.openai.com/v1/chat/completions", key, model, prompt)
    else:
        text = _call_anthropic(key, model, prompt)
    return _validate(symbol, _extract_json(text))


def get_graph(symbol: str, api_key: str = "", provider: str = "", model: str = "",
              context: str = "") -> dict:
    """Cached AI graph for a symbol. Raises on generation/validation failure.

    `api_key`/`provider`/`model` let a caller bring its own key (BYOK) for any
    supported provider (anthropic, gemini, grok, openai) — used when no server
    key is configured, or to spend the user's own tokens. The cached result is
    keyed only by symbol (the graph content isn't provider-specific), so a graph
    one user generates benefits everyone.
    """
    symbol = symbol.upper().strip()
    with _lock:
        cache = _load()
        c = cache.get(symbol)
        if c and time.time() - c.get("ts", 0) < TTL:
            return {"companies": c["companies"], "edges": c["edges"]}
        ev = _inflight.get(symbol)
        if ev is None:
            ev = _inflight[symbol] = threading.Event()
            owner = True
        else:
            owner = False
    if not owner:
        # another request is already generating this symbol — wait for it
        ev.wait(TIMEOUT + 5)
        with _lock:
            c = _load().get(symbol)
        if c:
            return {"companies": c["companies"], "edges": c["edges"]}
        # The owner's generation didn't produce a usable graph — treat like a
        # sparse result (caller falls back to the company workspace).
        raise ValueError("graph generation failed")
    try:
        g = _generate(symbol, api_key, provider, model, context)
        with _lock:
            _cache[symbol] = {"ts": int(time.time()), "src": "ai", **g}
            _save()
        return g
    finally:
        with _lock:
            _inflight.pop(symbol, None)
        ev.set()
