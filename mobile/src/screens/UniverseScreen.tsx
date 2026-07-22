import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { IndexConstituent, ReturnsRow, api } from '../api';
import { theme } from '../theme';
import { EmptyState, Loading } from '../ui';

const INDICES = [
  'NIFTY 50', 'NIFTY 100', 'NIFTY 200', 'NIFTY 500', 'NIFTY BANK', 'NIFTY IT',
  'NIFTY AUTO', 'NIFTY PHARMA', 'NIFTY FMCG', 'NIFTY METAL',
  'NIFTY MIDCAP 100', 'NIFTY MIDCAP 150', 'NIFTY SMALLCAP 100',
  'NIFTY SMALLCAP 250', 'NIFTY MICROCAP 250',
];

// Market-cap segments, SEBI-style rank classification over the NIFTY 500:
// top 100 by market cap = large, next 150 = mid, rest = small.
const SEGMENTS = ['LARGE CAP', 'MID CAP', 'SMALL CAP'] as const;
const isSegment = (n: string) => (SEGMENTS as readonly string[]).includes(n);

type UnivRow = IndexConstituent & ReturnsRow & { mcap?: number | null };

const pct = (v: number | null | undefined, d = 2) =>
  v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + '%';
const colorOf = (v: number | null | undefined) =>
  v == null ? theme.muted : v >= 0 ? theme.green : theme.red;
// Heatmap background tint by day change.
const heatBg = (v: number | null | undefined) => {
  if (v == null) return 'transparent';
  const a = Math.min(0.28, Math.abs(v) / 6 * 0.28);
  return v >= 0 ? `rgba(24,201,140,${a})` : `rgba(240,80,110,${a})`;
};

type Col = { key: keyof UnivRow | 'symbol'; label: string; w: number };
const BASE_COLS: Col[] = [
  { key: 'symbol', label: 'Symbol', w: 110 },
  { key: 'price', label: 'CMP', w: 78 },
  { key: 'chg', label: 'Chg%', w: 66 },
  { key: 'ret1y', label: '1Y', w: 66 },
  { key: 'ret3y', label: '3Y', w: 66 },
  { key: 'ret5y', label: '5Y', w: 66 },
];
const MCAP_COL: Col = { key: 'mcap', label: 'MCap cr', w: 92 };

