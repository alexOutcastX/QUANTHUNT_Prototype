"""Track record — every trade the engines recommended, marked to market.

The paper-trade tracker is a personal scoreboard: it only holds the setups a
user chose to tap. This module is the other half — an append-only ledger of
what the ENGINES actually called, recorded server-side at the moment of the
call so it cannot be curated after the fact:

  • reco        — every BUY that recommend.analyze() emits
  • momentum    — the strongest setups from each completed momentum sweep
  • multibagger — the highest analyser scores from each completed screen

Each entry stores the trade exactly as it was published (entry, stop, target,
strategy label, rationale) plus the date. A mark-to-market pass then decides
the outcome: target reached → won, stop taken out → lost, horizon elapsed →
closed at whatever the market was. Nothing is invented — sources that publish
no stop (momentum, multibagger) keep a NULL stop and simply run to target or
horizon.

Stdlib only, so the whole thing is unit-testable without a network or a
broker. Simulated throughout — no orders are ever placed.
"""
from __future__ import annotations

import json
import logging
import threading
import time

import store

log = logging.getLogger("tradelog")

DAY = 86400

# Notional size per trade, so the ledger can report money and not just
# percentages. Every trade is the same size — this is a track record, not a
# portfolio, and equal weighting is the only weighting that can't flatter it.
NOTIONAL = 100000.0

SOURCES = ("reco", "momentum", "multibagger")
SOURCE_LABEL = {
    "reco": "Recommendations",
    "momentum": "Momentum",
    "multibagger": "Multibagger",
}

# How long each kind of call gets before it is closed at the market. A momentum
# setup that hasn't worked in seven weeks has failed; a multibagger thesis is
# judged over a year.
HORIZON = {"reco": 60, "momentum": 45, "multibagger": 365}

# Recording bars. Published in the API response so the page can state them —
# a track record with a silent cut is not a track record.
MOM_MIN_SCORE = 60
MOM_TOP = 25
MB_TOP = 25

SETUP_STRATEGY = {
    "fired": "Breakout fired",
    "breakout": "Breakout watch",
    "pullback": "Pullback reversal",
}

MARK_INTERVAL = 900        # don't re-mark more than every 15 minutes
_MARK_CHUNK = 40           # symbols per quote batch

_lock = threading.Lock()
_thread = None
_last_mark = 0.0


# ── helpers ──────────────────────────────────────────────────────────────────
def _num(v):
    try:
        f = float(v)
        return f if f == f and f not in (float("inf"), float("-inf")) else None
    except (TypeError, ValueError):
        return None


def _loads(raw, fallback):
    try:
        v = json.loads(raw) if raw else fallback
        return v if isinstance(v, type(fallback)) else fallback
    except (TypeError, ValueError):
        return fallback


def pnl_pct(entry, price, side="long"):
    """P/L% of a position at a price, respecting side."""
    e, p = _num(entry), _num(price)
    if not e or p is None:
        return None
    raw = (p - e) / e * 100
    return round(-raw if side == "short" else raw, 2)


# ── recording ────────────────────────────────────────────────────────────────
def _open_symbols(source: str) -> set:
    rows = store.query("SELECT symbol FROM tradelog WHERE source=? AND status='open'",
                       (source,))
    return {r["symbol"] for r in rows}


def record(source: str, picks: list, now: float = None) -> int:
    """Append picks to the ledger. One OPEN trade per (source, symbol) — a name
    that is recommended again while its earlier call is still live does not get
    a second row, so a repeatedly-shown pick can't pad the record. Returns the
    number of trades actually opened."""
    if source not in SOURCES or not picks:
        return 0
    now = int(now if now is not None else time.time())
    have = _open_symbols(source)
    added = 0
    for p in picks:
        sym = str(p.get("symbol") or "").strip().upper()
        entry = _num(p.get("entry"))
        if not sym or not entry or entry <= 0 or sym in have:
            continue
        have.add(sym)
        store.execute(
            "INSERT INTO tradelog (source, symbol, name, side, strategy, entry, stop, "
            "target, horizon_days, opened, status, last, marked, rationale, meta) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,'open',?,?,?,?)",
            (source, sym, p.get("name") or None, p.get("side") or "long",
             p.get("strategy") or None, entry, _num(p.get("stop")), _num(p.get("target")),
             int(p.get("horizon_days") or HORIZON.get(source, 60)), now, entry, now,
             json.dumps([str(x) for x in (p.get("rationale") or [])]),
             json.dumps(p.get("meta") or {})),
        )
        added += 1
    if added:
        log.info("tradelog: recorded %d new %s trade(s)", added, source)
    return added


