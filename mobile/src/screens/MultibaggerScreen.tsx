import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Candle, MbScreenRow, MultibaggerReport, api } from '../api';
import { chartHtml } from '../chartHtml';
import HtmlView from '../components/HtmlView';
import StockDetail from '../components/StockDetail';
import SymbolInput from '../components/SymbolInput';
import ChecklistPanel from '../components/ChecklistPanel';
import { Row, sortRows } from '../screener';
import { capBand } from '../marketcap';
import { navigate, openStock, takeSector, takeSymbol } from '../navIntent';
import { mergeSectors } from '../sectors';
import { ACTIONS_W, COLS, Col, DEFAULT_HIDDEN, SYM_CELL, SimpleColumnMenu, SymInline, cellFlex, exportColsOf, loadNames } from './ScreenerScreen';
import { ExportCol, exportCsv, exportExcel, exportPdf } from '../csv';
import { TrackDir, TrackEntry, addTrack, loadTrack, removeTrack } from '../tracklist';
import { addSymbol, loadWatchlist, normSymbol, removeSymbol } from '../watchlist';
import { Btn, Card, Dropdown, EmptyState, InfoButton, InfoContent, Loading, SectionTitle, Sheet, StatTile } from '../ui';
import { openPdfPreview } from '../pdf';
import { MULTIBAGGER_INFO } from '../tabInfo';
import { theme } from '../theme';
import { getScanned, hydrateScan, isIncluded, subscribeScan, toggleInclude } from '../scanStore';

const GOLD = '#f5c518';
const BT_PREFILL_KEY = 'taureye.backtest.prefill';
const RECENT_KEY = 'taureye.mb.recent.v1';
const MB_COLS_KEY = 'taureye.mb.cols.v1';
// The Multibagger list carries one extra action (the "include in scan" toggle)
// beyond the shared screener action set, so its action cell is a touch wider.
const MB_ACTIONS_W = ACTIONS_W + 88;

// Analysed-report cache: re-opening a recently searched symbol is instant
// instead of refetching (the server caches 6h; this covers the round trip).
const REPORT_TTL = 30 * 60 * 1000;
const reportCache = new Map<string, { report: MultibaggerReport; candles: Candle[]; ts: number }>();

// The screen is simply "analyser score ≥ 60" computed SERVER-SIDE over the
// whole listed NSE universe (see mb_screen.py); a data-coverage floor keeps
// thin-data stocks from sneaking in on one strong pillar.

// Rows in this list carry the analyser score + 5x probability alongside the
// screener fields.
type MbRow = Row & { mbScore?: number; mbProb?: number };

// Strategy dropdown for the multibagger screen. Each strategy narrows the fixed
// candidate universe to a distinct wealth-compounding thesis (value, quality,
// hidden small-caps, momentum leaders…) and re-ranks it best-first. 'balanced'
// keeps the full list on analyser score. Grounded only in fields the list already
// carries: mbScore/mbProb + fundamentals (_fund) + trend flags (ret_6m/minervini).
type MbStrategy = { id: string; name: string; info: InfoContent; apply: (rows: MbRow[]) => MbRow[] };
const fnum = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
const fundOf = (r: MbRow) => (r._fund || {}) as Record<string, unknown>;
const capShort = (r: MbRow) => capBand(fnum(fundOf(r).market_cap_cr))?.short ?? null;
const byDesc = (get: (r: MbRow) => number | null) => (a: MbRow, b: MbRow) => (get(b) ?? -Infinity) - (get(a) ?? -Infinity);
const byAsc = (get: (r: MbRow) => number | null) => (a: MbRow, b: MbRow) => (get(a) ?? Infinity) - (get(b) ?? Infinity);

