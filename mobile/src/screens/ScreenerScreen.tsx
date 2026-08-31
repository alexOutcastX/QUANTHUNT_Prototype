import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, type IndexResp, type ScanRow } from '../api';
import StockDetail from '../components/StockDetail';
import { InfoDot } from '../components/InfoCard';
import { ExportCol, exportCsv, exportExcel, exportPdf } from '../csv';
import { crore } from '../format';
import { parseNL } from '../nlScreen';
import { PRESETS, Preset } from '../presets';

// Fields the constituent feed already carries, so a filter on one of them can
// match before the technical sweep lands. Everything else — RSI, the moving
// averages, the crosses, the candles — only exists once /scan has answered for
// that symbol.
const SCAN_FREE = new Set(['price', 'chg', 'volume']);
import {
  DEF_BY_KEY,
  ExprOp,
  ExprRow,
  FILTER_DEFS,
  FILTER_SYNONYMS,
  Row,
  Signal,
  TE_GROUPS,
  applyExpr,
  calcSignal,
  defaultOpFor,
  exprId,
  filtersToExpr,
  setSectorMedians,
  sortRows,
} from '../screener';
import {
  SavedScreen,
  ScreenState,
  decodeScreen,
  deleteScreen,
  encodeScreen,
  loadSavedScreens,
  saveScreen,
} from '../savedScreens';
import { TrackDir, TrackEntry, addTrack, loadTrack, removeTrack } from '../tracklist';
import { addSymbol, loadWatchlist, normSymbol, removeSymbol } from '../watchlist';
import { theme } from '../theme';
import { Icon } from '../icons';
import { navigate, subscribeNav, takeIndex } from '../navIntent';
import { useResponsive } from '../responsive';
import { AnchoredMenu, Btn, EmptyState, Loading, Sheet, useMenuAnchor } from '../ui';

// Universe picker (dropdown): NSE's official indices plus the custom groups
// the backend derives — BSE SENSEX (static 30), SME EMERGE (bhavcopy SM/ST
// series) and RECENT IPOS (listed within the last year, drops out after one).
const INDEX_GROUPS: { title: string; items: string[] }[] = [
  {
    title: 'NSE — broad',
    items: ['NIFTY 50', 'NIFTY 100', 'NIFTY 200', 'NIFTY 500',
      'NIFTY MIDCAP 100', 'NIFTY SMALLCAP 100', 'NIFTY MICROCAP 250'],
  },
  {
    title: 'NSE — sectoral',
    items: ['NIFTY BANK', 'NIFTY IT', 'NIFTY AUTO', 'NIFTY PHARMA',
      'NIFTY FMCG', 'NIFTY METAL'],
  },
  { title: 'BSE', items: ['BSE SENSEX'] },
  { title: 'Special', items: ['SME EMERGE', 'RECENT IPOS'] },
];
const INDICES = INDEX_GROUPS.flatMap((g) => g.items);
const shortIdx = (n: string) => n.replace('NIFTY ', '').replace('BSE ', '');

// Multiple universes can be selected at once (the scan runs over their union).
const selLabel = (sel: string[]) =>
  sel.length >= INDICES.length ? 'ALL' : sel.length === 1 ? shortIdx(sel[0]) : `${shortIdx(sel[0])} +${sel.length - 1}`;
const selName = (sel: string[]) =>
  sel.length >= INDICES.length ? 'ALL MARKETS' : sel.map(shortIdx).join(' + ');

const pct = (v: number | null | undefined, d = 2) =>
  v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + '%';
const colorOf = (v: number | null | undefined) =>
  v == null ? theme.muted : v >= 0 ? theme.green : theme.red;
const sigColor = (s: Signal) => (s === 'buy' ? theme.green : s === 'sell' ? theme.red : theme.muted2);
const fmtVol = (v: number | null | undefined) => {
  if (v == null || !isFinite(v)) return '—';
  if (v >= 1e7) return (v / 1e7).toFixed(1) + 'Cr';
  if (v >= 1e5) return (v / 1e5).toFixed(1) + 'L';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return String(Math.round(v));
};
const n1 = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : v.toFixed(1));
// Indian-grouped price (1,31,285.00) and volume (1,08,258) — TaurEye style.
const fmtIN = (v: number | null | undefined) =>
  v == null || !isFinite(v)
    ? '—'
    : v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtVolIN = (v: number | null | undefined) =>
  v == null || !isFinite(v) ? '—' : Math.round(v).toLocaleString('en-IN');
// Market cap arrives in ₹ crore — rendered by the one app-wide rule (format.ts).
// This screen used to print "₹1.20L cr" while Momentum printed "₹1.20L Cr" for
// the same number, one tab apart.
const fmtMcap = (v: number | null | undefined) => crore(v);
const fnum2 = (r: Row, k: string, d = 1): string => {
  const f = r._fund as Record<string, unknown> | null | undefined;
  const v = f ? f[k] : null;
  return typeof v === 'number' && isFinite(v) ? v.toFixed(d) : '—';
};

export type Col = {
  key: string;
  label: string;
  w: number; // min width; cells also flex-grow so the table fills the page
  flex?: number; // flex-grow weight (default 1; 0 = fixed)
  align?: 'left' | 'right';
  // `i` is the row's absolute position in the sorted result set (0-based) —
  // only the serial-number column uses it.
  render: (r: Row, i?: number) => React.ReactNode;
};

// TaurEye-style column set: Symbol/Name/Exch/LTP/%Chg/Volume/RelVol/RSI/
// vs 50DMA/52w Hi/Mkt Cap/Signal visible; everything else opt-in via ▤ Columns.
// Exported (with cellFlex/ACTIONS_W/DEFAULT_HIDDEN/loadNames) so the
// Multibagger screener renders the identical table.
export const COLS: Col[] = [
  { key: 'sno', label: '#', w: 40, flex: 0, align: 'right', render: (_r, i) => <Text style={styles.snoTxt}>{(i ?? 0) + 1}</Text> },
  // Wide enough for a long symbol plus the inline chart + watch controls.
  { key: 'sym', label: 'Symbol', w: 136, flex: 0, align: 'left', render: (r) => <Text style={styles.symTxt}>{r.sym}</Text> },
  { key: 'name', label: 'Name', w: 190, flex: 3, align: 'left', render: (r) => <Text style={styles.nameTxt} numberOfLines={1}>{r.name || '—'}</Text> },
  { key: 'exchange', label: 'Exch', w: 48, flex: 0, render: (r) => <Text style={styles.exchTxt}>{r.exchange || 'NSE'}</Text> },
  { key: 'price', label: 'LTP', w: 100, render: (r) => <Text style={[styles.cell, styles.ltp]}>{fmtIN(r.price)}</Text> },
  { key: 'chg', label: '% Chg', w: 72, render: (r) => <Text style={[styles.cell, { color: colorOf(r.chg) }]}>{pct(r.chg)}</Text> },
  { key: 'volume', label: 'Volume', w: 92, render: (r) => <Text style={styles.cell}>{fmtVolIN(r.volume)}</Text> },
  { key: 'relvol', label: 'Rel Vol', w: 62, render: (r) => <Text style={styles.cell}>{r.relvol != null ? r.relvol.toFixed(2) + 'x' : '—'}</Text> },
  { key: 'rsi', label: 'RSI', w: 48, render: (r) => <Text style={styles.cell}>{r.rsi != null ? r.rsi.toFixed(0) : '—'}</Text> },
  { key: 'd50', label: 'vs 50DMA', w: 80, render: (r) => <Text style={[styles.cell, { color: colorOf(r.d50) }]}>{pct(r.d50)}</Text> },
  { key: 'pct_from_high', label: '52w Hi', w: 72, render: (r) => <Text style={[styles.cell, { color: colorOf(r.pct_from_high) }]}>{pct(r.pct_from_high)}</Text> },
  { key: 'market_cap_cr', label: 'Mkt Cap', w: 96, render: (r) => <Text style={styles.cell}>{fmtMcap((r._fund as { market_cap_cr?: number } | null)?.market_cap_cr)}</Text> },
  { key: 'signal', label: 'Signal', w: 66, render: (r) => { const s = calcSignal(r); return <Text style={[styles.cell, styles.sig, { color: sigColor(s) }]}>{s.toUpperCase()}</Text>; } },
  // Extras — hidden by default, available from the Columns menu.
  { key: 'd20', label: 'vs 20DMA', w: 78, render: (r) => <Text style={[styles.cell, { color: colorOf(r.d20) }]}>{pct(r.d20, 1)}</Text> },
  { key: 'd200', label: 'vs 200DMA', w: 84, render: (r) => <Text style={[styles.cell, { color: colorOf(r.d200) }]}>{pct(r.d200, 1)}</Text> },
  { key: 'willr', label: 'W%R', w: 52, render: (r) => <Text style={styles.cell}>{r.willr != null ? r.willr.toFixed(0) : '—'}</Text> },
  { key: 'bollb', label: 'BB%', w: 50, render: (r) => <Text style={styles.cell}>{r.bollb != null ? r.bollb.toFixed(2) : '—'}</Text> },
  { key: 'beta', label: 'Beta', w: 48, render: (r) => <Text style={styles.cell}>{r.beta != null ? r.beta.toFixed(2) : '—'}</Text> },
  {
    key: 'sqzMom', label: 'Sqz', w: 52,
    render: (r) => (
      <Text style={[styles.cell, { color: r.sqzFire ? theme.green : r.sqzOn ? theme.text : theme.muted }]}>
        {r.sqzFire ? 'FIRE' : r.sqzOn ? 'ON' : r.sqzOn === false ? 'off' : '—'}
      </Text>
    ),
  },
  // Nearest zone only — the full S1-S3 / R1-R3 ladder lives in the Report modal.
  { key: 's1', label: 'Support', w: 66, render: (r) => <Text style={styles.cell}>{n1(r.s1)}</Text> },
  { key: 'r1', label: 'Resist', w: 66, render: (r) => <Text style={styles.cell}>{n1(r.r1)}</Text> },
  { key: 'pe', label: 'P/E', w: 52, render: (r) => <Text style={styles.cell}>{fnum2(r, 'pe')}</Text> },
  { key: 'pb', label: 'P/B', w: 48, render: (r) => <Text style={styles.cell}>{fnum2(r, 'pb')}</Text> },
  { key: 'roe', label: 'ROE%', w: 52, render: (r) => <Text style={styles.cell}>{fnum2(r, 'roe')}</Text> },
  { key: 'roce', label: 'ROCE%', w: 56, render: (r) => <Text style={styles.cell}>{fnum2(r, 'roce')}</Text> },
  { key: 'debt_equity', label: 'D/E', w: 48, render: (r) => <Text style={styles.cell}>{fnum2(r, 'debt_equity', 2)}</Text> },
  { key: 'dividend_yield', label: 'Div%', w: 50, render: (r) => <Text style={styles.cell}>{fnum2(r, 'dividend_yield')}</Text> },
];

// ── Columns derived from the filter engine ───────────────────────────────────
// The two lists used to be written by hand and had drifted badly: you could
// FILTER on EPS, EPS growth, PEG, forward P/E, cash conversion, every valuation
// model — and then not show any of them as a column. Screening on a number you
// cannot see is close to useless, and every metric added to the filters since
// has widened the gap.
//
// So the extras are generated from FILTER_DEFS instead. Anything numeric the
// engine can filter on is automatically available in ▤ Columns, using the same
// label, the same unit and the same getter — which means the two can no longer
// disagree, and a metric added to the engine tomorrow appears here for free.
// The hand-written columns above stay: they have bespoke rendering (colour on
// sign, Indian digit grouping, the signal chip) that a generic cell can't do.
const MANUAL = new Set(COLS.map((c) => c.key));

const fmtByUnit = (v: number, unit?: string): string => {
  if (unit === '₹cr') return crore(v);
  if (unit === '%') return (v >= 0 ? '' : '') + v.toFixed(1) + '%';
  if (unit === '×') return v.toFixed(2) + '×';
  if (unit === '₹') return fmtIN(v);
  return Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-IN') : v.toFixed(2);
};

// Roughly size the column to its heading — these are opt-in extras, so a
// too-narrow header is a worse failure than a slightly wide one.
const autoWidth = (label: string) => Math.max(56, Math.min(150, 12 + label.length * 7.5));

const AUTO_COLS: Col[] = FILTER_DEFS.filter(
  (d) => !MANUAL.has(d.key) && (d.type === 'range' || d.type === 'toggle'),
).map((d) => ({
  key: d.key,
  label: d.label,
  w: autoWidth(d.label),
  render: (r: Row) => {
    const v = d.get(r);
    if (typeof v === 'boolean') {
      return <Text style={[styles.cell, { color: v ? theme.green : theme.muted }]}>{v ? 'Yes' : 'No'}</Text>;
    }
    if (typeof v !== 'number' || !isFinite(v)) return <Text style={styles.cell}>—</Text>;
    // Percentages and anything that can go negative read much faster in colour.
    const signed = d.unit === '%' && /growth|upside|vs |yield/i.test(d.label);
    return (
      <Text style={[styles.cell, signed ? { color: colorOf(v) } : null]}>{fmtByUnit(v, d.unit)}</Text>
    );
  },
}));

COLS.push(...AUTO_COLS);

export const ACTIONS_W = 252; // per-row action cell (B / S / Chart / ★ / Report)
const COL_META = COLS.map((c) => ({ key: c.key, label: c.label }));

// Cells flex-grow from their minimum width so the table fills the viewport
// (like the TaurEye site); with many extra columns enabled it overflows into
// the horizontal scroll instead.
export const cellFlex = (c: Col) => ({
  flexBasis: c.w,
  flexGrow: c.flex ?? 1,
  flexShrink: 0,
  minWidth: c.w,
});

