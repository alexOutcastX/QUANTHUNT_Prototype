import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Candle, ChartPattern, ChartPatternsResp, PatternScreenHit, PatternScreenResp, api } from '../api';
import { CapChip, Enrich, useEnrich } from '../enrich';
import { chartHtml } from '../chartHtml';
import HtmlView from '../components/HtmlView';
import StockDetail from '../components/StockDetail';
import SymbolInput from '../components/SymbolInput';
import { Row } from '../screener';
import { navigate, takeSymbol } from '../navIntent';
import { addSymbol, loadWatchlist, normSymbol } from '../watchlist';
import { addPaperTrade, hasOpenPaper, loadPaperTrades } from '../paperTrades';
import { openPdfPreview } from '../pdf';
import { Btn, Card, EmptyState, InfoButton, Loading, SectionTitle, Segmented, Sheet } from '../ui';
import { PATTERN_INFO } from '../tabInfo';
import { describePattern } from '../patternInfo';
import { useResponsive } from '../responsive';
import { theme } from '../theme';

const PORTFOLIO_PREFILL_KEY = 'taureye.portfolio.prefill';

const RECENT_KEY = 'taureye.patterns.recent.v1';
const PERIODS: { key: string; label: string }[] = [
  { key: '1y', label: '1Y' },
  { key: '2y', label: '2Y' },
  { key: '5y', label: '5Y' },
];
// The scanner also reads index charts (server maps these to Yahoo index
// tickers) — one tap scans the index itself, not its constituents.
const INDEX_CHIPS = [
  'NIFTY 50', 'NIFTY BANK', 'SENSEX', 'NIFTY IT', 'NIFTY 100', 'NIFTY 500',
  'NIFTY MIDCAP 100', 'NIFTY SMALLCAP 100', 'NIFTY AUTO', 'NIFTY PHARMA',
  'NIFTY FMCG', 'NIFTY METAL', 'NIFTY ENERGY', 'NIFTY REALTY',
];

const biasColor = (b: string) => (b === 'bullish' ? theme.green : b === 'bearish' ? theme.red : theme.muted2);
const fmtDate = (ts?: number) =>
  ts == null ? '—' : new Date(ts * 1000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
const signPct = (v?: number | null) =>
  v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%';

// Desktop/mobile share one horizontally-scrolling table (many columns).
type Col = { key: string; label: string; w: number; align?: 'left' | 'right' };
const COLS: Col[] = [
  { key: 'pattern', label: 'PATTERN', w: 186, align: 'left' },
  { key: 'bias', label: 'BIAS', w: 82, align: 'left' },
  { key: 'started', label: 'STARTED', w: 92, align: 'right' },
  { key: 'ended', label: 'ENDED', w: 96, align: 'right' },
  { key: 'conf', label: 'PROBABILITY', w: 108, align: 'right' },
  { key: 'cont', label: 'CONTINUATION', w: 116, align: 'right' },
  { key: 'exp', label: 'EXPANSION', w: 96, align: 'right' },
  { key: 'chart', label: 'CHART', w: 64, align: 'right' },
];
const TABLE_W = COLS.reduce((a, c) => a + c.w, 0);

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${Math.max(3, Math.min(100, pct))}%`, backgroundColor: color }]} />
    </View>
  );
}

function PatternRow({ p, top, shown, onToggle }: {
  p: ChartPattern;
  top?: boolean;
  shown: boolean;
  onToggle: () => void;
}) {
  const c = biasColor(p.bias);
  return (
    <View style={[styles.dataRow, p.current && styles.currentRow, top && { borderTopWidth: 0 }]}>
      <View style={{ width: 186 }}>
        <View style={styles.patName}>
          {p.current ? <Text style={styles.liveDot}>●</Text> : null}
          <Text style={styles.patLabel} numberOfLines={1}>{p.label}</Text>
        </View>
        <Text style={styles.patMeta} numberOfLines={1}>
          {p.category}{p.status === 'confirmed' ? ' · confirmed' : ' · forming'}
        </Text>
      </View>
      <View style={{ width: 82 }}>
        <View style={[styles.biasChip, { borderColor: c }]}>
          <Text style={[styles.biasTxt, { color: c }]}>{p.bias.toUpperCase()}</Text>
        </View>
      </View>
      <Text style={[styles.cell, { width: 92 }]}>{fmtDate(p.start_ts)}</Text>
      <Text style={[styles.cell, { width: 96 }]}>{p.current ? 'active' : fmtDate(p.end_ts)}</Text>
      <View style={{ width: 108, paddingHorizontal: theme.sp.xs, alignItems: 'flex-end' }}>
        <Text style={styles.cellStrong}>{p.confidence}%</Text>
        <Bar pct={p.confidence} color={theme.accent} />
      </View>
      <View style={{ width: 116, paddingHorizontal: theme.sp.xs, alignItems: 'flex-end' }}>
        <Text style={styles.cellStrong}>{p.continuation}%</Text>
        <Bar pct={p.continuation} color={c} />
      </View>
      <Text style={[styles.cell, styles.mono, { width: 96, color: p.expansion_pct >= 0 ? theme.green : theme.red }]}>
        {signPct(p.expansion_pct)}
      </Text>
      {/* Toggle this pattern's drawing (span trace + key level + target) on the chart. */}
      <View style={{ width: 64, alignItems: 'flex-end' }}>
        <TouchableOpacity
          style={[styles.drawBtn, shown && { borderColor: c, backgroundColor: theme.surface2 }]}
          onPress={onToggle}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Text style={[styles.drawBtnTxt, shown && { color: c }]}>{shown ? '▣' : '▤'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// The dedicated "Current Pattern" detail box — bias, dates, probability, the
// continuation odds and the measured % move. Fills the space beside the table
// on desktop, stacks above it on mobile.
type CardActions = {
  onChart: () => void;
  onMultibagger: () => void;
  onInstitutional: () => void;
  onWatch: () => void;
  onPortfolio: () => void;
  watched: boolean;
};

function CurrentCard({ p, actions }: { p: ChartPattern; actions: CardActions }) {
  const c = biasColor(p.bias);
  const [explain, setExplain] = useState(false);
  const desc = describePattern(p.label);
  const bearish = p.bias === 'bearish';
  // Approximate resolution window: a measured move typically plays out over
  // roughly the pattern's own formation span. For a still-active pattern we
  // project from the last bar; a completed one shows its actual end.
  const spanSec = Math.max(0, p.end_ts - p.start_ts);
  const projTs = p.end_ts + spanSec;
  // Support / resistance zones from the pattern's own geometry: the key level
  // (neckline / breakout) is the pivotal band; the measured-move target is the
  // objective. Roles flip with bias. Render each as a small ±0.6% band.
  const band = (v: number) => {
    const d = v * 0.006;
    return `₹${(v - d).toLocaleString('en-IN', { maximumFractionDigits: 2 })} – ₹${(v + d).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  };
  const zoneRow = (role: string, sub: string, v: number | null | undefined, hot: boolean) =>
    v == null ? null : (
      <View style={styles.zoneRow} key={role}>
        <View style={[styles.zoneDot, { backgroundColor: hot ? theme.red : theme.green }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.zoneRole}>{role}</Text>
          <Text style={styles.zoneSub}>{sub}</Text>
        </View>
        <Text style={styles.zoneVal}>{band(v)}</Text>
      </View>
    );
  const Stat = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <View style={styles.cStat}>
      <Text style={styles.cStatLabel}>{label}</Text>
      <Text style={[styles.cStatVal, color ? { color } : null]}>{value}</Text>
    </View>
  );
  return (
    <>{/* fragment so the explain popup can sit beside the card */}
    <Card style={StyleSheet.flatten([styles.curCard, { borderColor: c }])}>
      <View style={styles.curHead}>
        <Text style={styles.curKicker}>CURRENT PATTERN</Text>
        <View style={[styles.statePill, { backgroundColor: p.active ? c : theme.surface3 }]}>
          <Text style={[styles.stateTxt, { color: p.active ? theme.bg : theme.muted2 }]}>
            {p.active ? 'IN PLAY' : 'LATEST'}
          </Text>
        </View>
      </View>
      <Text style={styles.curTitle}>{p.label}</Text>
      <View style={styles.curTags}>
        <View style={[styles.biasChip, { borderColor: c, marginHorizontal: 0 }]}>
          <Text style={[styles.biasTxt, { color: c }]}>{p.bias.toUpperCase()}</Text>
        </View>
        <Text style={styles.curCat}>{p.category} · {p.status}</Text>
      </View>

      <View style={styles.probBlock}>
        <View style={styles.probLine}>
          <Text style={styles.cStatLabel}>Probability</Text>
          <Text style={styles.probPct}>{p.confidence}%</Text>
        </View>
        <Bar pct={p.confidence} color={theme.accent} />
      </View>
      <View style={styles.probBlock}>
        <View style={styles.probLine}>
          <Text style={styles.cStatLabel}>Continuation</Text>
          <Text style={[styles.probPct, { color: c }]}>{p.continuation}%</Text>
        </View>
        <Bar pct={p.continuation} color={c} />
      </View>

      <View style={styles.cGrid}>
        <Stat label="Bias" value={p.bias[0].toUpperCase() + p.bias.slice(1)} color={c} />
        <Stat label="% move" value={signPct(p.expansion_pct)} color={p.expansion_pct >= 0 ? theme.green : theme.red} />
        <Stat label="Started" value={fmtDate(p.start_ts)} />
        <Stat label="Ended" value={p.active ? 'active' : fmtDate(p.end_ts)} />
        {p.target ? <Stat label="Target" value={`₹${p.target.toLocaleString('en-IN')}`} /> : null}
        {p.level ? <Stat label="Key level" value={`₹${p.level.toLocaleString('en-IN')}`} /> : null}
      </View>

      <View style={styles.actionsRow}>
        <TouchableOpacity style={[styles.actBtn, styles.explainBtn]} onPress={() => setExplain(true)} activeOpacity={0.75}>
          <Text style={[styles.actTxt, { color: c }]}>ⓘ Explain pattern</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actBtn} onPress={actions.onChart} activeOpacity={0.75}>
          <Text style={styles.actTxt}>▤ Chart</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actBtn} onPress={actions.onMultibagger} activeOpacity={0.75}>
          <Text style={[styles.actTxt, { color: theme.accent }]}>Multibagger</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actBtn} onPress={actions.onInstitutional} activeOpacity={0.75}>
          <Text style={styles.actTxt}>◪ Institutional</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actBtn} onPress={actions.onWatch} activeOpacity={0.75}>
          <Text style={[styles.actTxt, actions.watched && { color: theme.green }]}>
            {actions.watched ? '★ Watching' : '☆ Watchlist'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actBtn} onPress={actions.onPortfolio} activeOpacity={0.75}>
          <Text style={styles.actTxt}>＋ Portfolio</Text>
        </TouchableOpacity>
      </View>
    </Card>

    {explain ? (
      <Sheet onClose={() => setExplain(false)} maxHeight="88%">
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.exHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.exTitle}>{p.label}</Text>
              <View style={[styles.biasChip, { borderColor: c, alignSelf: 'flex-start', marginHorizontal: 0, marginTop: 4 }]}>
                <Text style={[styles.biasTxt, { color: c }]}>{p.bias.toUpperCase()} · {p.category} · {p.status}</Text>
              </View>
            </View>
            <TouchableOpacity onPress={() => setExplain(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.exX}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.exSecTitle}>WHAT IT IS</Text>
          <Text style={styles.exBody}>{desc.what}</Text>
          <Text style={[styles.exBody, { marginTop: 6 }]}>{desc.implies}</Text>

          <Text style={styles.exSecTitle}>PROBABILITY</Text>
          <Text style={styles.exBody}>
            <Text style={{ color: theme.accent, fontWeight: '800' }}>{p.confidence}% shape match</Text> — how cleanly the
            price action fits an ideal {p.label.toLowerCase()}. Higher means a more textbook, reliable formation.
          </Text>
          <Text style={[styles.exBody, { marginTop: 6 }]}>
            <Text style={{ color: c, fontWeight: '800' }}>{p.continuation}% follow-through</Text> — the indicative
            historical odds the measured move plays out once the pattern confirms (a close beyond the key level).
            {p.expansion_pct ? ` The textbook target is a ${signPct(p.expansion_pct)} move from here.` : ''}
          </Text>

          <Text style={styles.exSecTitle}>TIMING</Text>
          <Text style={styles.exBody}>
            Formed from <Text style={styles.exStrong}>{fmtDate(p.start_ts)}</Text>
            {p.active
              ? <> and is <Text style={{ color: c, fontWeight: '700' }}>still in play</Text> as of the latest bar.</>
              : <> to <Text style={styles.exStrong}>{fmtDate(p.end_ts)}</Text>.</>}
          </Text>
          {p.active ? (
            <Text style={[styles.exBody, { marginTop: 6 }]}>
              A measured move typically resolves over roughly the pattern's own span, so this one would be expected to
              play out by approximately <Text style={styles.exStrong}>{fmtDate(projTs)}</Text> — an estimate, not a
              deadline. It confirms only on a decisive close beyond the key level; until then it can still fail.
            </Text>
          ) : null}

          <Text style={styles.exSecTitle}>SUPPORT & RESISTANCE ZONES</Text>
          {bearish ? (
            <>
              {zoneRow('Resistance / key level', 'Neckline the price must hold below — a break above invalidates the setup', p.level, true)}
              {zoneRow('Support target', 'Measured-move objective on a confirmed breakdown', p.target, false)}
            </>
          ) : (
            <>
              {zoneRow('Resistance target', 'Measured-move objective on a confirmed breakout', p.target, true)}
              {zoneRow('Support / key level', 'Breakout base the price must hold above — a break below invalidates the setup', p.level, false)}
            </>
          )}
          {p.level == null && p.target == null ? (
            <Text style={styles.exBody}>Level data isn't available for this formation yet.</Text>
          ) : null}

          <Text style={styles.exDisc}>
            Chart patterns are probabilistic, not guarantees — confirmation, volume and broader context matter.
            Educational only, not investment advice.
          </Text>
        </ScrollView>
      </Sheet>
    ) : null}
    </>
  );
}