def record_reco(rec: dict) -> int:
    """Log a recommendation the engine just published. Only actionable BUY calls
    enter the record — WATCH and AVOID are opinions, not trades."""
    if not isinstance(rec, dict) or rec.get("action") != "BUY":
        return 0
    eta = _num(rec.get("eta_days"))
    # eta_days counts trading days; the horizon is wall-clock, hence ~1.4×.
    horizon = max(21, min(180, round(eta * 1.4))) if eta else HORIZON["reco"]
    conf = rec.get("confidence")
    return record("reco", [{
        "symbol": rec.get("symbol"),
        "name": rec.get("name"),
        "side": "long",
        "strategy": f"BUY · {conf}% confidence" if conf is not None else "BUY",
        "entry": rec.get("entry") if rec.get("entry") is not None else rec.get("price"),
        "stop": rec.get("stop"),
        "target": rec.get("target"),
        "horizon_days": horizon,
        "rationale": rec.get("rationale") or [],
        "meta": {k: rec.get(k) for k in
                 ("confidence", "fundamental_score", "momentum_score", "pattern_score",
                  "pattern", "rr", "upside_pct", "eta") if rec.get(k) is not None},
    }])


def record_momentum(results: list) -> int:
    """Log the strongest setups from a completed momentum sweep. The radar
    surfaces every qualifying setup in the whole universe; only the top
    MOM_TOP scoring MOM_MIN_SCORE+ are treated as calls."""
    strong = sorted([r for r in (results or []) if (_num(r.get("score")) or 0) >= MOM_MIN_SCORE],
                    key=lambda r: -(_num(r.get("score")) or 0))[:MOM_TOP]
    picks = []
    for r in strong:
        picks.append({
            "symbol": r.get("symbol"),
            "name": r.get("name"),
            "side": "long",
            "strategy": SETUP_STRATEGY.get(r.get("setup"), "Momentum setup"),
            "entry": r.get("price"),
            "stop": None,          # the radar publishes no stop — don't invent one
            "target": r.get("target"),
            "rationale": (r.get("signals") or [])[:6],
            "meta": {k: r.get(k) for k in
                     ("score", "probability", "setup", "rsi", "relvol", "upside_pct",
                      "exchange") if r.get(k) is not None},
        })
    return record("momentum", picks)


def record_multibagger(results: list) -> int:
    """Log the best analyser scores from a completed multibagger screen. These
    are fundamental theses, not trade setups: no stop, no target, judged over a
    year of holding."""
    best = sorted([r for r in (results or []) if _num(r.get("price"))],
                  key=lambda r: -(_num(r.get("score")) or 0))[:MB_TOP]
    picks = []
    for r in best:
        tier = r.get("tier")
        score = r.get("score")
        picks.append({
            "symbol": r.get("symbol"),
            "name": r.get("name"),
            "side": "long",
            "strategy": (f"Analyser {score}/100" + (f" · {tier}" if tier else "")),
            "entry": r.get("price"),
            "stop": None,
            "target": None,        # a compounding thesis has no price objective
            "rationale": _mb_rationale(r),
            "meta": {k: r.get(k) for k in
                     ("score", "tier", "probability_pct", "coverage_pct", "roe",
                      "debt_equity", "market_cap_cr", "sector") if r.get(k) is not None},
        })
    return record("multibagger", picks)


