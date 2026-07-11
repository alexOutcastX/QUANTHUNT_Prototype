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
import { api } from '../api';
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
  { key: 'signal', label: 'Signal', w: 64, render: (r) => { const s = calcSignal(r); return <Text style={[styles.cell, styles.sig, { color: sigColor(s) }]}>{s.toUpperCase()}</Text>; } },
];
const TABLE_W = COLS.reduce((a, c) => a + c.w, 0) + 120; // + track column

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

  const load = useCallback(async (name: string) => {
    setError(null);
    setNote('');
    try {
      const idx = await api.indexConstituents(name);
      const syms = (idx.data || []).map((c) => c.symbol).filter(Boolean);
      if (!syms.length) {
        setRows([]);
        setNote(idx.error || 'No constituents returned.');
        return;
      }
      setNote(`Scanning ${syms.length} symbols…`);
      const scan = await api.scan(syms);
      const merged: Row[] = syms.map((sym) => ({ sym, exchange: 'NSE', ...(scan.data[sym] || {}) }));
      setRows(merged);
      const withData = merged.filter((r) => r.price != null).length;
      setNote(`${withData}/${syms.length} scanned live`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load(indexName);
  }, [indexName, load]);

  useEffect(() => {
    loadTrack().then(setTrack);
  }, []);

  // Fetch fundamentals when a fundamental filter becomes active and we lack them.
  useEffect(() => {
    if (!hasFundFilter(active)) return;
    const missing = rows.filter((r) => r._fund === undefined).map((r) => r.sym);
    if (!missing.length) return;
    let cancelled = false;
    setFundBusy(true);
    api
      .fundamentalsBulk(missing)
      .then((res) => {
        if (cancelled) return;
        const data = res.data || {};
        setRows((prev) =>
          prev.map((r) =>
            r._fund === undefined ? { ...r, _fund: (data[r.sym] as Row['_fund']) ?? null } : r,
          ),
        );
      })
      .catch(() => {})
      .finally(() => !cancelled && setFundBusy(false));
    return () => {
      cancelled = true;
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
        {COLS.map((c) => (
          <View key={c.key} style={[styles.td, { width: c.w, alignItems: c.align === 'left' ? 'flex-start' : 'flex-end' }]}>
            {c.render(item)}
          </View>
        ))}
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
      </View>

      <View style={styles.statsRow}>
        <Stat v={stats.total} l="Matches" c={theme.text} />
        <Stat v={stats.buy} l="Bullish" c={theme.green} />
        <Stat v={stats.sell} l="Bearish" c={theme.red} />
        <Stat v={stats.neutral} l="Neutral" c={theme.muted2} />
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
  useEffect(() => {
    if (visible) setDraft(active);
  }, [visible, active]);

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
            style={styles.rInput}
            placeholder="min"
            placeholderTextColor={theme.muted}
            keyboardType="numeric"
            defaultValue={rv.min != null ? String(rv.min) : ''}
            onChangeText={(t) => setRange(def.key, 'min', t)}
          />
          <TextInput
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
          <TouchableOpacity onPress={() => setDraft({})}>
            <Text style={styles.clearAll}>Clear all</Text>
          </TouchableOpacity>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled">
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
  statsRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, gap: 6 },
  stat: { alignItems: 'center', minWidth: 46 },
  statV: { fontSize: 16, fontWeight: '700' },
  statL: { color: theme.muted, fontSize: 9, fontFamily: theme.mono },
  filterBtn: { marginLeft: 'auto', backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  filterTxt: { color: theme.text, fontSize: 12, fontWeight: '600' },
  note: { color: theme.muted, fontFamily: theme.mono, fontSize: 10, paddingHorizontal: 12, paddingBottom: 6 },
  headerRow: { flexDirection: 'row', borderBottomColor: theme.border2, borderBottomWidth: 1, backgroundColor: theme.surface, paddingVertical: 8 },
  th: { justifyContent: 'center', paddingHorizontal: 4 },
  thTxt: { color: theme.muted2, fontSize: 10, fontFamily: theme.mono, textTransform: 'uppercase' },
  dataRow: { flexDirection: 'row', alignItems: 'center', borderBottomColor: theme.border, borderBottomWidth: 1, paddingVertical: 9 },
  td: { justifyContent: 'center', paddingHorizontal: 4 },
  cell: { color: theme.text, fontFamily: theme.mono, fontSize: 12 },
  symTxt: { color: theme.text, fontWeight: '700', fontSize: 13 },
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
