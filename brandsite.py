# The public, no-login side of TaurEye: landing, About and Insights.
#
# Ported from the previous app (alexOutcastX/TaurEye), which was Vite + React
# DOM. This app is React Native rendering to RN-web, so those pages could not be
# dropped in — RN has no DOM, and the landing leaned on react-router, three.js
# and plain CSS. Rebuilding them as React Native screens would have lost the
# design and gained nothing: marketing pages are documents, not app screens.
#
# So they are served as server-rendered HTML instead, reusing the original
# brand assets and palette. That keeps the design, makes the pages indexable by
# search engines (an RN-web SPA is not), and costs one template render rather
# than a JavaScript bundle.
#
# Articles are the real content from the old app, exported to brand/articles.json.
# Bodies are the same lightweight Markdown the previous site used, rendered here
# rather than in the browser.

import html
import json
import os
import re

BRAND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "brand")
IMG_DIR = os.path.join(BRAND_DIR, "img")

TAGLINE = "Watch. Analyze. Trade."
ENTITY = "TaurEye"
SUPPORT_EMAIL = "support@taureye.com"

# Ported verbatim from the previous site — these are legally meaningful
# documents, so the wording was converted mechanically rather than rewritten.
LEGAL_DOCS = [
    ("terms", "Terms of Service"),
    ("privacy", "Privacy Policy"),
    ("cookies", "Cookie Policy"),
    ("refund", "Refund & Cancellation"),
    ("disclaimer", "Disclaimer"),
]
LEGAL_EFFECTIVE = "14 June 2026"

_legal_cache = None


def legal_docs():
    global _legal_cache
    if _legal_cache is None:
        try:
            with open(os.path.join(BRAND_DIR, "legal.json"), encoding="utf-8") as fh:
                _legal_cache = json.load(fh)
        except (OSError, ValueError):
            _legal_cache = {}
    return _legal_cache

_articles_cache = None