def _mb_rationale(r: dict) -> list:
    """Why the screen picked this one, from the numbers it already scored."""
    out = []
    score, tier = r.get("score"), r.get("tier")
    if score is not None:
        out.append(f"Analyser score {score}/100" + (f" — {tier}" if tier else ""))
    roe = _num(r.get("roe"))
    if roe is not None:
        out.append(f"Return on equity {roe:.1f}%")
    de = _num(r.get("debt_equity"))
    if de is not None:
        out.append(f"Debt/equity {de:.2f}" + (" — effectively debt-free" if de < 0.25 else ""))
    v200 = _num(r.get("vs_200dma"))
    if v200 is not None:
        out.append(f"{abs(v200):.1f}% {'above' if v200 >= 0 else 'below'} the 200-DMA")
    cov = _num(r.get("coverage_pct"))
    if cov is not None:
        out.append(f"Scored on {cov:.0f}% data coverage")
    if r.get("sector"):
        out.append(f"Sector — {r['sector']}")
    return out


# ── mark to market ───────────────────────────────────────────────────────────
def open_symbols() -> list:
    rows = store.query("SELECT DISTINCT symbol FROM tradelog WHERE status='open'")
    return [r["symbol"] for r in rows]


def reconcile(prices: dict, now: float = None) -> dict:
    """Mark every open trade against a {symbol: price} map and settle the ones
    that resolved. Target reached → won at the target. Stop taken out → lost at
    the stop. Horizon elapsed → closed at the market. Everything else keeps
    running with a fresh mark."""
    now = int(now if now is not None else time.time())
    rows = store.query("SELECT * FROM tradelog WHERE status='open'")
    won = lost = closed = marked = 0
    for r in rows:
        px = _num((prices or {}).get(r["symbol"]))
        if px is None:
            continue
        side = r["side"] or "long"
        tgt, stp = _num(r["target"]), _num(r["stop"])
        hit_tgt = tgt is not None and (px <= tgt if side == "short" else px >= tgt)
        hit_stp = stp is not None and (px >= stp if side == "short" else px <= stp)
        horizon = int(r["horizon_days"] or HORIZON.get(r["source"], 60))
        expired = (now - int(r["opened"])) >= horizon * DAY

        if hit_tgt:
            _settle(r["id"], "won", tgt, now)
            won += 1
        elif hit_stp:
            _settle(r["id"], "lost", stp, now)
            lost += 1
        elif expired:
            _settle(r["id"], "closed", px, now)
            closed += 1
        else:
            store.execute("UPDATE tradelog SET last=?, marked=? WHERE id=?", (px, now, r["id"]))
            marked += 1
    return {"won": won, "lost": lost, "closed": closed, "marked": marked,
            "open": len(rows), "priced": len([1 for r in rows if _num((prices or {}).get(r["symbol"])) is not None])}


def _settle(trade_id: int, status: str, exit_px, when: int) -> None:
    store.execute(
        "UPDATE tradelog SET status=?, exit=?, closed=?, last=?, marked=? WHERE id=?",
        (status, exit_px, when, exit_px, when, trade_id))


def ensure_marked(price_fn, force: bool = False) -> bool:
    """Kick a background mark-to-market pass if the ledger has gone stale.
    Returns True when a pass was started. Never blocks the caller — the page
    reads whatever the last pass left behind, and the next poll sees fresher
    numbers."""
    global _thread, _last_mark
    with _lock:
        if _thread is not None:
            return False
        if not force and (time.time() - _last_mark) < MARK_INTERVAL:
            return False
        _thread = threading.Thread(target=_mark_run, args=(price_fn,),
                                   name="tradelog-mark", daemon=True)
        _thread.start()
        return True


def _mark_run(price_fn) -> None:
    global _thread, _last_mark
    try:
        syms = open_symbols()
        prices = {}
        for i in range(0, len(syms), _MARK_CHUNK):
            chunk = syms[i:i + _MARK_CHUNK]
            try:
                prices.update(price_fn(chunk) or {})
            except Exception as e:
                log.warning("tradelog mark: quote batch failed (%s)", e)
        res = reconcile(prices)
        log.info("tradelog marked: %s", res)
    except Exception as e:
        log.error("tradelog mark failed: %s", e)
    finally:
        with _lock:
            _last_mark = time.time()
            _thread = None