// TaurEye default view: extras start hidden (re-enable via ▤ Columns). The
// v3 key intentionally ignores older prefs so the new default reaches everyone.
export const DEFAULT_HIDDEN = ['d20', 'd200', 'willr', 'bollb', 'beta', 'sqzMom', 's1', 'r1',
  'pe', 'pb', 'roe', 'roce', 'debt_equity', 'dividend_yield',
  // Everything generated from the filter engine is opt-in: there are ~60 of
  // them and a table that showed them all by default would be unreadable.
  ...AUTO_COLS.map((c) => c.key)];

const FILTERS_KEY = 'taureye.screener.filters.v1'; // legacy keyed filters (migrated)
const EXPR_KEY = 'taureye.screener.expr.v1';
const INDEX_KEY = 'taureye.screener.index.v1';
// v5: the filter-derived columns joined the set — reset stored orders once so
// the ~60 new keys land in DEFAULT_HIDDEN rather than inheriting a stale order.
const COLS_KEY = 'taureye.screener.cols.v5';

// Universe name/exchange lookup (fetched once per app session) so the table
// can show full company names like the TaurEye site.
let namesPromise: Promise<Record<string, { name: string; exchange: string }>> | null = null;
// Inline chart + watch-star controls that sit beside the symbol in every
// screener table (Custom, Multibagger, Momentum). Fixed same-size boxes so
// the two glyphs centre on the same axis as the symbol text.
export function SymInline({ sym, starred, onChart, onStar }: {
  sym?: string; starred: boolean; onChart: () => void; onStar: () => void;
}) {
  // Two icon-only buttons per row: to a screen reader they were an unlabelled
  // glyph and a star, repeated once per result.
  const of = (what: string) => (sym ? `${what} ${sym}` : what);
  return (
    <>
      <TouchableOpacity
        style={symInlineStyles.box}
        onPress={onChart}
        hitSlop={6}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={of('Chart for')}
      >
        <Icon name="candles" size={14} color={theme.muted2} />
      </TouchableOpacity>
      <TouchableOpacity
        style={symInlineStyles.box}
        onPress={onStar}
        hitSlop={6}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityState={{ selected: starred }}
        accessibilityLabel={of(starred ? 'Remove from watchlist:' : 'Add to watchlist:')}
      >
        <Text style={[symInlineStyles.star, starred && symInlineStyles.starOn]}>{starred ? '★' : '☆'}</Text>
      </TouchableOpacity>
    </>
  );
}
// The symbol cell hosting SymInline — one row, everything centred.
export const SYM_CELL = { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'flex-start' } as const;
const symInlineStyles = StyleSheet.create({
  box: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  star: { color: theme.muted2, fontSize: 14, lineHeight: 18 },
  starOn: { color: theme.green },
  colTitle: { color: theme.text, fontSize: theme.fs.lg, fontWeight: '700', marginBottom: theme.sp.sm },
  colRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  colTick: { color: theme.muted2, fontSize: 15 },
  colLbl: { color: theme.text, fontSize: theme.fs.md },
});

// Minimal show/hide column sheet for the tables that don't need reordering
// (Multibagger, Momentum) — same ▤ Columns affordance as the Custom screener.
export function SimpleColumnMenu({
  visible,
  cols,
  hidden,
  onToggle,
  onClose,
}: {
  visible: boolean;
  cols: { key: string; label: string }[];
  hidden: string[];
  onToggle: (key: string) => void;
  onClose: () => void;
}) {
  if (!visible) return null;
  return (
    <Sheet onClose={onClose} maxHeight="70%">
      <Text style={symInlineStyles.colTitle}>Columns</Text>
      <ScrollView>
      {cols.map((c) => {
        const off = hidden.includes(c.key);
        const locked = c.key === 'sym' || c.key === 'symbol';
        return (
          <TouchableOpacity
            key={c.key}
            style={symInlineStyles.colRow}
            onPress={() => (locked ? undefined : onToggle(c.key))}
            activeOpacity={locked ? 1 : 0.75}
          >
            <Text style={[symInlineStyles.colTick, !off && { color: theme.green }]}>{off ? '☐' : '☑'}</Text>
            <Text style={[symInlineStyles.colLbl, locked && { color: theme.muted }]}>
              {c.label}{locked ? ' (always shown)' : ''}
            </Text>
          </TouchableOpacity>
        );
      })}
      </ScrollView>
    </Sheet>
  );
}

const CFG_MIN_KEY = 'taureye.screener.cfgmin.v1';

/** The trading day a snapshot was built for, as the status line shows it. */
function snapDay(builtAt: number): string {
  try {
    return new Date(builtAt * 1000).toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

export function loadNames(): Promise<Record<string, { name: string; exchange: string }>> {
  if (!namesPromise) {
    namesPromise = api
      .universe()
      .then((r) => {
        const m: Record<string, { name: string; exchange: string }> = {};
        (r.symbols || []).forEach((s) => {
          const k = (s.symbol || '').toUpperCase();
          if (k && !m[k]) m[k] = { name: s.name || k, exchange: s.exchange || 'NSE' };
        });
        return m;
      })
      .catch(() => {
        namesPromise = null;
        return {};
      });
  }
  return namesPromise;
}

// Fixed page size — 50 rows a page keeps the (sticky-header) table snappy.
const PAGE_SIZE = 50;
// Background technical sweep: how many of its requests may be in flight. Kept
// below the foreground setting so the sweep never out-competes the page the
// user is actually reading.
const SWEEP_CONCURRENCY = 2;

// "2026-07-28" → "28 Jul", for the settled-close caption.
const fmtDay = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d.getTime())
    ? iso
    : `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`;
};

