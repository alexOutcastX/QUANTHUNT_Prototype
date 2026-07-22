import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MomentumHit, StrategyScoresResp, TimeframesResp, api } from '../api';
import { openPdfPreview } from '../pdf';
import StockDetail from '../components/StockDetail';
import { useResponsive } from '../responsive';
import { Row } from '../screener';
import { addSymbol, loadWatchlist, normSymbol, removeSymbol } from '../watchlist';
import { LocalAlert, addLocalAlert, hasLocalAlert, loadLocalAlerts } from '../localalerts';
import { capBand } from '../marketcap';
import { Btn, Dropdown, EmptyState, InfoButton, Loading, Sheet } from '../ui';
import { MOMENTUM_INFO } from '../tabInfo';
import StrategyScores from '../components/StrategyScores';
import TimeframePanel from '../components/TimeframePanel';
import SymbolInput from '../components/SymbolInput';
import { navigate, openStock, takeSector, takeSymbol } from '../navIntent';
import { useAdvisory } from '../flags';
import { mergeSectors } from '../sectors';
import { theme } from '../theme';

// Per-symbol enrichment (sector + market cap) fetched separately from the
// radar — the momentum scan itself carries neither field.
type Enrich = { sector?: string | null; mcap?: number | null };

const GOLD = '#f5c518';

type SetupKind = MomentumHit['setup'];
const SETUP_LABEL: Record<SetupKind, string> = {
  breakout: 'BREAKOUT WATCH',
  fired: 'BREAKOUT FIRED',
  pullback: 'PULLBACK REVERSAL',
};
const SETUP_FILTERS: { key: 'all' | SetupKind; label: string }[] = [
  { key: 'all', label: 'All setups' },
  { key: 'breakout', label: 'Breakout watch' },
  { key: 'fired', label: 'Breakout fired' },
  { key: 'pullback', label: '↩ Pullback reversal' },
];

const setupColor = (s: SetupKind) =>
  s === 'fired' ? theme.green : s === 'breakout' ? GOLD : theme.accent;

// Momentum selection strategies — composite filters over the radar hits, on top
// of the setup chips + sector. Each is a predicate on a MomentumHit using the
// fields the radar already carries: daily strength (chg / rsi / setup) and the
// higher-timeframe trend (d200 = vs 200-DMA, pct_from_high = distance below the
// 52-week high). "Daily strong · weekly/monthly weak" is the divergence screen:
// a stock thrusting today while still under its longer-term trend.
type MomStrategy = {
  key: string;
  label: string;
  hint: string;
  match: (h: MomentumHit) => boolean;
};
const MOM_STRATEGIES: MomStrategy[] = [
  { key: 'all', label: 'All strategies', hint: 'Every qualifying setup.', match: () => true },
  {
    key: 'leaders',
    label: 'Trend leaders (near highs)',
    hint: 'Above the 200-DMA and within ~12% of the 52-week high — strongest trends.',
    match: (h) => (h.d200 ?? -1) > 0 && (h.pct_from_high ?? -100) > -12,
  },
  {
    key: 'breakout',
    label: 'Breakout momentum',
    hint: 'Breakout / breakout-fired setups that are trend-aligned (at/above the 200-DMA).',
    match: (h) => (h.setup === 'breakout' || h.setup === 'fired') && (h.d200 == null || h.d200 >= 0),
  },
  {
    key: 'pullback',
    label: 'Pullback in uptrend',
    hint: 'Orderly dips inside an intact uptrend — buy-the-dip candidates.',
    match: (h) => h.setup === 'pullback' && (h.d200 == null || h.d200 > 0),
  },
  {
    key: 'volume',
    label: 'Volume thrust (≥2× RVOL)',
    hint: 'Relative volume 2× or more — institutional participation behind the move.',
    match: (h) => (h.relvol ?? 0) >= 2,
  },
  {
    key: 'divergence',
    label: 'Daily strong · weekly/monthly weak',
    hint: 'Up today but down over both the trailing week and month — a real timeframe divergence (mean-reversion bounce). Uses actual 1-week & 1-month returns. Higher risk / counter-trend.',
    // Exact: positive today, negative over the trailing week AND month.
    match: (h) => (h.chg ?? 0) > 0 && (h.ret_1w ?? 0) < 0 && (h.ret_1m ?? 0) < 0,
  },
];

// Desktop table columns (fixed widths → header + rows share one width so they
// stay aligned inside the horizontal scroll). `text` = left aligned.
// 'sector' / 'cap' aren't fields on MomentumHit — they come from the enrichment
// map — but they still get their own sortable columns.
type ColKey = keyof MomentumHit | 'sector' | 'cap';
type ColDef = { key: ColKey; label: string; w: number; text?: boolean };
const COLS: ColDef[] = [
  { key: 'symbol', label: 'SYMBOL', w: 92, text: true },
  { key: 'name', label: 'NAME', w: 190, text: true },
  { key: 'exchange', label: 'EXCH', w: 46, text: true },
  { key: 'sector', label: 'SECTOR', w: 140, text: true },
  { key: 'cap', label: 'CAP', w: 66, text: true },
  { key: 'setup', label: 'SETUP', w: 150, text: true },
  { key: 'score', label: 'SCORE', w: 56 },
  { key: 'probability', label: 'PROB', w: 54 },
  { key: 'price', label: 'LTP', w: 94 },
  { key: 'chg', label: '% CHG', w: 70 },
  { key: 'rsi', label: 'RSI', w: 46 },
  { key: 'relvol', label: 'RVOL', w: 58 },
  { key: 'd200', label: 'VS 200DMA', w: 82 },
  { key: 'pct_from_high', label: '52W HI', w: 68 },
  { key: 'upside_pct', label: 'UPSIDE', w: 72 },
];
const ACTIONS_W = 142;
const TABLE_W = 36 + COLS.reduce((a, c) => a + c.w, 0) + ACTIONS_W; // 36 = serial column

// Mobile sort options (headers are gone on the card layout).
const MOBILE_SORTS: { key: ColKey; label: string }[] = [
  { key: 'score', label: 'Score' },
  { key: 'probability', label: 'Prob' },
  { key: 'chg', label: '% Chg' },
  { key: 'relvol', label: 'RVol' },
  { key: 'rsi', label: 'RSI' },
  { key: 'price', label: 'LTP' },
  { key: 'upside_pct', label: 'Upside' },
  { key: 'cap', label: 'Cap' },
  { key: 'sector', label: 'Sector' },
];

const pct = (v: number | null | undefined, d = 1) =>
  v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + '%';
const fmtIN = (v: number | null | undefined) =>
  v == null || !isFinite(v)
    ? '—'
    : v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtAsof = (epoch: number) =>
  new Date(epoch * 1000).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
// Compact market cap (input in ₹ crore): 123456 → "₹1.23L Cr", 12345 → "₹12.3K Cr".
const fmtCap = (cr?: number | null) => {
  if (cr == null || !isFinite(cr)) return null;
  if (cr >= 100000) return '₹' + (cr / 100000).toFixed(2) + 'L Cr';
  if (cr >= 1000) return '₹' + (cr / 1000).toFixed(1) + 'K Cr';
  return '₹' + Math.round(cr).toLocaleString('en-IN') + ' Cr';
};

