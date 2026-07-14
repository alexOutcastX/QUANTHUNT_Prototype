import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Candle, MultibaggerReport, api } from '../api';
import { chartHtml } from '../chartHtml';
import HtmlView from '../components/HtmlView';
import StockDetail from '../components/StockDetail';
import SymbolInput from '../components/SymbolInput';
import { ActiveFilters, Row, applyFilters } from '../screener';
import { ACTIONS_W, COLS, DEFAULT_HIDDEN, cellFlex, loadNames } from './ScreenerScreen';
import { TrackDir, TrackEntry, addTrack, loadTrack, removeTrack } from '../tracklist';
import { addSymbol, loadWatchlist, normSymbol, removeSymbol } from '../watchlist';
import { Btn, Card, EmptyState, Loading, ScreenTitle, SectionTitle, StatTile } from '../ui';
import { theme } from '../theme';

const GOLD = '#f5c518';
const BT_PREFILL_KEY = 'taureye.backtest.prefill';

// The fixed multibagger screen — non-editable by design. Small/mid base,
// quality returns, low leverage, price in an uptrend; the analyser then does
// the deep read on ownership/growth/valuation per stock.
const FIXED_FILTERS: ActiveFilters = {
  market_cap_cr: { max: 20000 },
  roe: { min: 15 },
  debt_equity: { max: 0.6 },
  d200: { min: 0 },
};
const FIXED_CHIPS = [
  'Mkt cap < ₹20,000 cr',
  'ROE > 15%',
  'D/E < 0.6',
  'Above 200-DMA',
];
const SCREEN_INDICES = ['NIFTY MIDCAP 100', 'NIFTY SMALLCAP 100'];

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

// Printable HTML report (web: opens a print window → "Save as PDF").
function reportHtml(r: MultibaggerReport): string {
  const m = r.metrics || {};
  const row = (k: string, v: string) => `<tr><td>${esc(k)}</td><td style="text-align:right">${esc(v)}</td></tr>`;
  const pillars = r.pillars
    .map((p) => row(`${p.label} (${p.weight}%)`, p.score == null ? 'no data' : String(p.score)))
    .join('');
  const checks = r.checklist
    .map((c) => `<li>${c.state === 'pass' ? '✓' : c.state === 'fail' ? '✗' : '?'} ${esc(c.label)}</li>`)
    .join('');
  const list = (xs: string[]) => xs.map((x) => `<li>${esc(x)}</li>`).join('');
  const nums = [
    ['Market cap', fmtCr(m.mcap_cr)], ['Revenue growth', fmt(m.revenue_growth_pct, '%')],
    ['Earnings growth', fmt(m.earnings_growth_pct, '%')], ['ROE', fmt(m.roe_pct, '%')],
    ['Op margin', fmt(m.op_margin_pct, '%')], ['Debt/equity', fmt(m.debt_equity, '', 2)],
    ['Free cash flow', fmtCr(m.fcf_cr)], ['Promoter/insider', fmt(m.insider_pct, '%')],
    ['Institutions', fmt(m.institution_pct, '%')], ['P/E', fmt(m.pe, '', 1)],
    ['PEG', fmt(m.peg, '', 2)], ['vs 200-DMA', fmt(m.vs_200dma_pct, '%')],
    ['3y price CAGR', fmt(m.price_cagr_3y_pct, '%')], ['From 52w high', fmt(m.pct_from_high_pct, '%')],
  ].map(([k, v]) => row(k, v)).join('');
  return `<html><head><title>TaurEye — Multibagger report — ${esc(r.symbol)}</title>
<style>body{font-family:Arial,sans-serif;color:#111;max-width:760px;margin:24px auto;padding:0 16px}
h1{font-size:20px;margin-bottom:0}h2{font-size:14px;margin:18px 0 6px}
table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #ddd;padding:5px 4px;font-size:12px}
ul{margin:4px 0;padding-left:18px;font-size:12px;line-height:1.5}p{font-size:11px;color:#555}
.score{font-size:40px;font-weight:800}</style></head><body>
<h1>${esc(r.name)} <span style="color:#888;font-size:13px">${esc(r.symbol)}${r.sector ? ' · ' + esc(r.sector) : ''}</span></h1>
<div class="score">${r.score}/100 — ${esc(r.tier)}</div>
<div>Indicative probability of a 5x+ outcome over 5–10 years: <b>${r.probability_pct}%</b>${r.coverage_pct < 100 ? ` (data coverage ${r.coverage_pct}%)` : ''}</div>
<h2>Pillars</h2><table>${pillars}</table>
<h2>Checklist</h2><ul>${checks}</ul>
${r.strengths.length ? `<h2>What works</h2><ul>${list(r.strengths)}</ul>` : ''}
${r.red_flags.length ? `<h2>Red flags</h2><ul>${list(r.red_flags)}</ul>` : ''}
<h2>Key numbers</h2><table>${nums}</table>
${r.about ? `<h2>About</h2><p>${esc(r.about)}</p>` : ''}
<p>${esc(r.methodology)}</p><p><i>${esc(r.disclaimer)}</i></p></body></html>`;
}