# ── reading ──────────────────────────────────────────────────────────────────
def _row(r: dict, now: int) -> dict:
    """One ledger row, with the derived numbers the page shows."""
    side = r["side"] or "long"
    entry = _num(r["entry"])
    settled = r["status"] != "open"
    mark = _num(r["exit"]) if settled else _num(r["last"])
    pl = pnl_pct(entry, mark, side)
    end = int(r["closed"] or now) if settled else now
    held = max(0, (end - int(r["opened"])) // DAY)
    return {
        "id": r["id"],
        "source": r["source"],
        "source_label": SOURCE_LABEL.get(r["source"], r["source"]),
        "symbol": r["symbol"],
        "name": r["name"],
        "side": side,
        "strategy": r["strategy"],
        "entry": entry,
        "stop": _num(r["stop"]),
        "target": _num(r["target"]),
        "exit": _num(r["exit"]),
        "last": _num(r["last"]),
        "price": mark,
        "status": r["status"],
        "opened": int(r["opened"]),
        "closed": int(r["closed"]) if r["closed"] else None,
        "marked": int(r["marked"]) if r["marked"] else None,
        "horizon_days": int(r["horizon_days"] or 0),
        "hold_days": held,
        "pl_pct": pl,
        "pl_amt": round(NOTIONAL * pl / 100, 2) if pl is not None else None,
        "rationale": _loads(r["rationale"], []),
        "meta": _loads(r["meta"], {}),
    }


def summary(rows: list) -> dict:
    """Aggregate the record. Win rate counts only settled trades — an open
    position is not yet a result."""
    settled = [t for t in rows if t["status"] != "open"]
    wins = [t for t in settled if (t["pl_pct"] or 0) > 0]
    losses = [t for t in settled if (t["pl_pct"] or 0) < 0]
    pls = [t["pl_pct"] for t in settled if t["pl_pct"] is not None]
    open_pls = [t["pl_pct"] for t in rows if t["status"] == "open" and t["pl_pct"] is not None]
    holds = [t["hold_days"] for t in settled]
    best = max(settled, key=lambda t: t["pl_pct"] or 0) if pls else None
    worst = min(settled, key=lambda t: t["pl_pct"] or 0) if pls else None
    return {
        "total": len(rows),
        "open": len(rows) - len(settled),
        "settled": len(settled),
        "won": len([t for t in settled if t["status"] == "won"]),
        "lost": len([t for t in settled if t["status"] == "lost"]),
        "closed": len([t for t in settled if t["status"] == "closed"]),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": round(len(wins) / len(settled) * 100, 1) if settled else None,
        "avg_pl_pct": round(sum(pls) / len(pls), 2) if pls else None,
        "total_pl_amt": round(sum(t["pl_amt"] or 0 for t in settled), 2) if settled else 0.0,
        "open_pl_amt": round(sum(t["pl_amt"] or 0 for t in rows if t["status"] == "open"), 2),
        "open_avg_pl_pct": round(sum(open_pls) / len(open_pls), 2) if open_pls else None,
        "avg_hold_days": round(sum(holds) / len(holds)) if holds else None,
        "best": {"symbol": best["symbol"], "pl_pct": best["pl_pct"]} if best else None,
        "worst": {"symbol": worst["symbol"], "pl_pct": worst["pl_pct"]} if worst else None,
        "notional": NOTIONAL,
    }


def ledger(source: str = None, status: str = None, limit: int = 500) -> dict:
    """The record, newest first. `source` filters to one engine; `status` to
    open/won/lost/closed. The summary always covers the same filtered set."""
    sql = "SELECT * FROM tradelog"
    where, params = [], []
    if source in SOURCES:
        where.append("source=?")
        params.append(source)
    if status in ("open", "won", "lost", "closed"):
        where.append("status=?")
        params.append(status)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY opened DESC, id DESC LIMIT ?"
    params.append(max(1, min(2000, int(limit or 500))))

    now = int(time.time())
    rows = [_row(r, now) for r in store.query(sql, tuple(params))]
    by_source = {}
    for r in store.query("SELECT source, COUNT(*) n FROM tradelog GROUP BY source"):
        by_source[r["source"]] = r["n"]
    return {
        "trades": rows,
        "summary": summary(rows),
        "by_source": by_source,
        "marked_at": _last_mark or None,
        "rules": {
            "notional": NOTIONAL,
            "horizon_days": HORIZON,
            "momentum_min_score": MOM_MIN_SCORE,
            "momentum_top": MOM_TOP,
            "multibagger_top": MB_TOP,
        },
    }
