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
import { api } from '../api';
import StockDetail from '../components/StockDetail';
import { exportCsv, exportExcel, exportPdf } from '../csv';
import { parseNL } from '../nlScreen';
import { PRESETS, Preset } from '../presets';
import {
  DEF_BY_KEY,
  ExprOp,
  ExprRow,
  FILTER_DEFS,
  Row,
  Signal,
  TE_GROUPS,
  applyExpr,
  calcSignal,
  defaultOpFor,
  exprId,
  filtersToExpr,
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
import { Btn, EmptyState, Loading } from '../ui';

const INDICES = [
  'NIFTY 50', 'NIFTY 100', 'NIFTY BANK', 'NIFTY IT', 'NIFTY AUTO',
  'NIFTY PHARMA', 'NIFTY FMCG', 'NIFTY METAL', 'NIFTY MIDCAP 100',
  'NIFTY SMALLCAP 100',
];

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
// Market cap arrives in ₹ crore; render as ₹55.73k cr / ₹1.23L cr / ₹820 cr.
const fmtMcap = (v: number | null | undefined) => {
  if (v == null || !isFinite(v)) return '—';
  if (v >= 1e5) return '₹' + (v / 1e5).toFixed(2) + 'L cr';
  if (v >= 1e3) return '₹' + (v / 1e3).toFixed(2) + 'k cr';
  return '₹' + v.toFixed(0) + ' cr';
};
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
  render: (r: Row) => React.ReactNode;
};

// TaurEye-style column set: Symbol/Name/Exch/LTP/%Chg/Volume/RelVol/RSI/
// vs 50DMA/52w Hi/Mkt Cap/Signal visible; everything else opt-in via ▤ Columns.
// Exported (with cellFlex/ACTIONS_W/DEFAULT_HIDDEN/loadNames) so the
// Multibagger screener renders the identical table.
export const COLS: Col[] = [
  { key: 'sym', label: 'Symbol', w: 96, flex: 0, align: 'left', render: (r) => <Text style={styles.symTxt}>{r.sym}</Text> },
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
  'pe', 'pb', 'roe', 'roce', 'debt_equity', 'dividend_yield'];

const FILTERS_KEY = 'taureye.screener.filters.v1'; // legacy keyed filters (migrated)
const EXPR_KEY = 'taureye.screener.expr.v1';
const INDEX_KEY = 'taureye.screener.index.v1';
const COLS_KEY = 'taureye.screener.cols.v3';
const PAGE_KEY = 'taureye.screener.pagesize.v1';

// Universe name/exchange lookup (fetched once per app session) so the table
// can show full company names like the TaurEye site.
let namesPromise: Promise<Record<string, { name: string; exchange: string }>> | null = null;
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

const PAGE_SIZES: (number | 'all')[] = [25, 50, 100, 'all'];
type PageSize = number | 'all';

