# TaurEye roadmap — toward an institutional Indian-markets terminal

Sequenced, shippable phases from the Bloomberg/Palantir-competitor audit. Each
phase is its own version + PR + production deploy. Items marked **$/legal**
need money or registration, not code, and are called out as such.

Status legend: ☐ pending · ◐ in progress · ☑ shipped

## Phase 1 — Security foundation (v3.2.0)
- ☐ Owner authentication: signed-cookie session, `APP_PASSWORD` env; no new deps.
- ☐ Gate `/broker/*` (holdings, ltp, sync) behind owner auth — closes the live
  exposure where anyone reaching the site could read connected holdings.
- ☐ Tighten CORS from `*` to configurable allowed origins (default same-origin).
- ☐ Frontend owner-unlock in the Portfolio broker card.
- ☐ CI security scanning: `pip-audit` + `npm audit` (non-blocking report).
- ☐ `security.txt`, security headers already present.

## Phase 2 — Data platform (v3.3.0) — ☑ shipped
- ☐ Persistent store (SQLite → Postgres path) for users, alerts, snapshots,
  historical series — replaces ephemeral in-memory/localStorage-only state.
- ☐ Observability: error capture, request metrics, `/health` already present.
- ☐ Real unit-test suite (analysis, backtest, screener, camarilla, holidays,
  broker, auth) wired into CI as a gate.

## Phase 3 — Institutional data, free public feeds (v3.4.0)
- ☐ Corporate actions (dividends/splits/bonuses/buybacks).
- ☐ Results + board-meeting calendar.
- ☐ BSE/NSE corporate announcements, entity-tagged.
- ☐ Shareholding pattern trends + promoter pledging.
- ☐ Bulk/block deals.

## Phase 4 — Derivatives + portfolio risk (v3.5.0)
- ☐ F&O option chain: IV, OI, PCR, max-pain; futures basis/rollover.
- ☐ Option strategy payoff builder.
- ☐ Portfolio risk: VaR/CVaR, beta, factor/sector exposure, drawdown,
  correlation matrix, attribution.

## Phase 5 — Grounded entity graph, the Palantir layer (v3.6.0)
- ☐ Rebuild relationship edges from filings / shareholding / board interlocks /
  related-party disclosures — **with per-edge citations and time-versioning**.
- ☐ Cross-entity link analysis (promoter/auditor/lender pivots, pledge
  cascades, governance red-flags).
- ☐ Scenario/impact propagation through the supply/ownership graph.

## Phase 6 — Accuracy, alerts, API (v3.7.0)
- ☐ Backtest realism: slippage, STT, exchange charges, liquidity/tradability
  filter; deterministic-seed Monte Carlo; point-in-time fundamentals.
- ☐ Server-side alerts (price/technical/event/news) with push + email.
- ☐ Public data API + rate-limited API keys; Excel/Sheets connector.

## Not code — external dependencies (track, don't "build")
- **$** Licensed real-time/depth/F&O/bond data (NSE/BSE vendor, TrueData/
  GlobalDatafeed/EODHD paid tiers). The BYOB-broker path covers *equities*
  per-user via each user's own entitlement; bonds/estimates/filings still need
  licensing.
- **$** Broader asset classes needing paid data: bonds/G-secs beyond RBI Retail
  Direct public data, mutual-fund NAV history at scale, commodities, FX.
- **legal** SEBI positioning (data vendor vs research analyst), data-usage
  licenses, DPDP Act (India privacy) compliance, SOC2-style controls for
  selling to institutions.
- **$** Play Store / Apple Developer accounts for store distribution.
- **$** Domain + CDN + managed Postgres + error-monitoring SaaS when scaling
  past the single Always-Free VM.