// Market-cap band chip (LARGE / MID / SMALL / MICRO) — shared by table + cards.
function capTag(mcapCr?: number | null) {
  const b = capBand(mcapCr);
  if (!b) return <Text style={styles.capDash}>—</Text>;
  return (
    <View style={[styles.capChip, { borderColor: b.color }]}>
      <Text style={[styles.capChipTxt, { color: b.color }]}>{b.short}</Text>
    </View>
  );
}

// The expandable technical read — shared by the desktop table and mobile cards.
function ReadBox({ h, c, width }: { h: MomentumHit; c: string; width?: number }) {
  return (
    <View style={[styles.readBox, width ? { width } : { width: '100%' }]}>
      <View style={styles.probTrack}>
        <View style={[styles.probFill, { width: `${h.probability}%`, backgroundColor: c }]} />
      </View>
      <Text style={styles.readMeta}>
        Technical score {h.score}/100 · indicative follow-through probability {h.probability}%
      </Text>
      {h.signals.map((s) => (
        <Text key={s} style={styles.sigTxt}>▲ <Text style={styles.sigBody}>{s}</Text></Text>
      ))}
      {h.cautions.map((s) => (
        <Text key={s} style={styles.cauTxt}>▼ <Text style={styles.sigBody}>{s}</Text></Text>
      ))}
    </View>
  );
}

// Full tap-to-open detail card — mirrors the depth of the long/short/institutional
// popups: setup verdict, live stats, technical read, glossary, strategy scorecard
// and the same analyse/export action row.
function MomDetail({
  h,
  enr,
  watched,
  alerted,
  onClose,
  onChart,
  onAlert,
  onWatch,
  onAnalyse,
  onPattern,
  onDossier,
}: {
  h: MomentumHit;
  enr?: Enrich;
  watched: boolean;
  alerted: boolean;
  onClose: () => void;
  onChart: () => void;
  onAlert: () => void;
  onWatch: () => void;
  onAnalyse: () => void;
  onPattern: () => void;
  onDossier: () => void;
}) {
  const adv = useAdvisory();
  const c = setupColor(h.setup);
  const [exporting, setExporting] = useState(false);
  const onExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const [tf, strat] = await Promise.all([
        api.timeframes(h.symbol).catch(() => null),
        api.strategyScores(h.symbol).catch(() => null),
      ]);
      openPdfPreview(momentumReportHtml(h.symbol, tf, strat, h), {
        docType: 'Momentum analysis',
        fileName: `TaurEye-momentum-${h.symbol}`,
      });
    } finally {
      setExporting(false);
    }
  };
  const stat = (label: string, value: React.ReactNode) => (
    <View style={styles.dCell}>
      <Text style={styles.dCellLbl}>{label}</Text>
      <Text style={styles.dCellVal}>{value}</Text>
    </View>
  );
  return (
    <Sheet onClose={onClose} maxHeight="97%">
      {/* Sticky header (index 0): the company name + close button stay pinned
          while the body scrolls, so they're always visible. */}
      <ScrollView showsVerticalScrollIndicator={false} stickyHeaderIndices={[0]}>
        <View style={styles.dHead}>
          <View style={{ flex: 1 }}>
            <View style={styles.cardSymRow}>
              <Text style={styles.dSym}>{h.symbol}</Text>
              <Text style={styles.cardExch}>{h.exchange}</Text>
              {capTag(enr?.mcap)}
            </View>
            <Text style={styles.dName} numberOfLines={2}>
              {h.name || '—'}
              {enr?.sector ? <Text style={styles.cardSector}> · {enr.sector}</Text> : null}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.dX}>✕</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.dVerdict}>
          <Text style={[styles.setupBadge, { color: c, borderColor: c, fontSize: theme.fs.sm }]}>{SETUP_LABEL[h.setup]}</Text>
          <View style={styles.dScoreBox}>
            <Text style={[styles.dScore, { color: c }]}>{h.score}</Text>
            <Text style={styles.dScoreSub}>/100 · {h.probability}% prob</Text>
          </View>
        </View>

        <View style={styles.dGrid}>
          {stat('LTP', `₹${fmtIN(h.price)}`)}
          {stat('% CHG', <Text style={{ color: (h.chg ?? 0) >= 0 ? theme.green : theme.red }}>{pct(h.chg, 2)}</Text>)}
          {stat('RSI', h.rsi != null ? h.rsi.toFixed(0) : '—')}
          {stat('REL VOL', h.relvol != null ? h.relvol.toFixed(2) + 'x' : '—')}
          {stat('VS 200DMA', <Text style={{ color: (h.d200 ?? 0) >= 0 ? theme.green : theme.red }}>{pct(h.d200)}</Text>)}
          {stat('1W RET', <Text style={{ color: (h.ret_1w ?? 0) >= 0 ? theme.green : theme.red }}>{pct(h.ret_1w)}</Text>)}
          {stat('1M RET', <Text style={{ color: (h.ret_1m ?? 0) >= 0 ? theme.green : theme.red }}>{pct(h.ret_1m)}</Text>)}
          {stat('52W HIGH', <Text style={{ color: theme.red }}>{pct(h.pct_from_high)}</Text>)}
          {stat(adv ? 'UPSIDE' : 'TO RESISTANCE', <Text style={{ color: (h.upside_pct ?? 0) > 0 ? theme.green : theme.muted }}>{h.upside_pct != null ? '+' + h.upside_pct.toFixed(1) + '%' : '—'}</Text>)}
          {h.target != null ? stat(adv ? 'TARGET' : 'RESISTANCE', `₹${fmtIN(h.target)}`) : null}
        </View>

        <Text style={styles.dSecTitle}>TECHNICAL READ</Text>
        <ReadBox h={h} c={c} />

        <Text style={styles.dSecTitle}>MULTI-TIMEFRAME · S/R · FIBONACCI</Text>
        <TimeframePanel symbol={h.symbol} />

        <StrategyScores symbol={h.symbol} />

        <View style={styles.dActions}>
          <TouchableOpacity style={styles.dActBtn} onPress={onChart} activeOpacity={0.75}>
            <Text style={styles.dActTxt}>▤ Chart</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dActBtn} onPress={onAnalyse} activeOpacity={0.75}>
            <Text style={[styles.dActTxt, { color: theme.accent }]}>Multibagger</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dActBtn} onPress={onPattern} activeOpacity={0.75}>
            <Text style={styles.dActTxt}>Pattern</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dActBtn} onPress={onDossier} activeOpacity={0.75}>
            <Text style={styles.dActTxt}>Dossier</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dActBtn} onPress={onExport} activeOpacity={0.75} disabled={exporting}>
            <Text style={styles.dActTxt}>{exporting ? '… Exporting' : '⤓ Export PDF'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dActBtn} onPress={onWatch} activeOpacity={0.75}>
            <Text style={[styles.dActTxt, watched && { color: theme.green }]}>{watched ? '★ Watching' : '☆ Watchlist'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dActBtn} onPress={onAlert} activeOpacity={0.75}>
            <Text style={[styles.dActTxt, alerted && { color: GOLD }]}>{alerted ? 'Alerted' : 'Alert'}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.dClose} onPress={onClose} activeOpacity={0.75}>
          <Text style={styles.dCloseTxt}>Close</Text>
        </TouchableOpacity>
        <Text style={styles.dDisc}>
          Momentum setup on a live NSE/BSE scan. Probability is an indicative base-rate heuristic, not a forecast —
          for information only, not investment advice. Always confirm and manage risk.
        </Text>
      </ScrollView>
    </Sheet>
  );
}