const MB_STRATEGIES: MbStrategy[] = [
  {
    id: 'balanced',
    name: 'Balanced (all candidates)',
    info: {
      about: 'The full fixed multibagger screen, ranked by the analyser score. No extra filter — the widest funnel of mid & small caps that clear the base quality bar.',
      disclaimer: 'Educational screen, not investment advice.',
    },
    apply: (rows) => [...rows].sort(byDesc((r) => fnum(r.mbScore))),
  },
  {
    id: 'conviction',
    name: 'High conviction (score ≥ 75)',
    info: {
      about: 'Only the highest-scoring candidates — where the analyser sees strong alignment across growth, cash flow, leverage and trend.',
      sections: [{ heading: 'Filter', bullets: ['Analyser score ≥ 75', 'Ranked by score, best first'] }],
      disclaimer: 'A high score is not a guarantee — always verify the thesis.',
    },
    apply: (rows) => rows.filter((r) => (fnum(r.mbScore) ?? 0) >= 75).sort(byDesc((r) => fnum(r.mbScore))),
  },
  {
    id: 'value',
    name: 'Deep value (low P/E · P/B)',
    info: {
      about: 'Cheap on earnings and book value — the classic value tilt where a re-rating can drive multi-bagger returns.',
      sections: [{ heading: 'Filter', bullets: ['P/E between 0 and 22', 'P/B ≤ 4', 'Ranked by lowest P/E first'] }],
      disclaimer: 'Cheap can stay cheap — check why the market is discounting it.',
    },
    apply: (rows) =>
      rows
        .filter((r) => { const pe = fnum(fundOf(r).pe); const pb = fnum(fundOf(r).pb); return pe != null && pe > 0 && pe <= 22 && (pb == null || pb <= 4); })
        .sort(byAsc((r) => fnum(fundOf(r).pe))),
  },
  {
    id: 'quality',
    name: 'Quality compounder (high ROE/ROCE)',
    info: {
      about: 'Businesses that compound capital at high rates of return — the quality-growth thesis behind most durable multibaggers.',
      sections: [{ heading: 'Filter', bullets: ['ROE ≥ 15% or ROCE ≥ 15%', 'Ranked by ROE, highest first'] }],
      disclaimer: 'Past returns on capital may not persist — watch for margin pressure.',
    },
    apply: (rows) =>
      rows
        .filter((r) => (fnum(fundOf(r).roe) ?? 0) >= 15 || (fnum(fundOf(r).roce) ?? 0) >= 15)
        .sort(byDesc((r) => fnum(fundOf(r).roe))),
  },
  {
    id: 'hidden',
    name: 'Hidden small-caps',
    info: {
      about: 'Small & micro-cap names with the highest analyser 5x-probability — under-followed companies with the most runway to re-rate.',
      sections: [{ heading: 'Filter', bullets: ['Market cap band SMALL or MICRO', 'Ranked by 5x probability, highest first'] }],
      disclaimer: 'Small-caps are illiquid and volatile — size positions accordingly.',
    },
    apply: (rows) =>
      rows.filter((r) => { const b = capShort(r); return b === 'SMALL' || b === 'MICRO'; }).sort(byDesc((r) => fnum(r.mbProb))),
  },
  {
    id: 'momentum',
    name: 'Momentum leaders',
    info: {
      about: 'Multibagger candidates that are also trending — a Minervini-style trend template or strong 6-month price return layered on top of the fundamentals.',
      sections: [{ heading: 'Filter', bullets: ['Minervini trend template OR 6-month return > 0', 'Ranked by 6-month return, highest first'] }],
      disclaimer: 'Trend can reverse — combine with your own risk management.',
    },
    apply: (rows) =>
      rows
        .filter((r) => r.minervini === true || (fnum(r.ret_6m) ?? -1) > 0)
        .sort(byDesc((r) => fnum(r.ret_6m))),
  },
  {
    id: 'magic',
    name: 'Magic Formula (Greenblatt)',
    info: {
      about: "Joel Greenblatt's classic: buy good businesses (high return on capital) at cheap prices (high earnings yield). Each candidate is ranked on both and the two ranks are combined.",
      sections: [{ heading: 'Method', bullets: ['Rank by earnings yield (1/PE), cheapest first', 'Rank by ROE, highest first', 'Sort by the combined rank — best of both worlds first'] }],
      disclaimer: 'A screen, not a portfolio — Greenblatt held 20–30 names for a year+.',
    },
    apply: (rows) => {
      const elig = rows.filter((r) => { const pe = fnum(fundOf(r).pe); return pe != null && pe > 0 && fnum(fundOf(r).roe) != null; });
      const peRank = new Map([...elig].sort(byAsc((r) => fnum(fundOf(r).pe))).map((r, i) => [r.sym, i]));
      const roeRank = new Map([...elig].sort(byDesc((r) => fnum(fundOf(r).roe))).map((r, i) => [r.sym, i]));
      return [...elig].sort((a, b) =>
        ((peRank.get(a.sym) ?? 0) + (roeRank.get(a.sym) ?? 0)) - ((peRank.get(b.sym) ?? 0) + (roeRank.get(b.sym) ?? 0)));
    },
  },
  {
    id: 'garp',
    name: 'GARP / Peter Lynch (PEG ≤ 1.5)',
    info: {
      about: 'Growth At a Reasonable Price — the Lynch playbook. Pay a P/E no higher than the growth rate: PEG at or under ~1.5 (1 is the classic ideal).',
      sections: [{ heading: 'Filter', bullets: ['PEG between 0 and 1.5 (falls back to P/E ≤ 25 with earnings growth ≥ 15% when PEG is unavailable)', 'Ranked by lowest PEG first'] }],
      disclaimer: 'Growth estimates embedded in PEG can be stale — sanity-check the growth leg.',
    },
    apply: (rows) =>
      rows
        .filter((r) => {
          const f = fundOf(r); const peg = fnum(f.peg);
          if (peg != null) return peg > 0 && peg <= 1.5;
          const pe = fnum(f.pe); const eg = fnum(f.earnings_growth_pct);
          return pe != null && pe > 0 && pe <= 25 && (eg ?? 0) >= 15;
        })
        .sort(byAsc((r) => fnum(fundOf(r).peg) ?? fnum(fundOf(r).pe))),
  },
  {
    id: 'coffeecan',
    name: 'Coffee Can (quality growth, hold forever)',
    info: {
      about: 'The Saurabh Mukherjea-popularised Indian classic: consistent revenue growth with high return on equity, bought and left untouched.',
      sections: [{ heading: 'Filter', bullets: ['Revenue growth ≥ 10%', 'ROE ≥ 15%', 'Ranked by ROE, highest first'] }],
      disclaimer: 'The original rule demands 10 consecutive years — this uses the latest reported year.',
    },
    apply: (rows) =>
      rows
        .filter((r) => { const f = fundOf(r); return (fnum(f.revenue_growth_pct) ?? 0) >= 10 && (fnum(f.roe) ?? 0) >= 15; })
        .sort(byDesc((r) => fnum(fundOf(r).roe))),
  },
  {
    id: 'strength',
    name: 'Fortress balance sheet (low debt · FCF)',
    info: {
      about: 'Piotroski-spirit financial strength: little leverage, real free cash flow and growing profits — the survivors that compound through cycles.',
      sections: [{ heading: 'Filter', bullets: ['Debt/equity ≤ 0.5', 'Free cash flow positive', 'Earnings growth > 0', 'Ranked by analyser score'] }],
      disclaimer: 'Balance-sheet data lags the price — re-check after results season.',
    },
    apply: (rows) =>
      rows
        .filter((r) => {
          const f = fundOf(r);
          return (fnum(f.debt_equity) ?? 99) <= 0.5 && (fnum(f.fcf_cr) ?? -1) > 0 && (fnum(f.earnings_growth_pct) ?? -1) > 0;
        })
        .sort(byDesc((r) => fnum(r.mbScore))),
  },
  {
    id: 'turnaround',
    name: 'Turnaround (deep drawdown, intact quality)',
    info: {
      about: 'Quality candidates trading far below their 52-week high — the contrarian entry where a recovery re-rates the stock hardest.',
      sections: [{ heading: 'Filter', bullets: ['≥ 30% below the 52-week high', 'Analyser score still ≥ 60 (quality bar intact)', 'Ranked by deepest drawdown first'] }],
      disclaimer: 'Falling knives exist — demand a reason the drawdown is temporary.',
    },
    apply: (rows) =>
      rows
        .filter((r) => {
          const off = fnum(fundOf(r).pct_from_high_pct) ?? fnum(r.pct_from_high);
          return off != null && off <= -30 && (fnum(r.mbScore) ?? 0) >= 60;
        })
        .sort(byAsc((r) => fnum(fundOf(r).pct_from_high_pct) ?? fnum(r.pct_from_high))),
  },
  {
    id: 'dividend',
    name: 'Dividend + value (yield ≥ 1.5%)',
    info: {
      about: 'Cheap companies that also pay you to wait — a dividend floor under a value re-rating.',
      sections: [{ heading: 'Filter', bullets: ['Dividend yield ≥ 1.5%', 'P/E ≤ 25 (when known)', 'Ranked by yield, highest first'] }],
      disclaimer: 'Yield data loads with the fundamentals pass — give the list a few seconds.',
    },
    apply: (rows) =>
      rows
        .filter((r) => {
          const f = fundOf(r); const dy = fnum(f.dividend_yield); const pe = fnum(f.pe);
          return dy != null && dy >= 1.5 && (pe == null || pe <= 25);
        })
        .sort(byDesc((r) => fnum(fundOf(r).dividend_yield))),
  },
];

const tierColor = (score: number) =>
  score >= 75 ? theme.green : score >= 60 ? theme.accent : score >= 45 ? GOLD : theme.red;

const fmt = (v: number | null | undefined, suffix = '', d = 1) =>
  v == null || !isFinite(v) ? '—' : v.toFixed(d) + suffix;
const fmtCr = (v: number | null | undefined) =>
  v == null || !isFinite(v)
    ? '—'
    : v >= 1e5
      ? '₹' + (v / 1e5).toFixed(2) + 'L cr'
      : v >= 1e3
        ? '₹' + (v / 1e3).toFixed(2) + 'k cr'
        : '₹' + v.toFixed(0) + ' cr';

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Tier → print colour (green/amber/red), matching the on-screen score bands.
const GREEN = '#1e8449';
const RED = '#c0392b';
const AMBER = '#b7791f';
const tierHex = (score: number) => (score >= 75 ? GREEN : score >= 60 ? '#1d6fb8' : score >= 45 ? AMBER : RED);
// Green for a positive number, red for a negative one — for directional metrics.
const signHex = (v: string) => {
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  if (!isFinite(n) || n === 0) return '#111';
  return n > 0 ? GREEN : RED;
};