async function exportReport(r: MultibaggerReport): Promise<void> {
  if (Platform.OS !== 'web') {
    await Share.share({
      title: `Multibagger report — ${r.symbol}`,
      message: `${r.name} (${r.symbol}): ${r.score}/100 — ${r.tier} · probability ${r.probability_pct}%`,
    });
    return;
  }
  const win = (globalThis as { window?: any }).window;
  const w = win?.open?.('', '_blank');
  if (!w) return; // popup blocked
  w.document.write(reportHtml(r));
  w.document.close();
  w.focus();
  setTimeout(() => {
    try { w.print(); } catch { /* user can print manually */ }
  }, 250);
}

// ── Fixed-filter multibagger screener (list only) ────────────────────────────
// Candidates: mid + small cap indices, scanned and fundamentals-enriched, then
// passed through FIXED_FILTERS. Loaded once per app session (module cache).
let mbRowsCache: Row[] | null = null;

function MbList({
  onAnalyse,
  onDetail,
  toast,
}: {
  onAnalyse: (sym: string) => void;
  onDetail: (r: Row) => void;
  toast: (msg: string) => void;
}) {
  const [rows, setRows] = useState<Row[]>(mbRowsCache || []);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(!mbRowsCache);
  const [track, setTrack] = useState<TrackEntry[]>([]);
  const [watch, setWatch] = useState<string[]>([]);

  useEffect(() => {
    loadTrack().then(setTrack);
    loadWatchlist().then(setWatch);
  }, []);

  useEffect(() => {
    if (mbRowsCache) return;
    let cancelled = false;
    (async () => {
      try {
        const [names, ...idx] = await Promise.all([
          loadNames(),
          ...SCREEN_INDICES.map((n) => api.indexConstituents(n).catch(() => ({ data: [] }))),
        ]);
        const seen = new Set<string>();
        const seeded: Row[] = [];
        idx.forEach((r) =>
          (r.data || []).forEach((c) => {
            if (!c.symbol || seen.has(c.symbol)) return;
            seen.add(c.symbol);
            seeded.push({
              sym: c.symbol,
              name: names[c.symbol.toUpperCase()]?.name,
              exchange: names[c.symbol.toUpperCase()]?.exchange || 'NSE',
              price: c.price, prevClose: c.prevClose, chg: c.chg, absChg: c.absChg, volume: c.volume,
            });
          }),
        );
        if (cancelled) return;
        if (!seeded.length) {
          setNote('No candidates returned.');
          setLoading(false);
          return;
        }
        setRows(seeded);
        setLoading(false);
        const syms = seeded.map((r) => r.sym);
        setNote(`${syms.length} mid & small caps · scanning…`);
        await api.scan(syms, {
          onBatch: (data, done) => {
            if (cancelled) return;
            setRows((prev) => prev.map((r) => (data[r.sym] ? { ...r, ...data[r.sym], price: r.price ?? data[r.sym].price, chg: r.chg ?? data[r.sym].chg, volume: r.volume ?? data[r.sym].volume } : r)));
            setNote(`${syms.length} mid & small caps · technicals ${Math.min(done, syms.length)}/${syms.length}`);
          },
        });
        // Fundamentals (bounded poll — the filters need mcap/ROE/D-E).
        let target = syms;
        const settled = new Set<string>();
        for (let round = 0; round < 20 && target.length && !cancelled; round++) {
          try {
            const res = await api.fundamentalsBulk(target);
            if (cancelled) return;
            const data = res.data || {};
            Object.keys(data).forEach((s) => settled.add(s));
            setRows((prev) => prev.map((r) => (data[r.sym] !== undefined ? { ...r, _fund: data[r.sym] as Row['_fund'] } : r)));
            const pending = new Set(res.pending || []);
            target = target.filter((s) => !settled.has(s) && pending.has(s));
          } catch {
            break;
          }
          if (target.length) await new Promise((r) => setTimeout(r, 3000));
        }
        if (!cancelled) {
          setRows((prev) => {
            const done = prev.map((r) => (r._fund === undefined ? { ...r, _fund: null } : r));
            mbRowsCache = done;
            return done;
          });
          setNote(`${syms.length} mid & small caps screened`);
        }
      } catch (e) {
        if (!cancelled) {
          setNote(e instanceof Error ? e.message : 'Failed to load candidates');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleCols = useMemo(() => COLS.filter((c) => !DEFAULT_HIDDEN.includes(c.key)), []);
  const tableW = useMemo(() => visibleCols.reduce((a, c) => a + c.w, 0) + ACTIONS_W, [visibleCols]);
  const matches = useMemo(() => {
    const f = applyFilters(rows, FIXED_FILTERS);
    return [...f].sort((a, b) => {
      const ma = (a._fund as { market_cap_cr?: number } | null)?.market_cap_cr ?? Infinity;
      const mb = (b._fund as { market_cap_cr?: number } | null)?.market_cap_cr ?? Infinity;
      return ma - mb; // smallest base first — the most multibagger headroom
    });
  }, [rows]);

  const warming = rows.some((r) => r._fund === undefined);

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
    <ScrollView style={{ flex: 1 }}>
      <View style={styles.fixedRow}>
        <Text style={styles.fixedLabel}>FIXED SCREEN</Text>
        {FIXED_CHIPS.map((c) => (
          <View key={c} style={styles.fixedChip}>
            <Text style={styles.fixedChipTxt}>{c}</Text>
          </View>
        ))}
        <Text style={styles.fixedNote} numberOfLines={1}>
          {matches.length} match{matches.length === 1 ? '' : 'es'}
          {warming ? ' · loading fundamentals…' : ''} · {note} · tap a symbol to analyse
        </Text>
      </View>

      {loading ? <Loading label="Loading mid & small cap candidates…" /> : null}

      {!loading ? (
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: '100%' }}>
          <View style={{ minWidth: tableW, flexGrow: 1 }}>
            <View style={styles.headerRow}>
              {visibleCols.map((c) => (
                <View key={c.key} style={[styles.th, cellFlex(c), { alignItems: c.align === 'left' ? 'flex-start' : 'flex-end' }]}>
                  <Text style={styles.thTxt}>{c.label}</Text>
                </View>
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
              matches.map((item) => {
                const dir = trackDirOf(item.sym);
                const starred = isWatched(item.sym);
                return (
                  <View key={item.sym} style={styles.dataRow}>
                    {visibleCols.map((c) =>
                      c.key === 'sym' || c.key === 'name' ? (
                        <TouchableOpacity
                          key={c.key}
                          style={[styles.td, cellFlex(c), { alignItems: 'flex-start' }]}
                          onPress={() => onAnalyse(item.sym)}
                          activeOpacity={0.75}
                        >
                          {c.render(item)}
                        </TouchableOpacity>
                      ) : (
                        <View key={c.key} style={[styles.td, cellFlex(c), { alignItems: c.align === 'left' ? 'flex-start' : 'flex-end' }]}>
                          {c.render(item)}
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
                      <TouchableOpacity style={styles.aBtn} onPress={() => onAnalyse(item.sym)} activeOpacity={0.75}>
                        <Text style={[styles.aBtnTxt, { color: theme.accent }]}>Analyse</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      ) : null}
    </ScrollView>
  );
}

// ── Screen: sub-tabs (fixed screener list ⇄ one-click analyser) ──────────────
export default function MultibaggerScreen() {
  const [view, setView] = useState<'screen' | 'analyse'>('screen');
  const [symbol, setSymbol] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<MultibaggerReport | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [detail, setDetail] = useState<Row | null>(null);
  const [flash, setFlash] = useState('');
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((msg: string) => {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(''), 2000);
  }, []);

  const analyse = (symOverride?: string) => {
    const sym = (symOverride ?? symbol).trim().toUpperCase().replace(/^[A-Z]+:/, '');
    if (!sym || busy) return;
    setView('analyse');
    setSymbol(sym);
    setBusy(true);
    setError('');
    setReport(null);
    setCandles([]);
    api
      .multibagger(sym)
      .then((r) => {
        if (r && !r.error) setReport(r);
        else setError(r?.error || 'No data available for ' + sym);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Analysis failed'))
      .finally(() => setBusy(false));
    api
      .history(sym, '6mo', '1d')
      .then((h) => setCandles(Array.isArray(h.candles) ? h.candles : []))
      .catch(() => setCandles([]));
  };

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
      <ScreenTitle
        title="Multibagger"
        sub="Fixed-screen candidates + one-click potential analyser · Lynch, Mayer & the 100x studies"
        right={
          <View style={styles.segRow}>
            {(['screen', 'analyse'] as const).map((v) => (
              <TouchableOpacity
                key={v}
                style={[styles.segBtn, view === v && styles.segBtnOn]}
                onPress={() => setView(v)}
                activeOpacity={0.75}
              >
                <Text style={[styles.segTxt, view === v && styles.segTxtOn]}>
                  {v === 'screen' ? '◆ Screener' : '⚡ Analyser'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        }
      />

      {view === 'screen' ? (
        <MbList onAnalyse={(s) => analyse(s)} onDetail={setDetail} toast={toast} />
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
            <Btn label={busy ? 'Analysing…' : '⚡ Analyse'} onPress={() => analyse()} disabled={busy || !symbol.trim()} />
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            {busy ? <Loading label={`Reading ${symbol.toUpperCase()} fundamentals, ownership and trend…`} /> : null}
            {!busy && error ? <EmptyState icon="⚠" title="Analysis failed" hint={error} /> : null}
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
                    <View style={styles.scoreBox}>
                      <Text style={[styles.scoreBig, { color: tierColor(report.score) }]}>{report.score}</Text>
                      <Text style={styles.scoreOf}>/ 100</Text>
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
                    <TouchableOpacity style={styles.actBtn} onPress={addToBacktest} activeOpacity={0.75}>
                      <Text style={styles.actTxt}>⏱ Backtest</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actBtn} onPress={() => exportReport(report)} activeOpacity={0.75}>
                      <Text style={styles.actTxt}>⇩ Export report</Text>
                    </TouchableOpacity>
                  </View>
                </Card>

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
  // fixed-screen banner
  fixedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.sp.sm,
    paddingHorizontal: theme.sp.lg,
    paddingBottom: theme.sp.sm,
  },
  fixedLabel: { color: theme.muted, fontSize: theme.fs.xs + 1, fontWeight: '700', letterSpacing: 1 },
  fixedChip: {
    backgroundColor: theme.surface2,
    borderColor: GOLD,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 4,
  },
  fixedChipTxt: { color: GOLD, fontSize: theme.fs.sm },
  fixedNote: { color: theme.muted, fontSize: theme.fs.sm, flexShrink: 1 },
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
    width: ACTIONS_W,
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
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
  scoreBox: { flexDirection: 'row', alignItems: 'baseline' },
  scoreBig: { fontSize: 54, fontWeight: '800', fontFamily: theme.mono, lineHeight: 58 },
  scoreOf: { color: theme.muted, fontSize: theme.fs.md, marginLeft: 4 },
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