export default function UniverseScreen() {
  const [indexName, setIndexName] = useState('NIFTY 50');
  const [rows, setRows] = useState<UnivRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [heatmap, setHeatmap] = useState(false);
  const [sortCol, setSortCol] = useState<string>('chg');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  const load = useCallback(async (name: string) => {
    setError(null);
    try {
      const segment = isSegment(name);
      const idx = await api.indexConstituents(segment ? 'NIFTY 500' : name);
      let base: UnivRow[] = (idx.data || []).map((c) => ({ ...c }));
      if (!base.length) {
        setRows([]);
        setNote(idx.error || 'No constituents.');
        return;
      }
      if (segment) {
        // Rank the NIFTY 500 by market cap, then keep this segment's band.
        setRows([]);
        setNote('Classifying NIFTY 500 by market cap…');
        const syms = base.map((c) => c.symbol);
        let mcaps: Record<string, Record<string, unknown>> = {};
        let bulk = await api.fundamentalsBulk(syms);
        mcaps = { ...bulk.data };
        for (let round = 0; round < 10 && bulk.pending.length; round++) {
          await new Promise((r) => setTimeout(r, 3000));
          bulk = await api.fundamentalsBulk(bulk.pending);
          mcaps = { ...mcaps, ...bulk.data };
        }
        const withCap = base
          .map((c) => ({ ...c, mcap: (mcaps[c.symbol]?.market_cap_cr as number | undefined) ?? null }))
          .filter((c) => c.mcap != null)
          .sort((a, b) => (b.mcap as number) - (a.mcap as number));
        const bands: Record<string, [number, number]> = {
          'LARGE CAP': [0, 100],
          'MID CAP': [100, 250],
          'SMALL CAP': [250, withCap.length],
        };
        const [from, to] = bands[name];
        base = withCap.slice(from, to);
        if (!base.length) {
          setRows([]);
          setNote('Market caps unavailable right now — try again shortly.');
          return;
        }
      }
      setRows(base);
      setNote(`${base.length} ${segment ? name.toLowerCase() + ' stocks (by mcap rank in NIFTY 500)' : 'constituents'} · loading returns…`);
      // Returns are heavier; layer them in once loaded.
      try {
        const rets = await api.returns(base.map((c) => c.symbol));
        setRows(base.map((c) => ({ ...c, ...(rets[c.symbol] || {}) })));
        setNote(`${base.length} ${segment ? name.toLowerCase() + ' stocks (by mcap rank in NIFTY 500)' : 'constituents'}`);
      } catch {
        setNote(`${base.length} constituents · returns unavailable`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load index');
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

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(indexName);
  }, [indexName, load]);

  const onSort = (col: string) => {
    if (col === sortCol) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortCol(col);
      setSortDir(col === 'symbol' ? 1 : -1);
    }
  };

  const segment = isSegment(indexName);
  const COLS = useMemo<Col[]>(
    () => (segment ? [BASE_COLS[0], MCAP_COL, ...BASE_COLS.slice(1)] : BASE_COLS),
    [segment],
  );
  const TABLE_W = 36 + COLS.reduce((a, c) => a + c.w, 0); // 36 = serial column

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (sortCol === 'symbol') return a.symbol.localeCompare(b.symbol) * sortDir;
      const va = (a as unknown as Record<string, number | null>)[sortCol];
      const vb = (b as unknown as Record<string, number | null>)[sortCol];
      const na = va == null || !isFinite(va) ? -Infinity : va;
      const nb = vb == null || !isFinite(vb) ? -Infinity : vb;
      return (na - nb) * sortDir;
    });
  }, [rows, sortCol, sortDir]);

  const renderRow = ({ item, index }: { item: UnivRow; index: number }) => (
    <View style={[styles.row, heatmap ? { backgroundColor: heatBg(item.chg) } : null]}>
      <Text style={[styles.cell, styles.right, { width: 36, color: theme.muted }]}>{index + 1}</Text>
      <Text style={[styles.cell, styles.cSym, { width: BASE_COLS[0].w }]}>{item.symbol}</Text>
      {segment ? (
        <Text style={[styles.cell, styles.right, { width: MCAP_COL.w }]}>
          {item.mcap != null ? Math.round(item.mcap).toLocaleString('en-IN') : '—'}
        </Text>
      ) : null}
      <Text style={[styles.cell, styles.right, { width: BASE_COLS[1].w }]}>
        {item.price != null ? item.price.toFixed(1) : '—'}
      </Text>
      <Text style={[styles.cell, styles.right, { width: BASE_COLS[2].w, color: colorOf(item.chg) }]}>{pct(item.chg)}</Text>
      <Text style={[styles.cell, styles.right, { width: BASE_COLS[3].w, color: colorOf(item.ret1y) }]}>{pct(item.ret1y, 0)}</Text>
      <Text style={[styles.cell, styles.right, { width: BASE_COLS[4].w, color: colorOf(item.ret3y) }]}>{pct(item.ret3y, 0)}</Text>
      <Text style={[styles.cell, styles.right, { width: BASE_COLS[5].w, color: colorOf(item.ret5y) }]}>{pct(item.ret5y, 0)}</Text>
    </View>
  );

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
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {SEGMENTS.map((seg) => (
            <TouchableOpacity
              key={seg}
              style={[styles.chip, styles.segChip, seg === indexName && styles.chipOn]}
              onPress={() => {
                setIndexName(seg);
                setSortCol('mcap');
                setSortDir(-1);
              }}
              activeOpacity={0.75}
            >
              <Text style={[styles.chipTxt, seg === indexName && styles.chipTxtOn]}>{seg}</Text>
            </TouchableOpacity>
          ))}
          {INDICES.map((idx) => (
            <TouchableOpacity
              key={idx}
              style={[styles.chip, idx === indexName && styles.chipOn]}
              onPress={() => setIndexName(idx)}
              activeOpacity={0.75}
            >
              <Text style={[styles.chipTxt, idx === indexName && styles.chipTxtOn]}>{idx.replace('NIFTY ', '')}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.note}>{note}{error ? ` · ${error}` : ''}</Text>
        <TouchableOpacity
          style={[styles.heatBtn, heatmap && styles.heatOn]}
          onPress={() => setHeatmap((v) => !v)}
          activeOpacity={0.75}
        >
          <Text style={[styles.heatTxt, heatmap && styles.heatTxtOn]}>⊞ Heatmap</Text>
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={{ width: TABLE_W }}>
          <View style={styles.headerRow}>
            <Text style={[styles.th, styles.right, { width: 36 }]}>#</Text>
            {COLS.map((c) => (
              <TouchableOpacity
                key={String(c.key)}
                style={{ width: c.w }}
                onPress={() => onSort(String(c.key))}
                activeOpacity={0.75}
              >
                <Text style={[styles.th, c.key !== 'symbol' && styles.right]}>
                  {c.label}
                  {sortCol === c.key ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <FlatList
            data={sorted}
            keyExtractor={(r) => r.symbol}
            renderItem={renderRow}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />
            }
            ListEmptyComponent={
              <EmptyState
                icon="◇"
                title="Nothing to show"
                hint="Pick another index above, or pull down to refresh."
              />
            }
            initialNumToRender={25}
            windowSize={11}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, backgroundColor: theme.bg },
  topBar: { borderBottomColor: theme.border, borderBottomWidth: 1 },
  chips: { paddingHorizontal: theme.sp.md, paddingVertical: theme.sp.md, gap: theme.sp.sm },
  chip: {
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  segChip: { borderStyle: 'dashed', borderColor: theme.border2 },
  chipTxt: { color: theme.muted2, fontSize: theme.fs.sm },
  chipTxtOn: { color: theme.onAccent, fontWeight: '700' },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.sp.md,
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.md,
  },
  note: { color: theme.muted, fontSize: theme.fs.sm, flex: 1 },
  heatBtn: {
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  heatOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  heatTxt: { color: theme.muted2, fontSize: theme.fs.sm },
  heatTxtOn: { color: theme.onAccent, fontWeight: '700' },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: theme.surface2,
    borderBottomColor: theme.border2,
    borderBottomWidth: 1,
    paddingVertical: theme.sp.md,
    paddingHorizontal: theme.sp.sm,
  },
  th: {
    color: theme.muted2,
    fontSize: theme.fs.xs + 1,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    paddingVertical: theme.sp.md,
    paddingHorizontal: theme.sp.sm,
    minHeight: 44,
  },
  cell: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm },
  cSym: { fontWeight: '700', fontSize: theme.fs.sm + 1 },
  right: { textAlign: 'right' },
});
