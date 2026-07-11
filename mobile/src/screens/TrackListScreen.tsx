import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Quote, ScanRow, api } from '../api';
import { Row, calcSignal } from '../screener';
import { TrackDir, TrackEntry, loadTrack, removeTrack } from '../tracklist';
import { theme } from '../theme';

type Filter = 'all' | 'buy' | 'sell';

const fmtDate = (ms: number) => {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
};
const money = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const signedPct = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

// Direction-aware return since entry: a SELL profits when price falls.
function entryReturn(dir: TrackDir, entry: number, cur: number): number | null {
  if (!(entry > 0) || cur == null) return null;
  const raw = (cur - entry) / entry;
  return (dir === 'buy' ? raw : -raw) * 100;
}

// Exit hint: for a BUY, momentum turning bearish/overbought suggests trimming;
// mirror for a SELL.
function exitHint(dir: TrackDir, scan: ScanRow | undefined): string | null {
  if (!scan || scan.rsi == null) return null;
  const sig = calcSignal({ sym: '', ...scan } as Row);
  const rsi = scan.rsi;
  if (dir === 'buy') {
    if (sig === 'sell') return 'Signal flipped bearish — consider exit';
    if (rsi >= 70) return `Overbought (RSI ${rsi.toFixed(0)}) — consider trimming`;
  } else {
    if (sig === 'buy') return 'Signal flipped bullish — consider cover';
    if (rsi <= 30) return `Oversold (RSI ${rsi.toFixed(0)}) — consider cover`;
  }
  return null;
}

export default function TrackListScreen() {
  const [list, setList] = useState<TrackEntry[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [scan, setScan] = useState<Record<string, ScanRow>>({});
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLive = useCallback(async (entries: TrackEntry[]) => {
    if (!entries.length) {
      setQuotes({});
      setScan({});
      return;
    }
    const syms = entries.map((e) => e.sym);
    setError(null);
    try {
      const [q, s] = await Promise.all([
        api.ltp(syms).catch(() => ({}) as Record<string, Quote>),
        api.scan(syms).then((r) => r.data).catch(() => ({}) as Record<string, ScanRow>),
      ]);
      setQuotes(q);
      setScan(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh');
    }
  }, []);

  // Reload the stored list whenever the screen regains focus is ideal, but a
  // mount + pull-to-refresh keeps it simple and dependency-free.
  const reload = useCallback(async () => {
    const saved = await loadTrack();
    setList(saved);
    await fetchLive(saved);
  }, [fetchLive]);

  useEffect(() => {
    (async () => {
      await reload();
      setLoading(false);
    })();
  }, [reload]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  const onRemove = useCallback(
    async (sym: string) => setList(await removeTrack(list, sym)),
    [list],
  );

  const shown = useMemo(
    () => (filter === 'all' ? list : list.filter((e) => e.dir === filter)),
    [list, filter],
  );

  const renderCard = ({ item }: { item: TrackEntry }) => {
    const q = quotes[item.sym];
    const cur = q?.price ?? null;
    const ret = cur != null ? entryReturn(item.dir, item.addedPrice, cur) : null;
    const retCol = ret == null ? theme.muted : ret >= 0 ? theme.green : theme.red;
    const dayCol = q?.chg == null ? theme.muted : q.chg >= 0 ? theme.green : theme.red;
    const hint = exitHint(item.dir, scan[item.sym]);
    const isBuy = item.dir === 'buy';
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={styles.symWrap}>
            <Text style={styles.sym}>{item.sym}</Text>
            <View style={[styles.dirBadge, isBuy ? styles.buyBadge : styles.sellBadge]}>
              <Text style={[styles.dirTxt, { color: isBuy ? theme.green : theme.red }]}>
                {item.dir.toUpperCase()}
              </Text>
            </View>
          </View>
          <TouchableOpacity onPress={() => onRemove(item.sym)} hitSlop={10}>
            <Text style={styles.remove}>✕</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.grid}>
          <Cell label="Entry" value={item.addedPrice ? money(item.addedPrice) : '—'} />
          <Cell label="Current" value={cur != null ? money(cur) : '—'} />
          <Cell
            label="Return"
            value={ret != null ? signedPct(ret) : '—'}
            color={retCol}
          />
          <Cell
            label="Day"
            value={q?.chg != null ? signedPct(q.chg) : '—'}
            color={dayCol}
          />
          <Cell label="RSI" value={scan[item.sym]?.rsi != null ? scan[item.sym].rsi!.toFixed(0) : '—'} />
          <Cell label="Added" value={fmtDate(item.addedAt)} />
        </View>

        {hint ? (
          <Text style={styles.hint}>⚠ {hint}</Text>
        ) : cur != null ? (
          <Text style={styles.ok}>Holding — no exit signal</Text>
        ) : null}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  const counts = {
    all: list.length,
    buy: list.filter((e) => e.dir === 'buy').length,
    sell: list.filter((e) => e.dir === 'sell').length,
  };

  return (
    <View style={styles.container}>
      <View style={styles.filterRow}>
        {(['all', 'buy', 'sell'] as Filter[]).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.fChip, filter === f && styles.fChipOn]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.fTxt, filter === f && styles.fTxtOn]}>
              {f.toUpperCase()} {counts[f]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {error ? <Text style={styles.err}>{error} — is the backend reachable?</Text> : null}

      <FlatList
        data={shown}
        keyExtractor={(e) => e.sym}
        renderItem={renderCard}
        contentContainerStyle={styles.listPad}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            Nothing tracked yet. In the Screener, tap the B / S buttons on a row to track a stock as
            BUY or SELL — it shows up here with live return since entry.
          </Text>
        }
      />
    </View>
  );
}

function Cell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellLabel}>{label}</Text>
      <Text style={[styles.cellValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' },
  filterRow: { flexDirection: 'row', gap: 8, padding: 12 },
  fChip: { borderColor: theme.border2, borderWidth: 1, borderRadius: 6, paddingHorizontal: 14, paddingVertical: 7 },
  fChipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  fTxt: { color: theme.muted2, fontFamily: theme.mono, fontSize: 12 },
  fTxtOn: { color: theme.bg, fontWeight: '700' },
  err: { color: theme.red, fontFamily: theme.mono, fontSize: 11, paddingHorizontal: 12 },
  listPad: { paddingHorizontal: 12, paddingBottom: 24 },
  card: { backgroundColor: theme.surface2, borderColor: theme.border, borderWidth: 1, borderRadius: 10, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  symWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sym: { color: theme.text, fontWeight: '700', fontSize: 15 },
  dirBadge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1 },
  buyBadge: { borderColor: theme.green },
  sellBadge: { borderColor: theme.red },
  dirTxt: { fontSize: 10, fontWeight: '700', fontFamily: theme.mono },
  remove: { color: theme.muted2, fontSize: 15 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  cell: { width: '33.33%', marginBottom: 10 },
  cellLabel: { color: theme.muted2, fontSize: 10, fontFamily: theme.mono },
  cellValue: { color: theme.text, fontSize: 14, fontFamily: theme.mono, marginTop: 2 },
  hint: { color: theme.red, fontSize: 12, marginTop: 4, borderTopColor: theme.border, borderTopWidth: 1, paddingTop: 10 },
  ok: { color: theme.muted, fontSize: 11, fontFamily: theme.mono, marginTop: 4, borderTopColor: theme.border, borderTopWidth: 1, paddingTop: 10 },
  empty: { color: theme.muted, fontFamily: theme.mono, fontSize: 12, textAlign: 'center', marginTop: 30, lineHeight: 18, paddingHorizontal: 16 },
});