// ── Index-wide pattern screener ──────────────────────────────────────────────
// The inverse question to the single-stock recogniser: "which stocks are
// showing a pattern right now?". EVERY index below is always swept (no picker
// — the whole market is the universe, NSE broad + sectoral, BSE via SENSEX,
// and the SME board); the backend sweeps each in the background and streams
// hits into per-index snapshots that merge client-side.
const SCREEN_INDICES = [
  'NIFTY 50', 'NIFTY 100', 'NIFTY 200', 'NIFTY BANK', 'NIFTY IT',
  'NIFTY MIDCAP 100', 'NIFTY SMALLCAP 100', 'NIFTY AUTO', 'NIFTY PHARMA',
  'NIFTY FMCG', 'NIFTY METAL', 'BSE SENSEX', 'SME EMERGE',
];

// Full recogniser vocabulary for the filter dropdown (mirrors patterns.py
// _META), grouped by bias so the sheet doubles as a bullish/bearish filter.
const PATTERN_GROUPS: { title: string; labels: string[] }[] = [
  {
    title: 'Bullish',
    labels: ['Double Bottom', 'Triple Bottom', 'Inverse Head & Shoulders',
      'Ascending Triangle', 'Falling Wedge', 'Ascending Channel', 'Bull Flag',
      'Bull Pennant', 'Cup and Handle', 'Rounding Bottom', 'V-Bottom'],
  },
  {
    title: 'Bearish',
    labels: ['Double Top', 'Triple Top', 'Head and Shoulders',
      'Descending Triangle', 'Rising Wedge', 'Descending Channel', 'Bear Flag',
      'Bear Pennant', 'Rounding Top', 'V-Top'],
  },
  {
    title: 'Bilateral',
    labels: ['Symmetrical Triangle', 'Rectangle', 'Broadening Formation'],
  },
];

const SCREEN_COLS: Col[] = [
  { key: 'sno', label: '#', w: 36, align: 'right' },
  { key: 'symbol', label: 'SYMBOL', w: 118, align: 'left' },
  { key: 'cap', label: 'MKT CAP', w: 110, align: 'left' },
  { key: 'pattern', label: 'PATTERN', w: 178, align: 'left' },
  { key: 'bias', label: 'BIAS', w: 78, align: 'left' },
  { key: 'status', label: 'STATUS', w: 92, align: 'left' },
  { key: 'conf', label: 'PROBABILITY', w: 104, align: 'right' },
  { key: 'cont', label: 'CONTINUATION', w: 112, align: 'right' },
  { key: 'exp', label: 'TARGET %', w: 88, align: 'right' },
  { key: 'ended', label: 'DETECTED', w: 92, align: 'right' },
  { key: 'resolves', label: 'RESOLVES ~', w: 96, align: 'right' },
];
const SORTABLE = new Set(['symbol', 'pattern', 'bias', 'status', 'conf', 'cont', 'exp', 'ended', 'resolves']);
const SORT_OPTS: { key: string; label: string }[] = [
  { key: 'conf', label: 'Probability' },
  { key: 'cont', label: 'Continuation' },
  { key: 'exp', label: 'Target %' },
  { key: 'ended', label: 'Detected date' },
  { key: 'resolves', label: 'Resolves-by date' },
  { key: 'symbol', label: 'Symbol A–Z' },
];
const PATCOLS_KEY = 'taureye.patscreen.cols.v1';