def articles():
    """Every article, newest first. Cached — the file never changes at runtime."""
    global _articles_cache
    if _articles_cache is None:
        try:
            with open(os.path.join(BRAND_DIR, "articles.json"), encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            data = []
        _articles_cache = sorted(data, key=lambda a: a.get("date", ""), reverse=True)
    return _articles_cache


def article(slug):
    for a in articles():
        if a.get("slug") == slug:
            return a
    return None


# ── markdown ────────────────────────────────────────────────────────────────
# A deliberately small subset — headings, bold, italic, inline code, links,
# lists, blockquotes and paragraphs — matching what the article bodies actually
# use. Everything is escaped BEFORE any markup is introduced, so article text
# can never inject HTML.

def _inline(text):
    out = html.escape(text)
    out = re.sub(r"`([^`]+)`", r"<code>\1</code>", out)
    out = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", out)
    out = re.sub(r"(?<![*\w])\*([^*]+)\*(?!\w)", r"<em>\1</em>", out)
    # [label](href) — only http(s) and site-relative targets, so a crafted body
    # cannot smuggle in javascript: or data: URLs.
    def _link(m):
        label, href = m.group(1), m.group(2)
        if not re.match(r"^(https?://|/)", href):
            return label
        rel = ' target="_blank" rel="noopener noreferrer"' if href.startswith("http") else ""
        return f'<a href="{href}"{rel}>{label}</a>'
    return re.sub(r"\[([^\]]+)\]\(([^)]+)\)", _link, out)


def markdown(md):
    lines = (md or "").split("\n")
    out, para, list_items, in_quote = [], [], [], []

    def flush_para():
        if para:
            out.append("<p>" + _inline(" ".join(para)) + "</p>")
            para.clear()

    def flush_list():
        if list_items:
            out.append("<ul>" + "".join(f"<li>{_inline(i)}</li>" for i in list_items) + "</ul>")
            list_items.clear()

    def flush_quote():
        if in_quote:
            out.append("<blockquote>" + _inline(" ".join(in_quote)) + "</blockquote>")
            in_quote.clear()

    def flush_all():
        flush_para(); flush_list(); flush_quote()

    for raw in lines:
        line = raw.rstrip()
        if not line.strip():
            flush_all()
            continue
        h = re.match(r"^(#{1,4})\s+(.*)$", line)
        if h:
            flush_all()
            level = min(len(h.group(1)) + 1, 5)   # '#' in a body is an h2 on the page
            out.append(f"<h{level}>{_inline(h.group(2))}</h{level}>")
            continue
        li = re.match(r"^[-*]\s+(.*)$", line)
        if li:
            flush_para(); flush_quote()
            list_items.append(li.group(1))
            continue
        q = re.match(r"^>\s?(.*)$", line)
        if q:
            flush_para(); flush_list()
            in_quote.append(q.group(1))
            continue
        flush_list(); flush_quote()
        para.append(line.strip())

    flush_all()
    return "".join(out)


# ── page chrome ─────────────────────────────────────────────────────────────
CSS = """
:root{--bg:#0a0c0f;--surface:#11141a;--surface-2:#161a22;--border:#232a35;
--text:#e7eaef;--muted:#9aa4b2;--faint:#5e6776;--brand:#5aa86a;--brand-2:#8fd39b;
--up:#18c98c;--r:14px;--max:1120px}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:var(--text);
font-family:"Inter","Segoe UI",system-ui,-apple-system,sans-serif;
-webkit-font-smoothing:antialiased;line-height:1.6}
a{color:inherit;text-decoration:none}
img{max-width:100%;display:block}
.wrap{max-width:var(--max);margin:0 auto;padding:0 20px}
.nav{position:sticky;top:0;z-index:20;background:rgba(10,12,15,.86);
backdrop-filter:blur(10px);border-bottom:1px solid var(--border)}
.nav .wrap{display:flex;align-items:center;justify-content:space-between;
gap:16px;height:64px}
.brand{display:flex;align-items:center;gap:10px}
.brand img.mark{height:34px;width:auto}
.brand img.word{height:22px;width:auto}
.nav nav{display:flex;gap:22px;align-items:center;font-size:14px;color:var(--muted);
flex-wrap:wrap}
.nav nav a:hover{color:var(--text)}
.btn{display:inline-block;padding:9px 18px;border-radius:999px;font-weight:700;
font-size:14px;border:1px solid var(--border);color:var(--text)}
.btn-primary{background:linear-gradient(135deg,var(--brand),var(--brand-2));
color:#07120b;border-color:transparent}
.btn:hover{filter:brightness(1.08)}
.hero{padding:64px 0 48px;border-bottom:1px solid var(--border)}
.hero .wrap{display:grid;grid-template-columns:1.15fr .85fr;gap:40px;align-items:center}
.hero h1{font-size:clamp(32px,5vw,54px);line-height:1.1;margin:0 0 16px;
letter-spacing:-1px;font-weight:800}
.hero h1 .g{background:linear-gradient(135deg,var(--brand),var(--brand-2));
-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p{font-size:17px;color:var(--muted);margin:0 0 26px;max-width:52ch}
.cta{display:flex;gap:12px;flex-wrap:wrap}
.tag{display:inline-block;font-size:11px;letter-spacing:2.4px;text-transform:uppercase;
color:var(--brand-2);margin-bottom:14px;font-weight:700}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:18px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);
padding:22px}
.card h3{margin:0 0 8px;font-size:16px}
.card p{margin:0;color:var(--muted);font-size:14px}
section{padding:56px 0}
section h2{font-size:clamp(24px,3.4vw,34px);margin:0 0 10px;letter-spacing:-.5px}
.lead{color:var(--muted);font-size:16px;margin:0 0 28px;max-width:70ch}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:18px}
.stat{background:var(--surface-2);border:1px solid var(--border);border-radius:var(--r);
padding:18px}
.stat b{display:block;font-size:26px;color:var(--brand-2)}
.stat span{color:var(--muted);font-size:13px}
.post{display:block;background:var(--surface);border:1px solid var(--border);
border-radius:var(--r);padding:20px;margin-bottom:14px}
.post:hover{border-color:var(--brand)}
.cat{font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:var(--brand-2);
font-weight:700}
.post h3{margin:6px 0 6px;font-size:18px}
.post p{margin:0 0 8px;color:var(--muted);font-size:14px}
.meta{color:var(--faint);font-size:12px}
article.body{max-width:74ch}
article.body h2{font-size:24px;margin:30px 0 8px}
article.body h3{font-size:18px;margin:22px 0 6px}
article.body p{margin:0 0 14px}
article.body ul{margin:0 0 16px;padding-left:20px;color:var(--text)}
article.body li{margin:5px 0}
article.body blockquote{margin:0 0 16px;padding:12px 16px;border-left:3px solid var(--brand);
background:var(--surface);color:var(--muted);border-radius:0 8px 8px 0}
article.body code{background:var(--surface-2);padding:2px 6px;border-radius:5px;
font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:13px}
.foot{border-top:1px solid var(--border);padding:34px 0;color:var(--faint);font-size:13px}
.foot .wrap{display:flex;flex-direction:column;gap:10px}
.foot a{color:var(--muted)}
.disc{font-size:12px;line-height:1.6;max-width:80ch}
.auth{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);
padding:24px;max-width:400px}
.auth h3{margin:0 0 4px;font-size:20px}
.auth-sub{margin:0 0 18px;color:var(--muted);font-size:13px}
.fl{display:block;margin-bottom:12px}
.fl span{display:block;font-size:12px;color:var(--muted);margin-bottom:5px}
.fl input{width:100%;background:var(--surface-2);border:1px solid var(--border);
border-radius:9px;color:var(--text);font-size:15px;padding:11px 12px;font-family:inherit}
.fl input:focus{outline:none;border-color:var(--brand)}
.btn.wide{width:100%;text-align:center;padding:12px;border:none;cursor:pointer;
font-family:inherit;font-size:15px}
.auth-err{color:#f0506e;font-size:13px;margin:0 0 10px;min-height:0}
.sep{display:flex;align-items:center;gap:12px;margin:18px 0;color:var(--faint);font-size:12px}
.sep:before,.sep:after{content:"";flex:1;height:1px;background:var(--border)}
.socials{display:flex;flex-direction:column;gap:9px}
.soc{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;
padding:11px;border:1px solid var(--border);border-radius:9px;background:var(--surface-2);
color:var(--text);font-size:14px;font-weight:600;font-family:inherit;cursor:pointer}
.soc:hover:not(:disabled){border-color:var(--brand)}
.soc:disabled{opacity:.45;cursor:not-allowed}
.soc-i{width:20px;height:20px;border-radius:50%;background:var(--border);
display:grid;place-items:center;font-size:11px;font-weight:800}
.soc-note{color:var(--faint);font-size:11.5px;margin:10px 0 0;text-align:center}
.auth-fine{color:var(--faint);font-size:11.5px;margin:16px 0 0;line-height:1.5}
.auth-fine a{color:var(--muted);text-decoration:underline}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 26px}
.tabs a{padding:7px 14px;border:1px solid var(--border);border-radius:999px;
font-size:13px;color:var(--muted)}
.tabs a.on{background:var(--surface-2);color:var(--text);border-color:var(--brand)}
.legal h2{font-size:19px;margin:26px 0 8px}
.legal p{margin:0 0 12px;color:var(--text)}
.legal ul{margin:0 0 14px;padding-left:20px}
.legal li{margin:5px 0}
.legal strong{color:var(--text)}
@media(max-width:820px){.hero .wrap{grid-template-columns:1fr}.hero .art{order:-1}}
"""


def _nav(active=""):
    def link(href, label):
        style = ' style="color:var(--text)"' if active == label.lower() else ""
        return f'<a href="{href}"{style}>{label}</a>'
    return (
        '<header class="nav"><div class="wrap">'
        '<a class="brand" href="/site">'
        '<img class="mark" src="/brand/logo.png" alt="TaurEye">'
        '<img class="word" src="/brand/wordmark.png" alt="TaurEye">'
        '</a>'
        '<nav>'
        + link("/site/insights", "Insights")
        + link("/site/about", "About")
        + link("/site/tutorial", "Guide")
        + link("/site/contact", "Contact")
        + '<a class="btn btn-primary" href="/site#signin">Sign in</a>'
        '</nav></div></header>'
    )


def _foot():
    docs = " · ".join(
        f'<a href="/site/legal/{k}">{t}</a>' for k, t in LEGAL_DOCS)
    return (
        '<footer class="foot"><div class="wrap">'
        f'<span>© 2026 {ENTITY} · {TAGLINE}</span>'
        '<span><a href="/site/about">About</a> · <a href="/site/insights">Insights</a>'
        ' · <a href="/site/tutorial">Guide</a> · <a href="/site/contact">Contact</a></span>'
        f'<span>{docs}</span>'
        '<span class="disc">Educational and informational content only — not investment '
        'advice. TaurEye is not a SEBI-registered investment adviser or research analyst. '
        'Market data is sourced from public feeds and may be delayed. Always do your own '
        'research and consider your risk before acting.</span>'
        '</div></footer>'
    )


# ── sign-in panel ───────────────────────────────────────────────────────────
# The landing's primary action. Posts to the same /auth/member/login the app
# uses, so there is exactly one credential path rather than a second one that
# drifts.
#
# Social buttons render from the integrations registry: when a provider has no
# credentials on the server the button is DISABLED and says why, rather than
# sending someone to a provider that will refuse them. That honesty is the whole
# reason the registry exists.
SOCIALS = [("google", "Google"), ("apple", "Apple")]


def _social_buttons():
    try:
        import integrations as _integ
        ready = {k: _integ.configured(k + "_oauth") if k != "google"
                 else _integ.configured("google_oauth") for k, _ in SOCIALS}
    except Exception:
        ready = {k: False for k, _ in SOCIALS}

    out = []
    for key, label in SOCIALS:
        on = ready.get(key, False)
        if on:
            out.append(f'<a class="soc" href="/auth/oauth/{key}">'
                       f'<span class="soc-i">{label[0]}</span>Continue with {label}</a>')
        else:
            out.append(f'<button class="soc" disabled title="{label} sign-in is not '
                       f'connected yet"><span class="soc-i">{label[0]}</span>'
                       f'Continue with {label}</button>')
    note = ("" if any(ready.values()) else
            '<p class="soc-note">Social sign-in is not connected yet — '
            'use your username and password.</p>')
    return '<div class="socials">' + "".join(out) + "</div>" + note


def auth_panel():
    return f"""
<div class="auth" id="signin">
  <h3>Sign in</h3>
  <p class="auth-sub">Members only. Access is by invitation while we are in beta.</p>
  <form id="lf" autocomplete="on">
    <label class="fl"><span>Username</span>
      <input id="lu" name="username" autocomplete="username" autocapitalize="none"
             spellcheck="false" placeholder="your username" required></label>
    <label class="fl"><span>Password</span>
      <input id="lp" name="password" type="password" autocomplete="current-password"
             placeholder="••••••••" required></label>
    <p class="auth-err" id="le" role="alert"></p>
    <button class="btn btn-primary wide" type="submit" id="lb">Sign in</button>
  </form>
  <div class="sep"><span>or</span></div>
  {_social_buttons()}
  <p class="auth-fine">By signing in you agree to our
    <a href="/site/legal/terms">Terms</a> and
    <a href="/site/legal/privacy">Privacy Policy</a>.</p>
</div>
<script>
(function(){{
  var f=document.getElementById('lf'), e=document.getElementById('le'),
      b=document.getElementById('lb');
  if(!f) return;
  f.addEventListener('submit', function(ev){{
    ev.preventDefault();
    e.textContent=''; b.disabled=true; b.textContent='Signing in…';
    fetch('/auth/member/login', {{
      method:'POST', credentials:'include',
      headers:{{'Content-Type':'application/json'}},
      body: JSON.stringify({{username:document.getElementById('lu').value.trim(),
                            password:document.getElementById('lp').value}})
    }}).then(function(r){{ return r.json().then(function(j){{ return {{ok:r.ok, j:j}}; }}); }})
      .then(function(res){{
        if(res.ok){{ window.location.href='/'; return; }}
        e.textContent = res.j.detail || 'Wrong username or password.';
        b.disabled=false; b.textContent='Sign in';
      }})
      .catch(function(){{
        e.textContent='Could not reach the server. Please try again.';
        b.disabled=false; b.textContent='Sign in';
      }});
  }});
}})();
</script>"""


def page(title, body, description="", active="", og_type="website"):
    t = html.escape(title)
    d = html.escape(description or f"{ENTITY} — {TAGLINE}")
    return (
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        f"<title>{t}</title>"
        f"<meta name='description' content='{d}'>"
        f"<meta property='og:title' content='{t}'>"
        f"<meta property='og:description' content='{d}'>"
        f"<meta property='og:type' content='{og_type}'>"
        "<meta property='og:image' content='/brand/og-image.png'>"
        "<meta name='twitter:card' content='summary_large_image'>"
        "<link rel='icon' href='/brand/favicon-32.png' sizes='32x32'>"
        "<link rel='apple-touch-icon' href='/brand/apple-touch-icon.png'>"
        f"<style>{CSS}</style></head><body>"
        + _nav(active) + body + _foot() +
        "</body></html>"
    )


# ── pages ───────────────────────────────────────────────────────────────────
FEATURES = [
    ("Screen 5,800+ NSE/BSE stocks",
     "Build precise filters on price, volume, RSI, moving averages, 52-week range and "
     "more — across the whole EOD universe, instantly."),
    ("Strategy screens that you control",
     "Minervini, candlestick patterns, deep value, momentum — plus a configurable "
     "MACD + DMA screen where you set the moving average and the RSI band."),
    ("Chart patterns, drawn",
     "Rule-based detection traces necklines, channels and trendlines right on the "
     "chart — descriptive, never a buy/sell call."),
    ("Institutional dossiers",
     "Valuation against sector medians, cash flow, shareholding and promoter pledges, "
     "in one printable report per company."),
    ("Backtests with real Indian charges",
     "Brokerage, STT, exchange, SEBI, GST and stamp duty — plus slippage — so a "
     "simulated result resembles a real one."),
    ("Watchlist, portfolio and alerts",
     "Track entries with the price and date you added them, sync holdings read-only "
     "from your broker, and get alerted on price, % and RSI."),
]


def landing_html():
    feats = "".join(
        f'<div class="card"><h3>{html.escape(t)}</h3><p>{html.escape(b)}</p></div>'
        for t, b in FEATURES)
    body = f"""
<section class="hero"><div class="wrap">
  <div>
    <span class="tag">{html.escape(TAGLINE)}</span>
    <h1>The Indian market,<br><span class="g">screened properly.</span></h1>
    <p>Every listed NSE and BSE company, filtered by rules you set — technicals,
       fundamentals and chart patterns — with the evidence shown, not just a verdict.</p>
    <p style="font-size:14px"><a href="/site/insights" style="color:var(--brand-2);
       text-decoration:underline">Read the insights</a> ·
       <a href="/site/tutorial" style="color:var(--brand-2);text-decoration:underline">
       How it works</a></p>
  </div>
  {auth_panel()}
</div></section>

<section><div class="wrap" style="display:grid;grid-template-columns:1fr auto;
     gap:30px;align-items:center">
  <div><h2>What it does</h2>
  <p class="lead">Built for people who want to see why a stock made the list.</p></div>
  <img src="/brand/bull-hero.png" alt="" style="width:220px" loading="lazy">
</div>
<div class="wrap" style="margin-top:24px"><div class="grid">{feats}</div></div></section>

<section style="padding-top:0"><div class="wrap">
  <div class="stats">
    <div class="stat"><b>5,800+</b><span>NSE + BSE scrips covered</span></div>
    <div class="stat"><b>78</b><span>screener columns</span></div>
    <div class="stat"><b>22</b><span>plain-English explainers</span></div>
    <div class="stat"><b>0</b><span>buy/sell calls sold as advice</span></div>
  </div>
</div></section>

<section style="padding-top:0"><div class="wrap">
  <div class="card" style="text-align:center;padding:38px">
    <h2 style="margin-bottom:8px">Start screening</h2>
    <p class="lead" style="margin:0 auto 20px">Sign in above to run your first screen.</p>
    <a class="btn btn-primary" href="#signin">Sign in</a>
  </div>
</div></section>
"""
    return page(f"{ENTITY} — {TAGLINE}", body,
                "Screen every NSE and BSE listed company on technicals, fundamentals "
                "and chart patterns. Educational analytics, not investment advice.")


def about_html():
    body = """
<section><div class="wrap">
  <h1 style="font-size:38px;margin:0 0 10px">About TaurEye</h1>
  <p class="lead">TaurEye is a research and screening platform for the Indian equity
     market. It exists to answer one question well: which companies currently match
     the rules I care about, and what is the evidence?</p>

  <h2>What we build</h2>
  <p class="lead">A screener over the whole NSE and BSE universe, strategy screens
     based on published methods, rule-based chart-pattern detection, company dossiers
     with valuation and cash-flow context, and a backtester that charges the same
     brokerage, taxes and slippage a real trade would.</p>

  <h2>What we believe</h2>
  <div class="grid">
    <div class="card"><h3>Show the working</h3><p>A score with no explanation is a
      guess with confidence. Every screen states its rules and every report cites
      where its numbers came from.</p></div>
    <div class="card"><h3>Describe, do not prescribe</h3><p>We surface what the data
      says. Deciding what to do with it is yours — we are not a SEBI-registered
      adviser and we do not sell calls as advice.</p></div>
    <div class="card"><h3>Costs are part of the result</h3><p>A backtest that ignores
      STT, brokerage and slippage is fiction. Ours does not.</p></div>
    <div class="card"><h3>Public data, honestly labelled</h3><p>Prices and filings come
      from public sources and may be delayed. Every export says so.</p></div>
  </div>

  <h2>Important</h2>
  <p class="lead">TaurEye publishes educational and informational analytics. It is not
     investment advice, and nothing here is a recommendation to buy or sell any
     security. Markets carry risk, including loss of capital. Please do your own
     research and consider taking professional advice.</p>
</div></section>
"""
    return page(f"About — {ENTITY}", body,
                "TaurEye is a research and screening platform for the Indian equity "
                "market. Educational analytics with the working shown.", "about")


def insights_html():
    posts = "".join(
        '<a class="post" href="/site/insights/{slug}">'
        '<span class="cat">{cat}</span><h3>{title}</h3><p>{summary}</p>'
        '<span class="meta">{date} · {mins} min read</span></a>'.format(
            slug=html.escape(a.get("slug", "")),
            cat=html.escape(a.get("category", "")),
            title=html.escape(a.get("title", "")),
            summary=html.escape(a.get("summary", "")),
            date=html.escape(a.get("date", "")),
            mins=a.get("readMins", 5))
        for a in articles())
    body = f"""
<section><div class="wrap">
  <h1 style="font-size:38px;margin:0 0 10px">Insights</h1>
  <p class="lead">Plain-English explainers on screening, indicators, trading styles and
     the Indian markets. Educational only — never investment advice.</p>
  {posts or '<p class="lead">No articles yet.</p>'}
</div></section>
"""
    return page(f"Insights — {ENTITY}", body,
                "Plain-English explainers on screening, indicators and the Indian "
                "markets.", "insights")


def article_html(slug):
    a = article(slug)
    if not a:
        return None
    body = f"""
<section><div class="wrap">
  <span class="cat">{html.escape(a.get('category',''))}</span>
  <h1 style="font-size:34px;margin:8px 0 6px;max-width:24ch">{html.escape(a.get('title',''))}</h1>
  <p class="meta" style="margin-bottom:26px">{html.escape(a.get('date',''))} ·
     {a.get('readMins', 5)} min read</p>
  <article class="body">{markdown(a.get('body',''))}</article>
  <p style="margin-top:34px"><a class="btn" href="/site/insights">← All insights</a></p>
</div></section>
"""
    return page(f"{a.get('title','')} — {ENTITY}", body,
                a.get("summary", ""), "insights", og_type="article")


def legal_html(key):
    """One policy document, with a tab strip across the set."""
    titles = dict(LEGAL_DOCS)
    if key not in titles:
        return None
    body_html = legal_docs().get(key, "")
    if not body_html:
        body_html = ("<p>This document is being prepared. Please contact "
                     f"<a href='mailto:{SUPPORT_EMAIL}'>{SUPPORT_EMAIL}</a> in the "
                     "meantime.</p>")
    def _tab(k, t):
        cls = ' class="on"' if k == key else ""
        return f'<a href="/site/legal/{k}"{cls}>{html.escape(t)}</a>'
    tabs = "".join(_tab(k, t) for k, t in LEGAL_DOCS)
    body = f"""
<section><div class="wrap">
  <nav class="tabs" aria-label="Policies">{tabs}</nav>
  <h1 style="font-size:32px;margin:0 0 6px">{html.escape(titles[key])}</h1>
  <p class="meta" style="margin-bottom:26px">{ENTITY} · Last updated {LEGAL_EFFECTIVE}</p>
  <div class="legal" style="max-width:78ch">{body_html}</div>
  <p class="meta" style="margin-top:28px">Questions or grievances? Contact
     <a href="mailto:{SUPPORT_EMAIL}" style="color:var(--brand-2)">{SUPPORT_EMAIL}</a>.</p>
</div></section>
"""
    return page(f"{titles[key]} — {ENTITY}", body,
                f"{titles[key]} for {ENTITY}.")


def contact_html():
    body = f"""
<section><div class="wrap">
  <h1 style="font-size:38px;margin:0 0 10px">Contact us</h1>
  <p class="lead">Questions, feedback or a data correction? We'd like to hear from you.</p>
  <p class="lead">Email us directly at
     <a href="mailto:{SUPPORT_EMAIL}" style="color:var(--brand-2)">{SUPPORT_EMAIL}</a>.
     For grievances, please include your account username and a clear description so we
     can help quickly. We aim to respond within a few business days.</p>

  <div class="auth" style="max-width:520px">
    <h3>Send a message</h3>
    <p class="auth-sub">This opens your email app with the message pre-filled — we do
       not store anything you type here.</p>
    <form id="cf">
      <label class="fl"><span>Your name</span>
        <input id="cn" placeholder="Name"></label>
      <label class="fl"><span>Your email</span>
        <input id="ce" type="email" placeholder="you@example.com"></label>
      <label class="fl"><span>Message</span>
        <input id="cm" placeholder="How can we help?"></label>
      <button class="btn btn-primary wide" type="submit">Compose email</button>
    </form>
  </div>
</div></section>
<script>
(function(){{
  var f=document.getElementById('cf');
  if(!f) return;
  f.addEventListener('submit', function(ev){{
    ev.preventDefault();
    var n=document.getElementById('cn').value, e=document.getElementById('ce').value,
        m=document.getElementById('cm').value;
    var subject=encodeURIComponent('TaurEye enquiry from ' + (n || 'a visitor'));
    var body=encodeURIComponent(m + '\\n\\n— ' + n + (e ? ' (' + e + ')' : ''));
    window.location.href='mailto:{SUPPORT_EMAIL}?subject=' + subject + '&body=' + body;
  }});
}})();
</script>
"""
    return page(f"Contact — {ENTITY}", body,
                f"Get in touch with {ENTITY} — support, feedback and data corrections.",
                "contact")


# The guide is written for THIS app rather than ported verbatim: the previous
# one linked to routes that do not exist here (/app/screener, /blog/...) and
# described features this build does not have. A guide that sends people to 404s
# is worse than no guide.
GUIDE = """TaurEye turns the whole NSE/BSE universe into something you can *query* — filter
roughly 5,800 stocks down to a short list, read each chart and company, and export or
save the result. Everything here is educational; TaurEye is not an investment adviser
(see the [full disclaimer](/site/legal/disclaimer)).

## Start in five minutes

1. **Sign in** from the [home page](/site#signin). Access is by membership while we are in beta.
2. **Open Screens → Custom.** Add one filter to begin — say *Price ≥ 100* — and run it. Every matching stock appears.
3. **Add a second condition** to narrow it, e.g. *% vs 200-DMA > 0* for stocks above their long-term average. Filters combine with AND.
4. **Sort** by tapping a column header, then **tap a symbol** to open its detail card — chart, technical read, strategy scorecard and actions.
5. **Export** the result to CSV, Excel or a branded PDF, or add names to a watchlist.

That is the core loop: *filter → review → export or track*.

## The main tools

### Screeners
The custom screener filters on price, volume, RSI, moving averages, 52-week range, MACD,
market cap and dozens of fundamental columns — 78 in all. Use **Columns** to show, hide
and reorder them, and **Export** for CSV, Excel or PDF.

Alongside it sit purpose-built screens: **Multibagger** (quality and growth), **Momentum**
(breakouts, pullbacks and volume thrust), **Penny** (with liquidity and risk flags) and the
**Pattern recogniser**.

### Strategy screens
Each screener carries named strategies — Minervini's Trend Template, candlestick setups,
deep value, quality-at-a-price, high reward-to-risk — plus a **configurable MACD + DMA**
screen where you choose the moving average, where price must sit relative to it, the MACD
condition and an RSI band. It is the one screen whose thresholds are yours to set.

### Charts and patterns
Every symbol opens a chart with the moving-average stack and rule-based pattern detection
that draws necklines, channels and trendlines directly on the price. Descriptive only —
never a buy or sell call.

### Dossiers
A full company report: valuation against sector medians, cash flow, shareholding and
promoter pledges, corporate actions and detected patterns — exportable as a branded PDF
named `Taureye_Dossier_<SCRIP>`.

### Backtesting
Test a strategy over history with the charges a real trade would pay — brokerage, STT,
exchange fees, SEBI turnover fee, GST and stamp duty, plus slippage. A backtest that
ignores costs is fiction.

### Watchlist, portfolio and alerts
Track entries with the price and date you added them, hold positions with live P&L, and
set alerts on price, percentage move or RSI.

## Power-user notes

- **Stack conditions for precision.** Layer trend, momentum and a liquidity floor, then save the screen and re-run it on fresh data.
- **Read the evidence, not the score.** Every screen states its rules; every report cites where its numbers came from.
- **Watch the as-of date.** Quotes come from the most recent exchange close and may be delayed. Verify before acting.
- **Learn the concepts** in [Insights](/site/insights) — 22 plain-English explainers on indicators, screening and the Indian markets.

## Good to know

- Data is sourced from public NSE/BSE feeds and other public sources, and may be delayed or incomplete.
- TaurEye screens, charts and explains. It does not recommend buying or selling, and is **not a SEBI-registered adviser or research analyst**.
"""


def tutorial_html():
    body = f"""
<section><div class="wrap">
  <h1 style="font-size:38px;margin:0 0 10px">How TaurEye works</h1>
  <p class="lead">A fast start for new members, and a playbook for everyone else.</p>
  <article class="body">{markdown(GUIDE)}</article>
</div></section>
"""
    return page(f"Guide — {ENTITY}", body,
                "How to use TaurEye: screeners, strategies, charts, dossiers and "
                "backtests.", "guide")
