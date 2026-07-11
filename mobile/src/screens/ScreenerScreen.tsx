import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { exportCsv } from '../csv';
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
  hasFundFilter,
  sortRows,
} from '../screener';
import { TrackDir, TrackEntry, addTrack, loadTrack, removeTrack } from '../tracklist';
import { theme } from '../theme';

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
  { key: 'signal', label: 'Signal', w: 64, render: (r) => { const s = calcSignal(r); return <Text style={[styles.cell, styles.sig, { color: sigColor(s) }]}>{s.toUpperCase()}</Text>; } },
];
const TABLE_W = COLS.reduce((a, c) => a + c.w, 0) + 120; // + track column

const FILTERS_KEY = 'taureye.screener.filters.v1';
const INDEX_KEY = 'taureye.screener.index.v1';

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

  // Restore persisted filters + index once, before saving anything back.
  useEffect(() => {
    (async () => {
      try {
        const [f, idx] = await Promise.all([
          AsyncStorage.getItem(FILTERS_KEY),
          AsyncStorage.getItem(INDEX_KEY),
        ]);
        if (f) {
          const parsed = JSON.parse(f);
          if (parsed && typeof parsed === 'object') setActive(parsed);
        }
        if (idx && INDICES.includes(idx)) setIndexName(idx);
      } catch {
        /* fresh start */
      } finally {
        setRestored(true);
      }
    })();
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

  // Fetch fundamentals when a fundamental filter is active. /fundamentals/bulk
  // returns cached rows immediately plus a `pending` list still warming server-
  // side — poll until pending drains (bounded) so warming stocks aren't
  // silently excluded by strict fundamental filters forever.
  const fundPolling = React.useRef(false);
  useEffect(() => {
    if (!hasFundFilter(active) || fundPolling.current) return;
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

  const renderRow = ({ item }: { item: Row }) => {
    const dir = trackDirOf(item.sym);
    return (
      <View style={styles.dataRow}>
        {COLS.map((c) =>
          c.key === 'sym' ? (
            <TouchableOpacity
              key={c.key}
              style={[styles.td, { width: c.w, alignItems: 'flex-start' }]}
              onPress={() => setDetail(item)}
            >
              {c.render(item)}
            </TouchableOpacity>
          ) : (
            <View key={c.key} style={[styles.td, { width: c.w, alignItems: c.align === 'left' ? 'flex-start' : 'flex-end' }]}>
              {c.render(item)}
            </View>
          ),
        )}
        <View style={styles.trackCell}>
          <TouchableOpacity
            style={[styles.tBtn, dir === 'buy' && styles.tBuyOn]}
            onPress={() => onTrack(item, 'buy')}
          >
            <Text style={[styles.tBtnTxt, dir === 'buy' && styles.tOnTxt]}>{dir === 'buy' ? '✓B' : 'B'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tBtn, dir === 'sell' && styles.tSellOn]}
            onPress={() => onTrack(item, 'sell')}
          >
            <Text style={[styles.tBtnTxt, dir === 'sell' && styles.tOnTxt]}>{dir === 'sell' ? '✓S' : 'S'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
        <Text style={styles.dim}>Loading {indexName}…</Text>
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
        <TouchableOpacity
          style={[styles.filterBtn, { marginLeft: 'auto' }]}
          onPress={() => exportCsv(sorted, indexName).catch(() => {})}
        >
          <Text style={styles.filterTxt}>⇩ CSV</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.filterBtn} onPress={() => setDrawer(true)}>
          <Text style={styles.filterTxt}>⚙ Filters{activeCount ? ` (${activeCount})` : ''}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.note}>
        {note}
        {fundBusy ? ' · loading fundamentals…' : ''}
        {error ? ` · ${error}` : ''}
      </Text>

      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={{ width: TABLE_W }}>
          <View style={styles.headerRow}>
            {COLS.map((c) => (
              <TouchableOpacity
                key={c.key}
                style={[styles.th, { width: c.w, alignItems: c.align === 'left' ? 'flex-start' : 'flex-end' }]}
                onPress={() => onSort(c.key)}
              >
                <Text style={styles.thTxt}>
                  {c.label}
                  {sortCol === c.key ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}
                </Text>
              </TouchableOpacity>
            ))}
            <View style={styles.trackCell}>
              <Text style={styles.thTxt}>Track</Text>
            </View>
          </View>
          <FlatList
            data={sorted}
            keyExtractor={(r) => r.sym}
            renderItem={renderRow}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />
            }
            ListEmptyComponent={<Text style={styles.dim}>No matches. Loosen your filters.</Text>}
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

      {detail ? <StockDetail row={detail} onClose={() => setDetail(null)} /> : null}
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
          <TouchableOpacity style={styles.footBtnGhost} onPress={onClose}>
            <Text style={styles.footGhostTxt}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.footBtn}
            onPress={() => {
              onApply(draft);
              onClose();
            }}
          >
            <Text style={styles.footBtnTxt}>Apply</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', gap: 10 },
  dim: { color: theme.muted, fontFamily: theme.mono, fontSize: 12, textAlign: 'center', marginTop: 20 },
  topBar: { borderBottomColor: theme.border, borderBottomWidth: 1 },
  idxChips: { paddingHorizontal: 10, paddingVertical: 8, gap: 6 },
  idxChip: { borderColor: theme.border2, borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 },
  idxChipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  idxTxt: { color: theme.muted2, fontFamily: theme.mono, fontSize: 11 },
  idxTxtOn: { color: theme.bg, fontWeight: '700' },
  presetRow: { paddingHorizontal: 10, paddingBottom: 8, gap: 6, alignItems: 'center' },
  presetLabel: { color: theme.muted, fontSize: 10, fontFamily: theme.mono, textTransform: 'uppercase', marginRight: 2 },
  presetChip: { backgroundColor: theme.surface2, borderColor: theme.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  presetChipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  presetTxt: { color: theme.muted2, fontSize: 11 },
  presetTxtOn: { color: theme.bg, fontWeight: '700' },
  nlBox: { paddingHorizontal: 16, paddingTop: 14 },
  nlLabel: { color: theme.muted2, fontSize: 11, fontFamily: theme.mono, marginBottom: 6 },
  nlRow: { flexDirection: 'row', gap: 8 },
  nlInput: { flex: 1, backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1, borderRadius: 8, color: theme.text, paddingHorizontal: 12, paddingVertical: 9, fontFamily: theme.mono, fontSize: 13 },
  nlAdd: { backgroundColor: theme.accent, borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center' },
  nlAddOff: { backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1 },
  nlAddTxt: { color: theme.bg, fontWeight: '700', fontSize: 13 },
  nlFeedback: { color: theme.green, fontSize: 11, fontFamily: theme.mono, marginTop: 8, lineHeight: 16 },
  statsRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, gap: 6 },
  stat: { alignItems: 'center', minWidth: 46 },
  statV: { fontSize: 16, fontWeight: '700' },
  statL: { color: theme.muted, fontSize: 9, fontFamily: theme.mono },
  filterBtn: { backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  filterTxt: { color: theme.text, fontSize: 12, fontWeight: '600' },
  note: { color: theme.muted, fontFamily: theme.mono, fontSize: 10, paddingHorizontal: 12, paddingBottom: 6 },
  headerRow: { flexDirection: 'row', borderBottomColor: theme.border2, borderBottomWidth: 1, backgroundColor: theme.surface, paddingVertical: 8 },
  th: { justifyContent: 'center', paddingHorizontal: 4 },
  thTxt: { color: theme.muted2, fontSize: 10, fontFamily: theme.mono, textTransform: 'uppercase' },
  dataRow: { flexDirection: 'row', alignItems: 'center', borderBottomColor: theme.border, borderBottomWidth: 1, paddingVertical: 9 },
  td: { justifyContent: 'center', paddingHorizontal: 4 },
  cell: { color: theme.text, fontFamily: theme.mono, fontSize: 12 },
  zone: { color: theme.text, fontFamily: theme.mono, fontSize: 10, textAlign: 'right' },
  zoneDim: { color: theme.muted2, fontFamily: theme.mono, fontSize: 10, textAlign: 'right' },
  symTxt: { color: theme.accent, fontWeight: '700', fontSize: 13 },
  sig: { fontWeight: '700', fontSize: 11 },
  trackCell: { width: 120, flexDirection: 'row', gap: 6, paddingHorizontal: 6, justifyContent: 'center' },
  tBtn: { borderColor: theme.border2, borderWidth: 1, borderRadius: 5, paddingHorizontal: 12, paddingVertical: 5, minWidth: 40, alignItems: 'center' },
  tBuyOn: { backgroundColor: theme.green, borderColor: theme.green },
  tSellOn: { backgroundColor: theme.red, borderColor: theme.red },
  tBtnTxt: { color: theme.muted2, fontFamily: theme.mono, fontSize: 12, fontWeight: '700' },
  tOnTxt: { color: theme.bg },
  // drawer
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  drawer: { position: 'absolute', bottom: 0, left: 0, right: 0, top: 60, backgroundColor: theme.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, overflow: 'hidden' },
  drawerHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomColor: theme.border, borderBottomWidth: 1 },
  drawerTitle: { color: theme.text, fontSize: 16, fontWeight: '700' },
  clearAll: { color: theme.muted2, fontSize: 12, fontFamily: theme.mono },
  group: { paddingHorizontal: 16, paddingTop: 14 },
  groupTitle: { color: theme.accent, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  fRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7 },
  fCol: { paddingVertical: 7 },
  fLabel: { color: theme.text, fontSize: 13, flex: 1 },
  rangeInputs: { flexDirection: 'row', gap: 6 },
  rInput: { backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1, borderRadius: 6, color: theme.text, paddingHorizontal: 8, paddingVertical: 6, width: 64, fontFamily: theme.mono, fontSize: 12, textAlign: 'center' },
  optChip: { borderColor: theme.border2, borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5, marginRight: 6 },
  optChipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  optTxt: { color: theme.muted2, fontFamily: theme.mono, fontSize: 11 },
  optTxtOn: { color: theme.bg, fontWeight: '700' },
  fundNote: { color: theme.muted, fontSize: 10, fontFamily: theme.mono, padding: 16, lineHeight: 15 },
  drawerFoot: { flexDirection: 'row', gap: 10, padding: 14, borderTopColor: theme.border, borderTopWidth: 1 },
  footBtnGhost: { flex: 1, borderColor: theme.border2, borderWidth: 1, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  footGhostTxt: { color: theme.text, fontWeight: '600' },
  footBtn: { flex: 2, backgroundColor: theme.accent, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  footBtnTxt: { color: theme.bg, fontWeight: '700' },
});