// Reads a shared screen state from `#screen=` on the web URL, if present.
function readSharedScreen(): ScreenState | null {
  const g = globalThis as { location?: { hash?: string } };
  const hash = g.location?.hash || '';
  const m = hash.match(/#screen=([^&]+)/);
  return m ? decodeScreen(m[1]) : null;
}

/** One of the screeners the SCREEN dropdown offers. */
export type ScreenChoice = { key: string; label: string; hint?: string };

/** Supplied by ScreenerHub so the SCREEN picker can sit in this screen's own
 *  top bar beside the universe, rather than in a pill bar above the page. */
export type ScreenerScreenProps = {
  screens?: ScreenChoice[];
  screen?: string;
  onScreen?: (k: string) => void;
};

export default function ScreenerScreen({
  screens,
  screen,
  onScreen,
}: ScreenerScreenProps = {}) {
  const { isDesktop } = useResponsive();
  // Mobile: the filter builder lives in a popup so it never buries the table.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Minimised screen settings (desktop): collapse the filter panel to one line.
  const [cfgMin, setCfgMin] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(CFG_MIN_KEY).then((v) => { if (v === '1') setCfgMin(true); }).catch(() => {});
  }, []);

  // Sector medians for the 'vs sector' valuation filters. One small fetch,
  // cached server-side for an hour. Failing is not an error worth surfacing:
  // those filters simply return null and match nothing, which the picker's
  // info card explains.
  useEffect(() => {
    api.sectorMedians().then((r) => setSectorMedians(r.sectors || {})).catch(() => {});
  }, []);
  const toggleCfgMin = () => setCfgMin((v) => {
    AsyncStorage.setItem(CFG_MIN_KEY, v ? '0' : '1').catch(() => {});
    return !v;
  });
  const [fieldPickFor, setFieldPickFor] = useState<string | null>(null);
  // One or more universes; the scan runs over their deduped union.
  const [indexSel, setIndexSel] = useState<string[]>(['NIFTY 50']);
  const indexName = selName(indexSel);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string>('');
  // Where the prices on screen came from, so the status line can say whether
  // they are a live tick or a settled close — and which session's close.
  const [quoteInfo, setQuoteInfo] = useState<{ live: boolean; asOf: string | null }>({
    live: true,
    asOf: null,
  });
  // When the rows on screen came out of a prebuilt snapshot, so the status
  // line can say so rather than implying they are live.
  const [snapAt, setSnapAt] = useState<number | null>(null);
  // Expression filter rows (TaurEye-style `<metric> <op> <value>` chained
  // with AND/OR). Presets and the NL builder append rows into the same list.
  //
  // Every load starts EMPTY — the whole universe, no conditions. It used to
  // open on the golden crossover, which meant the first thing the console ever
  // showed was somebody else's screen: three rows out of five hundred, and a
  // filter you had to notice and remove before you could look at the market.
  // A suggestion is fine in the preset menu, where it is offered; as the
  // opening state it is a filter nobody asked for.
  //
  // Nor is the last session's screen restored: one that reopens mid-thought is
  // one you have to clear before you can think. Screens worth keeping have
  // their own home under Save screen, and a shared #screen= link still wins
  // outright.
  const [expr, setExpr] = useState<ExprRow[]>([]);
  const [sortCol, setSortCol] = useState('signal');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [track, setTrack] = useState<TrackEntry[]>([]);
  const [fundBusy, setFundBusy] = useState(false);

  // Rows whose financials have not arrived yet (undefined = never fetched;
  // null = fetched and unavailable, which is a real "no" and must still fail
  // the filter). Only meaningful while a ·f filter is active — otherwise
  // fundamentals are decoration and their absence changes nothing.
  const fundWaiting = useMemo(() => {
    const usesFund = expr.some((e) => DEF_BY_KEY[e.key]?.fund);
    if (!usesFund) return 0;
    return rows.reduce((n, r) => n + (r._fund === undefined ? 1 : 0), 0);
  }, [expr, rows]);

  // How many rows the ACTIVE fundamental filters can actually be evaluated
  // against. A row whose financials came back empty — or that has a value for
  // every field except the one being filtered on — silently fails the filter,
  // so "0 matches" reads as "your filter is too strict" when the truth is
  // "this data was never published for these symbols". Count it and say so.
  const fundCoverage = useMemo(() => {
    const keys = (expr || [])
      .map((e) => DEF_BY_KEY[e.key])
      .filter((d) => d?.fund);
    if (!keys.length || !rows.length) return null;
    let usable = 0;
    for (const r of rows) {
      if (r._fund === undefined || r._fund === null) continue;
      if (keys.every((d) => d!.get(r) != null)) usable += 1;
    }
    return { usable, total: rows.length, labels: keys.map((d) => d!.label) };
  }, [expr, rows]);
  const [detail, setDetail] = useState<Row | null>(null);
  const [restored, setRestored] = useState(false);
  // Column show/hide + order prefs.
  const [colOrder, setColOrder] = useState<string[]>(COLS.map((c) => c.key));
  const [colHidden, setColHidden] = useState<string[]>(DEFAULT_HIDDEN);
  const [colMenu, setColMenu] = useState(false);
  const [prefsRestored, setPrefsRestored] = useState(false);
  // Saved screens + watchlist + pagination.
  const [saved, setSaved] = useState<SavedScreen[]>([]);
  const [savedModal, setSavedModal] = useState(false);
  const [watch, setWatch] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  // Dropdown/popup UI state: universe picker, export menu, per-row Analyse.
  const [idxOpen, setIdxOpen] = useState(false);
  // Both menus are portalled (AnchoredMenu), so neither can be painted under
  // the table. Opening one closes the other — two open at once was the overlap.
  const presetMenu = useMenuAnchor();
  const screenMenu = useMenuAnchor();
  const openPresets = () => {
    screenMenu.close();
    presetMenu.toggle();
  };
  const openScreens = () => {
    presetMenu.close();
    screenMenu.toggle();
  };
  const [exportOpen, setExportOpen] = useState(false);
  const [analyseFor, setAnalyseFor] = useState<Row | null>(null);
  const [flash, setFlash] = useState('');
  const flashTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((msg: string) => {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(''), 1900);
  }, []);

  // Restore persisted filters + index once, before saving anything back. A
  // shared `#screen=` link (web) takes precedence over persisted state. Old
  // saved states/links carry legacy keyed filters — converted to expr rows.
  useEffect(() => {
    (async () => {
      try {
        const shared = readSharedScreen();
        if (shared) {
          const sharedSel = String(shared.indexName || '').split(',').filter((n) => INDICES.includes(n));
          if (sharedSel.length) setIndexSel(sharedSel);
          setExpr(shared.expr?.length ? shared.expr : filtersToExpr(shared.active));
          setSortCol(shared.sortCol);
          setSortDir(shared.sortDir);
        } else {
          const [x, f, idx] = await Promise.all([
            AsyncStorage.getItem(EXPR_KEY),
            AsyncStorage.getItem(FILTERS_KEY),
            AsyncStorage.getItem(INDEX_KEY),
          ]);
          // Filters are NOT restored: the console opens on no filters at all,
          // every load. The stored keys are still read for the universe below,
          // and left in place so a future "restore my last screen" has
          // something to restore.
          void x;
          void f;
          if (idx) {
            let sel: string[] = [];
            try {
              const p = JSON.parse(idx);
              if (Array.isArray(p)) sel = p.filter((n) => INDICES.includes(n));
            } catch {
              sel = idx.split(',').filter((n) => INDICES.includes(n));
            }
            if (sel.length) setIndexSel(sel);
          }
        }
      } catch {
        /* fresh start */
      } finally {
        setRestored(true);
      }
    })();
  }, []);

  // Landing-page "open in Custom screener" handoff: pre-select that universe
  // (on mount for a fresh open, and live while this screen stays mounted).
  // Runs after the persisted-index restore so the intent wins, not the save.
  useEffect(() => {
    if (!restored) return;
    const apply = () => {
      const ix = takeIndex('screener');
      if (ix && INDICES.includes(ix)) setIndexSel([ix]);
    };
    apply();
    return subscribeNav(apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored]);

  // Restore column prefs once (independent of index/filters).
  useEffect(() => {
    (async () => {
      try {
        const rawCols = await AsyncStorage.getItem(COLS_KEY);
        if (rawCols) {
          const p = JSON.parse(rawCols);
          if (Array.isArray(p?.order)) setColOrder(p.order.filter((k: unknown) => typeof k === 'string'));
          if (Array.isArray(p?.hidden)) setColHidden(p.hidden.filter((k: unknown) => typeof k === 'string'));
        }
      } catch {
        /* defaults */
      } finally {
        setPrefsRestored(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!prefsRestored) return;
    AsyncStorage.setItem(COLS_KEY, JSON.stringify({ order: colOrder, hidden: colHidden })).catch(() => {});
  }, [colOrder, colHidden, prefsRestored]);

  useEffect(() => {
    loadSavedScreens().then(setSaved);
    loadWatchlist().then(setWatch);
  }, []);

  useEffect(() => {
    if (!restored) return;
    AsyncStorage.setItem(EXPR_KEY, JSON.stringify(expr)).catch(() => {});
  }, [expr, restored]);

  useEffect(() => {
    if (!restored) return;
    AsyncStorage.setItem(INDEX_KEY, JSON.stringify(indexSel)).catch(() => {});
  }, [indexSel, restored]);

  // Monotonic token so a stale in-flight scan can't write into a newer index's rows.
  const loadSeq = React.useRef(0);

  // Technicals are fetched for WHAT IS ON SCREEN first, then swept in the
  // background over the rest of the universe.
  //
  // The old path asked /scan for every symbol in the union up front. On a
  // single index that was fine; on ALL MARKETS it is 1447 symbols — a hundred
  // and twenty round trips, each of which may have to compute a year of daily
  // bars upstream — and the table sat at "technicals 0/1447" indefinitely. The
  // user only ever sees fifty rows at a time, so those fifty go first: one
  // wave, and the visible page is full. Everything else still loads, just
  // behind the part being looked at, which is what makes sorting and filtering
  // across the whole universe work eventually without holding up first paint.
  const [scanJob, setScanJob] = useState<
    { seq: number; symbols: string[]; live: boolean } | null
  >(null);
  // Symbols already handed to /scan in this load — neither pass repeats work.
  const scanReq = React.useRef<Set<string>>(new Set());
  // Set while the visible page is fetching, so the background sweep stands off.
  const pageScanBusy = React.useRef(false);

  // Merge a batch of scan rows. Which side wins the price fields depends on
  // where the seed came from: a live NSE quote is fresher than anything
  // computed off daily bars, but a settled bhavcopy close is not — and letting
  // it win was what pinned the table to yesterday's number.
  const applyScan = useCallback((data: Record<string, ScanRow>, live: boolean) => {
    setRows((prev) =>
      prev.map((r) => {
        const s = data[r.sym];
        if (!s) return r;
        const merged = { ...r, ...s };
        if (live) {
          merged.price = r.price ?? s.price;
          merged.prevClose = r.prevClose ?? s.prevClose;
          merged.chg = r.chg ?? s.chg;
          merged.absChg = r.absChg ?? s.absChg;
          merged.volume = r.volume ?? s.volume;
        } else {
          merged.price = s.price ?? r.price;
          merged.prevClose = s.prevClose ?? r.prevClose;
          merged.chg = s.chg ?? r.chg;
          merged.absChg = s.absChg ?? r.absChg;
          merged.volume = s.volume ?? r.volume;
        }
        return merged;
      }),
    );
  }, []);

  /**
   * (Re)build the table for a set of universes.
   *
   * `force` bypasses the index cache. It matters: /index is cached for ten
   * minutes, so an explicit Run inside that window would have re-rendered the
   * same rows and called it a refresh — a control that appears to do work and
   * does none. The automatic load on mount keeps the cache, which is what the
   * cache is for; only a person asking for fresh numbers overrides it.
   */
  const load = useCallback(async (sel: string[], force = false) => {
    const seq = ++loadSeq.current;
    scanReq.current = new Set();
    pageScanBusy.current = false;
    setScanJob(null);
    setError(null);
    setNote('');
    setSnapAt(null);

    // ── the one-request path ──
    // A prebuilt snapshot carries names, the session's closes, technicals and
    // fundamentals already merged, so the table is complete on the first
    // response instead of after four waves of requests. It is EOD by
    // definition; when the market is open the live path below runs behind it
    // and overwrites the quotes, which is one request AFTER the rows are on
    // screen rather than three before.
    //
    // Only for a single universe: a snapshot is per index, and merging two of
    // them here would duplicate the union logic below for a case nobody opens
    // on. A forced Run skips it too — the point of Run is fresh numbers.
    if (!force && sel.length === 1) {
      try {
        const snap = await api.screenerSnapshot(sel[0]);
        if (seq !== loadSeq.current) return;
        if (snap?.rows?.length) {
          setRows(snap.rows as Row[]);
          setLoading(false);
          setRefreshing(false);
          setQuoteInfo({ live: false, asOf: snapDay(snap.built_at) });
          setSnapAt(snap.built_at);
        }
      } catch {
        // 404 until the first build, and after 36h without one. The path
        // below is the fallback and needs no announcement.
      }
    }

    try {
      const [idxes, names] = await Promise.all([
        Promise.all(sel.map((n) => api.indexConstituents(n, force).catch(() => ({ data: [], error: undefined as string | undefined })))),
        loadNames(),
      ]);
      if (seq !== loadSeq.current) return;
      // Union of every selected universe, deduped by symbol (first wins).
      const seen = new Set<string>();
      const cons: { symbol: string; name?: string | null; price?: number | null; prevClose?: number | null; chg?: number | null; absChg?: number | null; volume?: number | null }[] = [];
      for (const idx of idxes) {
        for (const c of idx.data || []) {
          if (c.symbol && !seen.has(c.symbol)) {
            seen.add(c.symbol);
            cons.push(c);
          }
        }
      }
      if (!cons.length) {
        setRows([]);
        setNote(idxes.map((i) => (i as { error?: string; note?: string }).error || (i as { note?: string }).note).filter(Boolean)[0] || 'No constituents returned.');
        return;
      }
      // 1) The index feed already carries live NSE quotes — show them instantly.
      const seeded: Row[] = cons.map((c) => ({
        sym: c.symbol,
        // Universe master list first; SME/IPO groups carry their own names
        // (those symbols aren't in the main-board master list).
        name: names[c.symbol.toUpperCase()]?.name || c.name || undefined,
        exchange: names[c.symbol.toUpperCase()]?.exchange || 'NSE',
        price: c.price,
        prevClose: c.prevClose,
        chg: c.chg,
        absChg: c.absChg,
        volume: c.volume,
      }));
      // Onto whatever is already on screen, not over it. If a snapshot painted
      // first, its technicals and fundamentals must survive this — replacing
      // the rows outright would flash a complete table back to a bare one and
      // leave it there until the sweep re-landed, which is worse than the
      // four-request wait this replaced.
      setRows((prev) => {
        if (!prev.length) return seeded;
        const bySym = new Map(prev.map((r) => [r.sym, r]));
        return seeded.map((row) => {
          const had = bySym.get(row.sym);
          if (!had) return row;
          // Quotes win (they are the fresher half); everything else is kept.
          const merged: Row = { ...had, ...row };
          if (row.price == null) merged.price = had.price;
          if (row.volume == null) merged.volume = had.volume;
          return merged;
        });
      });
      setLoading(false);
      setRefreshing(false);
      // Quote provenance decides both the caption and who wins the /scan merge.
      // 'nse' is a live tick; anything else is the last settled close, which is
      // a real number worth showing — as long as it says which day it is.
      const live = idxes.every((i) => (i as IndexResp).quote_source === 'nse');
      const asOf = idxes.map((i) => (i as IndexResp).quote_date).find(Boolean) || null;
      setQuoteInfo({ live, asOf: live ? null : asOf });
      // 2) Technicals: the visible page first, the rest behind it.
      setScanJob({ seq, symbols: cons.map((c) => c.symbol), live });
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load');
      setRows([]);
    } finally {
      if (seq === loadSeq.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!restored) return;
    setLoading(true);
    load(indexSel);
  }, [indexSel, load, restored]);

  useEffect(() => {
    loadTrack().then(setTrack);
  }, []);

  // Fetch fundamentals for every loaded index (they now feed table columns,
  // not just filters). /fundamentals/bulk returns cached rows immediately plus
  // a `pending` list still warming server-side — poll until pending drains
  // (bounded) so warming stocks aren't stuck at '—' or silently excluded by
  // strict fundamental filters.
  //
  // Keyed on the LOAD, not on `rows`. Every arriving scan batch replaces the
  // rows array, and this effect used to depend on it: React ran the cleanup,
  // which cancelled the poll mid-flight, and the body then started it over from
  // round zero. With technicals streaming in a hundred batches deep, the
  // fundamentals poll was reset a hundred times and never reached its warm
  // rounds — which is why market cap stayed blank on the wider universes.
  const fundPolling = React.useRef(false);
  useEffect(() => {
    const job = scanJob;
    if (!job || fundPolling.current) return;
    const missing = job.symbols;
    if (!missing.length) return;
    fundPolling.current = true;
    let cancelled = false;
    setFundBusy(true);
    (async () => {
      let target = missing;
      const settled = new Set<string>();
      // Scale the polling window with the universe: a fresh 400+ symbol group
      // (SME EMERGE, ALL) takes minutes to warm through screener.in/NSE — a
      // fixed 75 s window marked everything still warming as unavailable.
      const maxRounds = Math.min(90, 25 + Math.ceil(missing.length / 8));
      for (let round = 0; round < maxRounds && target.length && !cancelled; round++) {
        try {
          const res = await api.fundamentalsBulk(target);
          if (cancelled) break;
          const data = res.data || {};
          const got = Object.keys(data);
          if (got.length) {
            got.forEach((s) => settled.add(s));
            setRows((prev) =>
              prev.map((r) =>
                data[r.sym] !== undefined ? { ...r, _fund: data[r.sym] as Row['_fund'] } : r,
              ),
            );
          }
          const pending = new Set(res.pending || []);
          target = target.filter((s) => !settled.has(s) && pending.has(s));
        } catch {
          break; // network trouble — settle what's left as unavailable below
        }
        if (target.length) await new Promise((r) => setTimeout(r, 3000));
      }
      if (!cancelled) {
        // Anything never delivered is definitively unavailable (null), so the
        // effect doesn't loop and strict filters treat it consistently.
        const asked = new Set(missing);   // a Set, not includes() — this runs over the whole universe
        setRows((prev) =>
          prev.map((r) => (asked.has(r.sym) && r._fund === undefined ? { ...r, _fund: null } : r)),
        );
        setFundBusy(false);
      }
      fundPolling.current = false;
    })();
    return () => {
      cancelled = true;
      fundPolling.current = false;
    };
  }, [scanJob]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(indexSel, true);
  }, [indexSel, load]);

  // Live pattern bias per symbol — fetched from the pattern engine's index
  // snapshots only while a Patterns filter is in the expression.
  const [patMap, setPatMap] = useState<Record<string, 'bullish' | 'bearish' | 'neutral'>>({});
  const patActive = expr.some((e) => e.key.startsWith('pat_'));
  useEffect(() => {
    if (!patActive) return;
    let cancelled = false;
    (async () => {
      const map: Record<string, 'bullish' | 'bearish' | 'neutral'> = {};
      for (const idx of indexSel) {
        try {
          const snap = await api.patternsScreen(idx);
          (snap.results || []).forEach((h) => { if (h.bias) map[h.symbol] = h.bias; });
        } catch { /* snapshot unavailable for this index — skip */ }
      }
      if (!cancelled) setPatMap(map);
    })();
    return () => { cancelled = true; };
  }, [patActive, indexSel]);

  const filtered = useMemo(() => {
    if (patActive) rows.forEach((r) => { r._patBias = patMap[r.sym] ?? null; });
    return applyExpr(rows, expr);
  }, [rows, expr, patActive, patMap]);
  const sorted = useMemo(() => sortRows(filtered, sortCol, sortDir), [filtered, sortCol, sortDir]);

  // Visible/ordered columns from prefs (Symbol always first, hidden dropped).
  const visibleCols = useMemo(() => {
    const byKey = new Map(COLS.map((c) => [c.key, c]));
    const seen = new Set<string>();
    const ordered: Col[] = [];
    colOrder.forEach((k) => {
      const c = byKey.get(k);
      if (c && !seen.has(k)) {
        seen.add(k);
        ordered.push(c);
      }
    });
    COLS.forEach((c) => {
      if (!seen.has(c.key)) ordered.push(c);
    });
    // Pin # then Symbol to the front regardless of stored order.
    const symIdx = ordered.findIndex((c) => c.key === 'sym');
    if (symIdx > 0) ordered.unshift(ordered.splice(symIdx, 1)[0]);
    const snoIdx = ordered.findIndex((c) => c.key === 'sno');
    if (snoIdx > 0) ordered.unshift(ordered.splice(snoIdx, 1)[0]);
    const hidden = new Set(colHidden.filter((k) => k !== 'sym'));
    return ordered.filter((c) => !hidden.has(c.key));
  }, [colOrder, colHidden]);

  const tableW = useMemo(() => visibleCols.reduce((a, c) => a + c.w, 0) + ACTIONS_W, [visibleCols]);

  // Client-side pagination over the sorted set (stats + export use the full set).
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  useEffect(() => {
    setPage(0);
  }, [indexName, expr, sortCol, sortDir]);
  useEffect(() => {
    if (page > pageCount - 1) setPage(0);
  }, [page, pageCount]);
  const pageRows = useMemo(
    () => sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [sorted, page],
  );

  // Pass 1 — whatever is on screen right now. Re-runs on every rows change
  // (pageRows is derived from them), which is the point: turning the page or
  // re-sorting brings new symbols into view and they get fetched immediately.
  // Deliberately has NO cleanup — an in-flight fetch must survive the re-render
  // its own results cause. Staleness is handled by the load-sequence token.
  useEffect(() => {
    const job = scanJob;
    if (!job || job.seq !== loadSeq.current) return;
    const want = pageRows.map((r) => r.sym).filter((s) => !scanReq.current.has(s));
    if (!want.length) return;
    want.forEach((s) => scanReq.current.add(s));
    pageScanBusy.current = true;
    (async () => {
      try {
        await api.scan(want, {
          onBatch: (data) => {
            if (job.seq === loadSeq.current) applyScan(data, job.live);
          },
        });
      } catch {
        /* the sweep will come back around to these */
      } finally {
        pageScanBusy.current = false;
      }
    })();
  }, [pageRows, scanJob, applyScan]);

  // Pass 2 — everything else, so filtering and sorting on a technical column
  // cover the whole universe.
  //
  // This used to walk the list in chunks of 60 because /scan blocked on every
  // uncached symbol, which made a big request a long request. It no longer
  // does: the server answers from cache and computes behind the response. So
  // this is now one call that streams rows in as they land, and the chunking
  // that existed to hide latency is gone with the latency.
  useEffect(() => {
    const job = scanJob;
    if (!job) return;
    let stop = false;
    (async () => {
      // Let the visible page claim the connection first.
      await new Promise((r) => setTimeout(r, 300));
      if (stop || job.seq !== loadSeq.current) return;
      const rest = job.symbols.filter((s) => !scanReq.current.has(s));
      if (!rest.length) return;
      rest.forEach((s) => scanReq.current.add(s));
      try {
        await api.scan(rest, {
          concurrency: SWEEP_CONCURRENCY,
          onBatch: (data) => {
            if (!stop && job.seq === loadSeq.current) applyScan(data, job.live);
          },
        });
      } catch {
        /* the visible page still has its own fetch */
      }
    })();
    return () => {
      stop = true;
    };
  }, [scanJob, applyScan]);

  // How many rows actually carry technicals. Derived rather than counted as
  // batches land, so a symbol the upstream never answered for is reported as
  // missing instead of quietly inflating the total.
  const techCount = useMemo(
    () => rows.reduce((n, r) => n + (r.rsi != null || r.d50 != null ? 1 : 0), 0),
    [rows],
  );

  // How many rows a technical filter cannot judge yet.
  //
  // The sweep streams in behind the page, so a screen evaluated in the first
  // second or two is filtering rows that have no technicals on them — every
  // one fails, and the table says "No matches. Loosen or clear a filter",
  // which blames the screen for something that is merely not finished. With
  // the console now opening on a filtered screen every time, that was the
  // first thing you saw on every load.
  const techWaiting = useMemo(() => {
    const needs = expr.some(
      (e) => e.key && !SCAN_FREE.has(e.key) && !DEF_BY_KEY[e.key]?.fund,
    );
    return needs ? Math.max(0, rows.length - techCount) : 0;
  }, [expr, rows.length, techCount]);

  // The one status line under the toolbar. Load errors win; otherwise it says
  // what the prices are, and how far the technicals have got.
  const statusLine = useMemo(() => {
    if (note) return note;
    if (!rows.length) return '';
    const priced = rows.reduce((n, r) => n + (r.price != null ? 1 : 0), 0);
    const bits = [`${rows.length} symbols`];
    // Only worth a number when some rows have no price at all.
    if (priced < rows.length) bits.push(`${priced} priced`);
    bits.push(
      quoteInfo.live ? 'live quotes' : quoteInfo.asOf ? `${fmtDay(quoteInfo.asOf)} close` : 'quotes',
    );
    bits.push(
      techCount >= rows.length
        ? `${rows.length}/${rows.length} technicals`
        : `technicals ${techCount}/${rows.length}…`,
    );
    // Say where a complete table came from. A screen that fills instantly and
    // does not say it is holding a settled close invites someone to read it as
    // live during market hours.
    if (snapAt) bits.push('from the EOD snapshot');
    return bits.join(' · ');
  }, [note, rows, techCount, quoteInfo, snapAt]);

  const stats = useMemo(() => {
    let buy = 0;
    let sell = 0;
    let neutral = 0;
    for (const r of filtered) {
      const s = calcSignal(r);
      if (s === 'buy') buy++;
      else if (s === 'sell') sell++;
      else neutral++;
    }
    return { total: filtered.length, buy, sell, neutral };
  }, [filtered]);

  // "showing X–Y" bounds for the current page.
  const showFrom = sorted.length ? page * PAGE_SIZE + 1 : 0;
  const showTo = Math.min((page + 1) * PAGE_SIZE, sorted.length);

  const onSort = (col: string) => {
    if (col === sortCol) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortCol(col);
      setSortDir(col === 'sym' ? 1 : -1);
    }
  };

  const trackDirOf = (sym: string): TrackDir | null =>
    track.find((t) => t.sym === sym)?.dir ?? null;

  const onTrack = async (r: Row, dir: TrackDir) => {
    const cur = trackDirOf(r.sym);
    if (cur === dir) {
      setTrack(await removeTrack(track, r.sym)); // tapping the active side untracks
    } else {
      setTrack(await addTrack(track, r.sym, dir, r.price ?? 0, Date.now()));
    }
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

  // No cross-tab navigation exists (Hosts.tsx sub-tabs are locally-stateful and
  // don't accept a target symbol). TODO: wire a shared symbol bus so "Chart" can
  // jump to the Charts tab; until then, open the detail modal (which renders a
  // 6-month chart) as the fallback.
  const onChart = (r: Row) => setDetail(r);

  const curState = (): ScreenState => ({ indexName: indexSel.join(','), active: {}, expr, sortCol, sortDir });

  const onShare = async () => {
    const enc = encodeScreen(curState());
    if (!enc) {
      toast('Sharing not supported here');
      return;
    }
    const g = globalThis as {
      location?: { origin?: string; pathname?: string };
      navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } };
    };
    const loc = g.location;
    const url = loc ? `${loc.origin ?? ''}${loc.pathname ?? ''}#screen=${enc}` : `#screen=${enc}`;
    try {
      if (g.navigator?.clipboard?.writeText) {
        await g.navigator.clipboard.writeText(url);
        toast('Share link copied to clipboard');
      } else {
        toast('Clipboard unavailable');
      }
    } catch {
      toast('Copy failed');
    }
  };

  const doSaveScreen = async (name: string) => {
    setSaved(await saveScreen(saved, name, curState()));
    toast(`Saved "${name.trim()}"`);
  };
  const doDeleteScreen = async (name: string) => {
    setSaved(await deleteScreen(saved, name));
  };
  const applySaved = (s: SavedScreen) => {
    const sel = String(s.indexName || '').split(',').filter((n) => INDICES.includes(n));
    if (sel.length) setIndexSel(sel);
    setExpr(s.expr?.length ? s.expr : filtersToExpr(s.active));
    setSortCol(s.sortCol);
    setSortDir(s.sortDir);
    setSavedModal(false);
    toast(`Applied "${s.name}"`);
  };

  const renderRow = (item: Row, rowIdx: number) => {
    const dir = trackDirOf(item.sym);
    const starred = isWatched(item.sym);
    const absIdx = page * PAGE_SIZE + rowIdx; // serial number across pages
    return (
      <View key={item.sym} style={styles.dataRow}>
        {visibleCols.map((c) =>
          c.key === 'sym' ? (
            // Symbol cell: tap the symbol for the dossier; chart + watch star
            // sit right next to it.
            <View key={c.key} style={[styles.td, cellFlex(c), styles.symCell]}>
              <TouchableOpacity onPress={() => setDetail(item)} activeOpacity={0.75}>
                {c.render(item, absIdx)}
              </TouchableOpacity>
              <SymInline sym={item.sym} starred={starred} onChart={() => onChart(item)} onStar={() => onToggleWatch(item)} />
            </View>
          ) : (
            <View key={c.key} style={[styles.td, cellFlex(c), { alignItems: c.align === 'left' ? 'flex-start' : 'flex-end' }]}>
              {c.render(item, absIdx)}
            </View>
          ),
        )}
        <View style={styles.actionsCell}>
          <TouchableOpacity
            style={[styles.tBtn, dir === 'buy' && styles.tBuyOn]}
            onPress={() => onTrack(item, 'buy')}
            activeOpacity={0.75}
          >
            <Text style={[styles.tBtnTxt, dir === 'buy' && styles.tOnTxt]}>{dir === 'buy' ? '✓B' : 'B'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tBtn, dir === 'sell' && styles.tSellOn]}
            onPress={() => onTrack(item, 'sell')}
            activeOpacity={0.75}
          >
            <Text style={[styles.tBtnTxt, dir === 'sell' && styles.tOnTxt]}>{dir === 'sell' ? '✓S' : 'S'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.aBtn} onPress={() => setDetail(item)} activeOpacity={0.75}>
            <Text style={styles.aBtnTxt}>Report</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.aBtn} onPress={() => setAnalyseFor(item)} activeOpacity={0.75}>
            <Text style={styles.aBtnTxt}>Analyse ▾</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // How many preset scans are currently contributing rows — the button says so
  // rather than making you open it to find out.
  const presetCount = new Set(
    expr.map((e) => e.src).filter((v): v is string => !!v && v.startsWith('preset:')),
  ).size;

  if (loading) {
    return (
      <View style={styles.center}>
        <Loading label={`Loading ${indexName} constituents…`} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Everything above the rows is FIXED — universe picker, filters,
          columns/export, pagination and the table's header row never scroll
          away; only the result rows do. */}
      {/* ── screen settings ──────────────────────────────────────────────
          One bounded, shaded block rather than a row of controls floating on
          the page. "Minimise" needs a visible subject: before this it sat
          outside everything it collapsed, so pressing it was a guess. The
          block is what disappears, the button that collapses it lives inside
          it, and the shade is what tells you where it ends. */}
      <View style={[styles.settings, cfgMin && styles.settingsMin]}>
      <View style={styles.topBar}>
        {/* The three things a screen starts from, centred on the page: which
            screener, over what universe, looking for what. They used to be two
            pill bars above the page and a button buried in the filter panel. */}
        <View style={styles.dropRow}>
        {screens && onScreen ? (
          <TouchableOpacity
            ref={screenMenu.ref}
            style={[styles.idxDrop, screenMenu.isOpen && styles.idxDropOn]}
            onPress={openScreens}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityState={{ expanded: screenMenu.isOpen }}
            accessibilityLabel="Choose a screener"
          >
            <Text style={styles.idxDropLabel}>SCREEN</Text>
            <Text style={styles.idxDropTxt}>
              {screens.find((x) => x.key === screen)?.label ?? 'Custom'} ▾
            </Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.idxDrop} onPress={() => setIdxOpen(true)} activeOpacity={0.75}>
          <Text style={styles.idxDropLabel}>UNIVERSE</Text>
          <Text style={styles.idxDropTxt}>{selLabel(indexSel)} ▾</Text>
        </TouchableOpacity>
        <TouchableOpacity
          ref={presetMenu.ref}
          style={[styles.idxDrop, presetMenu.isOpen && styles.idxDropOn]}
          onPress={openPresets}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityState={{ expanded: presetMenu.isOpen }}
          accessibilityLabel="Preset scans"
        >
          <Text style={styles.idxDropLabel}>PRESET SCANS</Text>
          <Text style={styles.idxDropTxt}>
            {presetCount ? `${presetCount} applied` : 'Pick one'} ▾
          </Text>
        </TouchableOpacity>
        </View>
        {/* Absolutely placed so it cannot pull the row off centre: a button in
            the flow would shift the three pickers left by half its width. */}
        {isDesktop ? (
          <TouchableOpacity
            style={styles.cfgMinBtn}
            onPress={toggleCfgMin}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityState={{ expanded: !cfgMin }}
            accessibilityLabel={cfgMin ? 'Show screen settings' : 'Minimise screen settings'}
          >
            <Text style={styles.cfgMinTxt}>{cfgMin ? '⌄ Expand' : '⌃ Minimise'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {!isDesktop ? (
        <View style={styles.mobileFilterRow}>
          <TouchableOpacity
            style={[styles.filterBarBtn, expr.length > 0 && styles.filterBarBtnOn]}
            onPress={() => setFiltersOpen(true)}
            activeOpacity={0.75}
          >
            <Text style={[styles.filterBarBtnTxt, expr.length > 0 && styles.filterBarBtnTxtOn]}>
              ⚙ Filters{expr.length ? ` (${expr.length})` : ''}
            </Text>
          </TouchableOpacity>
          <Text style={styles.filterSummary} numberOfLines={1}>
            {expr.length ? exprSummary(expr) : 'No filters'}
          </Text>
          <RunBtn onPress={onRefresh} running={refreshing} />
        </View>
      ) : null}

      {isDesktop && cfgMin ? (
        // Minimised: the block still says what it is holding, and still lets
        // you re-run without expanding it to find the button.
        <View style={styles.minRow}>
          <Text style={styles.filterSummary} numberOfLines={1}>
            {expr.length ? `${expr.length} filter${expr.length === 1 ? '' : 's'} · ${exprSummary(expr)}` : 'No filters — full universe'}
          </Text>
          <RunBtn onPress={onRefresh} running={refreshing} />
        </View>
      ) : null}

      {isDesktop && !cfgMin ? (
        <FilterPanel
          expr={expr}
          setExpr={setExpr}
          savedCount={saved.length}
          onShare={onShare}
          onSaveScreen={() => setSavedModal(true)}
          onOpenFieldPicker={setFieldPickFor}
          onRun={onRefresh}
          running={refreshing}
        />
      ) : null}
      </View>
      <View style={styles.statsRow}>
        <Text style={styles.statsTxt} numberOfLines={1}>
          <Text style={styles.statsN}>{stats.total}</Text> matches
          {fundWaiting ? <Text style={{ color: '#f5c518' }}>{` · ${fundWaiting} awaiting financials`}</Text> : null}
          {stats.total ? ` · ${showFrom}–${showTo}` : ''}{'   '}
          <Text style={{ color: theme.green }}>{stats.buy}▲</Text>{'  '}
          <Text style={{ color: theme.red }}>{stats.sell}▼</Text>{'  '}
          <Text style={{ color: theme.muted2 }}>{stats.neutral}—</Text>
        </Text>
        <View style={styles.actionsWrap}>
          <TouchableOpacity style={styles.filterBtn} onPress={() => setColMenu(true)} activeOpacity={0.75}>
            <Text style={styles.filterTxt}>▤ Columns</Text>
          </TouchableOpacity>
          <View style={styles.exportWrap}>
            <TouchableOpacity style={styles.filterBtn} onPress={() => setExportOpen((v) => !v)} activeOpacity={0.75}>
              <Text style={styles.filterTxt}>⇩ Export ▾</Text>
            </TouchableOpacity>
            {exportOpen ? (
              <View style={styles.exportMenu}>
                {([['CSV', exportCsv], ['Excel', exportExcel], ['PDF', exportPdf]] as const).map(([label, fn]) => (
                  <TouchableOpacity
                    key={label}
                    style={styles.exportItem}
                    onPress={() => {
                      setExportOpen(false);
                      fn(sorted, indexName, exportColsOf(visibleCols)).catch(() => {});
                    }}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.exportItemTxt}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
          </View>
          <TouchableOpacity
            style={[styles.pageBtn, page <= 0 && styles.pageBtnOff]}
            onPress={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page <= 0}
            activeOpacity={0.75}
          >
            <Text style={styles.pageBtnTxt}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.pageInfo}>{sorted.length ? `${page + 1}/${pageCount}` : '0/0'}</Text>
          <TouchableOpacity
            style={[styles.pageBtn, page >= pageCount - 1 && styles.pageBtnOff]}
            onPress={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page >= pageCount - 1}
            activeOpacity={0.75}
          >
            <Text style={styles.pageBtnTxt}>›</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.note} numberOfLines={1}>
        {statusLine}
        {fundBusy ? ' · loading fundamentals…' : ''}
        {/* Coverage for the fields actually being filtered on — the number that
            explains an empty table when a ·f filter is active. */}
        {!fundBusy && fundCoverage ? ` · ${fundCoverage.usable}/${fundCoverage.total} with financials` : ''}
        {error ? ` · ${error}` : ''}
      </Text>

      {/* Table: header row is fixed; only the data rows scroll vertically.
          The horizontal ScrollView carries header + rows together so columns
          stay aligned while scrolling sideways. */}
      <ScrollView horizontal showsHorizontalScrollIndicator style={styles.tableArea} contentContainerStyle={styles.tableStretch}>
        <View style={{ minWidth: tableW, flexGrow: 1, flex: 1 }}>
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
          <ScrollView
            style={{ flex: 1 }}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />
            }
          >
            {pageRows.length === 0 ? (
              /* A fundamental filter compares against data fetched per symbol.
                 Until it arrives the row cannot satisfy the filter, so a big
                 universe reads "0 matches" while it is merely still loading —
                 say so instead of blaming the filter. */
              <EmptyState
                icon={techWaiting || fundWaiting ? '↻' : fundCoverage && !fundCoverage.usable ? '⚠' : '⌕'}
                title={
                  techWaiting
                    ? 'Still scanning…'
                    : fundWaiting
                      ? 'Fetching company financials…'
                      : fundCoverage && !fundCoverage.usable
                        ? 'No financials to filter on'
                        : 'No matches'
                }
                hint={
                  techWaiting
                    ? `${techCount} of ${rows.length} symbols have their technicals so far. A filter on RSI, a moving average or a signal can only match once a symbol has been scanned — results fill in as they arrive.`
                    : fundWaiting
                    ? `${fundWaiting} of ${rows.length} symbols still to load. Fundamental filters (·f) can only match once a symbol's financials arrive — results will fill in as they do.`
                    : fundCoverage && !fundCoverage.usable
                      ? `None of these ${rows.length} symbols has a published value for ${fundCoverage.labels.join(' or ')}, so the ·f filter cannot match anything — this is missing data, not a strict filter. Company financials are thinnest on the widest universes; try a narrower index, or screen on technicals instead.`
                      : fundCoverage && fundCoverage.usable < rows.length
                        ? `Only ${fundCoverage.usable} of ${rows.length} symbols have a published ${fundCoverage.labels.join(' / ')}, and none of those passed. Loosen the filter, or switch to a narrower index where financial coverage is better.`
                        : 'Loosen or clear a filter to see more of this index.'
                }
              />
            ) : (
              pageRows.map(renderRow)
            )}
          </ScrollView>
        </View>
      </ScrollView>

      {/* Both toolbar menus, portalled so nothing can paint over them. */}
      <AnchoredMenu
        anchor={presetMenu.anchor}
        width={480}
        maxHeight={440}
        onClose={presetMenu.close}
      >
        <PresetMenu expr={expr} setExpr={setExpr} onClose={presetMenu.close} />
      </AnchoredMenu>
      {screens && onScreen ? (
        <AnchoredMenu anchor={screenMenu.anchor} width={300} onClose={screenMenu.close}>
          {screens.map((x) => (
            <TouchableOpacity
              key={x.key}
              style={styles.presetItem}
              onPress={() => {
                screenMenu.close();
                onScreen(x.key);
              }}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={x.label}
            >
              <Text style={[styles.presetMark, x.key === screen && { color: theme.green }]}>
                {x.key === screen ? '✓' : '○'}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.presetName}>{x.label}</Text>
                {x.hint ? <Text style={styles.presetDesc} numberOfLines={1}>{x.hint}</Text> : null}
              </View>
            </TouchableOpacity>
          ))}
        </AnchoredMenu>
      ) : null}

      {/* Universe picker — multi-select: toggle any combination, or All. */}
      {idxOpen ? (
        <UniversePicker
          selected={indexSel}
          onApply={(sel) => {
            setIndexSel(sel);
            setIdxOpen(false);
          }}
          onClose={() => setIdxOpen(false)}
        />
      ) : null}

      {/* Per-row Analyse menu */}
      {analyseFor ? (
        <Sheet onClose={() => setAnalyseFor(null)} maxHeight="50%">
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Analyse {analyseFor.sym}</Text>
            <TouchableOpacity onPress={() => setAnalyseFor(null)} hitSlop={12} activeOpacity={0.75}>
              <Text style={styles.sheetClose}>✕ Close</Text>
            </TouchableOpacity>
          </View>
          {([
            ['As a multibagger', 'Fundamental compounding score + 5x probability', 'mb'],
            ['Momentum', 'Trend, relative strength and momentum read', 'momentum'],
            ['Chart patterns', 'Scan its full history for classic formations', 'patterns'],
          ] as const).map(([label, hint, sub]) => (
            <TouchableOpacity
              key={sub}
              style={styles.idxOpt}
              onPress={() => {
                const sym = analyseFor.sym;
                setAnalyseFor(null);
                navigate('analysis', { sub, symbol: sym });
              }}
              activeOpacity={0.75}
            >
              <Text style={styles.idxOptTxt}>{label}</Text>
              <Text style={styles.idxOptHint}>{hint}</Text>
            </TouchableOpacity>
          ))}
        </Sheet>
      ) : null}

      <ColumnMenu
        visible={colMenu}
        order={colOrder}
        hidden={colHidden}
        onClose={() => setColMenu(false)}
        onApply={(order, hidden) => {
          setColOrder(order);
          setColHidden(hidden);
          setColMenu(false);
        }}
        onReset={() => {
          setColOrder(COLS.map((c) => c.key));
          setColHidden(DEFAULT_HIDDEN);
          setColMenu(false);
        }}
      />

      <SavedScreensModal
        visible={savedModal}
        saved={saved}
        onClose={() => setSavedModal(false)}
        onSave={doSaveScreen}
        onDelete={doDeleteScreen}
        onApply={applySaved}
      />

      {/* Mobile filter-builder popup — at container level: Sheet is an
          absolute overlay and would mis-position inside the page ScrollView. */}
      {!isDesktop && filtersOpen ? (
        // Full-screen: title + Close stay fixed, the builder scrolls, the
        // apply button is pinned above the device nav bar.
        <Sheet onClose={() => setFiltersOpen(false)} fill>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Filters</Text>
            <TouchableOpacity onPress={() => setFiltersOpen(false)} hitSlop={12} activeOpacity={0.75}>
              <Text style={styles.sheetClose}>✕ Close</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={{ flex: 1 }} bounces={false} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            <FilterPanel
              expr={expr}
              setExpr={setExpr}
              savedCount={saved.length}
              onShare={onShare}
              onSaveScreen={() => setSavedModal(true)}
              onOpenFieldPicker={setFieldPickFor}
              // Running from inside the sheet closes it: the point of pressing
              // Run is to look at the rows, and they are behind this.
              onRun={() => { setFiltersOpen(false); onRefresh(); }}
              running={refreshing}
            />
          </ScrollView>
          <Btn label={`Show ${stats.total} matches`} onPress={() => setFiltersOpen(false)} style={styles.sheetApply} />
        </Sheet>
      ) : null}

      {/* Metric mega-picker — rendered at container level so it overlays the
          desktop panel AND the mobile filters Sheet (it comes later in the
          tree, so it paints on top). */}
      {fieldPickFor ? (
        <FieldPicker
          onClose={() => setFieldPickFor(null)}
          onPick={(k) => {
            setExpr((cur) => cur.map((e) => (e.id === fieldPickFor
              ? { ...e, key: k, op: defaultOpFor(k), v1: '', v2: '' }
              : e)));
            setFieldPickFor(null);
          }}
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

// ── Inline filter panel ───────────────────────────────────────────────────────
// Lives in the page flow (not a modal) and edits `active` LIVE — every change
// reflects immediately, exactly like presets. `shown` is the ordered list of
// filter-key rows; emptying a value keeps its row, the × button removes it.
// ── Universe picker (multi-select with an All toggle) ────────────────────────
// Edits a draft and commits on Apply, so toggling five universes triggers ONE
// reload of the union rather than five.
function UniversePicker({
  selected,
  onApply,
  onClose,
}: {
  selected: string[];
  onApply: (sel: string[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<string[]>(selected);
  const allOn = draft.length >= INDICES.length;
  const toggle = (idx: string) =>
    setDraft((d) => (d.includes(idx) ? d.filter((x) => x !== idx) : [...d, idx]));

  return (
    <Sheet onClose={onClose} fill>
      <View style={styles.sheetHead}>
        <Text style={styles.sheetTitle}>Universe</Text>
        <TouchableOpacity onPress={onClose} hitSlop={12} activeOpacity={0.75}>
          <Text style={styles.sheetClose}>✕ Close</Text>
        </TouchableOpacity>
      </View>
      <ScrollView style={{ flex: 1 }} bounces={false}>
        <TouchableOpacity
          style={styles.idxOptRow}
          onPress={() => setDraft(allOn ? ['NIFTY 50'] : [...INDICES])}
          activeOpacity={0.75}
        >
          <Text style={[styles.idxCheck, allOn && styles.idxCheckOn]}>{allOn ? '☑' : '☐'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.idxOptTxt, allOn && { color: theme.brand, fontWeight: '700' }]}>All markets</Text>
            <Text style={styles.idxOptHint}>Every universe below, deduped into one scan</Text>
          </View>
        </TouchableOpacity>
        {INDEX_GROUPS.map((g) => (
          <View key={g.title}>
            <Text style={styles.idxGroupTitle}>{g.title.toUpperCase()}</Text>
            {g.items.map((idx) => {
              const on = draft.includes(idx);
              return (
                <TouchableOpacity key={idx} style={styles.idxOptRow} onPress={() => toggle(idx)} activeOpacity={0.75}>
                  <Text style={[styles.idxCheck, on && styles.idxCheckOn]}>{on ? '☑' : '☐'}</Text>
                  <Text style={[styles.idxOptTxt, on && { color: theme.brand, fontWeight: '700' }]}>
                    {idx}
                    {idx === 'RECENT IPOS' ? '  · listed in the last year' : idx === 'SME EMERGE' ? '  · NSE SME platform' : ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </ScrollView>
      <Btn
        label={draft.length ? `Scan ${selName(draft)}` : 'Pick at least one universe'}
        onPress={() => draft.length && onApply(draft)}
        disabled={!draft.length}
        style={styles.sheetApply}
      />
    </Sheet>
  );
}


// The preset library, lifted out of the filter panel so it can sit beside the
// Universe picker — the two questions a screen starts from are "over what" and
// "looking for what", and they belong next to each other.
function PresetMenu({
  expr,
  setExpr,
  onClose,
}: {
  expr: ExprRow[];
  setExpr: React.Dispatch<React.SetStateAction<ExprRow[]>>;
  onClose: () => void;
}) {
  // Presets append their conditions as tagged rows; toggling off removes them.
  const presetOn = (p: Preset) => expr.some((e) => e.src === 'preset:' + p.id);
  const togglePresetExpr = (p: Preset) => {
    const tag = 'preset:' + p.id;
    setExpr((prev) => {
      if (prev.some((e) => e.src === tag)) return prev.filter((e) => e.src !== tag);
      // Presets stack, which is what makes them composable. There used to be an
      // exception here — an untouched opening screen stepped aside so that
      // picking a preset did not silently mean "golden cross AND that" — and it
      // is gone with the opening screen it existed for. Nothing is on the
      // console now unless somebody put it there, so nothing has to guess
      // whether it was meant.
      return [...prev, ...filtersToExpr(p.filters, tag)];
    });
  };
  return (
    <View style={styles.presetDrop}>
            <View style={styles.presetHead}>
              <Text style={styles.presetHeadTxt}>PRESET SCANS</Text>
              <TouchableOpacity onPress={onClose} hitSlop={12} activeOpacity={0.75}>
                <Text style={styles.presetClose}>✕ Close</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.pickerScroll} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              {PRESET_GROUPS.map((g) => {
                const ps = PRESETS.filter((p) => p.group === g);
                if (!ps.length) return null;
                return (
                  <View key={g} style={styles.group}>
                    <Text style={styles.groupTitle}>{g}</Text>
                    {ps.map((p) => {
                      const on = presetOn(p);
                      return (
                        <TouchableOpacity
                          key={p.id}
                          style={styles.presetItem}
                          onPress={() => togglePresetExpr(p)}
                          activeOpacity={0.75}
                        >
                          <Text style={[styles.presetMark, on && { color: theme.green }]}>
                            {on ? '✓' : '○'}
                          </Text>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.presetName}>{p.name}</Text>
                            <Text style={styles.presetDesc} numberOfLines={1}>{p.desc}</Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                );
              })}
              <Text style={styles.fundNote}>Presets add their conditions as filter rows below — edit or remove them like any row.</Text>
            </ScrollView>
    </View>
  );
}

// ── Expression filter panel (TaurEye-style rows with AND/OR) ─────────────────
// Dropdown select for the expression rows (RN-web has no native <select>).
type SelItem = { v?: string; label: string; header?: boolean };

function Sel({
  label,
  items,
  onPick,
  open,
  onToggle,
  width,
}: {
  label: string;
  items: SelItem[];
  onPick: (v: string) => void;
  open: boolean;
  onToggle: () => void;
  width: number;
}) {
  return (
    <View style={[styles.selWrap, { width }, open && { zIndex: 400 }]}>
      <TouchableOpacity style={styles.selBtn} onPress={onToggle} activeOpacity={0.75}>
        <Text style={styles.selTxt} numberOfLines={1}>{label}</Text>
        <Text style={styles.selCaret}>▾</Text>
      </TouchableOpacity>
      {open ? (
        <View style={styles.selMenu}>
          <ScrollView style={{ maxHeight: 280 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {items.map((it, i) =>
              it.header ? (
                <Text key={'h' + it.label + i} style={styles.selHeader}>{it.label}</Text>
              ) : (
                <TouchableOpacity
                  key={(it.v || '') + i}
                  style={styles.selItem}
                  onPress={() => onPick(it.v || '')}
                  activeOpacity={0.75}
                >
                  <Text style={styles.selItemTxt}>{it.label}</Text>
                </TouchableOpacity>
              ),
            )}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

// Fullscreen "everything screenable" metric picker: every technical, signal,
// strategy, candlestick pattern, volume/structure and fundamental field,
// grouped and searchable — replaces the old short dropdown for choosing a
// filter row's metric.
function FieldPicker({ onPick, onClose }: { onPick: (key: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  // Predictive search: label, key and the synonym phrases all match, so
  // "cheap", "fcf" or "dip buy" find the right metric.
  const hit = (d: (typeof FILTER_DEFS)[number]) =>
    !ql
    || d.label.toLowerCase().includes(ql)
    || d.key.replace(/_/g, ' ').includes(ql)
    || (FILTER_SYNONYMS[d.key] || '').includes(ql);
  const groups = TE_GROUPS.map((g) => ({
    g,
    defs: FILTER_DEFS.filter((d) => d.group === g && hit(d)),
  })).filter((x) => x.defs.length);
  return (
    <Sheet onClose={onClose} fill>
      <View style={styles.sheetHead}>
        <Text style={styles.sheetTitle}>Choose metric</Text>
        <TouchableOpacity onPress={onClose} hitSlop={12} activeOpacity={0.75}>
          <Text style={styles.sheetClose}>✕ Close</Text>
        </TouchableOpacity>
      </View>
      <TextInput
        style={styles.fpSearch}
        value={q}
        onChangeText={setQ}
        placeholder="Search — RSI, P/E, hammer, golden cross, revenue…"
        placeholderTextColor={theme.muted}
        autoFocus
      />
      <ScrollView style={{ flex: 1 }} bounces={false} keyboardShouldPersistTaps="handled">
        {groups.length === 0 ? (
          <Text style={styles.fpEmpty}>No metric matches “{q}”.</Text>
        ) : (
          groups.map(({ g, defs }) => (
            <View key={g}>
              <Text style={styles.fpGroup}>{g.toUpperCase()}</Text>
              <View style={styles.fpGrid}>
                {defs.map((d) => (
                  <View key={d.key} style={styles.fpChipWrap}>
                    <TouchableOpacity style={styles.fpChip} onPress={() => onPick(d.key)} activeOpacity={0.7}>
                      <Text style={styles.fpChipTxt}>
                        {d.label}
                        {/* Unit, so a bare ratio is not mistaken for a percentage. */}
                        {d.unit ? <Text style={{ color: theme.muted2 }}> {d.unit}</Text> : null}
                        {d.fund ? <Text style={{ color: theme.muted }}> ·f</Text> : null}
                      </Text>
                    </TouchableOpacity>
                    {/* Only renders where an explanation exists (see INFO). */}
                    <InfoDot id={d.key} size={15} />
                  </View>
                ))}
              </View>
            </View>
          ))
        )}
        <Text style={styles.fundNote}>·f = fundamental — fetches company financials for the universe.</Text>
      </ScrollView>
    </Sheet>
  );
}

const FIELD_ITEMS: SelItem[] = TE_GROUPS.flatMap((g) => {
  const defs = FILTER_DEFS.filter((d) => d.group === g);
  return defs.length
    ? [{ label: g, header: true } as SelItem,
       ...defs.map((d) => ({ v: d.key, label: d.label + (d.fund ? ' ·f' : '') }))]
    : [];
});
const OP_ITEMS: SelItem[] = [
  { v: 'gt', label: '>' },
  { v: 'lt', label: '<' },
  { v: 'between', label: 'between' },
  { v: 'eq', label: '=' },
];
const OP_LABEL: Record<string, string> = { gt: '>', lt: '<', between: 'between', eq: '=', is: 'is true', has: 'is' };

// Raw export value per column key — mirrors what each table cell renders, so
// CSV/Excel/PDF contain exactly the columns the user has toggled visible.
const fundVal = (r: Row, k: string): unknown => (r._fund as Record<string, unknown> | null | undefined)?.[k] ?? '';
const EXPORT_GET: Record<string, (r: Row, i: number) => unknown> = {
  sno: (_r, i) => i + 1,
  sym: (r) => r.sym,
  name: (r) => r.name ?? '',
  exchange: (r) => r.exchange || 'NSE',
  price: (r) => r.price,
  chg: (r) => r.chg,
  volume: (r) => r.volume,
  relvol: (r) => r.relvol,
  rsi: (r) => r.rsi,
  d50: (r) => r.d50,
  pct_from_high: (r) => r.pct_from_high,
  market_cap_cr: (r) => fundVal(r, 'market_cap_cr'),
  signal: (r) => calcSignal(r).toUpperCase(),
  d20: (r) => r.d20,
  d200: (r) => r.d200,
  willr: (r) => r.willr,
  bollb: (r) => r.bollb,
  beta: (r) => r.beta,
  sqzMom: (r) => (r.sqzFire ? 'FIRE' : r.sqzOn ? 'ON' : r.sqzOn === false ? 'off' : ''),
  s1: (r) => r.s1,
  r1: (r) => r.r1,
  pe: (r) => fundVal(r, 'pe'),
  pb: (r) => fundVal(r, 'pb'),
  roe: (r) => fundVal(r, 'roe'),
  roce: (r) => fundVal(r, 'roce'),
  debt_equity: (r) => fundVal(r, 'debt_equity'),
  dividend_yield: (r) => fundVal(r, 'dividend_yield'),
};
export const exportColsOf = (cols: Col[]): ExportCol[] =>
  cols.map((c) => ({ header: c.label, get: EXPORT_GET[c.key] ?? (() => '') }));

// One tiny line describing the active filter rows for the mobile summary
// ("Minervini Trend Template · Price > 100 · RSI < 30").
function exprSummary(expr: ExprRow[]): string {
  return expr
    .map((e) => {
      const def = DEF_BY_KEY[e.key];
      if (!def) return null;
      if (def.type === 'range') {
        const v = e.op === 'between' ? `${e.v1 || 0}–${e.v2 || '∞'}` : (e.v1 || '0');
        return `${def.label} ${e.op === 'between' ? '' : OP_LABEL[e.op] || '>'} ${v}`.replace('  ', ' ');
      }
      if (def.type === 'select') return `${def.label}: ${e.v1 || 'any'}`;
      return def.label;
    })
    .filter(Boolean)
    .join(' · ');
}
const PRESET_GROUPS = ['Strategies', 'Trend', 'Momentum', 'Breakouts', 'Candlesticks', 'Volume', 'Fundamentals'] as const;

/**
 * Re-run the screen.
 *
 * The filter rows themselves are applied live — applyExpr runs on every
 * keystroke — so this does not "apply" anything, and a button that pretended
 * to would be a lie in the shape of a control. What it does is the part that
 * is NOT live: re-fetch the universe, its quotes and the technical sweep, so a
 * screen written twenty minutes ago is judged on today's numbers rather than
 * the ones that happened to be in memory. That is the thing people are
 * actually reaching for when they look for a Run button after editing a
 * filter, and it had no control at all on desktop — only pull-to-refresh,
 * which a mouse cannot do.
 */
function RunBtn({ onPress, running }: { onPress: () => void; running: boolean }) {
  return (
    <TouchableOpacity
      style={[styles.runBtn, running && styles.runBtnBusy]}
      onPress={onPress}
      disabled={running}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={running ? 'Re-running the screen' : 'Run the screen again with fresh data'}
    >
      <Text style={styles.runTxt}>{running ? '↻ Running…' : '▶ Run screen'}</Text>
    </TouchableOpacity>
  );
}

function FilterPanel({
  expr,
  setExpr,
  savedCount,
  onShare,
  onSaveScreen,
  onOpenFieldPicker,
  onRun,
  running,
}: {
  expr: ExprRow[];
  setExpr: React.Dispatch<React.SetStateAction<ExprRow[]>>;
  savedCount: number;
  onShare: () => void;
  onSaveScreen: () => void;
  onOpenFieldPicker: (rowId: string) => void;
  onRun: () => void;
  running: boolean;
}) {
  const [nlText, setNlText] = useState('');
  const [openSel, setOpenSel] = useState(''); // '<rowId>:f' | '<rowId>:o' | '<rowId>:v'
  const toggleSel = (id: string) => setOpenSel((cur) => (cur === id ? '' : id));

  // Live plain-English preview — what the parser understood so far.
  const nlParsed = useMemo(() => (nlText.trim() ? parseNL(nlText) : null), [nlText]);
  const applyNl = () => {
    if (!nlParsed?.matchedAny) return;
    setExpr((prev) => [...prev, ...filtersToExpr(nlParsed.filters, 'nl')]);
    setNlText('');
  };

  const patch = (id: string, p: Partial<ExprRow>) =>
    setExpr((prev) => prev.map((e) => (e.id === id ? { ...e, ...p } : e)));
  const removeRow = (id: string) => setExpr((prev) => prev.filter((e) => e.id !== id));
  const addRow = () =>
    setExpr((prev) => [...prev, { id: exprId(), key: 'price', op: 'gt', v1: '', join: 'and' }]);
  const clearAll = () => {
    setExpr([]);
    setOpenSel('');
  };

  return (
    <View style={styles.panel}>
      <View style={styles.nlBox}>
        <View style={styles.nlRow}>
          <Text style={styles.spark}>✦</Text>
          <TextInput
            style={styles.nlInput}
            value={nlText}
            onChangeText={setNlText}
            placeholder='Describe a screen — e.g. "golden crossover", "rsi below 30 and above 200 dma"'
            placeholderTextColor={theme.muted}
            returnKeyType="done"
            onSubmitEditing={applyNl}
          />
          <TouchableOpacity
            style={[styles.nlAdd, !nlParsed?.matchedAny && styles.nlAddOff]}
            onPress={applyNl}
            disabled={!nlParsed?.matchedAny}
            activeOpacity={0.75}
          >
            <Text style={[styles.nlAddTxt, !nlParsed?.matchedAny && { color: theme.muted }]}>Build</Text>
          </TouchableOpacity>
        </View>
        {nlParsed ? (
          <Text style={styles.nlFeedback}>
            {nlParsed.matchedAny ? '✓ ' + nlParsed.recognized.join(' · ') : 'Nothing recognised yet…'}
            {nlParsed.unrecognized.length ? `   (ignored: ${nlParsed.unrecognized.join(', ')})` : ''}
          </Text>
        ) : null}
      </View>

      <View style={styles.ctrlWrap}>
        <View style={styles.ctrlRow}>
          <TouchableOpacity style={styles.addFilterBtn} onPress={addRow} activeOpacity={0.75}>
            <Text style={styles.addFilterTxt}>+ Add filter</Text>
          </TouchableOpacity>
          {expr.length ? (
            <TouchableOpacity onPress={clearAll} activeOpacity={0.75}>
              <Text style={styles.clearAll}>Clear all</Text>
            </TouchableOpacity>
          ) : null}
          <View style={styles.ctrlRight}>
            <TouchableOpacity style={styles.filterBtn} onPress={onShare} activeOpacity={0.75}>
              <Text style={styles.filterTxt}>↗ Share</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.filterBtn} onPress={onSaveScreen} activeOpacity={0.75}>
              <Text style={styles.filterTxt}>Save screen{savedCount ? ` (${savedCount})` : ''}</Text>
            </TouchableOpacity>
            <RunBtn onPress={onRun} running={running} />
          </View>
        </View>
      </View>

      <View style={styles.panelBody}>
        {expr.length === 0 ? (
          <Text style={styles.emptyFilters}>No filters — showing the full universe.</Text>
        ) : (
          expr.map((e, i) => {
            const def = DEF_BY_KEY[e.key];
            const isRange = def?.type === 'range';
            const isSelect = def?.type === 'select';
            const rowOpen = openSel.startsWith(e.id + ':');
            return (
              <View key={e.id} style={[styles.exprRow, rowOpen && { zIndex: 300 }]}>
                {i > 0 ? (
                  <View style={styles.joinWrap}>
                    {(['and', 'or'] as const).map((j) => (
                      <TouchableOpacity
                        key={j}
                        style={[styles.joinBtn, e.join === j && styles.joinOn]}
                        onPress={() => patch(e.id, { join: j })}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.joinTxt, e.join === j && styles.joinTxtOn]}>{j.toUpperCase()}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : (
                  <View style={styles.joinSpacer} />
                )}
                <TouchableOpacity
                  style={[styles.selBtn, { width: 235 }]}
                  onPress={() => { setOpenSel(''); onOpenFieldPicker(e.id); }}
                  activeOpacity={0.75}
                >
                  <Text style={styles.selTxt} numberOfLines={1}>
                    {def ? def.label + (def.fund ? ' ·f' : '') : 'Choose metric'}
                  </Text>
                  <Text style={styles.selCaret}>▾</Text>
                </TouchableOpacity>
                {isRange ? (
                  <Sel
                    label={OP_LABEL[e.op] || '>'}
                    items={OP_ITEMS}
                    open={openSel === e.id + ':o'}
                    onToggle={() => toggleSel(e.id + ':o')}
                    onPick={(op) => {
                      patch(e.id, { op: op as ExprOp });
                      setOpenSel('');
                    }}
                    width={108}
                  />
                ) : (
                  <Text style={styles.opFixed}>{OP_LABEL[e.op]}</Text>
                )}
                {isRange ? (
                  <>
                    <TextInput
                      style={styles.exprInput}
                      value={e.v1 ?? ''}
                      onChangeText={(t) => patch(e.id, { v1: t })}
                      placeholder="0"
                      placeholderTextColor={theme.muted}
                      keyboardType="numeric"
                    />
                    {e.op === 'between' ? (
                      <>
                        <Text style={styles.betweenDash}>—</Text>
                        <TextInput
                          style={styles.exprInput}
                          value={e.v2 ?? ''}
                          onChangeText={(t) => patch(e.id, { v2: t })}
                          placeholder="∞"
                          placeholderTextColor={theme.muted}
                          keyboardType="numeric"
                        />
                      </>
                    ) : null}
                    {def?.unit ? <Text style={styles.unitTxt}>{def.unit}</Text> : null}
                  </>
                ) : null}
                {isSelect ? (
                  <Sel
                    label={e.v1 || 'Any'}
                    items={(def?.options || []).map((o) => ({ v: o, label: o }))}
                    open={openSel === e.id + ':v'}
                    onToggle={() => toggleSel(e.id + ':v')}
                    onPick={(v) => {
                      patch(e.id, { v1: v });
                      setOpenSel('');
                    }}
                    width={200}
                  />
                ) : null}
                <TouchableOpacity
                  style={styles.removeBtn}
                  onPress={() => removeRow(e.id)}
                  hitSlop={8}
                  activeOpacity={0.75}
                >
                  <Text style={styles.removeTxt}>×</Text>
                </TouchableOpacity>
              </View>
            );
          })
        )}
        {expr.length ? (
          <Text style={styles.exprHint}>
            Rows combine left to right with each row's AND/OR · ·f = fundamental (fetches company financials)
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ── Column show/hide + reorder ────────────────────────────────────────────────
type ColDraft = { key: string; label: string; visible: boolean };

function ColumnMenu({
  visible,
  order,
  hidden,
  onClose,
  onApply,
  onReset,
}: {
  visible: boolean;
  order: string[];
  hidden: string[];
  onClose: () => void;
  onApply: (order: string[], hidden: string[]) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState<ColDraft[]>([]);
  useEffect(() => {
    if (!visible) return;
    const byKey = new Map(COL_META.map((c) => [c.key, c.label]));
    const seen = new Set<string>();
    const list: ColDraft[] = [];
    order.forEach((k) => {
      const label = byKey.get(k);
      if (label != null && !seen.has(k)) {
        seen.add(k);
        list.push({ key: k, label, visible: !hidden.includes(k) });
      }
    });
    COL_META.forEach((c) => {
      if (!seen.has(c.key)) list.push({ key: c.key, label: c.label, visible: !hidden.includes(c.key) });
    });
    const symIdx = list.findIndex((c) => c.key === 'sym');
    if (symIdx > 0) list.unshift(list.splice(symIdx, 1)[0]);
    setDraft(list);
  }, [visible, order, hidden]);

  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (i < 1 || j < 1 || j >= draft.length) return; // Symbol (index 0) is locked first
    setDraft((d) => {
      const next = [...d];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const toggle = (key: string) =>
    setDraft((d) => d.map((c) => (c.key === key && key !== 'sym' ? { ...c, visible: !c.visible } : c)));

  const apply = () => onApply(draft.map((c) => c.key), draft.filter((c) => !c.visible).map((c) => c.key));

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.drawer}>
        <View style={styles.drawerHead}>
          <Text style={styles.drawerTitle}>Columns</Text>
          <TouchableOpacity onPress={onReset} activeOpacity={0.75}>
            <Text style={styles.clearAll}>Reset</Text>
          </TouchableOpacity>
        </View>
        <ScrollView>
          {draft.map((c, i) => {
            const locked = c.key === 'sym';
            return (
              <View key={c.key} style={styles.colRow}>
                <TouchableOpacity
                  style={styles.colCheck}
                  onPress={() => toggle(c.key)}
                  disabled={locked}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.colBox, c.visible && styles.colBoxOn]}>{c.visible ? '☑' : '☐'}</Text>
                  <Text style={[styles.colLabel, locked && { color: theme.muted }]}>
                    {c.label}
                    {locked ? ' (locked)' : ''}
                  </Text>
                </TouchableOpacity>
                <View style={styles.colMoves}>
                  <TouchableOpacity
                    style={[styles.moveBtn, (locked || i <= 1) && styles.moveBtnOff]}
                    onPress={() => move(i, -1)}
                    disabled={locked || i <= 1}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.moveTxt}>↑</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.moveBtn, (locked || i >= draft.length - 1) && styles.moveBtnOff]}
                    onPress={() => move(i, 1)}
                    disabled={locked || i >= draft.length - 1}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.moveTxt}>↓</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </ScrollView>
        <View style={styles.drawerFoot}>
          <Btn label="Cancel" kind="ghost" onPress={onClose} style={{ flex: 1 }} />
          <Btn label="Apply" onPress={apply} style={{ flex: 2 }} />
        </View>
      </View>
    </Modal>
  );
}

// ── Saved screens (save current + reopen / delete) ────────────────────────────
function SavedScreensModal({
  visible,
  saved,
  onClose,
  onSave,
  onDelete,
  onApply,
}: {
  visible: boolean;
  saved: SavedScreen[];
  onClose: () => void;
  onSave: (name: string) => void;
  onDelete: (name: string) => void;
  onApply: (s: SavedScreen) => void;
}) {
  const [name, setName] = useState('');
  useEffect(() => {
    if (visible) setName('');
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.drawer}>
        <View style={styles.drawerHead}>
          <Text style={styles.drawerTitle}>Saved Screens</Text>
        </View>
        <View style={styles.saveBox}>
          <TextInput
            style={styles.saveInput}
            value={name}
            onChangeText={setName}
            placeholder="Name this screen…"
            placeholderTextColor={theme.muted}
            returnKeyType="done"
            onSubmitEditing={() => {
              if (name.trim()) {
                onSave(name);
                setName('');
              }
            }}
          />
          <TouchableOpacity
            style={[styles.nlAdd, !name.trim() && styles.nlAddOff]}
            onPress={() => {
              if (name.trim()) {
                onSave(name);
                setName('');
              }
            }}
            disabled={!name.trim()}
            activeOpacity={0.75}
          >
            <Text style={[styles.nlAddTxt, !name.trim() && { color: theme.muted }]}>Save</Text>
          </TouchableOpacity>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled">
          {saved.length === 0 ? (
            <EmptyState
              icon="◇"
              title="No saved screens"
              hint="Give the filters above a name and they are one tap away next time."
            />
          ) : (
            saved.map((s) => (
              <View key={s.name} style={styles.savedRow}>
                <TouchableOpacity style={{ flex: 1 }} onPress={() => onApply(s)} activeOpacity={0.75}>
                  <Text style={styles.savedName}>{s.name}</Text>
                  <Text style={styles.savedMeta}>
                    {s.indexName} · {(s.expr?.length ?? Object.keys(s.active).length)} filter{(s.expr?.length ?? Object.keys(s.active).length) === 1 ? '' : 's'} · sort {s.sortCol} {s.sortDir === 1 ? '↑' : '↓'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => onDelete(s.name)} hitSlop={10} activeOpacity={0.75}>
                  <Text style={styles.savedDel}>✕</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>
        <View style={styles.drawerFoot}>
          <Btn label="Close" kind="ghost" onPress={onClose} style={{ flex: 1 }} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, backgroundColor: theme.bg },
  // ── the screen-settings block ──
  // A shade off the page, bounded, with everything it owns inside it. The
  // pickers, the filter rows and the button that collapses them used to sit on
  // the page background looking like part of the results, which is why
  // "Minimise" read as a mystery: nothing on screen said what it would take
  // away.
  settings: {
    backgroundColor: theme.surface,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    marginHorizontal: theme.sp.md,
    marginTop: theme.sp.sm,
    marginBottom: theme.sp.sm,
    overflow: 'visible',
    // The filter and preset dropdowns are absolutely positioned inside this
    // block, and RN-web scopes their zIndex to it — below the stats row's 60
    // they would be painted through by the match count.
    zIndex: 120,
  },
  settingsMin: { paddingBottom: 2 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.sp.sm,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm,
  },
  // Centred on the page. The minimise button is absolutely placed rather than
  // a sibling in this row, because a button in the flow shifts the three
  // pickers left by half its width — which is exactly the off-centre look
  // this replaced.
  dropRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: theme.sp.sm,
    flexShrink: 1,
  },
  mobileFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.sm,
    paddingHorizontal: theme.sp.md,
    paddingBottom: theme.sp.sm,
  },
  minRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.sm,
    paddingHorizontal: theme.sp.md,
    paddingBottom: theme.sp.sm,
  },
  runBtn: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm + 1,
  },
  runBtnBusy: { opacity: 0.6 },
  runTxt: { color: theme.bg, fontSize: theme.fs.sm + 1, fontWeight: '800' },
  idxChips: { paddingHorizontal: theme.sp.md, paddingVertical: theme.sp.sm, gap: theme.sp.sm },
  idxChip: {
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  idxChipOn: { backgroundColor: theme.brandSoft, borderColor: theme.brand },
  idxTxt: { color: theme.muted2, fontSize: theme.fs.sm },
  idxTxtOn: { color: theme.brand, fontWeight: '800' },
  // Content of an AnchoredMenu, which owns the position and the surface.
  presetDrop: { maxHeight: '100%' },
  // Anchors the two dropdowns to their buttons, and keeps them above the
  // fixed toolbar rows below (which use zIndex ~60).
  screenPickWrap: { position: 'relative', zIndex: 90 },
  screenDrop: { width: 280, top: 44, left: 0 },
  idxDropOn: { borderColor: theme.brand },
  presetRow: { paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.md, gap: theme.sp.sm, alignItems: 'center' },
  presetLabel: {
    color: theme.muted,
    fontSize: theme.fs.xs + 1,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginRight: theme.sp.xs,
  },
  presetChip: {
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  presetChipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  presetTxt: { color: theme.muted2, fontSize: theme.fs.sm },
  presetTxtOn: { color: theme.onAccent, fontWeight: '700' },
  nlBox: { paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.md },
  nlLabel: { color: theme.muted2, fontSize: theme.fs.sm, marginBottom: theme.sp.sm },
  nlRow: { flexDirection: 'row', gap: theme.sp.sm },
  nlInput: {
    flex: 1,
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    color: theme.text,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 10,
    fontSize: theme.fs.md,
  },
  nlAdd: { backgroundColor: theme.accent, borderRadius: theme.radius.sm + 2, paddingHorizontal: theme.sp.lg, justifyContent: 'center' },
  nlAddOff: { backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1 },
  nlAddTxt: { color: theme.onAccent, fontWeight: '700', fontSize: theme.fs.sm + 1 },
  nlFeedback: { color: theme.green, fontSize: theme.fs.sm, marginTop: theme.sp.sm, lineHeight: 17 },
  // Mobile compact filter bar + popup builder
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.sm,
    paddingHorizontal: theme.sp.lg,
    paddingTop: theme.sp.sm,
  },
  filterBarBtn: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 6,
  },
  filterBarBtnOn: { borderColor: theme.brand, backgroundColor: theme.brandSoft },
  filterBarBtnTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
  filterBarBtnTxtOn: { color: theme.brand },
  filterSummary: { flex: 1, color: theme.muted, fontSize: theme.fs.xs + 1 },
  cfgMinBtn: {
    position: 'absolute',
    right: theme.sp.md,
    top: theme.sp.sm,
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 6,
  },
  cfgMinTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '600' },
  // Universe dropdown + sheets + export menu + serial column
  idxDrop: {
    flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm,
    backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1,
    borderRadius: theme.radius.sm + 2, paddingHorizontal: theme.sp.md, paddingVertical: 6,
  },
  idxDropLabel: { color: theme.muted, fontSize: theme.fs.xs, fontWeight: '800', letterSpacing: 1 },
  idxDropTxt: { color: theme.text, fontSize: theme.fs.sm + 1, fontWeight: '800', fontFamily: theme.mono },
  idxGroupTitle: { color: theme.muted, fontSize: theme.fs.xs, fontWeight: '800', letterSpacing: 1, marginTop: theme.sp.md, marginBottom: 2 },
  idxOpt: { paddingVertical: theme.sp.sm },
  idxOptRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.md, paddingVertical: theme.sp.sm },
  idxCheck: { color: theme.muted, fontSize: 18 },
  idxCheckOn: { color: theme.brand },
  idxOptTxt: { color: theme.text, fontSize: theme.fs.md },
  idxOptHint: { color: theme.muted, fontSize: theme.fs.sm, marginTop: 1 },
  exportWrap: { position: 'relative', zIndex: 80 },
  exportMenu: {
    position: 'absolute', top: '100%', right: 0, marginTop: 4, minWidth: 120,
    backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1,
    borderRadius: theme.radius.md, paddingVertical: 4, zIndex: 90, elevation: 12,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
  },
  exportItem: { paddingHorizontal: theme.sp.md, paddingVertical: theme.sp.sm },
  exportItemTxt: { color: theme.text, fontSize: theme.fs.md },
  symCell: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'flex-start' },
  starTxt: { color: theme.muted2, fontSize: 14 },
  snoTxt: { color: theme.muted, fontSize: theme.fs.sm, fontFamily: theme.mono },
  tableArea: { flex: 1 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.sp.xs },
  sheetTitle: { color: theme.text, fontSize: theme.fs.xl, fontWeight: '800' },
  sheetClose: { color: theme.muted2, fontSize: theme.fs.md, fontWeight: '700' },
  sheetApply: { marginTop: theme.sp.lg },
  presetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  presetHeadTxt: { color: theme.muted, fontSize: theme.fs.xs, fontWeight: '800', letterSpacing: 1 },
  presetClose: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '700' },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap', // actions drop to their own line on phones
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm,
    gap: theme.sp.md,
    zIndex: 60, // export dropdown must overlay the table
  },
  statsTxt: { color: theme.muted, fontSize: theme.fs.sm, fontFamily: theme.mono, flexShrink: 1 },
  statsN: { color: theme.text, fontWeight: '700' },
  // Page-level vertical scroll (the builder, toolbar and table all live inside
  // it, so the mouse wheel always scrolls the results).
  page: { flex: 1 },
  tableStretch: { minWidth: '100%' },
  spark: { fontSize: 15, alignSelf: 'center' },
  ctrlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap', // phones: Share/Save wrap below instead of clipping
    gap: theme.sp.sm,
    paddingHorizontal: theme.sp.lg,
    paddingTop: theme.sp.sm,
  },
  ctrlRight: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm },
  // Anchor for the add-filter dropdown; keeps it above the table when open.
  ctrlWrap: { zIndex: 60 },
  pickerDrop: {
    position: 'absolute',
    top: '100%',
    left: theme.sp.lg,
    marginTop: 4,
    width: 680,
    maxWidth: '94%',
    maxHeight: 360,
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
    zIndex: 100,
    elevation: 16,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  nameTxt: { color: theme.muted2, fontSize: theme.fs.sm },
  exchTxt: { color: theme.muted, fontSize: theme.fs.xs + 1, fontFamily: theme.mono },
  ltp: { fontWeight: '700' },
  filterBtn: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm + 1,
  },
  filterTxt: { color: theme.text, fontSize: theme.fs.sm + 1, fontWeight: '600' },
  filterBtnOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  filterTxtOn: { color: theme.onAccent, fontWeight: '700' },
  note: { color: theme.muted, fontSize: theme.fs.sm, paddingHorizontal: theme.sp.md, paddingBottom: theme.sp.xs },
  headerRow: {
    flexDirection: 'row',
    borderBottomColor: theme.border2,
    borderBottomWidth: 1,
    backgroundColor: theme.surface2,
    paddingVertical: theme.sp.sm,
  },
  th: { justifyContent: 'center', paddingHorizontal: theme.sp.xs },
  thTxt: {
    color: theme.muted2,
    fontSize: theme.fs.xs + 1,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    paddingVertical: 6,
    minHeight: 42,
  },
  td: { justifyContent: 'center', paddingHorizontal: theme.sp.xs },
  cell: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm },
  symTxt: { color: theme.accent, fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.sm + 1 },
  sig: { fontWeight: '700', fontSize: theme.fs.sm, letterSpacing: 0.4 },
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
  // per-row actions
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
  starOn: { color: theme.green },
  // Wrapping row (was a horizontal ScrollView, which clipped buttons mid-way
  // on phones with no visible affordance).
  actionsWrap: {
    marginLeft: 'auto',
    flexDirection: 'row',
    flexWrap: 'wrap',
    flexShrink: 1, // without this a row parent lets the content define width → clip
    minWidth: 0,
    alignItems: 'center',
    gap: theme.sp.sm,
  },
  // pagination
  pageLabel: {
    color: theme.muted,
    fontSize: theme.fs.xs + 1,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginRight: theme.sp.xs,
  },
  pageChip: {
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.sp.sm + 2,
    paddingVertical: 5,
  },
  pageChipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  pageChipTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontFamily: theme.mono },
  pageChipTxtOn: { color: theme.onAccent, fontWeight: '700' },
  pageBtn: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 5,
  },
  pageBtnOff: { opacity: 0.4 },
  pageBtnTxt: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '600' },
  pageInfo: { color: theme.muted2, fontSize: theme.fs.sm, fontFamily: theme.mono, minWidth: 48, textAlign: 'center' },
  // toast
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
  // column menu
  colRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.sm + 2,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  colCheck: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.md, flex: 1 },
  colBox: { color: theme.muted, fontSize: theme.fs.lg },
  colBoxOn: { color: theme.green },
  colLabel: { color: theme.text, fontSize: theme.fs.md },
  colMoves: { flexDirection: 'row', gap: theme.sp.sm },
  moveBtn: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 4,
    minWidth: 38,
    alignItems: 'center',
  },
  moveBtnOff: { opacity: 0.35 },
  moveTxt: { color: theme.text, fontSize: theme.fs.md, fontWeight: '700' },
  // saved screens
  saveBox: { flexDirection: 'row', gap: theme.sp.sm, padding: theme.sp.lg },
  saveInput: {
    flex: 1,
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    color: theme.text,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 10,
    fontSize: theme.fs.md,
  },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.md,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    gap: theme.sp.md,
  },
  savedName: { color: theme.text, fontSize: theme.fs.md, fontWeight: '700' },
  savedMeta: { color: theme.muted, fontSize: theme.fs.sm, marginTop: 2 },
  savedDel: { color: theme.red, fontSize: theme.fs.lg, fontWeight: '700', paddingHorizontal: theme.sp.sm },
  // drawer
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  // Full screen: top 0 + a padded footer so Apply/Cancel clear the device's
  // gesture/nav bar (they were half-hidden behind it before).
  drawer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    top: 0,
    backgroundColor: theme.surface,
    overflow: 'hidden',
  },
  drawerHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.sp.lg,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  drawerTitle: { color: theme.text, fontSize: theme.fs.lg, fontWeight: '700' },
  clearAll: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '600' },
  group: { paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.lg },
  groupTitle: {
    color: theme.muted2,
    fontSize: theme.fs.xs + 1,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: theme.sp.sm,
  },
  fRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.sp.sm + 2,
  },
  fCol: { paddingVertical: theme.sp.sm + 2 },
  fLabel: { color: theme.text, fontSize: theme.fs.md, flex: 1 },
  rangeInputs: { flexDirection: 'row', gap: theme.sp.sm },
  rInput: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    color: theme.text,
    paddingHorizontal: theme.sp.sm,
    paddingVertical: 7,
    width: 68,
    fontFamily: theme.mono,
    fontSize: theme.fs.sm,
    textAlign: 'center',
  },
  optChip: {
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
    marginRight: theme.sp.sm,
  },
  optChipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  optTxt: { color: theme.muted2, fontSize: theme.fs.sm },
  optTxtOn: { color: theme.onAccent, fontWeight: '700' },
  fundNote: { color: theme.muted, fontSize: theme.fs.sm, padding: theme.sp.lg, lineHeight: 17 },
  drawerFoot: {
    flexDirection: 'row',
    gap: theme.sp.md,
    padding: theme.sp.lg,
    paddingBottom: theme.sp.lg + 24, // clear the device gesture/nav bar
    borderTopColor: theme.border,
    borderTopWidth: 1,
  },
  // inline filter panel. zIndex lifts the whole panel's stacking context above
  // the table (RN-web gives sibling Views z-index 0, so the later table would
  // otherwise paint over the add-filter dropdown).
  panel: {
    // No background or border of its own any more: it is the body of the
    // settings block above, and a second card edge inside that one read as
    // two panels rather than one thing you can collapse.
    // Must stack ABOVE statsRow (zIndex 60): the filter/preset dropdowns are
    // absolutely positioned inside this panel, and RN-web scopes their
    // zIndex to this container — a lower value here let the match-count row
    // bleed through every open menu.
    zIndex: 120,
    elevation: 20,
  },
  panelBody: { paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.sm },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm },
  selHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  removeBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderColor: theme.border2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeTxt: { color: theme.muted2, fontSize: theme.fs.lg, fontWeight: '700', lineHeight: 20 },
  emptyFilters: { color: theme.muted, fontSize: theme.fs.sm, paddingVertical: theme.sp.sm },
  addFilterBtn: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm + 1,
  },
  addFilterBtnOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  addFilterTxt: { color: theme.text, fontSize: theme.fs.sm + 1, fontWeight: '700' },
  pickerScroll: { maxHeight: 358 },
  // preset dropdown entries
  presetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.md,
    paddingVertical: theme.sp.sm,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  presetMark: { color: theme.muted, fontFamily: theme.mono, fontSize: theme.fs.md, width: 16, textAlign: 'center' },
  presetName: { color: theme.text, fontSize: theme.fs.sm + 1, fontWeight: '600' },
  presetDesc: { color: theme.muted, fontSize: theme.fs.xs + 1, marginTop: 1 },
  // expression rows
  exprRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap', // metric/op/value controls flow onto extra lines on phones
    gap: theme.sp.sm,
    paddingVertical: 5,
  },
  joinWrap: { flexDirection: 'row', gap: 2, width: 92 },
  joinSpacer: { width: 92 },
  joinBtn: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.sp.sm + 1,
    paddingVertical: 4,
  },
  joinOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  joinTxt: { color: theme.muted2, fontSize: theme.fs.xs + 1, fontWeight: '800', letterSpacing: 0.5 },
  joinTxtOn: { color: theme.onAccent },
  opFixed: { color: theme.muted2, fontSize: theme.fs.sm, width: 108, textAlign: 'center' },
  exprInput: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    color: theme.text,
    paddingHorizontal: theme.sp.sm,
    paddingVertical: 7,
    width: 110,
    fontFamily: theme.mono,
    fontSize: theme.fs.sm,
  },
  betweenDash: { color: theme.muted, fontSize: theme.fs.md },
  unitTxt: { color: theme.muted, fontSize: theme.fs.sm, fontFamily: theme.mono },
  exprHint: { color: theme.muted, fontSize: theme.fs.xs + 1, paddingTop: theme.sp.sm },
  // dropdown select
  selWrap: { position: 'relative' },
  selBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.sp.sm,
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 7,
  },
  selTxt: { color: theme.text, fontSize: theme.fs.sm, flexShrink: 1 },
  selCaret: { color: theme.muted, fontSize: theme.fs.xs + 1 },
  selMenu: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 3,
    minWidth: '100%',
    backgroundColor: theme.surface3,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    overflow: 'hidden',
    zIndex: 500,
    elevation: 16,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  fpSearch: {
    backgroundColor: theme.surface2,
    color: theme.text,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 9,
    fontSize: theme.fs.sm,
    marginBottom: theme.sp.sm,
  },
  fpGroup: {
    color: theme.muted,
    fontSize: theme.fs.xs,
    fontFamily: theme.mono,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: theme.sp.md,
    marginBottom: theme.sp.sm,
  },
  // Word-list layout (report request): metrics read as a flowing list of
  // tappable words rather than a wall of buttons.
  fpGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: theme.sp.md + 2, rowGap: 2 },
  fpChipWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fpChip: { paddingVertical: 4 },
  fpChipTxt: {
    color: theme.text,
    fontSize: theme.fs.sm + 1,
    textDecorationLine: 'underline',
    textDecorationColor: theme.border2,
  },
  fpEmpty: { color: theme.muted, fontSize: theme.fs.sm, marginTop: theme.sp.lg, textAlign: 'center' },
  selHeader: {
    color: theme.muted,
    fontSize: theme.fs.xs,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingHorizontal: theme.sp.md,
    paddingTop: theme.sp.sm + 2,
    paddingBottom: 3,
  },
  selItem: {
    paddingHorizontal: theme.sp.md,
    paddingVertical: 7,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  selItemTxt: { color: theme.text, fontSize: theme.fs.sm },
  pickWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm },
  pickChip: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  pickTxt: { color: theme.text, fontSize: theme.fs.sm },
});