// Analyser sub-tab: type/search any symbol and read its momentum across every
// timeframe (5-min → weekly) — trade rating, S/R and Fibonacci levels per
// ── Momentum PDF report ──────────────────────────────────────────────────────
// Builds a self-contained "Momentum analysis" report from the per-timeframe read
// (+ overall score) and the strategy scorecard, then hands it to the shared PDF
// preview (professionalShell adds the A4 research chrome incl. the .tf-card grid).
const _esc = (v: unknown): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const _money = (n?: number | null) =>
  n == null || !isFinite(n) ? '—' : '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const _pctS = (n?: number | null) => (n == null || !isFinite(n) ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%');
const _scoreHex = (n?: number | null) => (n == null ? '#111' : n >= 60 ? '#0b7a53' : n <= 40 ? '#c92a2a' : '#b7791f');
const _biasCls = (b?: string) => (/bull/i.test(b || '') ? 'g' : /bear/i.test(b || '') ? 'r' : 'a');

function momentumReportHtml(
  sym: string,
  tf: TimeframesResp | null,
  strat: StrategyScoresResp | null,
  hit?: MomentumHit | null,
): string {
  const ov = tf?.overall;
  // When opened from a radar card, lead with the live momentum snapshot the
  // card shows (setup, score, probability + the key stats grid).
  const cell = (label: string, value: string) =>
    `<tr><td style="color:#64748b">${_esc(label)}</td><td style="text-align:right"><b>${value}</b></td></tr>`;
  const hitBlock = hit
    ? `<div class="big" style="color:${_scoreHex(hit.score)}">${_esc(SETUP_LABEL[hit.setup])} · ${hit.score}/100` +
      `<span class="sub"> · ${hit.probability}% prob</span></div>` +
      `<h2>Momentum snapshot</h2><table>` +
      cell('LTP', hit.price != null ? _money(hit.price) : '—') +
      cell('Day change', _pctS(hit.chg)) +
      cell('RSI', hit.rsi != null ? hit.rsi.toFixed(0) : '—') +
      cell('Relative volume', hit.relvol != null ? hit.relvol.toFixed(2) + 'x' : '—') +
      cell('vs 200-DMA', _pctS(hit.d200)) +
      cell('From 52-week high', _pctS(hit.pct_from_high)) +
      cell('Upside to target', hit.upside_pct != null ? _pctS(hit.upside_pct) : '—') +
      (hit.target != null ? cell('Target', _money(hit.target)) : '') +
      `</table>` +
      (hit.signals?.length ? `<p style="margin:6px 0 0"><b>Signals</b> — ${hit.signals.map(_esc).join(' · ')}</p>` : '') +
      (hit.cautions?.length ? `<p style="margin:2px 0 0;color:#c92a2a"><b>Cautions</b> — ${hit.cautions.map(_esc).join(' · ')}</p>` : '')
    : '';
  const levels = (a?: number[]) => (a && a.length ? a.map((x) => _money(x)).join(' · ') : '—');
  const fib = (f?: Record<string, number>) =>
    f && Object.keys(f).length
      ? Object.entries(f).map(([k, v]) => `${k} ${_money(v)}`).join(' · ')
      : '';
  const tfCard = (t: TimeframesResp['timeframes'][number]) =>
    `<div class="tf-card">` +
    `<div class="tf-top"><span class="tf-tf">${_esc(t.label)}</span>` +
    `<span class="pill ${_biasCls(t.bias)}">${_esc(t.rating || t.bias)}</span></div>` +
    `<div class="tf-top"><span class="tf-score" style="color:${_scoreHex(t.score)}">${t.score != null ? t.score : '—'}` +
    `<span class="tf-of"> /100</span></span></div>` +
    `<div class="tf-row"><span>Price</span><b>${t.price != null ? _esc(_money(t.price)) : '—'}</b></div>` +
    `<div class="tf-row"><span>RSI</span><b>${t.rsi != null ? t.rsi.toFixed(0) : '—'}</b></div>` +
    `<div class="tf-row"><span>vs EMA20</span><b style="color:${(t.vs_ema20 ?? 0) >= 0 ? '#0b7a53' : '#c92a2a'}">${_pctS(t.vs_ema20)}</b></div>` +
    `<div class="tf-row"><span>vs EMA50</span><b style="color:${(t.vs_ema50 ?? 0) >= 0 ? '#0b7a53' : '#c92a2a'}">${_pctS(t.vs_ema50)}</b></div>` +
    `<div class="tf-row"><span>Resistance</span><b>${_esc(levels(t.resistances))}</b></div>` +
    `<div class="tf-row"><span>Support</span><b>${_esc(levels(t.supports))}</b></div>` +
    (fib(t.fib) ? `<div class="tf-row" style="display:block"><span>Fib</span> <b style="font-weight:600">${_esc(fib(t.fib))}</b></div>` : '') +
    `</div>`;
  const tfBlock = tf?.timeframes?.length
    ? `<h2>Technical setup · by timeframe</h2><div class="tf-grid">${tf.timeframes.map(tfCard).join('')}</div>` +
      (tf.horizons?.length
        ? `<p style="margin:8px 0 0"><b>Horizon read</b> &nbsp; ${tf.horizons
            .map((h) => `${_esc(h.label)} <span class="pill ${_biasCls(h.bias)}">${_esc(h.bias)}${h.score != null ? ` ${h.score}` : ''}</span>`)
            .join(' &nbsp; ')}</p>`
        : '')
    : '<p>No timeframe data was available at export time (intraday feeds can be rate-limited).</p>';
  const stratRows = strat?.strategies?.length
    ? `<h2>Strategy scorecard</h2><p style="margin:0 0 4px">How well ${_esc(sym)} fits each screening strategy right now — 0–100, ✓ qualifies (≥70).</p>` +
      `<table><tr><td><b>Strategy</b></td><td style="text-align:right"><b>Score</b></td><td style="text-align:center"><b>Fit</b></td></tr>` +
      [...strat.strategies]
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
        .map(
          (s) =>
            `<tr><td>${_esc(s.name)}${s.note ? ` <span style="color:#888;font-size:10px">— ${_esc(s.note)}</span>` : ''}</td>` +
            `<td style="text-align:right;color:${_scoreHex(s.score)};font-weight:700">${s.score != null ? s.score : '—'}</td>` +
            `<td style="text-align:center">${s.pass ? '<span style="color:#0b7a53;font-weight:700">✓</span>' : '<span style="color:#bbb">—</span>'}</td></tr>`,
        )
        .join('') +
      `</table>`
    : '';
  // The overall multi-timeframe read. Show the big headline only when there's no
  // radar-card headline above it (avoid two big numbers); otherwise fold it into
  // a line above the timeframe grid.
  const ovBlock = ov
    ? (hit
        ? `<p style="margin:10px 0 0"><b>Overall timeframe read</b> — <b style="color:${_scoreHex(ov.score)}">${_esc(ov.rating || ov.bias)}${ov.score != null ? ` · ${ov.score}/100` : ''}</b> (higher timeframes weighted more)</p>`
        : `<div class="big" style="color:${_scoreHex(ov.score)}">${_esc(ov.rating || ov.bias)}${ov.score != null ? ` · ${ov.score}/100` : ''}</div>` +
          `<p>Weighted across every timeframe (higher timeframes count more). Overall bias: <b>${_esc(ov.bias)}</b>.</p>`)
    : '';
  return `<html><head><title>TaurEye — Momentum analysis — ${_esc(sym)}</title></head><body>` +
    `<h1>${_esc(sym)}${hit?.name ? ` <span class="sub">${_esc(hit.name)}</span>` : ' <span class="sub">Momentum analysis</span>'}</h1>` +
    hitBlock + ovBlock + tfBlock + stratRows +
    `<p style="color:#999;font-size:10px;margin-top:14px">Multi-timeframe momentum from live price/volume and quantitative models. Educational only — not investment advice.</p>` +
    `</body></html>`;
}