// Reads a shared screen state from `#screen=` on the web URL, if present.
function readSharedScreen(): ScreenState | null {
  const g = globalThis as { location?: { hash?: string } };
  const hash = g.location?.hash || '';
  const m = hash.match(/#screen=([^&]+)/);
  return m ? decodeScreen(m[1]) : null;
}

export default function ScreenerScreen() {
  const [indexName, setIndexName] = useState('NIFTY 50');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string>('');
  // Expression filter rows (TaurEye-style `<metric> <op> <value>` chained
  // with AND/OR). Presets and the NL builder append rows into the same list.
  const [expr, setExpr] = useState<ExprRow[]>([]);
  const [sortCol, setSortCol] = useState('signal');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [track, setTrack] = useState<TrackEntry[]>([]);
  const [fundBusy, setFundBusy] = useState(false);
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
  const [pageSize, setPageSize] = useState<PageSize>(100);
  const [page, setPage] = useState(0);
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
          if (INDICES.includes(shared.indexName)) setIndexName(shared.indexName);
          setExpr(shared.expr?.length ? shared.expr : filtersToExpr(shared.active));
          setSortCol(shared.sortCol);
          setSortDir(shared.sortDir);
        } else {
          const [x, f, idx] = await Promise.all([
            AsyncStorage.getItem(EXPR_KEY),
            AsyncStorage.getItem(FILTERS_KEY),
            AsyncStorage.getItem(INDEX_KEY),
          ]);
          if (x) {
            const parsed = JSON.parse(x);
            if (Array.isArray(parsed)) {
              setExpr(parsed.filter((e) => e && typeof e.key === 'string' && typeof e.id === 'string'));
            }
          } else if (f) {
            // One-time migration from the pre-expression keyed filters.
            const parsed = JSON.parse(f);
            if (parsed && typeof parsed === 'object') setExpr(filtersToExpr(parsed));
          }
          if (idx && INDICES.includes(idx)) setIndexName(idx);
        }
      } catch {
        /* fresh start */
      } finally {
        setRestored(true);
      }
    })();
  }, []);

  // Restore column prefs + page size once (independent of index/filters).
  useEffect(() => {
    (async () => {
      try {
        const [rawCols, rawPage] = await Promise.all([
          AsyncStorage.getItem(COLS_KEY),
          AsyncStorage.getItem(PAGE_KEY),
        ]);
        if (rawCols) {
          const p = JSON.parse(rawCols);
          if (Array.isArray(p?.order)) setColOrder(p.order.filter((k: unknown) => typeof k === 'string'));
          if (Array.isArray(p?.hidden)) setColHidden(p.hidden.filter((k: unknown) => typeof k === 'string'));
        }
        if (rawPage) {
          const v = JSON.parse(rawPage);
          if (v === 'all' || (typeof v === 'number' && [25, 50, 100].includes(v))) setPageSize(v);
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
    if (!prefsRestored) return;
    AsyncStorage.setItem(PAGE_KEY, JSON.stringify(pageSize)).catch(() => {});
  }, [pageSize, prefsRestored]);

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
    AsyncStorage.setItem(INDEX_KEY, indexName).catch(() => {});
  }, [indexName, restored]);

  // Monotonic token so a stale in-flight scan can't write into a newer index's rows.
  const loadSeq = React.useRef(0);

  const load = useCallback(async (name: string) => {
    const seq = ++loadSeq.current;
    setError(null);
    setNote('');
    try {
      const [idx, names] = await Promise.all([api.indexConstituents(name), loadNames()]);
      if (seq !== loadSeq.current) return;
      const cons = (idx.data || []).filter((c) => c.symbol);
      if (!cons.length) {
        setRows([]);
        setNote(idx.error || 'No constituents returned.');
        return;
      }
      // 1) The index feed already carries live NSE quotes — show them instantly.
      const seeded: Row[] = cons.map((c) => ({
        sym: c.symbol,
        name: names[c.symbol.toUpperCase()]?.name,
        exchange: names[c.symbol.toUpperCase()]?.exchange || 'NSE',
        price: c.price,
        prevClose: c.prevClose,
        chg: c.chg,
        absChg: c.absChg,
        volume: c.volume,
      }));
      setRows(seeded);
      setLoading(false);
      setRefreshing(false);
      const total = cons.length;
      // CSV/cache fallback returns symbols without quotes — /scan fills prices.
      const seedLabel = seeded.some((r) => r.price != null) ? 'live quotes' : 'symbols';
      setNote(`${total} ${seedLabel} · technicals 0/${total}…`);
      // 2) Technicals stream in batch by batch. Keep the fresher NSE live quote
      //    over the scan's daily-bar figures.
      let got = 0;
      await api.scan(
        cons.map((c) => c.symbol),
        {
          onBatch: (data, done) => {
            if (seq !== loadSeq.current) return;
            got += Object.keys(data).length;
            setRows((prev) =>
              prev.map((r) => {
                const s = data[r.sym];
                if (!s) return r;
                return {
                  ...r,
                  ...s,
                  price: r.price ?? s.price,
                  prevClose: r.prevClose ?? s.prevClose,
                  chg: r.chg ?? s.chg,
                  absChg: r.absChg ?? s.absChg,
                  volume: r.volume ?? s.volume,
                };
              }),
            );
            setNote(`${total} ${seedLabel} · technicals ${Math.min(done, total)}/${total}`);
          },
        },
      );
      if (seq === loadSeq.current) {
        setNote(`${total} ${seedLabel} · ${got}/${total} technicals`);
      }
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
    load(indexName);
  }, [indexName, load, restored]);

  useEffect(() => {
    loadTrack().then(setTrack);
  }, []);

  // Fetch fundamentals for every loaded index (they now feed table columns,
  // not just filters). /fundamentals/bulk returns cached rows immediately plus
  // a `pending` list still warming server-side — poll until pending drains
  // (bounded) so warming stocks aren't stuck at '—' or silently excluded by
  // strict fundamental filters.
  const fundPolling = React.useRef(false);
  useEffect(() => {
    if (fundPolling.current) return;
    const missing = rows.filter((r) => r._fund === undefined).map((r) => r.sym);
    if (!missing.length) return;
    fundPolling.current = true;
    let cancelled = false;
    setFundBusy(true);
    (async () => {
      let target = missing;
      const settled = new Set<string>();
      for (let round = 0; round < 25 && target.length && !cancelled; round++) {
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
        setRows((prev) =>
          prev.map((r) =>
            missing.includes(r.sym) && r._fund === undefined ? { ...r, _fund: null } : r,
          ),
        );
        setFundBusy(false);
      }
      fundPolling.current = false;
    })();
    return () => {
      cancelled = true;
      fundPolling.current = false;
    };
  }, [rows]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(indexName);
  }, [indexName, load]);

  const filtered = useMemo(() => applyExpr(rows, expr), [rows, expr]);
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
    const symIdx = ordered.findIndex((c) => c.key === 'sym');
    if (symIdx > 0) ordered.unshift(ordered.splice(symIdx, 1)[0]);
    const hidden = new Set(colHidden.filter((k) => k !== 'sym'));
    return ordered.filter((c) => !hidden.has(c.key));
  }, [colOrder, colHidden]);

  const tableW = useMemo(() => visibleCols.reduce((a, c) => a + c.w, 0) + ACTIONS_W, [visibleCols]);

  // Client-side pagination over the sorted set (stats + export use the full set).
  const pageCount = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(sorted.length / pageSize));
  useEffect(() => {
    setPage(0);
  }, [indexName, expr, sortCol, sortDir, pageSize]);
  useEffect(() => {
    if (page > pageCount - 1) setPage(0);
  }, [page, pageCount]);
  const pageRows = useMemo(
    () => (pageSize === 'all' ? sorted : sorted.slice(page * pageSize, page * pageSize + pageSize)),
    [sorted, page, pageSize],
  );

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
  const showFrom = sorted.length ? (pageSize === 'all' ? 1 : page * pageSize + 1) : 0;
  const showTo = pageSize === 'all' ? sorted.length : Math.min((page + 1) * (pageSize as number), sorted.length);

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

  const curState = (): ScreenState => ({ indexName, active: {}, expr, sortCol, sortDir });

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
    if (INDICES.includes(s.indexName)) setIndexName(s.indexName);
    setExpr(s.expr?.length ? s.expr : filtersToExpr(s.active));
    setSortCol(s.sortCol);
    setSortDir(s.sortDir);
    setSavedModal(false);
    toast(`Applied "${s.name}"`);
  };

  const renderRow = (item: Row) => {
    const dir = trackDirOf(item.sym);
    const starred = isWatched(item.sym);
    return (
      <View key={item.sym} style={styles.dataRow}>
        {visibleCols.map((c) =>
          c.key === 'sym' ? (
            <TouchableOpacity
              key={c.key}
              style={[styles.td, cellFlex(c), { alignItems: 'flex-start' }]}
              onPress={() => setDetail(item)}
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
          <TouchableOpacity style={styles.aBtn} onPress={() => onChart(item)} activeOpacity={0.75}>
            <Text style={styles.aBtnTxt}>Chart</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.aBtn} onPress={() => onToggleWatch(item)} activeOpacity={0.75}>
            <Text style={[styles.aBtnTxt, starred && styles.starOn]}>{starred ? '★' : '☆'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.aBtn} onPress={() => setDetail(item)} activeOpacity={0.75}>
            <Text style={styles.aBtnTxt}>Report</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <Loading label={`Loading ${indexName} constituents…`} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.idxChips}>
          {INDICES.map((idx) => (
            <TouchableOpacity
              key={idx}
              style={[styles.idxChip, idx === indexName && styles.idxChipOn]}
              onPress={() => setIndexName(idx)}
              activeOpacity={0.75}
            >
              <Text style={[styles.idxTxt, idx === indexName && styles.idxTxtOn]}>{idx.replace('NIFTY ', '')}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        style={styles.page}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />
        }
      >
      <FilterPanel
        expr={expr}
        setExpr={setExpr}
        savedCount={saved.length}
        onShare={onShare}
        onSaveScreen={() => setSavedModal(true)}
      />

      <View style={styles.statsRow}>
        <Text style={styles.statsTxt} numberOfLines={1}>
          <Text style={styles.statsN}>{stats.total}</Text> matches
          {stats.total ? ` · showing ${showFrom}–${showTo}` : ''}{'   '}
          <Text style={{ color: theme.green }}>{stats.buy}▲</Text>{'  '}
          <Text style={{ color: theme.red }}>{stats.sell}▼</Text>{'  '}
          <Text style={{ color: theme.muted2 }}>{stats.neutral}—</Text>
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.actionsScroll}
          contentContainerStyle={styles.actionsScrollInner}
        >
          <TouchableOpacity style={styles.filterBtn} onPress={() => setColMenu(true)} activeOpacity={0.75}>
            <Text style={styles.filterTxt}>⚙ Columns {COLS.length - colHidden.length}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.filterBtn}
            onPress={() => exportCsv(sorted, indexName).catch(() => {})}
            activeOpacity={0.75}
          >
            <Text style={styles.filterTxt}>⇩ CSV</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.filterBtn}
            onPress={() => exportExcel(sorted, indexName).catch(() => {})}
            activeOpacity={0.75}
          >
            <Text style={styles.filterTxt}>⇩ Excel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.filterBtn}
            onPress={() => exportPdf(sorted, indexName).catch(() => {})}
            activeOpacity={0.75}
          >
            <Text style={styles.filterTxt}>⇩ PDF</Text>
          </TouchableOpacity>
          <Text style={styles.pageLabel}>Rows</Text>
          {PAGE_SIZES.map((sz) => (
            <TouchableOpacity
              key={String(sz)}
              style={[styles.pageChip, pageSize === sz && styles.pageChipOn]}
              onPress={() => setPageSize(sz)}
              activeOpacity={0.75}
            >
              <Text style={[styles.pageChipTxt, pageSize === sz && styles.pageChipTxtOn]}>
                {sz === 'all' ? 'All' : sz}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[styles.pageBtn, page <= 0 && styles.pageBtnOff]}
            onPress={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page <= 0}
            activeOpacity={0.75}
          >
            <Text style={styles.pageBtnTxt}>‹ Prev</Text>
          </TouchableOpacity>
          <Text style={styles.pageInfo}>{sorted.length ? `${page + 1} / ${pageCount}` : '0 / 0'}</Text>
          <TouchableOpacity
            style={[styles.pageBtn, page >= pageCount - 1 && styles.pageBtnOff]}
            onPress={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page >= pageCount - 1}
            activeOpacity={0.75}
          >
            <Text style={styles.pageBtnTxt}>Next ›</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      <Text style={styles.note} numberOfLines={1}>
        {note}
        {fundBusy ? ' · loading fundamentals…' : ''}
        {error ? ` · ${error}` : ''}
      </Text>

      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.tableStretch}>
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
          {pageRows.length === 0 ? (
            <EmptyState
              icon="⌕"
              title="No matches"
              hint="Loosen or clear a filter to see more of this index."
            />
          ) : (
            pageRows.map(renderRow)
          )}
        </View>
      </ScrollView>
      </ScrollView>

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
const PRESET_GROUPS = ['Trend', 'Momentum', 'Breakouts', 'Volume', 'Fundamentals'] as const;

function FilterPanel({
  expr,
  setExpr,
  savedCount,
  onShare,
  onSaveScreen,
}: {
  expr: ExprRow[];
  setExpr: React.Dispatch<React.SetStateAction<ExprRow[]>>;
  savedCount: number;
  onShare: () => void;
  onSaveScreen: () => void;
}) {
  const [nlText, setNlText] = useState('');
  const [presetsOpen, setPresetsOpen] = useState(false);
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

  // Presets append their conditions as tagged rows; toggling off removes them.
  const presetOn = (p: Preset) => expr.some((e) => e.src === 'preset:' + p.id);
  const togglePresetExpr = (p: Preset) => {
    const tag = 'preset:' + p.id;
    setExpr((prev) =>
      prev.some((e) => e.src === tag)
        ? prev.filter((e) => e.src !== tag)
        : [...prev, ...filtersToExpr(p.filters, tag)],
    );
  };

  return (
    <View style={styles.panel}>
      <View style={styles.nlBox}>
        <View style={styles.nlRow}>
          <Text style={styles.spark}>✨</Text>
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
          <TouchableOpacity
            style={[styles.addFilterBtn, presetsOpen && styles.addFilterBtnOn]}
            onPress={() => setPresetsOpen((v) => !v)}
            activeOpacity={0.75}
          >
            <Text style={[styles.addFilterTxt, presetsOpen && { color: theme.onAccent }]}>
              Preset scans {presetsOpen ? '▾' : '▸'}
            </Text>
          </TouchableOpacity>
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
              <Text style={styles.filterTxt}>💾 Save screen{savedCount ? ` (${savedCount})` : ''}</Text>
            </TouchableOpacity>
          </View>
        </View>
        {presetsOpen ? (
          <View style={[styles.pickerDrop, { width: 480 }]}>
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
        ) : null}
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
                <Sel
                  label={def ? def.label + (def.fund ? ' ·f' : '') : 'Choose metric'}
                  items={FIELD_ITEMS}
                  open={openSel === e.id + ':f'}
                  onToggle={() => toggleSel(e.id + ':f')}
                  onPick={(k) => {
                    patch(e.id, { key: k, op: defaultOpFor(k), v1: '', v2: '' });
                    setOpenSel('');
                  }}
                  width={235}
                />
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
            <EmptyState icon="◇" title="No saved screens" hint="Name the current scan above to save it." />
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
  topBar: { borderBottomColor: theme.border, borderBottomWidth: 1 },
  idxChips: { paddingHorizontal: theme.sp.md, paddingVertical: theme.sp.sm, gap: theme.sp.sm },
  idxChip: {
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  idxChipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  idxTxt: { color: theme.muted2, fontSize: theme.fs.sm },
  idxTxtOn: { color: theme.onAccent, fontWeight: '700' },
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
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm,
    gap: theme.sp.md,
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
    paddingVertical: 3,
    minHeight: 32,
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
  actionsScroll: { marginLeft: 'auto', flexGrow: 0 },
  actionsScrollInner: { gap: theme.sp.sm, alignItems: 'center' },
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
  drawer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    top: 60,
    backgroundColor: theme.surface,
    borderTopLeftRadius: theme.radius.lg + 2,
    borderTopRightRadius: theme.radius.lg + 2,
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
    borderTopColor: theme.border,
    borderTopWidth: 1,
  },
  // inline filter panel. zIndex lifts the whole panel's stacking context above
  // the table (RN-web gives sibling Views z-index 0, so the later table would
  // otherwise paint over the add-filter dropdown).
  panel: {
    backgroundColor: theme.surface,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    zIndex: 50,
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
