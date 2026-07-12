import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
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
import { PRESETS, presetActive, togglePreset } from '../presets';
import {
  ActiveFilters,
  FILTER_DEFS,
  FilterDef,
  RangeVal,
  Row,
  Signal,
  TE_GROUPS,
  applyFilters,
  calcSignal,
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
// Market cap arrives in ₹ crore; compact to L (lakh cr) / K (thousand cr).
const fmtMcap = (v: number | null | undefined) => {
  if (v == null || !isFinite(v)) return '—';
  if (v >= 1e5) return (v / 1e5).toFixed(2) + 'L';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toFixed(0);
};
const fnum2 = (r: Row, k: string, d = 1): string => {
  const f = r._fund as Record<string, unknown> | null | undefined;
  const v = f ? f[k] : null;
  return typeof v === 'number' && isFinite(v) ? v.toFixed(d) : '—';
};

type Col = {
  key: string;
  label: string;
  w: number;
  align?: 'left' | 'right';
  render: (r: Row) => React.ReactNode;
};

const COLS: Col[] = [
  { key: 'sym', label: 'Symbol', w: 92, align: 'left', render: (r) => <Text style={styles.symTxt}>{r.sym}</Text> },
  { key: 'price', label: 'Price', w: 72, render: (r) => <Text style={styles.cell}>{r.price != null ? r.price.toFixed(1) : '—'}</Text> },
  { key: 'chg', label: 'Chg%', w: 62, render: (r) => <Text style={[styles.cell, { color: colorOf(r.chg) }]}>{pct(r.chg)}</Text> },
  { key: 'rsi', label: 'RSI', w: 48, render: (r) => <Text style={styles.cell}>{r.rsi != null ? r.rsi.toFixed(0) : '—'}</Text> },
  { key: 'd20', label: '20DMA', w: 62, render: (r) => <Text style={[styles.cell, { color: colorOf(r.d20) }]}>{pct(r.d20, 1)}</Text> },
  { key: 'd50', label: '50DMA', w: 62, render: (r) => <Text style={[styles.cell, { color: colorOf(r.d50) }]}>{pct(r.d50, 1)}</Text> },
  { key: 'd200', label: '200DMA', w: 64, render: (r) => <Text style={[styles.cell, { color: colorOf(r.d200) }]}>{pct(r.d200, 1)}</Text> },
  { key: 'willr', label: 'W%R', w: 52, render: (r) => <Text style={styles.cell}>{r.willr != null ? r.willr.toFixed(0) : '—'}</Text> },
  { key: 'bollb', label: 'BB%', w: 50, render: (r) => <Text style={styles.cell}>{r.bollb != null ? r.bollb.toFixed(2) : '—'}</Text> },
  { key: 'relvol', label: 'RVol', w: 52, render: (r) => <Text style={styles.cell}>{r.relvol != null ? r.relvol.toFixed(1) + 'x' : '—'}</Text> },
  { key: 'volume', label: 'Vol', w: 58, render: (r) => <Text style={styles.cell}>{fmtVol(r.volume)}</Text> },
  { key: 'beta', label: 'Beta', w: 46, render: (r) => <Text style={styles.cell}>{r.beta != null ? r.beta.toFixed(2) : '—'}</Text> },
  {
    key: 'sqzMom', label: 'Sqz', w: 52,
    render: (r) => (
      <Text style={[styles.cell, { color: r.sqzFire ? theme.green : r.sqzOn ? theme.text : theme.muted }]}>
        {r.sqzFire ? 'FIRE' : r.sqzOn ? 'ON' : r.sqzOn === false ? 'off' : '—'}
      </Text>
    ),
  },
  {
    key: 's1', label: 'Support', w: 66,
    render: (r) => (
      <View>
        <Text style={styles.zone}>{n1(r.s1)}</Text>
        <Text style={styles.zoneDim}>{n1(r.s2)}</Text>
        <Text style={styles.zoneDim}>{n1(r.s3)}</Text>
      </View>
    ),
  },
  {
    key: 'r1', label: 'Resist', w: 66,
    render: (r) => (
      <View>
        <Text style={styles.zone}>{n1(r.r1)}</Text>
        <Text style={styles.zoneDim}>{n1(r.r2)}</Text>
        <Text style={styles.zoneDim}>{n1(r.r3)}</Text>
      </View>
    ),
  },
  // Fundamentals (bulk-cached server-side; stream in shortly after load)
  { key: 'market_cap_cr', label: 'MCap(cr)', w: 66, render: (r) => <Text style={styles.cell}>{fmtMcap((r._fund as { market_cap_cr?: number } | null)?.market_cap_cr)}</Text> },
  { key: 'pe', label: 'P/E', w: 52, render: (r) => <Text style={styles.cell}>{fnum2(r, 'pe')}</Text> },
  { key: 'pb', label: 'P/B', w: 48, render: (r) => <Text style={styles.cell}>{fnum2(r, 'pb')}</Text> },
  { key: 'roe', label: 'ROE%', w: 52, render: (r) => <Text style={styles.cell}>{fnum2(r, 'roe')}</Text> },
  { key: 'roce', label: 'ROCE%', w: 56, render: (r) => <Text style={styles.cell}>{fnum2(r, 'roce')}</Text> },
  { key: 'debt_equity', label: 'D/E', w: 46, render: (r) => <Text style={styles.cell}>{fnum2(r, 'debt_equity', 2)}</Text> },
  { key: 'dividend_yield', label: 'Div%', w: 48, render: (r) => <Text style={styles.cell}>{fnum2(r, 'dividend_yield')}</Text> },
  { key: 'signal', label: 'Signal', w: 64, render: (r) => { const s = calcSignal(r); return <Text style={[styles.cell, styles.sig, { color: sigColor(s) }]}>{s.toUpperCase()}</Text>; } },
];
const ACTIONS_W = 328; // per-row action cell (B / S / Chart / ★ / Report)
const COL_META = COLS.map((c) => ({ key: c.key, label: c.label }));

const FILTERS_KEY = 'taureye.screener.filters.v1';
const INDEX_KEY = 'taureye.screener.index.v1';
const COLS_KEY = 'taureye.screener.cols.v1';
const PAGE_KEY = 'taureye.screener.pagesize.v1';

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
  const [active, setActive] = useState<ActiveFilters>({});
  const [sortCol, setSortCol] = useState('signal');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [drawer, setDrawer] = useState(false);
  const [track, setTrack] = useState<TrackEntry[]>([]);
  const [fundBusy, setFundBusy] = useState(false);
  const [detail, setDetail] = useState<Row | null>(null);
  const [restored, setRestored] = useState(false);
  // Column show/hide + order prefs.
  const [colOrder, setColOrder] = useState<string[]>(COLS.map((c) => c.key));
  const [colHidden, setColHidden] = useState<string[]>([]);
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
  // shared `#screen=` link (web) takes precedence over persisted state.
  useEffect(() => {
    (async () => {
      try {
        const shared = readSharedScreen();
        if (shared) {
          if (INDICES.includes(shared.indexName)) setIndexName(shared.indexName);
          setActive(shared.active);
          setSortCol(shared.sortCol);
          setSortDir(shared.sortDir);
        } else {
          const [f, idx] = await Promise.all([
            AsyncStorage.getItem(FILTERS_KEY),
            AsyncStorage.getItem(INDEX_KEY),
          ]);
          if (f) {
            const parsed = JSON.parse(f);
            if (parsed && typeof parsed === 'object') setActive(parsed);
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
    AsyncStorage.setItem(FILTERS_KEY, JSON.stringify(active)).catch(() => {});
  }, [active, restored]);

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
      const idx = await api.indexConstituents(name);
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
        exchange: 'NSE',
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
  }, [active, rows]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(indexName);
  }, [indexName, load]);

  const filtered = useMemo(() => applyFilters(rows, active), [rows, active]);
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
  }, [indexName, active, sortCol, sortDir, pageSize]);
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

  const activeCount = Object.keys(active).length;

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

  const curState = (): ScreenState => ({ indexName, active, sortCol, sortDir });

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
    setActive(s.active);
    setSortCol(s.sortCol);
    setSortDir(s.sortDir);
    setSavedModal(false);
    toast(`Applied "${s.name}"`);
  };

  const renderRow = ({ item }: { item: Row }) => {
    const dir = trackDirOf(item.sym);
    const starred = isWatched(item.sym);
    return (
      <View style={styles.dataRow}>
        {visibleCols.map((c) =>
          c.key === 'sym' ? (
            <TouchableOpacity
              key={c.key}
              style={[styles.td, { width: c.w, alignItems: 'flex-start' }]}
              onPress={() => setDetail(item)}
              activeOpacity={0.75}
            >
              {c.render(item)}
            </TouchableOpacity>
          ) : (
            <View key={c.key} style={[styles.td, { width: c.w, alignItems: c.align === 'left' ? 'flex-start' : 'flex-end' }]}>
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
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetRow}>
          <Text style={styles.presetLabel}>Scans</Text>
          {PRESETS.map((p) => {
            const on = presetActive(active, p);
            return (
              <TouchableOpacity
                key={p.id}
                style={[styles.presetChip, on && styles.presetChipOn]}
                onPress={() => setActive(togglePreset(active, p))}
                activeOpacity={0.75}
              >
                <Text style={[styles.presetTxt, on && styles.presetTxtOn]}>{on ? '✓ ' : ''}{p.name}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.statsRow}>
        <Stat v={stats.total} l="Matches" c={theme.text} />
        <Stat v={stats.buy} l="Bullish" c={theme.green} />
        <Stat v={stats.sell} l="Bearish" c={theme.red} />
        <Stat v={stats.neutral} l="Neutral" c={theme.muted2} />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.actionsScroll}
          contentContainerStyle={styles.actionsScrollInner}
        >
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
          <TouchableOpacity style={styles.filterBtn} onPress={() => setSavedModal(true)} activeOpacity={0.75}>
            <Text style={styles.filterTxt}>💾 Save{saved.length ? ` (${saved.length})` : ''}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.filterBtn} onPress={onShare} activeOpacity={0.75}>
            <Text style={styles.filterTxt}>↗ Share</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.filterBtn} onPress={() => setColMenu(true)} activeOpacity={0.75}>
            <Text style={styles.filterTxt}>▤ Columns</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.filterBtn} onPress={() => setDrawer(true)} activeOpacity={0.75}>
            <Text style={styles.filterTxt}>⚙ Filters{activeCount ? ` (${activeCount})` : ''}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      <Text style={styles.note}>
        {note}
        {fundBusy ? ' · loading fundamentals…' : ''}
        {error ? ` · ${error}` : ''}
      </Text>

      <View style={styles.pageBar}>
        <View style={styles.pageSizes}>
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
        </View>
        <View style={styles.pageNav}>
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
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={{ width: tableW }}>
          <View style={styles.headerRow}>
            {visibleCols.map((c) => (
              <TouchableOpacity
                key={c.key}
                style={[styles.th, { width: c.w, alignItems: c.align === 'left' ? 'flex-start' : 'flex-end' }]}
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
          <FlatList
            data={pageRows}
            keyExtractor={(r) => r.sym}
            renderItem={renderRow}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />
            }
            ListEmptyComponent={
              <EmptyState
                icon="⌕"
                title="No matches"
                hint="Loosen or clear a filter to see more of this index."
              />
            }
            initialNumToRender={20}
            windowSize={11}
          />
        </View>
      </ScrollView>

      <FilterDrawer
        visible={drawer}
        active={active}
        onClose={() => setDrawer(false)}
        onApply={setActive}
      />

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
          setColHidden([]);
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

function Stat({ v, l, c }: { v: number; l: string; c: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statV, { color: c }]}>{v}</Text>
      <Text style={styles.statL}>{l}</Text>
    </View>
  );
}

// ── Filter drawer ────────────────────────────────────────────────────────────
function FilterDrawer({
  visible,
  active,
  onClose,
  onApply,
}: {
  visible: boolean;
  active: ActiveFilters;
  onClose: () => void;
  onApply: (a: ActiveFilters) => void;
}) {
  const [draft, setDraft] = useState<ActiveFilters>(active);
  const [nlText, setNlText] = useState('');
  // Bumped on non-typing draft changes (NL add, clear-all, reopen) so the
  // uncontrolled range inputs remount with fresh defaultValues — but never
  // while the user is typing in them, which would drop focus.
  const [extVersion, setExtVersion] = useState(0);
  useEffect(() => {
    if (visible) {
      setDraft(active);
      setNlText('');
      setExtVersion((v) => v + 1);
    }
  }, [visible, active]);

  // Live plain-English preview — what the parser understood so far.
  const nlParsed = useMemo(() => (nlText.trim() ? parseNL(nlText) : null), [nlText]);
  const applyNl = () => {
    if (!nlParsed?.matchedAny) return;
    setDraft((d) => ({ ...d, ...nlParsed.filters }));
    setNlText('');
    setExtVersion((v) => v + 1);
  };

  const setRange = (key: string, part: 'min' | 'max', text: string) => {
    setDraft((d) => {
      const cur = (d[key] as RangeVal) || {};
      const num = text.trim() === '' ? undefined : parseFloat(text);
      const nextVal: RangeVal = { ...cur, [part]: isFinite(num as number) ? num : undefined };
      const next = { ...d };
      if (nextVal.min == null && nextVal.max == null) delete next[key];
      else next[key] = nextVal;
      return next;
    });
  };
  const setToggle = (key: string, on: boolean) =>
    setDraft((d) => {
      const next = { ...d };
      if (on) next[key] = true;
      else delete next[key];
      return next;
    });
  const setSelect = (key: string, val: string) =>
    setDraft((d) => {
      const next = { ...d };
      if (val) next[key] = val;
      else delete next[key];
      return next;
    });

  const renderFilter = (def: FilterDef) => {
    if (def.type === 'toggle') {
      return (
        <View key={def.key} style={styles.fRow}>
          <Text style={styles.fLabel}>{def.label}</Text>
          <Switch
            value={draft[def.key] === true}
            onValueChange={(v) => setToggle(def.key, v)}
            trackColor={{ true: theme.accent, false: theme.border2 }}
            thumbColor={theme.text}
          />
        </View>
      );
    }
    if (def.type === 'select') {
      const val = (draft[def.key] as string) || '';
      return (
        <View key={def.key} style={styles.fCol}>
          <Text style={styles.fLabel}>{def.label}{def.fund ? ' ·f' : ''}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
            {['', ...(def.options || [])].map((opt) => (
              <TouchableOpacity
                key={opt || 'any'}
                style={[styles.optChip, val === opt && styles.optChipOn]}
                onPress={() => setSelect(def.key, opt)}
                activeOpacity={0.75}
              >
                <Text style={[styles.optTxt, val === opt && styles.optTxtOn]}>{opt || 'Any'}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      );
    }
    const rv = (draft[def.key] as RangeVal) || {};
    return (
      <View key={def.key} style={styles.fRow}>
        <Text style={styles.fLabel}>
          {def.label}
          {def.unit ? ` (${def.unit})` : ''}
          {def.fund ? ' ·f' : ''}
        </Text>
        <View style={styles.rangeInputs}>
          <TextInput
            key={`${def.key}-min-${extVersion}`}
            style={styles.rInput}
            placeholder="min"
            placeholderTextColor={theme.muted}
            keyboardType="numeric"
            defaultValue={rv.min != null ? String(rv.min) : ''}
            onChangeText={(t) => setRange(def.key, 'min', t)}
          />
          <TextInput
            key={`${def.key}-max-${extVersion}`}
            style={styles.rInput}
            placeholder="max"
            placeholderTextColor={theme.muted}
            keyboardType="numeric"
            defaultValue={rv.max != null ? String(rv.max) : ''}
            onChangeText={(t) => setRange(def.key, 'max', t)}
          />
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.drawer}>
        <View style={styles.drawerHead}>
          <Text style={styles.drawerTitle}>All Filters</Text>
          <TouchableOpacity
            onPress={() => {
              setDraft({});
              setExtVersion((v) => v + 1);
            }}
            activeOpacity={0.75}
          >
            <Text style={styles.clearAll}>Clear all</Text>
          </TouchableOpacity>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled">
          <View style={styles.nlBox}>
            <Text style={styles.nlLabel}>Describe a scan in plain English</Text>
            <View style={styles.nlRow}>
              <TextInput
                style={styles.nlInput}
                value={nlText}
                onChangeText={setNlText}
                placeholder='e.g. "rsi below 30 and above 200 dma"'
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
                <Text style={[styles.nlAddTxt, !nlParsed?.matchedAny && { color: theme.muted }]}>Add</Text>
              </TouchableOpacity>
            </View>
            {nlParsed ? (
              <Text style={styles.nlFeedback}>
                {nlParsed.matchedAny ? '✓ ' + nlParsed.recognized.join(' · ') : 'Nothing recognised yet…'}
                {nlParsed.unrecognized.length ? `   (ignored: ${nlParsed.unrecognized.join(', ')})` : ''}
              </Text>
            ) : null}
          </View>
          {TE_GROUPS.map((g) => (
            <View key={g} style={styles.group}>
              <Text style={styles.groupTitle}>{g}</Text>
              {FILTER_DEFS.filter((d) => d.group === g).map(renderFilter)}
            </View>
          ))}
          <Text style={styles.fundNote}>·f = fundamental filter; applying one fetches company financials (may take a moment).</Text>
        </ScrollView>
        <View style={styles.drawerFoot}>
          <Btn label="Cancel" kind="ghost" onPress={onClose} style={{ flex: 1 }} />
          <Btn
            label="Apply"
            onPress={() => {
              onApply(draft);
              onClose();
            }}
            style={{ flex: 2 }}
          />
        </View>
      </View>
    </Modal>
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
                    {s.indexName} · {Object.keys(s.active).length} filter{Object.keys(s.active).length === 1 ? '' : 's'} · sort {s.sortCol} {s.sortDir === 1 ? '↑' : '↓'}
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
  idxChips: { paddingHorizontal: theme.sp.md, paddingVertical: theme.sp.md, gap: theme.sp.sm },
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
  presetRow: { paddingHorizontal: theme.sp.md, paddingBottom: theme.sp.md, gap: theme.sp.sm, alignItems: 'center' },
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
  nlBox: { paddingHorizontal: theme.sp.lg, paddingTop: theme.sp.lg },
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
    paddingVertical: theme.sp.md,
    gap: theme.sp.sm,
  },
  stat: { alignItems: 'center', minWidth: 48 },
  statV: { fontSize: theme.fs.lg, fontWeight: '700', fontFamily: theme.mono },
  statL: { color: theme.muted, fontSize: theme.fs.xs + 1, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 1 },
  filterBtn: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm + 1,
  },
  filterTxt: { color: theme.text, fontSize: theme.fs.sm + 1, fontWeight: '600' },
  note: { color: theme.muted, fontSize: theme.fs.sm, paddingHorizontal: theme.sp.md, paddingBottom: theme.sp.sm },
  headerRow: {
    flexDirection: 'row',
    borderBottomColor: theme.border2,
    borderBottomWidth: 1,
    backgroundColor: theme.surface2,
    paddingVertical: theme.sp.md,
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
    paddingVertical: theme.sp.md,
    minHeight: 44,
  },
  td: { justifyContent: 'center', paddingHorizontal: theme.sp.xs },
  cell: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm },
  zone: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.xs, textAlign: 'right' },
  zoneDim: { color: theme.muted2, fontFamily: theme.mono, fontSize: theme.fs.xs, textAlign: 'right' },
  symTxt: { color: theme.accent, fontFamily: theme.mono, fontWeight: '700', fontSize: theme.fs.sm + 1 },
  sig: { fontWeight: '700', fontSize: theme.fs.sm, letterSpacing: 0.4 },
  tBtn: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 6,
    minWidth: 40,
    alignItems: 'center',
  },
  tBuyOn: { backgroundColor: theme.green, borderColor: theme.green },
  tSellOn: { backgroundColor: theme.red, borderColor: theme.red },
  tBtnTxt: { color: theme.muted2, fontFamily: theme.mono, fontSize: theme.fs.sm, fontWeight: '700' },
  tOnTxt: { color: theme.onAccent },
  // per-row actions
  actionsCell: {
    width: ACTIONS_W,
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
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aBtnTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '700' },
  starOn: { color: theme.green },
  actionsScroll: { marginLeft: 'auto', flexGrow: 0 },
  actionsScrollInner: { gap: theme.sp.sm, alignItems: 'center' },
  // pagination
  pageBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.sp.md,
    paddingBottom: theme.sp.sm,
    gap: theme.sp.sm,
  },
  pageSizes: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.xs },
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
  pageNav: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm },
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
});