// timeframe + an overall score. Same predictive search as the other pages.
function MomAnalyser({
  initialSymbol,
  watch,
  onToggleWatch,
  onChartSym,
}: {
  initialSymbol: string;
  watch: string[];
  onToggleWatch: (sym: string) => void;
  onChartSym: (sym: string) => void;
}) {
  const [sym, setSym] = useState('');
  const [active, setActive] = useState(initialSymbol);
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    if (initialSymbol) setActive(initialSymbol);
  }, [initialSymbol]);
  const run = (s?: string) => {
    const q = (s ?? sym).trim().toUpperCase().replace(/^[A-Z]+:/, '');
    if (!q) return;
    setActive(q);
    setSym(q);
    setRecent((prev) => [q, ...prev.filter((x) => x !== q)].slice(0, 8));
  };
  const isWatched = (s: string) => watch.includes(normSymbol(s));

  const [exporting, setExporting] = useState(false);
  const onExport = async () => {
    if (!active || exporting) return;
    setExporting(true);
    try {
      // Pull the same two feeds the panels show, then build the report.
      const [tf, strat] = await Promise.all([
        api.timeframes(active).catch(() => null),
        api.strategyScores(active).catch(() => null),
      ]);
      openPdfPreview(momentumReportHtml(active, tf, strat), {
        docType: 'Momentum analysis',
        fileName: `TaurEye-momentum-${active}`,
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: theme.sp.xl }}>
      <View style={styles.anaInputRow}>
        <SymbolInput
          value={sym}
          onChangeText={setSym}
          onSelect={(s) => run(s)}
          onSubmit={() => run()}
          placeholder="Any NSE/BSE symbol — momentum on every timeframe…"
          inputStyle={styles.anaInput}
          containerStyle={{ flex: 1 }}
        />
        <Btn label="Analyse" onPress={() => run()} disabled={!sym.trim()} />
      </View>
      {recent.length ? (
        <View style={styles.recentRow}>
          <Text style={styles.recentLabel}>RECENT</Text>
          {recent.map((s) => (
            <TouchableOpacity key={s} style={styles.recentChip} onPress={() => run(s)} activeOpacity={0.75}>
              <Text style={styles.recentTxt}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      {!active ? (
        <EmptyState
          icon="◎"
          title="Analyse any stock's momentum"
          hint="Search a symbol to see its trade rating, support/resistance and Fibonacci levels on every timeframe from 5-minute to weekly, plus an overall score."
        />
      ) : (
        <View style={styles.anaBody}>
          <View style={styles.anaHead}>
            <Text style={styles.anaSym}>{active}</Text>
            <View style={styles.anaHeadActions}>
              <TouchableOpacity style={styles.aBtn} onPress={onExport} activeOpacity={0.75} disabled={exporting}>
                <Text style={styles.aTxt}>{exporting ? '…' : '⤓ Export PDF'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.aBtn} onPress={() => onChartSym(active)} activeOpacity={0.75}>
                <Text style={styles.aTxt}>▤ Chart</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.aBtn} onPress={() => onToggleWatch(active)} activeOpacity={0.75}>
                <Text style={[styles.aTxt, isWatched(active) && { color: theme.green }]}>{isWatched(active) ? '★' : '☆'}</Text>
              </TouchableOpacity>
            </View>
          </View>
          <TimeframePanel symbol={active} />
          <StrategyScores symbol={active} />
          <View style={styles.dActions}>
            <TouchableOpacity style={styles.dActBtn} onPress={() => navigate('analysis', { sub: 'mb', symbol: active })} activeOpacity={0.75}>
              <Text style={[styles.dActTxt, { color: theme.accent }]}>Multibagger</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.dActBtn} onPress={() => navigate('analysis', { sub: 'patterns', symbol: active })} activeOpacity={0.75}>
              <Text style={styles.dActTxt}>Pattern</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.dActBtn} onPress={() => navigate('analysis', { sub: 'inst', symbol: active })} activeOpacity={0.75}>
              <Text style={styles.dActTxt}>Dossier</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

// Session caches — switching tabs doesn't refetch.
let momCache: MomentumHit[] | null = null;
let momNote = '';
let momAsof = 0;
let momEnrichCache: Record<string, Enrich> = {};

export default function MomentumScreen() {
  const [hits, setHits] = useState<MomentumHit[]>(momCache || []);
  const [note, setNote] = useState(momNote);
  const [loading, setLoading] = useState(!momCache);
  const [asof, setAsof] = useState(momAsof);
  const [tick, setTick] = useState(0);
  const [view, setView] = useState<'radar' | 'analyse'>('radar');
  const [setupFilter, setSetupFilter] = useState<'all' | SetupKind>('all');
  const [strategy, setStrategy] = useState('all');
  const [enrich, setEnrich] = useState<Record<string, Enrich>>(momEnrichCache);
  const [sector, setSector] = useState('');
  const [sel, setSel] = useState<MomentumHit | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const [watch, setWatch] = useState<string[]>([]);
  const [alerts, setAlerts] = useState<LocalAlert[]>([]);
  const [flash, setFlash] = useState('');
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { isDesktop } = useResponsive();

  const [anaInitial, setAnaInitial] = useState('');
  useEffect(() => {
    loadWatchlist().then(setWatch);
    loadLocalAlerts().then(setAlerts);
    const s = takeSector('momentum');
    if (s) setSector(s);
    // A symbol handed off from another screen opens the analyser directly.
    const sym = takeSymbol('momentum');
    if (sym) {
      setAnaInitial(sym);
      setView('analyse');
    }
  }, []);

  const toast = (m: string) => {
    setFlash(m);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(''), 2200);
  };
  const isAlerted = (sym: string) => hasLocalAlert(alerts, sym);
  const onAlert = async (h: MomentumHit) => {
    const tgt = h.target ?? (h.price != null ? h.price * 1.1 : null);
    if (tgt == null || h.price == null) return;
    setAlerts(await addLocalAlert(alerts, h.symbol, tgt, h.price, h.name));
    const up = h.upside_pct != null ? ` · ${h.upside_pct >= 0 ? '+' : ''}${h.upside_pct.toFixed(1)}% upside` : '';
    toast(`Alert set for ${h.symbol} → ₹${tgt.toLocaleString('en-IN')}${up}`);
  };

  const forceRefresh = () => {
    if (loading) return;
    momCache = null;
    momNote = '';
    momEnrichCache = {};
    setEnrich({});
    setSector('');
    setHits([]);
    setLoading(true);
    setNote('Restarting the universe radar…');
    setTick((t) => t + 1);
  };

  // Poll the server-side full NSE+BSE radar; setups stream in live.
  useEffect(() => {
    if (momCache && tick === 0) return;
    let cancelled = false;
    (async () => {
      try {
        let snap = await api.momentumScreen(tick > 0);
        while (!cancelled && snap.status === 'running') {
          if (snap.results.length) {
            setHits(snap.results);
            setLoading(false);
          }
          setNote(`Scanning the whole NSE + BSE universe server-side… ${snap.progress || ''}`);
          await new Promise((r) => setTimeout(r, 4000));
          snap = await api.momentumScreen();
        }
        if (cancelled) return;
        if (snap.status === 'error' && !snap.results.length) {
          setNote(snap.error || 'Radar failed — retry shortly.');
          setLoading(false);
          return;
        }
        const meta = `${snap.universe_nse.toLocaleString('en-IN')} NSE${snap.universe_bse ? ` + ${snap.universe_bse.toLocaleString('en-IN')} BSE` : ''} scanned${snap.refreshing ? ' · refreshing…' : ''}`;
        setHits(snap.results);
        setLoading(false);
        setNote(meta);
        setAsof(snap.asof);
        momCache = snap.results;
        momNote = meta;
        momAsof = snap.asof;
      } catch (e) {
        if (!cancelled) {
          setNote(e instanceof Error ? e.message : 'Failed to load the radar');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  // Enrich hits with sector + market cap (the radar carries neither). A
  // separate effect keyed on the hit list, NOT part of the radar fetch: the
  // radar effect early-returns when its module cache is warm, so enrichment
  // bundled inside it never resumed after a remount — leaving caps null and
  // Cap-sorting inert ("sorting sometimes doesn't work"). Caps warm in the
  // background server-side; poll until `pending` drains, merging progressively
  // so tags and sorting fill in as data arrives.
  useEffect(() => {
    if (!hits.length) return;
    const syms = hits.map((h) => h.symbol);
    if (!syms.some((s) => momEnrichCache[s]?.mcap == null)) return;
    let cancelled = false;
    (async () => {
      for (let round = 0; round < 8 && !cancelled; round++) {
        let res: Awaited<ReturnType<typeof api.fundamentalsBulk>>;
        try {
          res = await api.fundamentalsBulk(syms);
        } catch {
          break;
        }
        if (cancelled) return;
        if (res.data) {
          const merged = { ...momEnrichCache };
          Object.entries(res.data).forEach(([sym, f]) => {
            const rec = f as Record<string, unknown>;
            merged[sym] = {
              sector: (rec.sector as string) ?? merged[sym]?.sector ?? null,
              mcap: typeof rec.market_cap_cr === 'number' ? rec.market_cap_cr : (merged[sym]?.mcap ?? null),
            };
          });
          momEnrichCache = merged;
          setEnrich(merged);
        }
        if (!res.pending || !res.pending.length) break;
        await new Promise((r) => setTimeout(r, 3000));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hits]);

  // Tap-to-sort columns (default: score, best first). Numeric columns sort
  // desc first; text columns (symbol/name/exch/setup) asc first.
  const [sortCol, setSortCol] = useState<ColKey>('score');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const TEXT_COLS: ColKey[] = ['symbol', 'name', 'exchange', 'setup', 'sector'];
  const onSort = (col: ColKey) => {
    if (col === sortCol) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortCol(col);
      setSortDir(TEXT_COLS.includes(col) ? 1 : -1);
    }
  };
  // Column value for sorting — 'sector'/'cap' come from the enrichment map.
  const sortVal = (h: MomentumHit, col: ColKey): string | number | null | undefined => {
    if (col === 'sector') return enrich[h.symbol]?.sector ?? '';
    if (col === 'cap') return enrich[h.symbol]?.mcap ?? null;
    return h[col as keyof MomentumHit] as string | number | null | undefined;
  };
  // Exhaustive canonical sector list (unioned with any present in the enriched
  // hits) so every sector is selectable, including one routed from the heatmap.
  const sectors = useMemo(
    () => mergeSectors(hits.map((h) => enrich[h.symbol]?.sector)),
    [hits, enrich],
  );
  const stratDef = MOM_STRATEGIES.find((s) => s.key === strategy) || MOM_STRATEGIES[0];
  const shown = useMemo(() => {
    const filtered = hits.filter(
      (h) =>
        (setupFilter === 'all' || h.setup === setupFilter) &&
        (sector === '' || enrich[h.symbol]?.sector === sector) &&
        stratDef.match(h),
    );
    return [...filtered].sort((a, b) => {
      const va = sortVal(a, sortCol);
      const vb = sortVal(b, sortCol);
      if (typeof va === 'string' || typeof vb === 'string') {
        return String(va ?? '').localeCompare(String(vb ?? '')) * sortDir;
      }
      // Unknown values (e.g. a market cap that hasn't loaded) always sort last,
      // regardless of direction — so Cap sorting surfaces real caps, not blanks.
      const na = typeof va === 'number' && isFinite(va) ? va : null;
      const nb = typeof vb === 'number' && isFinite(vb) ? vb : null;
      if (na === null && nb === null) return 0;
      if (na === null) return 1;
      if (nb === null) return -1;
      return (na - nb) * sortDir;
    });
  }, [hits, enrich, setupFilter, sector, strategy, sortCol, sortDir]);
  const arrow = (col: ColKey) => (sortCol === col ? (sortDir === 1 ? ' ↑' : ' ↓') : '');
  const counts = useMemo(() => {
    const c: Record<string, number> = { breakout: 0, fired: 0, pullback: 0 };
    hits.forEach((h) => c[h.setup]++);
    return c;
  }, [hits]);

  const isWatched = (sym: string) => watch.includes(normSymbol(sym));
  const toggleWatch = async (sym: string) => {
    if (isWatched(sym)) setWatch(await removeSymbol(watch, normSymbol(sym)));
    else setWatch(await addSymbol(watch, sym));
  };
  const openChart = (h: MomentumHit) =>
    setDetail({ sym: h.symbol, name: h.name, exchange: h.exchange, price: h.price, chg: h.chg });
  const openChartSym = (sym: string) =>
    setDetail({ sym, name: sym, exchange: 'NSE', price: null });

  return (
    <View style={styles.container}>
      <View style={styles.segRow}>
        <View style={styles.seg}>
          {(['radar', 'analyse'] as const).map((v) => (
            <TouchableOpacity
              key={v}
              style={[styles.segBtn, view === v && styles.segBtnOn]}
              onPress={() => setView(v)}
              activeOpacity={0.75}
            >
              <Text style={[styles.segTxt, view === v && styles.segTxtOn]}>{v === 'radar' ? 'Radar' : 'Analyser'}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <InfoButton title="Momentum radar" content={MOMENTUM_INFO} />
      </View>

      {view === 'radar' ? (
        <>
      <View style={styles.chipsRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsInner}>
          {SETUP_FILTERS.map((f) => {
            const count =
              f.key === 'all' ? counts.breakout + counts.fired + counts.pullback : counts[f.key] || 0;
            return (
              <TouchableOpacity
                key={f.key}
                style={[styles.chip, setupFilter === f.key && styles.chipOn]}
                onPress={() => setSetupFilter(f.key)}
                activeOpacity={0.75}
              >
                <Text style={[styles.chipTxt, setupFilter === f.key && styles.chipTxtOn]}>
                  {f.label} ({count})
                </Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={[styles.updBtn, loading && { opacity: 0.5 }]}
            onPress={forceRefresh}
            disabled={loading}
            activeOpacity={0.75}
          >
            <Text style={styles.updTxt}>⟳ Update list</Text>
          </TouchableOpacity>
          <Text style={styles.note} numberOfLines={1}>{note} · tap a row for the technical read</Text>
        </ScrollView>
      </View>
      {asof ? <Text style={styles.lastUpd}>Setups last updated {fmtAsof(asof)}</Text> : null}

      {!loading ? (
        <>
          <View style={styles.secRow}>
            <Dropdown
              label="Strategy"
              value={strategy}
              options={MOM_STRATEGIES.map((s) => ({ key: s.key, label: s.label }))}
              onChange={setStrategy}
            />
            {sectors.length ? (
              <Dropdown
                label="Sector"
                value={sector}
                options={[{ key: '', label: 'All sectors' }, ...sectors.map((sn) => ({ key: sn, label: sn }))]}
                onChange={setSector}
              />
            ) : null}
          </View>
          {strategy !== 'all' ? (
            <Text style={styles.stratHint}>{stratDef.hint}</Text>
          ) : null}
        </>
      ) : null}

      <ScrollView style={{ flex: 1 }}>
        {loading ? <Loading label="Scanning the universe — setups stream in as they're found…" /> : null}
        {!loading && !shown.length ? (
          <EmptyState
            icon="◇"
            title="No qualifying setups right now"
            hint="Compression and pullback windows come and go — hit ⟳ Update list or check back later."
          />
        ) : null}

        {shown.length && !isDesktop ? (
          <View style={styles.mSortRow}>
            <Text style={styles.mSortLabel}>SORT</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mSortInner}>
              {MOBILE_SORTS.map((s) => {
                const on = sortCol === s.key;
                return (
                  <TouchableOpacity
                    key={s.key}
                    style={[styles.mSortChip, on && styles.mSortChipOn]}
                    onPress={() => onSort(s.key)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.mSortTxt, on && styles.mSortTxtOn]}>
                      {s.label}{on ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {shown.length && isDesktop ? (
          <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: '100%' }}>
            <View style={{ minWidth: TABLE_W }}>
              <View style={styles.headerRow}>
                <Text style={[styles.thR, { width: 36 }]}>#</Text>
                {COLS.map((col) => (
                  <TouchableOpacity key={col.key} style={{ width: col.w }} onPress={() => onSort(col.key)} activeOpacity={0.7}>
                    <Text style={col.text ? styles.th : styles.thR}>{col.label}{arrow(col.key)}</Text>
                  </TouchableOpacity>
                ))}
                <Text style={[styles.th, { width: ACTIONS_W, textAlign: 'center' }]}>ACTIONS</Text>
              </View>
              {shown.map((h, rowIdx) => {
                const c = setupColor(h.setup);
                return (
                  <View key={h.symbol}>
                    <TouchableOpacity style={styles.dataRow} onPress={() => setSel(h)} activeOpacity={0.8}>
                      <Text style={[styles.exch, { width: 36, textAlign: 'right' }]}>{rowIdx + 1}</Text>
                      <Text style={[styles.sym, { width: 92 }]} numberOfLines={1}>{h.symbol}</Text>
                      <Text style={[styles.name, { width: 190 }]} numberOfLines={1}>{h.name || '—'}</Text>
                      <Text style={[styles.exch, { width: 46 }]}>{h.exchange}</Text>
                      <Text style={[styles.sector, { width: 140 }]} numberOfLines={1}>{enrich[h.symbol]?.sector || '—'}</Text>
                      <View style={{ width: 66, paddingHorizontal: theme.sp.xs }}>{capTag(enrich[h.symbol]?.mcap)}</View>
                      <View style={{ width: 150 }}>
                        <Text style={[styles.setupBadge, { color: c, borderColor: c }]}>{SETUP_LABEL[h.setup]}</Text>
                      </View>
                      <Text style={[styles.cellR, { width: 56, color: c, fontWeight: '700' }]}>{h.score}</Text>
                      <Text style={[styles.cellR, { width: 54 }]}>{h.probability}%</Text>
                      <Text style={[styles.cellR, { width: 94, fontWeight: '700' }]}>{fmtIN(h.price)}</Text>
                      <Text style={[styles.cellR, { width: 70, color: (h.chg ?? 0) >= 0 ? theme.green : theme.red }]}>{pct(h.chg, 2)}</Text>
                      <Text style={[styles.cellR, { width: 46 }]}>{h.rsi != null ? h.rsi.toFixed(0) : '—'}</Text>
                      <Text style={[styles.cellR, { width: 58 }]}>{h.relvol != null ? h.relvol.toFixed(2) + 'x' : '—'}</Text>
                      <Text style={[styles.cellR, { width: 82, color: (h.d200 ?? 0) >= 0 ? theme.green : theme.red }]}>{pct(h.d200)}</Text>
                      <Text style={[styles.cellR, { width: 68, color: theme.red }]}>{pct(h.pct_from_high)}</Text>
                      <Text style={[styles.cellR, { width: 72, color: (h.upside_pct ?? 0) > 0 ? theme.green : theme.muted }]}>
                        {h.upside_pct != null ? '+' + h.upside_pct.toFixed(1) + '%' : '—'}
                      </Text>
                      <View style={[styles.actions, { width: ACTIONS_W }]}>
                        <TouchableOpacity style={styles.aBtn} onPress={() => openChart(h)} activeOpacity={0.75}>
                          <Text style={styles.aTxt}>Chart</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.aBtn} onPress={() => onAlert(h)} activeOpacity={0.75}>
                          <Text style={[styles.aTxt, isAlerted(h.symbol) && { color: GOLD }]}>{isAlerted(h.symbol) ? 'Alerted' : 'Alert'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.aBtn} onPress={() => toggleWatch(h.symbol)} activeOpacity={0.75}>
                          <Text style={[styles.aTxt, isWatched(h.symbol) && { color: theme.green }]}>{isWatched(h.symbol) ? '★' : '☆'}</Text>
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        ) : null}

        {shown.length && !isDesktop
          ? shown.map((h) => {
              const c = setupColor(h.setup);
              return (
                <View key={h.symbol}>
                  <TouchableOpacity style={styles.card} onPress={() => setSel(h)} activeOpacity={0.8}>
                    <View style={styles.cardTop}>
                      <View style={{ flex: 1 }}>
                        <View style={styles.cardSymRow}>
                          <Text style={styles.cardSym}>{h.symbol}</Text>
                          <Text style={styles.cardExch}>{h.exchange}</Text>
                          {capTag(enrich[h.symbol]?.mcap)}
                          <Text style={[styles.setupBadge, { color: c, borderColor: c }]}>{SETUP_LABEL[h.setup]}</Text>
                        </View>
                        <Text style={styles.cardName} numberOfLines={1}>
                          {h.name || '—'}
                          {enrich[h.symbol]?.sector ? <Text style={styles.cardSector}> · {enrich[h.symbol]?.sector}</Text> : null}
                        </Text>
                      </View>
                      <View style={styles.cardScoreBox}>
                        <Text style={[styles.cardScore, { color: c }]}>{h.score}</Text>
                        <Text style={styles.cardProb}>{h.probability}% prob</Text>
                      </View>
                    </View>
                    <View style={styles.cardStats}>
                      <Text style={styles.cardStat}>₹{fmtIN(h.price)}</Text>
                      <Text style={[styles.cardStat, { color: (h.chg ?? 0) >= 0 ? theme.green : theme.red }]}>{pct(h.chg, 2)}</Text>
                      {fmtCap(enrich[h.symbol]?.mcap) ? (
                        <Text style={[styles.cardStat, { color: theme.muted2 }]}>{fmtCap(enrich[h.symbol]?.mcap)}</Text>
                      ) : null}
                      <Text style={styles.cardStat}>RSI {h.rsi != null ? h.rsi.toFixed(0) : '—'}</Text>
                      <Text style={styles.cardStat}>{h.relvol != null ? h.relvol.toFixed(2) + 'x' : '—'}</Text>
                      <Text style={[styles.cardStat, { color: (h.d200 ?? 0) >= 0 ? theme.green : theme.red }]}>200DMA {pct(h.d200)}</Text>
                      {h.upside_pct != null ? (
                        <Text style={[styles.cardStat, { color: h.upside_pct > 0 ? theme.green : theme.muted }]}>
                          ▲ {h.upside_pct > 0 ? '+' + h.upside_pct.toFixed(1) + '%' : 'extended'} upside
                        </Text>
                      ) : null}
                    </View>
                    <View style={styles.cardActions}>
                      <TouchableOpacity style={styles.aBtn} onPress={() => openChart(h)} activeOpacity={0.75}>
                        <Text style={styles.aTxt}>Chart</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.aBtn} onPress={() => onAlert(h)} activeOpacity={0.75}>
                        <Text style={[styles.aTxt, isAlerted(h.symbol) && { color: GOLD }]}>
                          {isAlerted(h.symbol) ? 'Alerted' : 'Alert'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.aBtn} onPress={() => toggleWatch(h.symbol)} activeOpacity={0.75}>
                        <Text style={[styles.aTxt, isWatched(h.symbol) && { color: theme.green }]}>
                          {isWatched(h.symbol) ? '★ Watching' : '☆ Watch'}
                        </Text>
                      </TouchableOpacity>
                      <Text style={styles.cardHint}>tap for full read</Text>
                    </View>
                  </TouchableOpacity>
                </View>
              );
            })
          : null}

        {shown.length ? (
          <Text style={styles.method}>
            Setups: BREAKOUT WATCH — TTM squeeze compression near the 52-week high with volume building;
            BREAKOUT FIRED — squeeze release / fresh high / Camarilla break on the latest bar;
            PULLBACK REVERSAL — orderly dip to support inside an intact uptrend with washed-out oscillators.
            Probability is an indicative base-rate heuristic, not a forecast. For information only — not investment advice.
          </Text>
        ) : null}
      </ScrollView>
        </>
      ) : (
        <MomAnalyser
          initialSymbol={anaInitial}
          watch={watch}
          onToggleWatch={(s) => toggleWatch(s)}
          onChartSym={openChartSym}
        />
      )}

      {sel ? (
        <MomDetail
          h={sel}
          enr={enrich[sel.symbol]}
          watched={isWatched(sel.symbol)}
          alerted={isAlerted(sel.symbol)}
          onClose={() => setSel(null)}
          onChart={() => { const h = sel; setSel(null); openChart(h); }}
          onAlert={() => onAlert(sel)}
          onWatch={() => toggleWatch(sel.symbol)}
          onAnalyse={() => { const s = sel.symbol; setSel(null); openStock(s); }}
          onPattern={() => { const s = sel.symbol; setSel(null); navigate('analysis', { sub: 'patterns', symbol: s }); }}
          onDossier={() => { const s = sel.symbol; setSel(null); navigate('analysis', { sub: 'inst', symbol: s }); }}
        />
      ) : null}
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
  // Radar ⇄ Analyser segmented toggle.
  segRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.sp.lg,
    paddingTop: theme.sp.md,
    paddingBottom: theme.sp.sm,
  },
  seg: { flexDirection: 'row', gap: theme.sp.xs },
  segBtn: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 7,
  },
  segBtnOn: { backgroundColor: theme.brandSoft, borderColor: theme.brand },
  segTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '700' },
  segTxtOn: { color: theme.brand, fontWeight: '800' },
  // analyser sub-tab
  // zIndex lifts the whole row (and its absolutely-positioned autocomplete
  // dropdown) above the analyser result body, which renders as a later sibling
  // in the ScrollView — without it the dropdown paints *behind* the result and
  // the suggestion rows collide with the ticker underneath (RN-web stacking).
  anaInputRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.sm, zIndex: 50 },
  anaInput: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    color: theme.text,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm + 2,
    fontSize: theme.fs.md,
  },
  recentRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.sp.sm, paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.sm },
  recentLabel: { color: theme.muted, fontSize: theme.fs.xs, fontWeight: '700', letterSpacing: 1 },
  recentChip: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 4,
  },
  recentTxt: { color: theme.muted2, fontFamily: theme.mono, fontSize: theme.fs.sm },
  anaBody: { paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.md, gap: theme.sp.sm },
  anaHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.sp.sm, marginBottom: theme.sp.xs },
  anaSym: { color: theme.accent, fontFamily: theme.mono, fontWeight: '800', fontSize: theme.fs.xl, flexShrink: 1 },
  anaHeadActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: theme.sp.sm, flexShrink: 1 },
  chipsRow: { paddingBottom: theme.sp.xs, paddingTop: theme.sp.sm },
  infoInline: { alignSelf: 'center', marginRight: theme.sp.sm },
  chipsInner: { paddingHorizontal: theme.sp.lg, gap: theme.sp.sm, alignItems: 'center' },
  chip: {
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 6,
  },
  chipOn: { backgroundColor: theme.brandSoft, borderColor: theme.brand },
  chipTxt: { color: theme.muted2, fontSize: theme.fs.sm },
  chipTxtOn: { color: theme.brand, fontWeight: '800' },
  updBtn: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 5,
  },
  updTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
  note: { color: theme.muted, fontSize: theme.fs.sm, marginLeft: theme.sp.sm },
  lastUpd: { color: theme.muted, fontSize: theme.fs.xs + 1, paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.sm },
  // sector filter chips
  // flexGrow:0 so this horizontal filter strip sizes to its content instead of
  // greedily filling the column (which left a large blank gap and vertically-
  // centred the chips).
  secScroll: { flexGrow: 0, flexShrink: 0 },
  secRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, paddingHorizontal: theme.sp.md, paddingBottom: theme.sp.sm, alignItems: 'center' },
  stratHint: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 15, paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.sm },
  secChip: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 4,
    backgroundColor: theme.surface2,
  },
  secChipOn: { backgroundColor: theme.brandSoft, borderColor: theme.brand },
  secChipTxt: { color: theme.muted2, fontFamily: theme.mono, fontSize: theme.fs.sm },
  secChipTxtOn: { color: theme.brand, fontWeight: '800' },
  // sector + market-cap columns
  sector: { color: theme.muted2, fontSize: theme.fs.sm, paddingHorizontal: theme.sp.xs },
  capChip: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, alignSelf: 'flex-start' },
  capChipTxt: { fontFamily: theme.mono, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  capDash: { color: theme.muted, fontFamily: theme.mono, fontSize: theme.fs.sm },
  cardSector: { color: theme.muted, fontSize: theme.fs.sm },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface2,
    borderBottomColor: theme.border2,
    borderBottomWidth: 1,
    paddingVertical: theme.sp.sm,
    paddingHorizontal: theme.sp.xs,
  },
  th: { color: theme.muted2, fontSize: theme.fs.xs + 1, fontWeight: '600', letterSpacing: 0.5, paddingHorizontal: theme.sp.xs },
  thR: { color: theme.muted2, fontSize: theme.fs.xs + 1, fontWeight: '600', letterSpacing: 0.5, paddingHorizontal: theme.sp.xs, textAlign: 'right' },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    paddingVertical: 5,
    paddingHorizontal: theme.sp.xs,
    minHeight: 34,
  },
  // mobile sort chips
  mSortRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.sp.md, paddingBottom: theme.sp.sm, gap: theme.sp.sm },
  mSortLabel: { color: theme.muted, fontSize: theme.fs.xs, fontWeight: '700', letterSpacing: 1 },
  mSortInner: { gap: theme.sp.sm, alignItems: 'center' },
  mSortChip: {
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  mSortChipOn: { backgroundColor: theme.brandSoft, borderColor: theme.brand },
  mSortTxt: { color: theme.muted2, fontSize: theme.fs.sm },
  mSortTxtOn: { color: theme.brand, fontWeight: '800' },
  // mobile card
  card: {
    backgroundColor: theme.surface,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.md,
    gap: theme.sp.sm,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp.md },
  cardSymRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, flexWrap: 'wrap' },
  cardSym: { color: theme.accent, fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.md },
  cardExch: { color: theme.muted, fontSize: theme.fs.xs + 1, fontFamily: theme.mono },
  cardName: { color: theme.muted2, fontSize: theme.fs.sm, marginTop: 2 },
  cardScoreBox: { alignItems: 'flex-end' },
  cardScore: { fontFamily: theme.mono, fontWeight: '800', fontSize: theme.fs.xl },
  cardProb: { color: theme.muted, fontSize: theme.fs.xs + 1 },
  cardStats: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.md },
  cardStat: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm },
  cardHint: { color: theme.muted, fontSize: theme.fs.xs + 1, marginLeft: 'auto' },
  sym: { color: theme.accent, fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.sm + 1, paddingHorizontal: theme.sp.xs },
  name: { color: theme.muted2, fontSize: theme.fs.sm, paddingHorizontal: theme.sp.xs },
  exch: { color: theme.muted, fontSize: theme.fs.xs + 1, fontFamily: theme.mono, paddingHorizontal: theme.sp.xs },
  setupBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: theme.sp.sm,
    paddingVertical: 2,
    fontSize: theme.fs.xs,
    fontWeight: '800',
    letterSpacing: 0.5,
    alignSelf: 'flex-start',
    overflow: 'hidden',
  },
  cellR: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm, textAlign: 'right', paddingHorizontal: theme.sp.xs },
  actions: { width: 110, flexDirection: 'row', gap: 5, justifyContent: 'center' },
  aBtn: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.sp.sm,
    paddingVertical: 3,
  },
  aTxt: { color: theme.muted2, fontSize: theme.fs.xs + 1, fontWeight: '700' },
  readBox: {
    backgroundColor: theme.surface,
    borderBottomColor: theme.border2,
    borderBottomWidth: 1,
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.md,
    gap: 4,
  },
  probTrack: { height: 8, borderRadius: 4, backgroundColor: theme.surface3, overflow: 'hidden', marginBottom: 4 },
  probFill: { height: '100%', borderRadius: 4 },
  readMeta: { color: theme.muted, fontSize: theme.fs.sm, marginBottom: 4 },
  sigTxt: { color: theme.green, fontSize: theme.fs.sm, lineHeight: 19 },
  cauTxt: { color: GOLD, fontSize: theme.fs.sm, lineHeight: 19 },
  sigBody: { color: theme.text },
  method: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 16, padding: theme.sp.lg },
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
    maxWidth: '92%',
  },
  toastTxt: { color: theme.text, fontSize: theme.fs.sm + 1, fontWeight: '600' },
  // detail popup — dHead is a sticky header, so it needs a solid background and
  // a divider to sit cleanly over the scrolling body.
  dHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.sp.md,
    backgroundColor: theme.surface,
    paddingBottom: theme.sp.md,
    marginBottom: theme.sp.sm,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  dSym: { color: theme.accent, fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.lg },
  dName: { color: theme.muted2, fontSize: theme.fs.sm, marginTop: 3 },
  dX: { color: theme.muted, fontSize: 18, paddingHorizontal: 4 },
  dVerdict: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.md,
    marginBottom: theme.sp.md,
  },
  dScoreBox: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  dScore: { fontFamily: theme.mono, fontWeight: '800', fontSize: theme.fs.xxl },
  dScoreSub: { color: theme.muted, fontSize: theme.fs.xs + 1 },
  dGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: theme.sp.sm },
  dCell: { width: '25%', paddingVertical: theme.sp.sm },
  dCellLbl: { color: theme.muted, fontSize: theme.fs.xs, letterSpacing: 0.5, marginBottom: 2 },
  dCellVal: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.md, fontWeight: '700' },
  dSecTitle: { color: theme.muted2, fontSize: theme.fs.xs + 1, fontWeight: '800', letterSpacing: 1, marginTop: theme.sp.md, marginBottom: theme.sp.sm },
  dActions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginTop: theme.sp.md },
  dActBtn: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm,
    backgroundColor: theme.surface2,
  },
  dActTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
  dClose: {
    marginTop: theme.sp.lg,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingVertical: theme.sp.md,
    alignItems: 'center',
  },
  dCloseTxt: { color: theme.muted2, fontSize: theme.fs.md, fontWeight: '700' },
  dDisc: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 16, marginTop: theme.sp.md, marginBottom: theme.sp.md },
});