// Rough resolution estimate: a measured move typically plays out over about
// the pattern's own formation span, projected forward from its detection date.
const resolvesTs = (h: { start_ts?: number | null; end_ts?: number | null }): number | null =>
  h.end_ts != null && h.start_ts != null ? h.end_ts + Math.max(0, h.end_ts - h.start_ts) : null;

const sortVal = (h: PatternScreenHit, k: string): number | string => {
  switch (k) {
    case 'symbol': return h.symbol;
    case 'pattern': return h.label ?? '';
    case 'bias': return h.bias ?? '';
    case 'status': return h.status ?? '';
    case 'cont': return h.continuation ?? -1;
    case 'exp': return h.expansion_pct ?? -999;
    case 'ended': return h.end_ts ?? 0;
    case 'resolves': return resolvesTs(h) ?? 0;
    default: return h.confidence;
  }
};

function PatternIndexScreener({ onOpenSymbol, onFullScan }: {
  onOpenSymbol: (sym: string) => void;
  onFullScan: (sym: string) => void;
}) {
  const { isDesktop } = useResponsive();
  const [snaps, setSnaps] = useState<Record<string, PatternScreenResp>>({});
  const [error, setError] = useState('');
  const [patFilter, setPatFilter] = useState('');    // '' = all patterns; 'Bullish'/'Bearish' = bias groups
  const [patOpen, setPatOpen] = useState(false);
  const [sweep, setSweep] = useState(0);             // bump to restart the poll loop
  const [sel, setSel] = useState<PatternScreenHit | null>(null);
  // Sorting + column prefs + the guide/glossary sheet.
  const [sortKey, setSortKey] = useState('conf');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [sortOpen, setSortOpen] = useState(false);
  const [colHidden, setColHidden] = useState<string[]>([]);
  const [colOpen, setColOpen] = useState(false);
  const [guide, setGuide] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(PATCOLS_KEY)
      .then((v) => {
        if (!v) return;
        try {
          const p = JSON.parse(v);
          if (Array.isArray(p)) setColHidden(p.filter((k) => typeof k === 'string'));
        } catch { /* defaults */ }
      })
      .catch(() => {});
  }, []);
  const saveHidden = (next: string[]) => {
    setColHidden(next);
    AsyncStorage.setItem(PATCOLS_KEY, JSON.stringify(next)).catch(() => {});
  };

  // Poll every index (the whole sweep list, always); merge snapshots
  // client-side. Keep last data through transient poll failures.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setError('');
    let misses = 0;
    const tick = async () => {
      const results = await Promise.all(
        SCREEN_INDICES.map((ix) => api.patternsScreen(ix).then((s) => [ix, s] as const).catch(() => null)),
      );
      if (cancelled) return;
      const ok = results.filter(Boolean) as (readonly [string, PatternScreenResp])[];
      if (ok.length) {
        misses = 0;
        setError('');
        setSnaps((prev) => {
          const next = { ...prev };
          ok.forEach(([ix, s]) => { next[ix] = s; });
          return next;
        });
      } else {
        misses += 1;
        if (misses > 5) {
          setError('Screen failed — check the connection and tap Rescan.');
          return;
        }
      }
      const anyRunning = ok.some(([, s]) => s.status === 'running' || s.refreshing);
      if (anyRunning || ok.length < SCREEN_INDICES.length) timer = setTimeout(tick, 4000);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sweep]);

  // Merge the per-index snapshots: dedupe symbol+pattern (keep the stronger
  // read), aggregate progress/coverage.
  const loaded = SCREEN_INDICES.map((ix) => snaps[ix]).filter(Boolean) as PatternScreenResp[];
  const merged = useMemo(() => {
    const bySig = new Map<string, PatternScreenHit>();
    loaded.forEach((s) => (s.results || []).forEach((h) => {
      const k = `${h.symbol}|${h.type}`;
      const prev = bySig.get(k);
      if (!prev || h.confidence > prev.confidence) bySig.set(k, h);
    }));
    return Array.from(bySig.values()).sort((a, b) => b.confidence - a.confidence);
  }, [loaded]);
  const hits = merged;
  const enrich = useEnrich(useMemo(() => hits.map((h) => h.symbol), [hits]));
  const biasGroup = patFilter === 'Bullish' || patFilter === 'Bearish';
  const shown = hits.filter((h) => {
    if (!patFilter) return true;
    if (biasGroup) return h.bias === patFilter.toLowerCase();
    return h.label === patFilter;
  });
  const running = loaded.some((s) => s.status === 'running' || s.refreshing) || loaded.length < SCREEN_INDICES.length;
  const anyLoaded = loaded.length > 0;
  const partial = !running && loaded.some((s) => s.partial);
  const scannedOk = loaded.reduce((a, s) => a + (s.scanned_ok || 0), 0);
  const universe = loaded.reduce((a, s) => a + (s.universe || 0), 0);
  const asof = Math.max(0, ...loaded.map((s) => s.asof || 0));
  const capped = loaded.some((s) => s.capped);
  const idxLabel = 'all indices · NSE + BSE + SME';

  const pickPat = (l: string) => {
    setPatFilter(l);
    setPatOpen(false);
  };

  const sorted = useMemo(() => {
    const out = [...shown];
    out.sort((a, b) => {
      const va = sortVal(a, sortKey);
      const vb = sortVal(b, sortKey);
      const cmp = typeof va === 'string' || typeof vb === 'string'
        ? String(va).localeCompare(String(vb))
        : (va as number) - (vb as number);
      return cmp * sortDir;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, sortKey, sortDir]);
  const toggleSort = (k: string) => {
    if (!SORTABLE.has(k)) return;
    if (sortKey === k) setSortDir((d) => (d === -1 ? 1 : -1));
    else {
      setSortKey(k);
      setSortDir(k === 'symbol' || k === 'pattern' || k === 'bias' || k === 'status' ? 1 : -1);
    }
  };
  const sortLabel = SORT_OPTS.find((o) => o.key === sortKey)?.label
    || SCREEN_COLS.find((c) => c.key === sortKey)?.label || 'Probability';
  // # / Symbol always stay; everything else is user-toggleable.
  const visCols = SCREEN_COLS.filter((c) => c.key === 'sno' || c.key === 'symbol' || !colHidden.includes(c.key));
  const visTableW = visCols.reduce((a, c) => a + c.w, 0);

  const body = (
    <ScrollView contentContainerStyle={styles.body}>
      {/* control line: pattern filter · sort · columns · rescan · guide */}
      <View style={styles.ctlLine}>
        <TouchableOpacity style={[styles.perChip, !!patFilter && styles.perChipOn]} onPress={() => setPatOpen(true)} activeOpacity={0.75}>
          <Text style={[styles.perTxt, !!patFilter && styles.perTxtOn]}>{patFilter || 'All patterns'} ▾</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.perChip} onPress={() => setSortOpen(true)} activeOpacity={0.75}>
          <Text style={styles.perTxt}>⇅ {sortLabel}{sortDir === -1 ? ' ↓' : ' ↑'}</Text>
        </TouchableOpacity>
        {isDesktop ? (
          <TouchableOpacity style={styles.perChip} onPress={() => setColOpen(true)} activeOpacity={0.75}>
            <Text style={styles.perTxt}>▤ Columns</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={styles.perChip}
          onPress={() => {
            // Force fresh sweeps server-side, then restart the poll loop.
            SCREEN_INDICES.forEach((ix) => api.patternsScreen(ix, true).catch(() => {}));
            setSweep((n) => n + 1);
          }}
          activeOpacity={0.75}
        >
          <Text style={styles.perTxt}>⟳ Rescan</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.perChip} onPress={() => setGuide(true)} activeOpacity={0.75}>
          <Text style={[styles.perTxt, { color: theme.brand }]}>ⓘ Guide</Text>
        </TouchableOpacity>
      </View>

      {patOpen ? (
        <Sheet onClose={() => setPatOpen(false)} maxHeight="80%">
          <ScrollView bounces={false}>
            <SectionTitle>Filter by pattern</SectionTitle>
            {['', 'Bullish', 'Bearish'].map((l) => (
              <TouchableOpacity key={l || 'all'} style={styles.patOpt} onPress={() => pickPat(l)} activeOpacity={0.75}>
                <Text style={[styles.patOptTxt, patFilter === l && { color: theme.brand, fontWeight: '700' }]}>
                  {l ? `All ${l.toLowerCase()} patterns` : 'All patterns'}
                </Text>
              </TouchableOpacity>
            ))}
            {PATTERN_GROUPS.map((g) => (
              <View key={g.title}>
                <Text style={styles.patGroup}>{g.title.toUpperCase()}</Text>
                {g.labels.map((l) => (
                  <TouchableOpacity key={l} style={styles.patOpt} onPress={() => pickPat(l)} activeOpacity={0.75}>
                    <Text style={[styles.patOptTxt, patFilter === l && { color: theme.brand, fontWeight: '700' }]}>{l}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </ScrollView>
        </Sheet>
      ) : null}

      {error && !anyLoaded ? <EmptyState icon="⚠" title="Couldn't screen" hint={`${error}`} /> : null}
      {!error && !anyLoaded ? <Loading label={`Loading ${idxLabel} pattern screen…`} /> : null}
      {anyLoaded ? (
        <>
          <SectionTitle>
            {shown.length} hit{shown.length === 1 ? '' : 's'} · {idxLabel}
            {running ? ' · sweeping…' : asof ? ` · as of ${fmtDate(asof)}` : ''}
            {capped ? ' · first 260 constituents per index' : ''}
          </SectionTitle>
          {partial ? (
            <Text style={styles.partialNote}>
              The data feed rate-limited this sweep — only {scannedOk}/{universe} stocks had price
              history. It retries automatically in a few minutes, or tap Rescan.
            </Text>
          ) : null}
          {sorted.length && !isDesktop ? (
            // Mobile: compact two-line rows — every field visible, no
            // horizontal scrolling, no clipped headers.
            <View>
              {sorted.map((h, i) => (
                <MobileHitRow key={`${h.symbol}-${h.type}-${i}`} h={h} enr={enrich[h.symbol]} top={i === 0} onPress={() => setSel(h)} />
              ))}
            </View>
          ) : sorted.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: '100%' }}>
              <View style={{ minWidth: visTableW }}>
                <View style={styles.headerRow}>
                  {visCols.map((c) => (
                    <TouchableOpacity
                      key={c.key}
                      style={{ width: c.w }}
                      onPress={() => toggleSort(c.key)}
                      disabled={!SORTABLE.has(c.key)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.th, { width: c.w, textAlign: c.align === 'left' ? 'left' : 'right' }, sortKey === c.key && { color: theme.brand }]}>
                        {c.label}{sortKey === c.key ? (sortDir === -1 ? ' ↓' : ' ↑') : ''}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {sorted.map((h, i) => (
                  <ScreenHitRow key={`${h.symbol}-${h.type}-${i}`} h={h} enr={enrich[h.symbol]} idx={i} top={i === 0} cols={visCols} onPress={() => setSel(h)} />
                ))}
              </View>
            </ScrollView>
          ) : !running ? (
            <EmptyState
              icon="◇"
              title={patFilter && hits.length ? `No ${patFilter} hits` : 'No fresh patterns'}
              hint={
                patFilter && hits.length
                  ? 'Other patterns were found — switch the dropdown back to All patterns to see them.'
                  : partial
                    ? 'Most of this sweep was rate-limited by the data feed — tap Rescan to fill in the gaps.'
                    : 'No constituent shows a confident formation reaching into the last ~3 weeks. Try another index, or Rescan.'
              }
            />
          ) : (
            <Loading label={`Sweeping ${idxLabel}… hits appear as they're found`} />
          )}
          <Text style={styles.method}>
            Every constituent's last year of daily bars is scanned with the same geometric recogniser as the
            single-stock tab. Only formations reaching into the last ~2 weeks with probability ≥ 55 count as
            hits. Tap a row for the full read + actions. Indicative and educational only — not investment advice.
          </Text>
        </>
      ) : null}
    </ScrollView>
  );

  return (
    <View style={{ flex: 1, flexDirection: isDesktop ? 'row' : 'column' }}>
      <View style={{ flex: 1 }}>{body}</View>

      {/* Desktop: a permanent panel in the blank space beside the table — the
          tapped hit's full read lives here, never as an overlay. */}
      {isDesktop ? (
        <ScrollView style={styles.sidePanel} contentContainerStyle={{ padding: theme.sp.md }}>
          {sel ? (
            <PatternHitCard
              h={sel}
              enr={enrich[sel.symbol]}
              onClose={() => setSel(null)}
              onOpenSymbol={onOpenSymbol}
              onFullScan={onFullScan}
            />
          ) : (
            <EmptyState
              icon="◇"
              title="Please select a stock"
              hint="Tap any row in the table — its full pattern read, recent formations and actions appear here."
            />
          )}
        </ScrollView>
      ) : null}

      {/* Mobile: same card as a popup. */}
      {!isDesktop && sel ? (
        <Sheet onClose={() => setSel(null)} maxHeight="92%">
          <ScrollView bounces={false}>
            <PatternHitCard
              h={sel}
              enr={enrich[sel.symbol]}
              onClose={() => setSel(null)}
              onOpenSymbol={onOpenSymbol}
              onFullScan={onFullScan}
            />
          </ScrollView>
        </Sheet>
      ) : null}

      {/* Sort picker */}
      {sortOpen ? (
        <Sheet onClose={() => setSortOpen(false)} maxHeight="70%">
          <SectionTitle>Sort hits by</SectionTitle>
          <ScrollView bounces={false} style={{ marginVertical: theme.sp.sm }}>
            {SORT_OPTS.map((o) => (
              <TouchableOpacity
                key={o.key}
                style={styles.patOpt}
                onPress={() => { toggleSort(o.key); setSortOpen(false); }}
                activeOpacity={0.75}
              >
                <Text style={[styles.patOptTxt, sortKey === o.key && { color: theme.brand, fontWeight: '700' }]}>
                  {o.label}{sortKey === o.key ? (sortDir === -1 ? '  ↓ high → low' : '  ↑ low → high') : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={styles.hitRecentSub}>Pick the same field again to flip the direction.</Text>
        </Sheet>
      ) : null}

      {/* Column show/hide (the table view) */}
      {colOpen ? (
        <Sheet onClose={() => setColOpen(false)} maxHeight="80%">
          <SectionTitle>Columns</SectionTitle>
          <ScrollView bounces={false} style={{ marginVertical: theme.sp.sm }}>
            {SCREEN_COLS.filter((c) => c.key !== 'sno' && c.key !== 'symbol').map((c) => {
              const on = !colHidden.includes(c.key);
              return (
                <TouchableOpacity
                  key={c.key}
                  style={styles.patOpt}
                  onPress={() => saveHidden(on ? [...colHidden, c.key] : colHidden.filter((k) => k !== c.key))}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.patOptTxt, on && { color: theme.brand, fontWeight: '700' }]}>
                    {on ? '☑' : '☐'} {c.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <Text style={styles.hitRecentSub}># and SYMBOL always stay. Preferences persist on this device.</Text>
        </Sheet>
      ) : null}

      {/* Guide + glossary */}
      {guide ? <PatternGuideSheet onClose={() => setGuide(false)} /> : null}
    </View>
  );
}

// ── ⓘ Guide: how the pattern engine works + a glossary of every column ──────
function PatternGuideSheet({ onClose }: { onClose: () => void }) {
  const G = ({ term, body: b }: { term: string; body: string }) => (
    <View style={styles.gRow}>
      <Text style={styles.gTerm}>{term}</Text>
      <Text style={styles.gBody}>{b}</Text>
    </View>
  );
  return (
    <Sheet onClose={onClose} maxHeight="92%">
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.exHead}>
          <Text style={styles.exTitle}>Pattern engine — guide</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.exX}>✕</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.exSecTitle}>HOW THE ENGINE WORKS</Text>
        <Text style={styles.exBody}>
          Every constituent of every swept index (NSE broad + sectoral indices, BSE SENSEX and the SME
          board) runs through a geometric recogniser: the last year of daily bars is searched for two
          dozen textbook formations — double/triple tops and bottoms, head &amp; shoulders, triangles,
          wedges, flags, pennants, channels, cup &amp; handle, rounding turns and V-reversals. Sweeps run
          in the background on the server and hits stream in live; only formations reaching into the last
          ~2 weeks with probability ≥ 55% qualify, so the list is always about what's setting up now.
        </Text>

        <Text style={styles.exSecTitle}>GLOSSARY — WHAT EACH COLUMN MEANS</Text>
        <G term="PATTERN" body="The formation's textbook name. Tap a row and use ⓘ Explain on the card for its full description." />
        <G term="BIAS" body="The direction the pattern usually resolves — ▲ bullish (up), ▼ bearish (down). Bilateral shapes (rectangles, symmetrical triangles) can break either way and count as neutral until they do." />
        <G term="STATUS" body="Forming — the shape is there but price hasn't broken the key level yet, so it can still fail. Confirmed — price has closed decisively beyond the key level." />
        <G term="PROBABILITY" body="Shape match, 0–100%: how cleanly the price action fits the ideal geometry of that formation. Higher = more textbook, historically more reliable." />
        <G term="CONTINUATION" body="Indicative historical odds that the measured move plays out once the pattern confirms. It is not a promise — volume and market context still matter." />
        <G term="TARGET %" body="The measured move: the pattern's own height projected from its breakout level, as a % from the current price. The card shows it in ₹ too." />
        <G term="KEY LEVEL" body="The neckline / breakout line. A decisive close beyond it confirms the pattern; a close through the opposite side invalidates it." />
        <G term="MKT CAP" body="Market capitalisation with a Large/Mid/Small tag, so you can screen by liquidity comfort at a glance." />
        <G term="FORMED" body="The date the formation started building." />
        <G term="DETECTED" body="The formation's last bar — when the shape completed, or the latest bar if it's still in play." />
        <G term="RESOLVES ~" body="The probable end date: measured moves typically play out over roughly the pattern's own formation span, projected forward from the detection date. Treat it as an estimate, never a deadline." />

        <Text style={styles.exSecTitle}>HOW TO USE IT</Text>
        <Text style={styles.exBody}>
          1 · Sort by probability or the resolves-by date, and filter to bullish or bearish setups (or one
          specific pattern) with the dropdown.{'\n'}
          2 · Tap a row — the card shows the full read: probability, continuation odds, target, key level
          and the symbol's last five formations.{'\n'}
          3 · From the card, open the full pattern page to see the pattern drawn on the chart with its key
          level and target, log a 2:1 paper trade, add to the watchlist, or export the read as a PDF.{'\n'}
          4 · ⟳ Rescan forces a fresh sweep; otherwise results refresh in the background through the day.
        </Text>

        <Text style={styles.exDisc}>
          Chart patterns are probabilistic tendencies, not guarantees — confirmation, volume and broader
          market context matter. Indicative and educational only, not investment advice.
        </Text>
      </ScrollView>
    </Sheet>
  );
}

// Mobile hit row: everything on two dense lines — no sideways scrolling.
function MobileHitRow({ h, enr, top, onPress }: { h: PatternScreenHit; enr?: Enrich; top?: boolean; onPress: () => void }) {
  const c = biasColor(h.bias);
  const rts = resolvesTs(h);
  return (
    <TouchableOpacity style={[styles.mHitRow, top && { borderTopWidth: 0 }]} onPress={onPress} activeOpacity={0.75}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={styles.mHitLine}>
          <Text style={styles.sym}>{h.symbol}</Text>
          <CapChip mcapCr={enr?.mcap} />
        </View>
        <Text style={[styles.mHitPat, { color: c }]} numberOfLines={1}>
          {h.label} · {h.status === 'confirmed' ? 'confirmed' : 'forming'}
        </Text>
        <Text style={styles.mHitMeta} numberOfLines={1}>
          {h.price != null ? `₹${h.price.toLocaleString('en-IN')}` : '—'} · det {fmtDate(h.end_ts ?? undefined)}
          {rts ? ` · res ~${fmtDate(rts)}` : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={[styles.mHitConf, { color: c }]}>
          {h.bias === 'bullish' ? '▲' : h.bias === 'bearish' ? '▼' : '—'} {h.confidence}%
        </Text>
        <Text style={[styles.mHitTgt, { color: (h.expansion_pct ?? 0) >= 0 ? theme.green : theme.red }]}>
          {signPct(h.expansion_pct)}
        </Text>
        <Text style={styles.mHitMeta}>cont {h.continuation != null ? `${h.continuation}%` : '—'}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ── Tapped-hit detail card: the full pattern read + every follow-up action ──
function PatternHitCard({ h, enr, onClose, onOpenSymbol, onFullScan }: {
  h: PatternScreenHit;
  enr?: Enrich;
  onClose: () => void;
  onOpenSymbol: (sym: string) => void;
  onFullScan: (sym: string) => void;
}) {
  const c = biasColor(h.bias);
  const desc = describePattern(h.label);
  const [watch, setWatch] = useState<string[]>([]);
  const [papered, setPapered] = useState(false);
  const [flash, setFlash] = useState('');
  // The symbol's recent formation history — same engine as the single-stock
  // scanner, trimmed to the last 5 detections for the card.
  const [recent, setRecent] = useState<ChartPattern[] | null>(null);
  const [keyLevel, setKeyLevel] = useState<number | null>(null);
  useEffect(() => {
    loadWatchlist().then(setWatch);
    loadPaperTrades().then((ts) => setPapered(hasOpenPaper(ts, h.symbol)));
    let cancelled = false;
    setRecent(null);
    setKeyLevel(null);
    api.chartPatterns(h.symbol, '1y')
      .then((r) => {
        if (cancelled) return;
        const ps = (r.patterns || []).slice().sort((a, b) => (b.end_ts || 0) - (a.end_ts || 0));
        setRecent(ps.slice(0, 5));
        const cur = ps.find((p) => p.label === h.label) || r.current || null;
        if (cur?.level != null) setKeyLevel(cur.level);
      })
      .catch(() => { if (!cancelled) setRecent([]); });
    return () => { cancelled = true; };
  }, [h.symbol, h.label]);
  const watched = watch.includes(normSymbol(h.symbol));
  const toast = (m: string) => {
    setFlash(m);
    setTimeout(() => setFlash(''), 2200);
  };

  const target = h.target ?? (h.price != null && h.expansion_pct != null
    ? h.price * (1 + h.expansion_pct / 100) : null);
  const long = h.bias !== 'bearish';
  const onPaper = async () => {
    if (h.price == null || target == null) return;
    // Stop at half the measured move on the opposite side → a 2:1 setup.
    const stop = long ? h.price - (target - h.price) / 2 : h.price + (h.price - target) / 2;
    await addPaperTrade({
      symbol: h.symbol, side: long ? 'long' : 'short', source: 'Pattern screener',
      entry: h.price, stop: Math.round(stop * 100) / 100, target: Math.round(target * 100) / 100,
    });
    setPapered(true);
    toast(`Paper ${long ? 'long' : 'short'} logged for ${h.symbol}`);
  };
  const onExport = () => {
    const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    openPdfPreview(
      `<html><head><title>TaurEye — Pattern read — ${esc(h.symbol)}</title></head><body>` +
      `<h1>${esc(h.symbol)} <span class="sub">${esc(h.label)}</span></h1>` +
      `<div class="big" style="color:${h.bias === 'bearish' ? '#c92a2a' : '#0b7a53'}">${esc(h.label)} · ${h.confidence}% <span class="sub">${esc(h.bias)} · ${h.status === 'confirmed' ? 'confirmed' : 'forming'}</span></div>` +
      `<h2>Reading</h2><table>` +
      `<tr><td style="color:#64748b">CMP</td><td style="text-align:right"><b>${h.price != null ? '₹' + h.price.toLocaleString('en-IN') : '—'}</b></td></tr>` +
      `<tr><td style="color:#64748b">Continuation probability</td><td style="text-align:right"><b>${h.continuation != null ? h.continuation + '%' : '—'}</b></td></tr>` +
      `<tr><td style="color:#64748b">Measured move</td><td style="text-align:right"><b>${h.expansion_pct != null ? (h.expansion_pct >= 0 ? '+' : '') + h.expansion_pct + '%' : '—'}${target != null ? ' → ₹' + target.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : ''}</b></td></tr>` +
      `<tr><td style="color:#64748b">Formation window</td><td style="text-align:right"><b>${fmtDate(h.start_ts ?? undefined)} → ${fmtDate(h.end_ts ?? undefined)}</b></td></tr>` +
      `</table>` +
      `<h2>What this pattern is</h2><p>${esc(desc.what)}</p><p><b>What it implies</b> — ${esc(desc.implies)}</p>` +
      `<p style="color:#999;font-size:10px;margin-top:14px">Geometric pattern detection on public daily price data. Indicative and educational only — not investment advice.</p>` +
      `</body></html>`,
      { docType: 'Pattern read', fileName: `TaurEye-pattern-${h.symbol}` },
    );
  };

  return (
    <View>
      <View style={styles.hitHead}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, flexWrap: 'wrap' }}>
            <Text style={styles.hitSym}>{h.symbol}</Text>
            <CapChip mcapCr={enr?.mcap} value />
          </View>
          <Text style={styles.hitPx}>
            {h.price != null ? `₹${h.price.toLocaleString('en-IN')}` : '—'}
            {enr?.sector ? <Text style={{ color: theme.muted }}> · {enr.sector}</Text> : null}
          </Text>
        </View>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.hitX}>✕</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.hitBadge, { borderColor: c }]}>
        <Text style={[styles.hitBadgeTxt, { color: c }]}>
          {h.label} · {h.bias === 'bullish' ? '▲ Bullish' : h.bias === 'bearish' ? '▼ Bearish' : '— Neutral'} · {h.status === 'confirmed' ? 'Confirmed' : 'Forming'}
        </Text>
      </View>

      {/* The headline action: jump straight to this symbol's full pattern page
          (chart with the pattern drawn, all formations, every level). */}
      <TouchableOpacity style={[styles.hitPrim, { borderColor: c }]} onPress={() => onFullScan(h.symbol)} activeOpacity={0.8}>
        <Text style={[styles.hitPrimTxt, { color: c }]}>▤ Open full pattern page ›</Text>
      </TouchableOpacity>

      <View style={styles.hitGrid}>
        {[
          ['PROBABILITY', `${h.confidence}%`],
          ['CONTINUATION', h.continuation != null ? `${h.continuation}%` : '—'],
          ['MEASURED MOVE', h.expansion_pct != null ? `${h.expansion_pct >= 0 ? '+' : ''}${h.expansion_pct}%` : '—'],
          ['TARGET', target != null ? `₹${target.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'],
          ['KEY LEVEL', keyLevel != null ? `₹${keyLevel.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'],
          ['FORMED', fmtDate(h.start_ts ?? undefined)],
          ['DETECTED', fmtDate(h.end_ts ?? undefined)],
          ['RESOLVES ~', fmtDate(resolvesTs(h) ?? undefined)],
        ].map(([l, v]) => (
          <View key={l} style={styles.hitCell}>
            <Text style={styles.hitCellLbl}>{l}</Text>
            <Text style={styles.hitCellVal}>{v}</Text>
          </View>
        ))}
      </View>
      <Bar pct={h.confidence} color={c} />

      <Text style={styles.hitDesc}>{desc.what}</Text>
      <Text style={styles.hitDesc}><Text style={{ fontWeight: '700' }}>Implies</Text> — {desc.implies}</Text>

      {/* Recent formation history — the single-stock scanner's read, last 5. */}
      <Text style={styles.hitRecentTitle}>RECENT PATTERNS · LAST 5</Text>
      {recent === null ? (
        <Text style={styles.hitRecentSub}>Scanning {h.symbol}'s last year of bars…</Text>
      ) : recent.length === 0 ? (
        <Text style={styles.hitRecentSub}>No other formations detected in the last year.</Text>
      ) : (
        recent.map((p, i) => {
          const pc = biasColor(p.bias);
          return (
            <View key={`${p.type}-${p.end_ts}-${i}`} style={styles.hitRecentRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.hitRecentLbl}>
                  {p.label}
                  {p.active ? <Text style={{ color: theme.green }}>  · in play</Text> : null}
                </Text>
                <Text style={styles.hitRecentSub}>
                  {p.category} · {p.status} · {fmtDate(p.start_ts)} → {p.active ? 'active' : fmtDate(p.end_ts)}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.hitRecentLbl, { color: pc }]}>
                  {p.bias === 'bullish' ? '▲' : p.bias === 'bearish' ? '▼' : '—'} {p.confidence}%
                </Text>
                <Text style={[styles.hitRecentSub, { color: (p.expansion_pct ?? 0) >= 0 ? theme.green : theme.red }]}>
                  {p.expansion_pct != null ? `${p.expansion_pct >= 0 ? '+' : ''}${p.expansion_pct}%` : '—'}
                </Text>
              </View>
            </View>
          );
        })
      )}

      <View style={styles.hitActions}>
        <TouchableOpacity style={styles.hitBtn} onPress={() => onOpenSymbol(h.symbol)} activeOpacity={0.75}>
          <Text style={styles.hitBtnTxt}>Company profile</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.hitBtn} onPress={() => navigate('analysis', { sub: 'mb', symbol: h.symbol })} activeOpacity={0.75}>
          <Text style={[styles.hitBtnTxt, { color: theme.accent }]}>Multibagger</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.hitBtn} onPress={() => navigate('analysis', { sub: 'momentum', symbol: h.symbol })} activeOpacity={0.75}>
          <Text style={styles.hitBtnTxt}>Momentum</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.hitBtn} onPress={() => navigate('analysis', { sub: 'inst', symbol: h.symbol })} activeOpacity={0.75}>
          <Text style={styles.hitBtnTxt}>Dossier</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.hitBtn}
          onPress={async () => { setWatch(await addSymbol(watch, h.symbol)); toast(`${h.symbol} added to watchlist`); }}
          activeOpacity={0.75}
        >
          <Text style={[styles.hitBtnTxt, watched && { color: theme.green }]}>{watched ? '★ Watching' : '☆ Watchlist'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.hitBtn} onPress={onPaper} activeOpacity={0.75} disabled={h.price == null || target == null}>
          <Text style={[styles.hitBtnTxt, papered && { color: theme.green }]}>{papered ? '✓ Papered' : '✎ Paper trade'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.hitBtn} onPress={onExport} activeOpacity={0.75}>
          <Text style={styles.hitBtnTxt}>⤓ Export PDF</Text>
        </TouchableOpacity>
      </View>
      {flash ? <Text style={styles.hitFlash}>{flash}</Text> : null}
      <Text style={styles.method}>
        Geometric read on daily bars — the measured move projects the pattern's height from its breakout
        level. Indicative and educational only — not investment advice.
      </Text>
    </View>
  );
}

function ScreenHitRow({ h, enr, idx, top, cols, onPress }: {
  h: PatternScreenHit; enr?: Enrich; idx: number; top?: boolean; cols: Col[]; onPress: () => void;
}) {
  const c = biasColor(h.bias);
  const cell = (col: Col): React.ReactNode => {
    switch (col.key) {
      case 'sno':
        return <Text key={col.key} style={[styles.cellNum, { width: col.w, color: theme.muted }]}>{idx + 1}</Text>;
      case 'symbol':
        return (
          <View key={col.key} style={{ width: col.w }}>
            <Text style={styles.sym}>{h.symbol}</Text>
            {h.price != null ? <Text style={styles.priceSub}>₹{h.price.toLocaleString('en-IN')}</Text> : null}
          </View>
        );
      case 'cap':
        return (
          <View key={col.key} style={{ width: col.w, alignItems: 'flex-start' }}>
            <CapChip mcapCr={enr?.mcap} value />
          </View>
        );
      case 'pattern':
        return <Text key={col.key} style={[styles.cellLeft, { width: col.w }]} numberOfLines={2}>{h.label}</Text>;
      case 'bias':
        return (
          <Text key={col.key} style={[styles.cellLeft, { width: col.w, color: c, fontWeight: '700' }]}>
            {h.bias === 'bullish' ? '▲ Bull' : h.bias === 'bearish' ? '▼ Bear' : '— Neut'}
          </Text>
        );
      case 'status':
        return (
          <Text key={col.key} style={[styles.cellLeft, { width: col.w, color: h.status === 'confirmed' ? theme.green : theme.muted2 }]}>
            {h.status === 'confirmed' ? 'Confirmed' : 'Forming'}
          </Text>
        );
      case 'conf':
        return (
          <View key={col.key} style={{ width: col.w, alignItems: 'flex-end' }}>
            <Text style={styles.cellNum}>{h.confidence}%</Text>
            <Bar pct={h.confidence} color={c} />
          </View>
        );
      case 'cont':
        return <Text key={col.key} style={[styles.cellNum, { width: col.w }]}>{h.continuation != null ? `${h.continuation}%` : '—'}</Text>;
      case 'exp':
        return (
          <Text key={col.key} style={[styles.cellNum, { width: col.w, color: (h.expansion_pct ?? 0) >= 0 ? theme.green : theme.red }]}>
            {signPct(h.expansion_pct)}
          </Text>
        );
      case 'ended':
        return <Text key={col.key} style={[styles.cellNum, { width: col.w }]}>{fmtDate(h.end_ts ?? undefined)}</Text>;
      case 'resolves':
        return <Text key={col.key} style={[styles.cellNum, { width: col.w }]}>{fmtDate(resolvesTs(h) ?? undefined)}</Text>;
      default:
        return null;
    }
  };
  return (
    <TouchableOpacity style={[styles.dataRow, top && { borderTopWidth: 0 }]} onPress={onPress} activeOpacity={0.75}>
      {cols.map(cell)}
    </TouchableOpacity>
  );
}

export default function PatternScreen() {
  const [mode, setMode] = useState<'stock' | 'screen'>('stock');
  const [symbol, setSymbol] = useState('');
  const [period, setPeriod] = useState('2y');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<ChartPatternsResp | null>(null);
  const [chartPat, setChartPat] = useState<ChartPattern | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [detail, setDetail] = useState<Row | null>(null);
  const [watch, setWatch] = useState<string[]>([]);
  const [flash, setFlash] = useState('');
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQuery = useRef<{ sym: string; period: string } | null>(null);
  const { isDesktop } = useResponsive();

  const toast = useCallback((m: string) => {
    setFlash(m);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(''), 2200);
  }, []);

  useEffect(() => {
    loadWatchlist().then(setWatch).catch(() => {});
  }, []);

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

  const scan = useCallback((symOverride?: string, periodOverride?: string) => {
    const sym = (symOverride ?? symbol).trim().toUpperCase().replace(/^[A-Z]+:/, '');
    const per = periodOverride ?? period;
    if (!sym || busy) return;
    setSymbol(sym);
    setPeriod(per);
    setBusy(true);
    setError('');
    setData(null);
    pushRecent(sym);
    lastQuery.current = { sym, period: per };
    api
      .chartPatterns(sym, per)
      .then((r) => {
        if (r && !r.error) {
          setData(r);
          // Draw the current (most recent) pattern on the chart by default;
          // any row's ▤ toggle can swap or clear the drawing.
          setChartPat(r.current || null);
        } else setError(r?.error || `No price history for ${sym}`);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Pattern scan failed'))
      .finally(() => setBusy(false));
  }, [symbol, period, busy]);

  // Auto-scan a symbol handed off from another screen (e.g. the Recommendations
  // "Pattern" button).
  useEffect(() => {
    const s = takeSymbol('patterns');
    if (s) scan(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chartCandles: Candle[] = (data?.candles || []).map((c) => ({
    t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: 0,
  }));

  const cur = data?.current || null;
  const drawing = chartPat ? {
    label: chartPat.label, bias: chartPat.bias,
    start_ts: chartPat.start_ts, end_ts: chartPat.end_ts,
    active: !!chartPat.active || !!chartPat.current,
    target: chartPat.target, level: chartPat.level,
  } : null;
  const activeSym = (data?.symbol || symbol).trim().toUpperCase();

  const actions: CardActions = {
    watched: watch.includes(normSymbol(activeSym)),
    onChart: () => activeSym && setDetail({ sym: activeSym } as Row),
    onMultibagger: () => activeSym && navigate('analysis', { sub: 'mb', symbol: activeSym }),
    onInstitutional: () => activeSym && navigate('analysis', { sub: 'inst', symbol: activeSym }),
    onWatch: async () => {
      if (!activeSym) return;
      setWatch(await addSymbol(watch, activeSym));
      toast(`${activeSym} added to watchlist`);
    },
    onPortfolio: async () => {
      if (!activeSym) return;
      await AsyncStorage.setItem(PORTFOLIO_PREFILL_KEY, activeSym).catch(() => {});
      toast(`${activeSym} queued — open Lists ▸ Portfolio`);
    },
  };

  return (
    <View style={styles.container}>
      <View style={styles.modeRow}>
        <Segmented
          items={[
            { key: 'stock', label: 'One stock' },
            { key: 'screen', label: 'Index screener' },
          ]}
          value={mode}
          onChange={(k) => setMode(k as 'stock' | 'screen')}
        />
      </View>

      {mode === 'screen' ? (
        <PatternIndexScreener
          onOpenSymbol={(s) => setDetail({ sym: s } as Row)}
          onFullScan={(s) => { setMode('stock'); setSymbol(s); scan(s); }}
        />
      ) : (
      <>
      <View style={styles.inputRow}>
        <SymbolInput
          value={symbol}
          onChangeText={setSymbol}
          onSelect={(s) => scan(s)}
          onSubmit={() => scan()}
          placeholder="Symbol or index — e.g. RELIANCE, NIFTY 50, BANKNIFTY…"
          inputStyle={styles.input}
          containerStyle={{ flex: 1 }}
        />
        <Btn label={busy ? 'Scanning…' : '⚏ Scan'} onPress={() => scan()} disabled={busy || !symbol.trim()} />
        <InfoButton title="Pattern Recogniser" content={PATTERN_INFO} style={styles.infoInline} />
      </View>

      <View style={styles.periodRow}>
        {PERIODS.map((p) => (
          <TouchableOpacity
            key={p.key}
            style={[styles.perChip, period === p.key && styles.perChipOn]}
            onPress={() => {
              setPeriod(p.key);
              if (lastQuery.current) scan(lastQuery.current.sym, p.key);
            }}
            activeOpacity={0.75}
          >
            <Text style={[styles.perTxt, period === p.key && styles.perTxtOn]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
        {recent.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={styles.recentInner}>
            <Text style={styles.recentLabel}>RECENT</Text>
            {recent.map((s) => (
              <TouchableOpacity key={s} style={styles.recentChip} onPress={() => scan(s)} activeOpacity={0.75}>
                <Text style={styles.recentTxt}>{s}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}
      </View>

      {/* Every index is scannable as its own chart — one tap. */}
      <View style={styles.periodRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentInner}>
          <Text style={styles.recentLabel}>INDICES</Text>
          {INDEX_CHIPS.map((s) => (
            <TouchableOpacity key={s} style={styles.recentChip} onPress={() => scan(s)} activeOpacity={0.75}>
              <Text style={styles.recentTxt}>{s}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {busy ? <Loading label={`Scanning ${symbol.toUpperCase()} for chart patterns…`} /> : null}
        {!busy && error ? <EmptyState icon="⚠" title="Couldn't scan" hint={error} /> : null}
        {!busy && !error && !data ? (
          <EmptyState
            icon="⚏"
            title="Pick a stock or index to scan"
            hint="Type any NSE/BSE symbol or tap an index chip — the recogniser walks the whole history and lists every chart pattern it finds (double tops, head-and-shoulders, triangles, wedges, flags, cup-and-handle and more)."
          />
        ) : null}

        {data && !busy ? (
          <>
            {chartCandles.length ? (
              <Card style={styles.chartCard}>
                <HtmlView html={chartHtml(chartCandles, 86400, undefined, drawing)} style={styles.chart} />
              </Card>
            ) : null}

            {/* On desktop the table and the Current Pattern card sit side by
                side (the card fills the space that was blank); on mobile the
                card stacks above the table. */}
            <View style={isDesktop ? styles.split : undefined}>
              {!isDesktop && cur ? (
                <View style={{ marginBottom: theme.sp.md }}>
                  <CurrentCard p={cur} actions={actions} />
                </View>
              ) : null}
              <View style={isDesktop ? styles.splitMain : undefined}>
                <SectionTitle>
                  {data.count} pattern{data.count === 1 ? '' : 's'} found{data.bars ? ` · ${data.bars} bars` : ''}
                </SectionTitle>

                {data.patterns.length ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: '100%' }}>
                    <View style={{ minWidth: TABLE_W }}>
                      <View style={styles.headerRow}>
                        {COLS.map((c) => (
                          <Text
                            key={c.key}
                            style={[styles.th, { width: c.w, textAlign: c.align === 'left' ? 'left' : 'right' }]}
                          >
                            {c.label}
                          </Text>
                        ))}
                      </View>
                      {data.patterns.map((p, i) => (
                        <PatternRow
                          key={`${p.type}-${p.start_ts}-${i}`}
                          p={p}
                          top={i === 0}
                          shown={chartPat === p}
                          onToggle={() => setChartPat(chartPat === p ? null : p)}
                        />
                      ))}
                    </View>
                  </ScrollView>
                ) : (
                  <EmptyState
                    icon="◇"
                    title="No clear chart patterns"
                    hint={data.note || 'The recogniser found no textbook formations in this window. Try a longer period.'}
                  />
                )}
              </View>

              {isDesktop && cur ? (
                <View style={styles.splitSide}>
                  <CurrentCard p={cur} actions={actions} />
                </View>
              ) : null}
            </View>

            <Text style={styles.method}>
              Patterns are detected geometrically from swing pivots and trend-line fits. “Probability” is how
              closely the price action matches the ideal shape; “continuation” is an indicative base-rate that
              price follows the pattern's implied direction; “expansion” is the measured-move target as a % of
              price. Indicative and educational only — not investment advice.
            </Text>
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
  modeRow: { paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.sm, paddingBottom: theme.sp.xs },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.sm, paddingBottom: theme.sp.sm, zIndex: 50 },
  infoInline: { alignSelf: 'center' },
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
  periodRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.sm },
  perChip: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 4,
    backgroundColor: theme.surface2,
  },
  perChipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  perTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontFamily: theme.mono },
  perTxtOn: { color: theme.onAccent, fontWeight: '700' },
  recentInner: { gap: theme.sp.sm, alignItems: 'center', paddingLeft: theme.sp.sm },
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
  body: { paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.xl, gap: theme.sp.md },
  // index screener
  idxScroll: { flexGrow: 0 },
  idxLine: { flexDirection: 'row', gap: theme.sp.sm, alignItems: 'center', paddingRight: theme.sp.lg },
  ctlLine: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, alignItems: 'center' },
  patOpt: { paddingVertical: theme.sp.sm },
  patOptTxt: { color: theme.text, fontSize: theme.fs.md },
  patGroup: { color: theme.muted, fontSize: theme.fs.xs, fontWeight: '800', letterSpacing: 1, marginTop: theme.sp.md, marginBottom: 2 },
  partialNote: { color: '#c9a45b', fontSize: theme.fs.sm, lineHeight: 18 },
  sym: { color: theme.text, fontSize: theme.fs.md, fontWeight: '800', fontFamily: theme.mono },
  priceSub: { color: theme.muted2, fontSize: theme.fs.xs + 1, fontFamily: theme.mono },
  cellLeft: { color: theme.muted2, fontSize: theme.fs.sm },
  cellNum: { color: theme.text, fontSize: theme.fs.sm, fontFamily: theme.mono, textAlign: 'right' },
  chartCard: { height: 240, padding: 0, overflow: 'hidden', marginTop: theme.sp.sm },
  chart: { flex: 1 },
  // desktop two-column split (table | current-pattern card)
  split: { flexDirection: 'row', gap: theme.sp.lg, alignItems: 'flex-start' },
  splitMain: { flex: 1, minWidth: 0 },
  splitSide: { width: 360 },
  // current-pattern detail card
  curCard: { borderWidth: 1, gap: theme.sp.sm },
  curHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  curKicker: { color: theme.muted, fontSize: theme.fs.xs + 1, fontWeight: '700', letterSpacing: 1 },
  curTitle: { color: theme.text, fontSize: theme.fs.xl, fontWeight: '800' },
  curTags: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm },
  curCat: { color: theme.muted, fontSize: theme.fs.sm },
  statePill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  stateTxt: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5, fontFamily: theme.mono },
  probBlock: { gap: 4 },
  probLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  probPct: { color: theme.text, fontSize: theme.fs.md, fontWeight: '800', fontFamily: theme.mono },
  cGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: theme.sp.md, marginTop: 2 },
  cStat: { width: '50%', gap: 2 },
  cStatLabel: { color: theme.muted, fontSize: theme.fs.xs + 1 },
  cStatVal: { color: theme.text, fontSize: theme.fs.md, fontWeight: '700', fontFamily: theme.mono },
  // action buttons on the card
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginTop: theme.sp.sm, borderTopColor: theme.border, borderTopWidth: 1, paddingTop: theme.sp.md },
  actBtn: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm,
  },
  actTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
  explainBtn: { borderColor: theme.border2 },
  // explain-pattern popup
  exHead: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: theme.sp.sm },
  exTitle: { color: theme.text, fontSize: theme.fs.xl, fontWeight: '800' },
  exX: { color: theme.muted, fontSize: 18, paddingHorizontal: 4 },
  exSecTitle: { color: theme.muted, fontSize: theme.fs.xs, fontWeight: '800', letterSpacing: 1.2, marginTop: theme.sp.lg, marginBottom: theme.sp.xs },
  exBody: { color: theme.text, fontSize: theme.fs.sm + 1, lineHeight: 20 },
  exStrong: { color: theme.text, fontWeight: '700', fontFamily: theme.mono },
  exDisc: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 16, marginTop: theme.sp.lg, marginBottom: theme.sp.md },
  zoneRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, paddingVertical: theme.sp.sm, borderBottomColor: theme.border, borderBottomWidth: 1 },
  zoneDot: { width: 8, height: 8, borderRadius: 4 },
  zoneRole: { color: theme.text, fontSize: theme.fs.sm + 1, fontWeight: '700' },
  zoneSub: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 15, marginTop: 1 },
  zoneVal: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700', fontFamily: theme.mono, marginLeft: theme.sp.sm },
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
  // table
  headerRow: {
    flexDirection: 'row',
    borderBottomColor: theme.border2,
    borderBottomWidth: 1,
    backgroundColor: theme.surface2,
    paddingVertical: theme.sp.sm,
    paddingHorizontal: theme.sp.xs,
  },
  th: { color: theme.muted2, fontSize: theme.fs.xs + 1, fontWeight: '600', letterSpacing: 0.5, paddingHorizontal: theme.sp.xs },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopColor: theme.border,
    borderTopWidth: 1,
    paddingVertical: theme.sp.sm,
    paddingHorizontal: theme.sp.xs,
    minHeight: 46,
  },
  currentRow: { backgroundColor: theme.surface },
  patName: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: theme.sp.xs },
  liveDot: { color: theme.green, fontSize: 9 },
  patLabel: { color: theme.text, fontSize: theme.fs.sm + 1, fontWeight: '700' },
  patMeta: { color: theme.muted, fontSize: theme.fs.xs + 1, paddingHorizontal: theme.sp.xs, marginTop: 1 },
  biasChip: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1, alignSelf: 'flex-start', marginHorizontal: theme.sp.xs },
  biasTxt: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5, fontFamily: theme.mono },
  cell: { color: theme.text, fontSize: theme.fs.sm, paddingHorizontal: theme.sp.xs, textAlign: 'right' },
  cellStrong: { color: theme.text, fontSize: theme.fs.sm, fontFamily: theme.mono, fontWeight: '700' },
  mono: { fontFamily: theme.mono },
  barTrack: { height: 4, width: '86%', borderRadius: 2, backgroundColor: theme.surface3, overflow: 'hidden', marginTop: 3 },
  barFill: { height: '100%', borderRadius: 2 },
  method: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 16, marginTop: theme.sp.sm },
  // ── index-screener hit card ──
  sidePanel: {
    width: 336, borderLeftWidth: 1, borderLeftColor: theme.border,
    backgroundColor: theme.surface,
  },
  hitHead: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp.sm },
  hitSym: { color: theme.text, fontSize: theme.fs.xl, fontWeight: '800', fontFamily: theme.mono },
  hitPx: { color: theme.text, fontSize: theme.fs.md, fontFamily: theme.mono, fontWeight: '700', marginTop: 2 },
  hitX: { color: theme.muted, fontSize: theme.fs.lg, paddingHorizontal: 4 },
  hitBadge: {
    borderWidth: 1, borderRadius: theme.radius.sm, paddingHorizontal: 10, paddingVertical: 6,
    alignSelf: 'flex-start', marginTop: theme.sp.sm,
  },
  hitBadgeTxt: { fontSize: theme.fs.sm, fontWeight: '700' },
  hitPrim: {
    borderWidth: 1.5, borderRadius: theme.radius.sm + 2, paddingVertical: 10, alignItems: 'center',
    backgroundColor: theme.surface2, marginTop: theme.sp.md,
  },
  hitPrimTxt: { fontSize: theme.fs.sm + 1, fontWeight: '800' },
  // mobile compact hit rows (no horizontal scroll)
  mHitRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.sp.md,
    paddingVertical: theme.sp.md - 2, borderTopColor: theme.border, borderTopWidth: 1,
  },
  mHitLine: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, flexWrap: 'wrap' },
  mHitPat: { fontSize: theme.fs.sm, fontWeight: '700' },
  mHitMeta: { color: theme.muted, fontSize: theme.fs.xs + 1, fontFamily: theme.mono },
  mHitConf: { fontSize: theme.fs.md, fontWeight: '800', fontFamily: theme.mono },
  mHitTgt: { fontSize: theme.fs.sm, fontWeight: '700', fontFamily: theme.mono },
  // guide / glossary
  gRow: { paddingVertical: theme.sp.sm, borderBottomColor: theme.border, borderBottomWidth: 1 },
  gTerm: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '800', fontFamily: theme.mono, letterSpacing: 0.4 },
  gBody: { color: theme.muted2, fontSize: theme.fs.sm + 1, lineHeight: 19, marginTop: 2 },
  hitGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginVertical: theme.sp.md },
  hitCell: {
    backgroundColor: theme.surface2, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.border,
    paddingVertical: 6, paddingHorizontal: 10, minWidth: 104, flexGrow: 1,
  },
  hitCellLbl: { color: theme.muted, fontSize: 9, fontFamily: theme.mono, letterSpacing: 0.5 },
  hitCellVal: { color: theme.text, fontSize: theme.fs.md, fontWeight: '700', fontFamily: theme.mono, marginTop: 2 },
  hitDesc: { color: theme.muted2, fontSize: theme.fs.sm, lineHeight: 19, marginTop: theme.sp.sm },
  hitActions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginTop: theme.sp.md },
  hitBtn: {
    borderWidth: 1, borderColor: theme.border, borderRadius: theme.radius.sm,
    paddingHorizontal: 12, paddingVertical: 8, backgroundColor: theme.surface2,
  },
  hitBtnTxt: { color: theme.text, fontSize: theme.fs.sm },
  hitFlash: { color: theme.green, fontSize: theme.fs.sm, marginTop: theme.sp.sm, fontWeight: '600' },
  hitRecentTitle: { color: theme.muted, fontSize: 10, fontFamily: theme.mono, letterSpacing: 0.5, marginTop: theme.sp.md, marginBottom: 4 },
  hitRecentRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, paddingVertical: 7,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border,
  },
  hitRecentLbl: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
  hitRecentSub: { color: theme.muted, fontSize: theme.fs.xs + 1, marginTop: 1 },
  drawBtn: {
    borderWidth: 1, borderColor: theme.border, borderRadius: theme.radius.sm,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  drawBtnTxt: { color: theme.muted, fontSize: theme.fs.sm },
});