// Printable HTML report — always black-on-white (see pdf.ts FORCE_LIGHT), with
// colour on the score, probability and directional numbers.
function reportHtml(r: MultibaggerReport): string {
  const m = r.metrics || {};
  const row = (k: string, v: string, color = '#111') =>
    `<tr><td>${esc(k)}</td><td style="text-align:right;color:${color};font-weight:600">${esc(v)}</td></tr>`;
  const pillars = r.pillars
    .map((p) => row(`${p.label} (${p.weight}%)`, p.score == null ? 'no data' : String(p.score), p.score == null ? '#888' : tierHex(p.score)))
    .join('');
  const checks = r.checklist
    .map((c) => `<li style="color:${c.state === 'pass' ? GREEN : c.state === 'fail' ? RED : '#888'}">${c.state === 'pass' ? '✓' : c.state === 'fail' ? '✗' : '?'} <span style="color:#111">${esc(c.label)}</span></li>`)
    .join('');
  const list = (xs: string[], color: string) => xs.map((x) => `<li style="color:${color}">${esc(x)}</li>`).join('');
  // 'signed' rows get green/red by sign; the rest stay black.
  const nums: [string, string, boolean][] = [
    ['Market cap', fmtCr(m.mcap_cr), false], ['Revenue growth', fmt(m.revenue_growth_pct, '%'), true],
    ['Earnings growth', fmt(m.earnings_growth_pct, '%'), true], ['ROE', fmt(m.roe_pct, '%'), false],
    ['Op margin', fmt(m.op_margin_pct, '%'), false], ['Debt/equity', fmt(m.debt_equity, '', 2), false],
    ['Free cash flow', fmtCr(m.fcf_cr), true], ['Promoter/insider', fmt(m.insider_pct, '%'), false],
    ['Institutions', fmt(m.institution_pct, '%'), false], ['P/E', fmt(m.pe, '', 1), false],
    ['PEG', fmt(m.peg, '', 2), false], ['vs 200-DMA', fmt(m.vs_200dma_pct, '%'), true],
    ['3y price CAGR', fmt(m.price_cagr_3y_pct, '%'), true], ['From 52w high', fmt(m.pct_from_high_pct, '%'), false],
  ];
  const numRows = nums.map(([k, v, signed]) => row(k, v, signed && v !== '—' ? signHex(v) : '#111')).join('');
  const tc = tierHex(r.score);
  const price = r.price != null ? '₹' + r.price.toLocaleString('en-IN') : '';
  return `<html><head><title>TaurEye — Multibagger report — ${esc(r.symbol)}</title>
<style>body{font-family:Arial,sans-serif;color:#111;background:#fff;max-width:760px;margin:24px auto;padding:0 16px}
h1{font-size:20px;margin-bottom:0}h2{font-size:14px;margin:18px 0 6px;color:#111}
table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #ddd;padding:5px 4px;font-size:12px}
ul{margin:4px 0;padding-left:18px;font-size:12px;line-height:1.5}p{font-size:11px;color:#555}
.score{font-size:40px;font-weight:800}</style></head><body>
<h1>${esc(r.name)} <span style="color:#888;font-size:13px">${esc(r.symbol)}${r.sector ? ' · ' + esc(r.sector) : ''}</span></h1>
${price ? `<div style="font-size:15px;font-weight:700;color:#111;margin-top:4px">${esc(price)} <span style="color:#888;font-weight:400;font-size:12px">${esc(fmtCr(m.mcap_cr))}</span></div>` : ''}
<div class="score" style="color:${tc}">${r.score}/100 — ${esc(r.tier)}</div>
<div>Indicative probability of a 5x+ outcome over 5–10 years: <b style="color:${tc}">${r.probability_pct}%</b>${r.coverage_pct < 100 ? ` <span style="color:#888">(data coverage ${r.coverage_pct}%)</span>` : ''}</div>
<h2>Pillars</h2><table>${pillars}</table>
<h2>Checklist</h2><ul>${checks}</ul>
${r.strengths.length ? `<h2>What works</h2><ul>${list(r.strengths, GREEN)}</ul>` : ''}
${r.red_flags.length ? `<h2>Red flags</h2><ul>${list(r.red_flags, RED)}</ul>` : ''}
<h2>Key numbers</h2><table>${numRows}</table>
${r.about ? `<h2>About</h2><p>${esc(r.about)}</p>` : ''}
<p>${esc(r.methodology)}</p><p><i>${esc(r.disclaimer)}</i></p></body></html>`;
}

async function exportReport(r: MultibaggerReport): Promise<void> {
  // Route through the shared print helper: real "Save as PDF" download on both
  // desktop and the Android WebView, forced to a white page. Only a true native
  // RN runtime with no DOM falls back to a text share.
  const ok = openPdfPreview(reportHtml(r), {
    docType: 'Multibagger report',
    fileName: `TaurEye-${r.symbol}-multibagger`,
  });
  if (!ok && Platform.OS !== 'web') {
    await Share.share({
      title: `Multibagger report — ${r.symbol}`,
      message: `${r.name} (${r.symbol}): ${r.score}/100 — ${r.tier} · probability ${r.probability_pct}%`,
    });
  }
}

// ── Fixed-filter multibagger screener (list only) ────────────────────────────
// The match list comes from the server's full-universe background screen
// (/multibagger/screen); the browser then enriches only the matches with live
// technicals + fundamentals so the table shows the full Screener columns.
let mbRowsCache: Row[] | null = null;
let mbNoteCache = '';
let mbAsofCache = 0;

const fmtAsof = (epoch: number) =>
  new Date(epoch * 1000).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });

function MbList({
  onAnalyse,
  onDetail,
  toast,
  refreshSignal,
  onLoadingChange,
}: {
  onAnalyse: (sym: string) => void;
  onDetail: (r: Row) => void;
  toast: (msg: string) => void;
  refreshSignal: number;
  onLoadingChange: (loading: boolean) => void;
}) {
  const [rows, setRows] = useState<Row[]>(mbRowsCache || []);
  const [note, setNote] = useState(mbNoteCache);
  const [loading, setLoading] = useState(!mbRowsCache);
  const [asof, setAsof] = useState(mbAsofCache);
  const [tick, setTick] = useState(0);
  const [track, setTrack] = useState<TrackEntry[]>([]);
  const [watch, setWatch] = useState<string[]>([]);
  const [analyseMenu, setAnalyseMenu] = useState<string | null>(null); // row → analyse-as menu
  const [, setScanTick] = useState(0); // re-render when the reco scan store changes

  useEffect(() => {
    loadTrack().then(setTrack);
    loadWatchlist().then(setWatch);
    hydrateScan();
    return subscribeScan(() => setScanTick((t) => t + 1));
  }, []);

  // ⟳ Update list — drop caches and force a fresh server-side screen run.
  const forceRefresh = () => {
    if (loading) return;
    mbRowsCache = null;
    mbNoteCache = '';
    setRows([]);
    setLoading(true);
    setNote('Restarting the universe screen…');
    setTick((t) => t + 1);
  };

  // The ⟳ Update-list button now lives in the parent top row (beside the
  // Screener/Analyser toggle). The parent bumps refreshSignal to trigger a
  // rebuild, and reads loading back so it can disable the button mid-run.
  useEffect(() => {
    if (refreshSignal > 0) forceRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);
  useEffect(() => {
    onLoadingChange(loading);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  useEffect(() => {
    if (mbRowsCache && tick === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const names = await loadNames();
        const build = (rs: MbScreenRow[]): MbRow[] =>
          rs.map((c) => ({
            sym: c.symbol,
            name: names[c.symbol.toUpperCase()]?.name,
            exchange: names[c.symbol.toUpperCase()]?.exchange || 'NSE',
            price: c.price,
            chg: c.chg,
            volume: c.volume,
            relvol: c.relvol,
            d50: c.vs_50dma,
            d200: c.vs_200dma,
            pct_from_high: c.pct_from_high,
            mbScore: c.score,
            mbProb: c.probability_pct,
            // Seed the strategy-filter fundamentals straight from the analyser
            // metrics the screen already carries — P/E, P/B, PEG, growth, FCF —
            // so Deep value & co. work immediately instead of waiting on (or
            // silently losing) the separate fundamentals fetch.
            _fund: {
              market_cap_cr: c.market_cap_cr,
              roe: c.roe,
              debt_equity: c.debt_equity,
              sector: c.sector,
              pe: c.metrics?.pe ?? null,
              pb: c.metrics?.pb ?? null,
              peg: c.metrics?.peg ?? null,
              revenue_growth_pct: c.metrics?.revenue_growth_pct ?? null,
              earnings_growth_pct: c.metrics?.earnings_growth_pct ?? null,
              fcf_cr: c.metrics?.fcf_cr ?? null,
              pct_from_high_pct: c.metrics?.pct_from_high_pct ?? null,
            } as Row['_fund'],
          }));
        // 1) Poll the server-side full-universe screen. Matches stream in
        //    LIVE while the background job runs, so render partials as they land.
        let snap = await api.mbScreen(tick > 0);
        while (!cancelled && snap.status === 'running') {
          if (snap.results.length) {
            setRows(build(snap.results));
            setLoading(false);
          }
          setNote(`Scoring the whole universe server-side… ${snap.progress || ''} · ${snap.results.length} so far`);
          await new Promise((r) => setTimeout(r, 4000));
          snap = await api.mbScreen();
        }
        if (cancelled) return;
        if (snap.status === 'error' && !snap.results.length) {
          setNote(snap.error || 'Screen failed — retry shortly.');
          setLoading(false);
          return;
        }
        const meta = `universe ${snap.universe.toLocaleString('en-IN')} analysed${snap.refreshing ? ' · refreshing…' : ''}`;
        const seeded = build(snap.results);
        setRows(seeded);
        setLoading(false);
        setNote(meta);
        setAsof(snap.asof);
        mbAsofCache = snap.asof;
        if (!seeded.length) return;
        // 2) Enrich the matches with the scan's technicals (mainly RSI — the
        //    screen already seeded quotes) + fuller fundamentals. Null-safe
        //    merges: a slow/empty scan value must never blank a seeded one.
        const defined = (into: Record<string, unknown>, from: Record<string, unknown>) => {
          Object.entries(from).forEach(([k, v]) => {
            if (v != null) into[k] = v;
          });
          return into;
        };
        const syms = seeded.map((r) => r.sym);
        await api.scan(syms, {
          onBatch: (data, done) => {
            if (cancelled) return;
            setRows((prev) =>
              prev.map((r) =>
                data[r.sym]
                  ? ({ ...defined({ ...r }, data[r.sym] as Record<string, unknown>), _fund: r._fund } as Row)
                  : r,
              ),
            );
            setNote(`${meta} · technicals ${Math.min(done, syms.length)}/${syms.length}`);
          },
        });
        try {
          const res = await api.fundamentalsBulk(syms);
          if (!cancelled && res.data) {
            setRows((prev) =>
              prev.map((r) =>
                res.data[r.sym]
                  ? ({ ...r, _fund: defined({ ...(r._fund as object) }, res.data[r.sym] as Record<string, unknown>) as Row['_fund'] } as Row)
                  : r,
              ),
            );
          }
        } catch {
          /* seeded fundamentals already carry mcap/roe/de */
        }
        if (!cancelled) {
          setNote(meta);
          setRows((prev) => {
            mbRowsCache = prev;
            return prev;
          });
          mbNoteCache = meta;
        }
      } catch (e) {
        if (!cancelled) {
          setNote(e instanceof Error ? e.message : 'Failed to load the screen');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  // The analyser score gets its own column, right after Exch.
  const scoreCol: Col = useMemo(
    () => ({
      key: 'mb_score',
      label: 'Score',
      w: 58,
      flex: 0,
      render: (r) => {
        const s = (r as MbRow).mbScore;
        return (
          <Text style={{ fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.sm, color: s == null ? theme.muted : tierColor(s) }}>
            {s ?? '—'}
          </Text>
        );
      },
    }),
    [],
  );
  // Indicative 5x-probability column (from the analyser), sortable like Score.
  const probCol: Col = useMemo(
    () => ({
      key: 'mb_prob',
      label: 'Prob',
      w: 56,
      flex: 0,
      render: (r) => {
        const p = (r as MbRow).mbProb;
        return (
          <Text style={{ fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.sm, color: p == null ? theme.muted : tierColor(p >= 40 ? 75 : p >= 25 ? 60 : p >= 12 ? 45 : 0) }}>
            {p == null ? '—' : p + '%'}
          </Text>
        );
      },
    }),
    [],
  );
  // Market-cap band tag (LARGE / MID / SMALL / MICRO) — its own column.
  const capCol: Col = useMemo(
    () => ({
      key: 'cap_band',
      label: 'Cap',
      w: 66,
      flex: 0,
      render: (r) => {
        const b = capBand((r as MbRow)._fund?.market_cap_cr);
        if (!b) return <Text style={{ color: theme.muted, fontFamily: theme.mono, fontSize: theme.fs.sm }}>—</Text>;
        return (
          <View style={{ borderColor: b.color, borderWidth: 1, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
            <Text style={{ color: b.color, fontFamily: theme.mono, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 }}>{b.short}</Text>
          </View>
        );
      },
    }),
    [],
  );
  const allCols = useMemo(() => {
    const base = COLS.filter((c) => !DEFAULT_HIDDEN.includes(c.key));
    const at = base.findIndex((c) => c.key === 'exchange') + 1;
    return [...base.slice(0, at || 3), scoreCol, probCol, capCol, ...base.slice(at || 3)];
  }, [scoreCol, probCol, capCol]);
  // ▤ Columns: user-hidden keys, persisted (symbol can't be hidden).
  const [colHidden, setColHidden] = useState<string[]>([]);
  const [colMenu, setColMenu] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(MB_COLS_KEY)
      .then((v) => { if (v) setColHidden(JSON.parse(v)); })
      .catch(() => {});
  }, []);
  const toggleCol = (key: string) => {
    setColHidden((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      AsyncStorage.setItem(MB_COLS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  };
  const visibleCols = useMemo(
    () => allCols.filter((c) => c.key === 'sym' || !colHidden.includes(c.key)),
    [allCols, colHidden],
  );
  const tableW = useMemo(() => visibleCols.reduce((a, c) => a + c.w, 0) + MB_ACTIONS_W, [visibleCols]);
  // Export uses the shared per-key getters plus the analyser-specific columns.
  const mbExportCols = useCallback((): ExportCol[] => visibleCols.map((c) => {
    if (c.key === 'mb_score') return { header: 'Score', get: (r: Row) => (r as MbRow).mbScore ?? '' };
    if (c.key === 'mb_prob') return { header: 'Prob %', get: (r: Row) => (r as MbRow).mbProb ?? '' };
    if (c.key === 'cap_band') return { header: 'Cap', get: (r: Row) => capBand((r as MbRow)._fund?.market_cap_cr)?.short ?? '' };
    return exportColsOf([c])[0];
  }), [visibleCols]);

  // Column sorting (tap a header) — defaults to analyser score, best first.
  const [sortCol, setSortCol] = useState('mb_score');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const onSort = (col: string) => {
    if (col === sortCol) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortCol(col);
      setSortDir(col === 'sym' || col === 'name' || col === 'exchange' ? 1 : -1);
    }
  };
  // Strategy dropdown: narrows the fixed universe to a distinct thesis.
  const [strat, setStrat] = useState('balanced');
  const stratDef = MB_STRATEGIES.find((s) => s.id === strat) || MB_STRATEGIES[0];
  // Sector search: the exhaustive canonical list (unioned with any sector present
  // in the results), so every sector is always selectable — including one routed
  // in from the sectoral heatmap that may not yet have a loaded match. '' = all.
  const [sector, setSector] = useState('');
  const sectors = useMemo(
    () => mergeSectors(rows.map((r) => (r as MbRow)._fund?.sector)),
    [rows],
  );
  // Honour a sector routed in from the heatmap (tap sector → Multibagger).
  useEffect(() => {
    const s = takeSector('mb');
    if (s) setSector(s);
  }, []);
  const matches = useMemo(() => {
    // Strategy first (filters + base ranking), then the sector chip, then the
    // manual Sort chips / header taps order within.
    let filtered = stratDef.apply(rows as MbRow[]) as Row[];
    if (sector) filtered = filtered.filter((r) => (r as MbRow)._fund?.sector === sector);
    if (sortCol === 'mb_score' || sortCol === 'mb_prob') {
      const key = sortCol === 'mb_score' ? 'mbScore' : 'mbProb';
      return [...filtered].sort(
        (a, b) => (((a as MbRow)[key] ?? -1) - ((b as MbRow)[key] ?? -1)) * sortDir,
      );
    }
    return sortRows(filtered, sortCol, sortDir);
  }, [rows, stratDef, sector, sortCol, sortDir]);
  const warming = false;
  // Which scrips the recommendation engine has already deep-analysed (so a
  // rebuild skips them). Recomputed on every render — cheap Set membership.
  const scannedSet = getScanned();

  const trackDirOf = (sym: string): TrackDir | null => track.find((t) => t.sym === sym)?.dir ?? null;
  const onTrack = async (r: Row, dir: TrackDir) => {
    const cur = trackDirOf(r.sym);
    if (cur === dir) setTrack(await removeTrack(track, r.sym));
    else setTrack(await addTrack(track, r.sym, dir, r.price ?? 0, Date.now()));
  };
  const isWatched = (sym: string) => watch.includes(normSymbol(sym));
  const onToggleWatch = async (r: Row) => {
    if (isWatched(r.sym)) {
      setWatch(await removeSymbol(watch, normSymbol(r.sym)));
      toast(`${r.sym} removed from watchlist`);
    } else {
      setWatch(await addSymbol(watch, r.sym));
      toast(`${r.sym} added to watchlist`);
    }
  };

  return (
    <>
    <ScrollView style={{ flex: 1 }}>
      {/* Strategy first — the ⟳ Update-list button lives in the parent top row. */}
      {!loading ? (
        <View style={styles.stratRow}>
          <Dropdown
            label="Strategy"
            value={strat}
            options={MB_STRATEGIES.map((s) => ({ key: s.id, label: s.name }))}
            onChange={setStrat}
          />
          <InfoButton
            title={stratDef.name}
            content={stratDef.info}
            style={strat !== 'balanced' ? styles.stratInfoOn : styles.stratInfoOff}
          />
        </View>
      ) : null}

      {/* Update text: match count + status, then when the list last refreshed. */}
      <Text style={styles.fixedNote} numberOfLines={2}>
        {matches.length} match{matches.length === 1 ? '' : 'es'}
        {warming ? ' · loading fundamentals…' : ''} · {note} · tap a symbol to analyse
      </Text>
      {asof ? (
        <Text style={styles.lastUpd}>Stocks last updated {fmtAsof(asof)}</Text>
      ) : null}

      {/* Sector filter as a dropdown (was a chip row). Column headers handle
          sorting now, so the separate SORT bar is gone. */}
      {!loading ? (
        <View style={styles.secRow}>
          {sectors.length ? (
            <Dropdown
              label="Sector"
              value={sector}
              options={[{ key: '', label: 'All sectors' }, ...sectors.map((s) => ({ key: s, label: s }))]}
              onChange={setSector}
            />
          ) : null}
          <View style={{ flex: 1 }} />
          <TouchableOpacity style={styles.ctlBtn} onPress={() => setColMenu(true)} activeOpacity={0.75}>
            <Text style={styles.ctlTxt}>▤ Columns</Text>
          </TouchableOpacity>
          <View>
            <TouchableOpacity style={styles.ctlBtn} onPress={() => setExportOpen((v) => !v)} activeOpacity={0.75}>
              <Text style={styles.ctlTxt}>⇩ Export ▾</Text>
            </TouchableOpacity>
            {exportOpen ? (
              <View style={styles.exportMenu}>
                {([['CSV', exportCsv], ['Excel', exportExcel], ['PDF', exportPdf]] as const).map(([label, fn]) => (
                  <TouchableOpacity
                    key={label}
                    style={styles.exportItem}
                    onPress={() => {
                      setExportOpen(false);
                      fn(matches, 'multibagger', mbExportCols()).catch(() => {});
                    }}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.exportItemTxt}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      {loading ? <Loading label="Loading mid & small cap candidates…" /> : null}

      {!loading ? (
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: '100%' }}>
          <View style={{ minWidth: tableW, flexGrow: 1 }}>
            <View style={styles.headerRow}>
              {visibleCols.map((c) => (
                <TouchableOpacity
                  key={c.key}
                  style={[styles.th, cellFlex(c), { alignItems: c.align === 'left' ? 'flex-start' : 'flex-end' }]}
                  onPress={() => onSort(c.key)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.thTxt}>
                    {c.label}
                    {sortCol === c.key ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}
                  </Text>
                </TouchableOpacity>
              ))}
              <View style={styles.actionsCell}>
                <Text style={styles.thTxt}>Actions</Text>
              </View>
            </View>
            {matches.length === 0 ? (
              <EmptyState
                icon="◆"
                title={warming ? 'Screening…' : 'No matches right now'}
                hint={warming ? 'Fundamentals are still warming — matches appear as they load.' : 'No mid/small cap currently passes the fixed multibagger screen.'}
              />
            ) : (
              matches.map((item, rowIdx) => {
                const dir = trackDirOf(item.sym);
                const starred = isWatched(item.sym);
                const scanned = scannedSet.has(item.sym.toUpperCase());
                const included = isIncluded(item.sym);
                return (
                  <View key={item.sym} style={styles.dataRow}>
                    {visibleCols.map((c) =>
                      c.key === 'sym' ? (
                        // Symbol cell: tap analyses; inline chart + watch star
                        // (same affordance as the Custom screener).
                        <View key={c.key} style={[styles.td, cellFlex(c), SYM_CELL]}>
                          <TouchableOpacity onPress={() => onAnalyse(item.sym)} activeOpacity={0.75}>
                            {c.render(item, rowIdx)}
                          </TouchableOpacity>
                          <SymInline starred={starred} onChart={() => onDetail(item)} onStar={() => onToggleWatch(item)} />
                        </View>
                      ) : c.key === 'name' ? (
                        <TouchableOpacity
                          key={c.key}
                          style={[styles.td, cellFlex(c), { alignItems: 'flex-start' }]}
                          onPress={() => onAnalyse(item.sym)}
                          activeOpacity={0.75}
                        >
                          {c.render(item, rowIdx)}
                        </TouchableOpacity>
                      ) : (
                        <View key={c.key} style={[styles.td, cellFlex(c), { alignItems: c.align === 'left' ? 'flex-start' : 'flex-end' }]}>
                          {c.render(item, rowIdx)}
                        </View>
                      ),
                    )}
                    <View style={styles.actionsCell}>
                      <TouchableOpacity style={[styles.tBtn, dir === 'buy' && styles.tBuyOn]} onPress={() => onTrack(item, 'buy')} activeOpacity={0.75}>
                        <Text style={[styles.tBtnTxt, dir === 'buy' && styles.tOnTxt]}>{dir === 'buy' ? '✓B' : 'B'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.tBtn, dir === 'sell' && styles.tSellOn]} onPress={() => onTrack(item, 'sell')} activeOpacity={0.75}>
                        <Text style={[styles.tBtnTxt, dir === 'sell' && styles.tOnTxt]}>{dir === 'sell' ? '✓S' : 'S'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.aBtn} onPress={() => onDetail(item)} activeOpacity={0.75}>
                        <Text style={styles.aBtnTxt}>Chart</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.aBtn} onPress={() => onToggleWatch(item)} activeOpacity={0.75}>
                        <Text style={[styles.aBtnTxt, starred && { color: theme.green }]}>{starred ? '★' : '☆'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.aBtn} onPress={() => setAnalyseMenu(item.sym)} activeOpacity={0.75}>
                        <Text style={[styles.aBtnTxt, { color: theme.accent }]}>Analyse ▾</Text>
                      </TouchableOpacity>
                      {scanned ? (
                        <TouchableOpacity
                          style={[styles.scanBtn, included && styles.scanBtnOn]}
                          onPress={() => {
                            toggleInclude(item.sym);
                            toast(
                              isIncluded(item.sym)
                                ? `${item.sym} will be re-scanned on next Update List`
                                : `${item.sym} back to scanned — skipped on rebuild`,
                            );
                          }}
                          activeOpacity={0.75}
                        >
                          <Text style={[styles.scanBtnTxt, included && styles.scanBtnTxtOn]}>
                            {included ? '＋ Rescan' : '✓ Scanned'}
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <View style={styles.scanBtnGhost}>
                          <Text style={styles.scanGhostTxt}>· new</Text>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      ) : null}
    </ScrollView>

    {analyseMenu ? (
      <Sheet onClose={() => setAnalyseMenu(null)} maxHeight="55%">
        <Text style={styles.menuTitle}>{analyseMenu}</Text>
        <Text style={styles.menuLabel}>ANALYSE AS</Text>
        {[
          { icon: '◆', label: 'Symbol overview', hint: 'Price, technicals, fundamentals & patterns on one page', run: () => openStock(analyseMenu) },
          { icon: '◈', label: 'Multibagger', hint: '5x-potential score + fundamental checklist', run: () => onAnalyse(analyseMenu) },
          { icon: '▲', label: 'Momentum', hint: 'Multi-timeframe trade rating, S/R, momentum', run: () => navigate('analysis', { sub: 'momentum', symbol: analyseMenu }) },
          { icon: '▦', label: 'Institutional dossier', hint: 'Full company report — financials, ownership, filings', run: () => navigate('analysis', { sub: 'inst', symbol: analyseMenu }) },
        ].map((o) => (
          <TouchableOpacity
            key={o.label}
            style={styles.menuAct}
            activeOpacity={0.8}
            onPress={() => {
              const run = o.run;
              setAnalyseMenu(null);
              run();
            }}
          >
            <Text style={styles.menuActTxt}>{o.icon}  {o.label}</Text>
            <Text style={styles.menuActSub}>{o.hint}</Text>
          </TouchableOpacity>
        ))}
      </Sheet>
    ) : null}

    <SimpleColumnMenu
      visible={colMenu}
      cols={allCols.map((c) => ({ key: c.key, label: c.label }))}
      hidden={colHidden}
      onToggle={toggleCol}
      onClose={() => setColMenu(false)}
    />
    </>
  );
}

// ── Screen: sub-tabs (fixed screener list ⇄ one-click analyser) ──────────────
export default function MultibaggerScreen() {
  const [view, setView] = useState<'screen' | 'analyse'>('screen');
  // ⟳ Update-list lives here (beside the Screener/Analyser toggle). Bumping
  // mbRefresh triggers a rebuild inside MbList; mbLoading mirrors its progress
  // so the button disables mid-run.
  const [mbRefresh, setMbRefresh] = useState(0);
  const [mbLoading, setMbLoading] = useState(false);
  const [symbol, setSymbol] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<MultibaggerReport | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [detail, setDetail] = useState<Row | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [flash, setFlash] = useState('');
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((msg: string) => {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(''), 2000);
  }, []);

  // Recent searches persist across sessions; tapping one re-opens instantly
  // from the report cache.
  useEffect(() => {
    AsyncStorage.getItem(RECENT_KEY)
      .then((v) => {
        const p = v ? JSON.parse(v) : null;
        if (Array.isArray(p)) setRecent(p.filter((s) => typeof s === 'string'));
      })
      .catch(() => {});
  }, []);
  const pushRecent = (sym: string) => {
    setRecent((prev) => {
      const next = [sym, ...prev.filter((s) => s !== sym)].slice(0, 8);
      AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  };

  // `attempt` drives a single automatic retry: the report source (Yahoo) can
  // rate-limit a small-cap on the first hit, so a screened stock that "can't be
  // analysed" almost always succeeds on a second try a moment later.
  const analyse = (symOverride?: string, attempt = 0) => {
    const sym = (symOverride ?? symbol).trim().toUpperCase().replace(/^[A-Z]+:/, '');
    if (!sym) return;
    if (busy && attempt === 0) return;
    setView('analyse');
    setSymbol(sym);
    setError('');
    if (attempt === 0) pushRecent(sym);
    // Served from the searched-symbols cache when fresh — no refetch.
    const hit = reportCache.get(sym);
    if (hit && Date.now() - hit.ts < REPORT_TTL && attempt === 0) {
      setReport(hit.report);
      setCandles(hit.candles);
      setBusy(false);
      return;
    }
    setBusy(true);
    setReport(null);
    if (attempt === 0) setCandles([]);
    const fail = (msg: string) => {
      // Keep the spinner up and retry once for a likely-transient rate-limit;
      // only surface the error after the retry also fails.
      if (attempt < 1) {
        setTimeout(() => analyse(sym, attempt + 1), 2500);
      } else {
        setError(msg);
        setBusy(false);
      }
    };
    api
      .multibagger(sym)
      .then((r) => {
        if (r && !r.error) {
          setReport(r);
          setBusy(false);
          const entry = reportCache.get(sym);
          reportCache.set(sym, { report: r, candles: entry?.candles || [], ts: Date.now() });
        } else {
          fail(r?.error || 'No data available for ' + sym);
        }
      })
      .catch((e) => fail(e instanceof Error ? e.message : 'Analysis failed'));
    if (attempt === 0) {
      api
        .history(sym, '6mo', '1d')
        .then((h) => {
          const cs = Array.isArray(h.candles) ? h.candles : [];
          setCandles(cs);
          const entry = reportCache.get(sym);
          if (entry) entry.candles = cs;
        })
        .catch(() => setCandles([]));
    }
  };

  // Auto-analyse a symbol handed off from another screen (e.g. the Pattern
  // Recogniser or Watchlist "Analyse" button).
  useEffect(() => {
    const s = takeSymbol('mb');
    if (s) analyse(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openChart = () => {
    if (!report) return;
    setDetail({ sym: report.symbol, name: report.name, exchange: 'NSE', price: report.price ?? null });
  };
  const addToWatchlist = async () => {
    if (!report) return;
    const list = await loadWatchlist();
    if (list.includes(normSymbol(report.symbol))) {
      toast(`${report.symbol} is already in the watchlist`);
      return;
    }
    await addSymbol(list, report.symbol);
    toast(`${report.symbol} added to watchlist`);
  };
  const addToBacktest = async () => {
    if (!report) return;
    await AsyncStorage.setItem(BT_PREFILL_KEY, report.symbol).catch(() => {});
    toast(`${report.symbol} queued — open Analysis ▸ Backtest`);
  };

  const m = report?.metrics || {};

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <View style={styles.segRow}>
          {(['screen', 'analyse'] as const).map((v) => (
            <TouchableOpacity
              key={v}
              style={[styles.segBtn, view === v && styles.segBtnOn]}
              onPress={() => setView(v)}
              activeOpacity={0.75}
            >
              <Text style={[styles.segTxt, view === v && styles.segTxtOn]}>
                {v === 'screen' ? 'Screener' : 'Analyser'}
              </Text>
            </TouchableOpacity>
          ))}
          {view === 'screen' ? (
            <TouchableOpacity
              style={[styles.updBtn, mbLoading && { opacity: 0.5 }]}
              onPress={() => !mbLoading && setMbRefresh((t) => t + 1)}
              disabled={mbLoading}
              activeOpacity={0.75}
            >
              <Text style={styles.updTxt}>⟳ Update list</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <InfoButton title="Multibagger" content={MULTIBAGGER_INFO} />
      </View>

      {view === 'screen' ? (
        <MbList
          onAnalyse={(s) => analyse(s)}
          onDetail={setDetail}
          toast={toast}
          refreshSignal={mbRefresh}
          onLoadingChange={setMbLoading}
        />
      ) : (
        <>
          <View style={styles.inputRow}>
            <SymbolInput
              value={symbol}
              onChangeText={setSymbol}
              onSelect={(s) => analyse(s)}
              onSubmit={() => analyse()}
              placeholder="Small-cap NSE symbol — e.g. TARIL, KAYNES, JYOTICNC…"
              inputStyle={styles.input}
              containerStyle={{ flex: 1 }}
            />
            <Btn label={busy ? 'Analysing…' : 'Analyse'} onPress={() => analyse()} disabled={busy || !symbol.trim()} />
          </View>

          {recent.length ? (
            <View style={styles.recentRow}>
              <Text style={styles.recentLabel}>RECENT</Text>
              {recent.map((s) => (
                <TouchableOpacity key={s} style={styles.recentChip} onPress={() => analyse(s)} activeOpacity={0.75}>
                  <Text style={styles.recentTxt}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          <ScrollView contentContainerStyle={styles.body}>
            {busy ? <Loading label={`Reading ${symbol.toUpperCase()} fundamentals, ownership and trend…`} /> : null}
            {!busy && error ? (
              <>
                <EmptyState icon="⚠" title="Analysis failed" hint={error} />
                <View style={{ alignItems: 'center', marginTop: theme.sp.md }}>
                  <Btn label="↻ Retry" onPress={() => analyse(symbol)} />
                </View>
              </>
            ) : null}
            {!busy && !error && !report ? (
              <EmptyState
                icon="◆"
                title="Pick a stock to analyse"
                hint="Run the fixed Screener tab for candidates, or type any symbol — the score rewards a small base, fast compounding, clean balance sheets, promoter skin in the game and an intact uptrend."
              />
            ) : null}

            {report ? (
              <>
                <Card style={styles.headCard}>
                  <View style={styles.headRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.coName}>{report.name}</Text>
                      <Text style={styles.coMeta}>
                        {report.symbol}
                        {report.sector ? ` · ${report.sector}` : ''}
                        {report.industry ? ` · ${report.industry}` : ''}
                      </Text>
                    </View>
                    <View style={styles.headRight}>
                      <Text style={styles.coPrice}>{report.price != null ? '₹' + report.price.toLocaleString('en-IN') : ''}</Text>
                      <Text style={styles.coMeta}>{fmtCr(m.mcap_cr)}</Text>
                    </View>
                  </View>

                  <View style={styles.scoreRow}>
                    <View style={[styles.scoreBox, { borderColor: tierColor(report.score) }]}>
                      <Text style={[styles.scoreBig, { color: tierColor(report.score) }]}>{report.score}</Text>
                      <Text style={styles.scoreOf}>/100</Text>
                    </View>
                    <View style={{ flex: 1, gap: 6 }}>
                      <Text style={[styles.tier, { color: tierColor(report.score) }]}>{report.tier}</Text>
                      <View style={styles.probTrack}>
                        <View
                          style={[styles.probFill, { width: `${report.probability_pct}%`, backgroundColor: tierColor(report.score) }]}
                        />
                      </View>
                      <Text style={styles.probTxt}>
                        Indicative probability of a 5x+ outcome over 5–10 years: {' '}
                        <Text style={{ color: tierColor(report.score), fontWeight: '700' }}>{report.probability_pct}%</Text>
                        {report.coverage_pct < 100 ? `   ·   data coverage ${report.coverage_pct}%` : ''}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.actRow}>
                    <TouchableOpacity style={styles.actBtn} onPress={openChart} activeOpacity={0.75}>
                      <Text style={styles.actTxt}>▤ Chart</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actBtn} onPress={addToWatchlist} activeOpacity={0.75}>
                      <Text style={styles.actTxt}>★ Watchlist</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actBtn} onPress={() => navigate('analysis', { sub: 'inst', symbol: report.symbol })} activeOpacity={0.75}>
                      <Text style={styles.actTxt}>Dossier</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actBtn} onPress={() => navigate('analysis', { sub: 'momentum', symbol: report.symbol })} activeOpacity={0.75}>
                      <Text style={styles.actTxt}>Momentum</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actBtn} onPress={() => navigate('analysis', { sub: 'patterns', symbol: report.symbol })} activeOpacity={0.75}>
                      <Text style={styles.actTxt}>Pattern</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actBtn} onPress={addToBacktest} activeOpacity={0.75}>
                      <Text style={styles.actTxt}>⏱ Backtest</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actBtn} onPress={() => exportReport(report)} activeOpacity={0.75}>
                      <Text style={styles.actTxt}>⇩ Export report</Text>
                    </TouchableOpacity>
                  </View>
                </Card>

                <SectionTitle>Fundamental checklist</SectionTitle>
                <Card><ChecklistPanel symbol={report.symbol} /></Card>

                {candles.length ? (
                  <>
                    <SectionTitle>6-month chart</SectionTitle>
                    <Card style={styles.chartCard}>
                      <HtmlView html={chartHtml(candles, 86400)} style={styles.chart} />
                    </Card>
                  </>
                ) : null}

                <SectionTitle>Pillars — how the big players screen</SectionTitle>
                <Card>
                  {report.pillars.map((p) => (
                    <View key={p.key} style={styles.pillarRow}>
                      <View style={styles.pillarHead}>
                        <Text style={styles.pillarLabel}>
                          {p.label} <Text style={styles.pillarW}>· {p.weight}%</Text>
                        </Text>
                        <Text style={[styles.pillarScore, { color: p.score == null ? theme.muted : tierColor(p.score) }]}>
                          {p.score == null ? 'no data' : p.score}
                        </Text>
                      </View>
                      <View style={styles.pillarTrack}>
                        <View
                          style={[
                            styles.pillarFill,
                            { width: `${p.score ?? 0}%`, backgroundColor: p.score == null ? theme.border2 : tierColor(p.score) },
                          ]}
                        />
                      </View>
                      <Text style={styles.pillarNote}>{p.note}</Text>
                    </View>
                  ))}
                </Card>

                <SectionTitle>The classic checklist</SectionTitle>
                <Card>
                  <View style={styles.checkWrap}>
                    {report.checklist.map((c) => (
                      <View key={c.label} style={styles.checkItem}>
                        <Text
                          style={[
                            styles.checkMark,
                            { color: c.state === 'pass' ? theme.green : c.state === 'fail' ? theme.red : theme.muted },
                          ]}
                        >
                          {c.state === 'pass' ? '✓' : c.state === 'fail' ? '✗' : '?'}
                        </Text>
                        <Text style={styles.checkLabel}>{c.label}</Text>
                      </View>
                    ))}
                  </View>
                </Card>

                {report.strengths.length ? (
                  <>
                    <SectionTitle>What works</SectionTitle>
                    <Card>
                      {report.strengths.map((s) => (
                        <Text key={s} style={[styles.bullet, { color: theme.green }]}>
                          ▲ <Text style={styles.bulletTxt}>{s}</Text>
                        </Text>
                      ))}
                    </Card>
                  </>
                ) : null}

                {report.red_flags.length ? (
                  <>
                    <SectionTitle>Red flags</SectionTitle>
                    <Card>
                      {report.red_flags.map((s) => (
                        <Text key={s} style={[styles.bullet, { color: theme.red }]}>
                          ▼ <Text style={styles.bulletTxt}>{s}</Text>
                        </Text>
                      ))}
                    </Card>
                  </>
                ) : null}

                <SectionTitle>Key numbers</SectionTitle>
                <View style={styles.tiles}>
                  <StatTile label="Market cap" value={fmtCr(m.mcap_cr)} />
                  <StatTile label="Revenue growth" value={fmt(m.revenue_growth_pct, '%')} color={m.revenue_growth_pct != null && m.revenue_growth_pct >= 15 ? theme.green : undefined} />
                  <StatTile label="Earnings growth" value={fmt(m.earnings_growth_pct, '%')} color={m.earnings_growth_pct != null && m.earnings_growth_pct >= 18 ? theme.green : undefined} />
                  <StatTile label="ROE" value={fmt(m.roe_pct, '%')} />
                  <StatTile label="Op margin" value={fmt(m.op_margin_pct, '%')} />
                  <StatTile label="Debt / equity" value={fmt(m.debt_equity, '', 2)} color={m.debt_equity != null && m.debt_equity > 1.5 ? theme.red : undefined} />
                  <StatTile label="Free cash flow" value={fmtCr(m.fcf_cr)} color={m.fcf_cr != null && m.fcf_cr < 0 ? theme.red : undefined} />
                  <StatTile label="Promoter / insider" value={fmt(m.insider_pct, '%')} />
                  <StatTile label="Institutions" value={fmt(m.institution_pct, '%')} />
                  <StatTile label="P/E" value={fmt(m.pe, '', 1)} />
                  <StatTile label="PEG" value={fmt(m.peg, '', 2)} />
                  <StatTile label="vs 200-DMA" value={fmt(m.vs_200dma_pct, '%')} color={m.vs_200dma_pct != null ? (m.vs_200dma_pct >= 0 ? theme.green : theme.red) : undefined} />
                  <StatTile label="3y price CAGR" value={fmt(m.price_cagr_3y_pct, '%')} />
                  <StatTile label="From 52w high" value={fmt(m.pct_from_high_pct, '%')} />
                </View>

                {report.about ? (
                  <>
                    <SectionTitle>About the company</SectionTitle>
                    <Card>
                      <Text style={styles.about}>{report.about}</Text>
                    </Card>
                  </>
                ) : null}

                <Text style={styles.method}>{report.methodology}</Text>
                <Text style={styles.disclaimer}>{report.disclaimer}</Text>
              </>
            ) : null}
          </ScrollView>
        </>
      )}

      {detail ? <StockDetail row={detail} onClose={() => setDetail(null)} /> : null}
      {flash ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastTxt}>{flash}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.md, paddingBottom: theme.sp.sm },
  segRow: { flexDirection: 'row', gap: theme.sp.xs },
  segBtn: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 7,
  },
  segBtnOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  segTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '700' },
  segTxtOn: { color: theme.onAccent },
  // Status line under the controls: match count + build progress.
  fixedNote: { color: theme.muted, fontSize: theme.fs.sm, paddingHorizontal: 12, paddingBottom: 6 },
  secRow: { flexDirection: 'row', paddingHorizontal: 12, paddingBottom: 8, alignItems: 'center', gap: theme.sp.sm, zIndex: 30 },
  ctlBtn: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 7,
  },
  ctlTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '600' },
  exportMenu: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 4,
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    zIndex: 40,
    elevation: 8,
    minWidth: 110,
  },
  exportItem: { paddingHorizontal: theme.sp.md, paddingVertical: 9 },
  exportItemTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '600' },
  stratRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 8, gap: 6 },
  stratInfoOn: { opacity: 1 },
  stratInfoOff: { opacity: 0.4 },
  updBtn: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 5,
  },
  updTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
  lastUpd: { color: theme.muted, fontSize: theme.fs.xs + 1, paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.sm },
  // A plain wrapping row, not a horizontal ScrollView: on react-native-web that
  // ScrollView collapsed to a few px tall (overflow-y:hidden) and the results
  // body painted over the chips. A flex-wrap row reserves real height, so no
  // overlap. Recents are capped + short, so wrapping to a second line is fine.
  recentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.sp.sm,
    paddingHorizontal: theme.sp.lg,
    marginBottom: theme.sp.sm,
  },
  recentLabel: { color: theme.muted, fontSize: theme.fs.xs + 1, fontWeight: '700', letterSpacing: 1 },
  recentChip: {
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 4,
  },
  recentTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontFamily: theme.mono, fontWeight: '700' },
  // table (mirrors the Screener)
  headerRow: {
    flexDirection: 'row',
    borderBottomColor: theme.border2,
    borderBottomWidth: 1,
    backgroundColor: theme.surface2,
    paddingVertical: theme.sp.sm,
  },
  th: { justifyContent: 'center', paddingHorizontal: theme.sp.xs },
  thTxt: { color: theme.muted2, fontSize: theme.fs.xs + 1, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    paddingVertical: 3,
    minHeight: 32,
  },
  td: { justifyContent: 'center', paddingHorizontal: theme.sp.xs },
  actionsCell: {
    width: MB_ACTIONS_W,
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanBtn: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.sp.sm,
    paddingVertical: 3,
    minWidth: 74,
    alignItems: 'center',
  },
  scanBtnOn: { backgroundColor: GOLD, borderColor: GOLD },
  scanBtnTxt: { color: theme.green, fontSize: theme.fs.xs + 1, fontWeight: '700' },
  scanBtnTxtOn: { color: '#111' },
  scanBtnGhost: { minWidth: 74, alignItems: 'center', paddingVertical: 3 },
  scanGhostTxt: { color: theme.muted, fontSize: theme.fs.xs + 1 },
  tBtn: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.sp.sm,
    paddingVertical: 3,
    minWidth: 30,
    alignItems: 'center',
  },
  tBuyOn: { backgroundColor: theme.green, borderColor: theme.green },
  tSellOn: { backgroundColor: theme.red, borderColor: theme.red },
  tBtnTxt: { color: theme.muted2, fontFamily: theme.mono, fontSize: theme.fs.sm, fontWeight: '700' },
  tOnTxt: { color: theme.onAccent },
  aBtn: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.sp.sm,
    paddingVertical: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aBtnTxt: { color: theme.muted2, fontSize: theme.fs.xs + 1, fontWeight: '700' },
  // analyser
  inputRow: {
    flexDirection: 'row',
    gap: theme.sp.sm,
    paddingHorizontal: theme.sp.lg,
    paddingBottom: theme.sp.md,
    zIndex: 50,
  },
  input: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    color: theme.text,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 10,
    fontSize: theme.fs.md,
    fontFamily: theme.mono,
  },
  body: { paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.xl, gap: theme.sp.sm },
  headCard: { gap: theme.sp.md },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp.md },
  headRight: { alignItems: 'flex-end' },
  coName: { color: theme.text, fontSize: theme.fs.lg, fontWeight: '800' },
  coMeta: { color: theme.muted, fontSize: theme.fs.sm, marginTop: 2 },
  coPrice: { color: theme.text, fontSize: theme.fs.lg, fontWeight: '700', fontFamily: theme.mono },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.lg },
  scoreBox: {
    flexDirection: 'row',
    alignItems: 'baseline',
    borderWidth: 1.5,
    borderRadius: theme.radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: theme.surface2,
  },
  scoreBig: { fontSize: 44, fontWeight: '800', fontFamily: theme.mono, lineHeight: 48 },
  scoreOf: { color: theme.muted, fontSize: theme.fs.sm, marginLeft: 3, fontFamily: theme.mono },
  tier: { fontSize: theme.fs.md, fontWeight: '800', letterSpacing: 1.5 },
  probTrack: { height: 10, borderRadius: 5, backgroundColor: theme.surface3, overflow: 'hidden' },
  probFill: { height: '100%', borderRadius: 5 },
  probTxt: { color: theme.muted, fontSize: theme.fs.sm },
  actRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm },
  actBtn: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm + 1,
  },
  actTxt: { color: theme.text, fontSize: theme.fs.sm + 1, fontWeight: '600' },
  // row → "analyse as" menu
  menuTitle: { color: theme.text, fontSize: theme.fs.lg, fontWeight: '800' },
  menuLabel: { color: theme.muted, fontSize: theme.fs.xs, fontWeight: '700', letterSpacing: 1, marginTop: theme.sp.sm, marginBottom: theme.sp.sm },
  menuAct: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.md,
    marginBottom: theme.sp.sm,
    backgroundColor: theme.surface2,
  },
  menuActTxt: { color: theme.text, fontSize: theme.fs.md + 1, fontWeight: '700' },
  menuActSub: { color: theme.muted, fontSize: theme.fs.sm, marginTop: 2 },
  chartCard: { height: 240, padding: 0, overflow: 'hidden' },
  chart: { flex: 1 },
  pillarRow: { paddingVertical: theme.sp.sm, gap: 5 },
  pillarHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pillarLabel: { color: theme.text, fontSize: theme.fs.md, fontWeight: '600' },
  pillarW: { color: theme.muted, fontSize: theme.fs.sm, fontWeight: '400' },
  pillarScore: { fontFamily: theme.mono, fontSize: theme.fs.md, fontWeight: '700' },
  pillarTrack: { height: 6, borderRadius: 3, backgroundColor: theme.surface3, overflow: 'hidden' },
  pillarFill: { height: '100%', borderRadius: 3 },
  pillarNote: { color: theme.muted, fontSize: theme.fs.sm, lineHeight: 16 },
  checkWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  checkItem: { flexDirection: 'row', alignItems: 'center', gap: 7, width: '50%', minWidth: 260, paddingVertical: 5 },
  checkMark: { fontFamily: theme.mono, fontSize: theme.fs.md, fontWeight: '800', width: 14 },
  checkLabel: { color: theme.muted2, fontSize: theme.fs.sm, flexShrink: 1 },
  bullet: { fontSize: theme.fs.sm, lineHeight: 20, paddingVertical: 2 },
  bulletTxt: { color: theme.text },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm },
  about: { color: theme.muted2, fontSize: theme.fs.sm, lineHeight: 19 },
  method: { color: theme.muted, fontSize: theme.fs.sm, lineHeight: 17, marginTop: theme.sp.sm },
  disclaimer: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 15, fontStyle: 'italic' },
  toast: {
    position: 'absolute',
    bottom: theme.sp.xl,
    alignSelf: 'center',
    backgroundColor: theme.surface3,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.sm + 2,
  },
  toastTxt: { color: theme.text, fontSize: theme.fs.sm + 1, fontWeight: '600' },
});
