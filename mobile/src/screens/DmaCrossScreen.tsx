// Ideas ▸ DMA crossovers — the averages that are about to meet.
//
// The screener already has "Golden cross (50↑200)" as a filter, and it fires on
// the day the cross happens, which is the day it is in every scanner in the
// country. This tab is the window before that: the pairs still apart, closing,
// and how many sessions of the current rate would take them to contact.
//
// It reads the EOD snapshot rather than scanning symbol by symbol like its
// sibling tabs. The snapshot already carries every technical for the whole
// universe and is rebuilt twice a day, so this list is complete the moment the
// tab opens instead of filling in over a minute of requests.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SnapshotRow, api } from '../api';
import { openStock } from '../navIntent';
import { useResponsive } from '../responsive';
import { theme } from '../theme';
import { Card, EmptyState, Loading } from '../ui';
import {
  Approach, PAIRS, PairKey, crossName, countByPair, etaLabel, scanApproaches,
} from '../dmaCross';

const UNIVERSE = 'NIFTY 500';

// How close counts as near. A tenth of a percent is inside a day's noise for
// most names; two percent is a fortnight away for a slow pair. One is the
// default because it is roughly a week of drift on the pairs people watch.
const WITHIN: { key: string; label: string; value: number }[] = [
  { key: 'tight', label: '0.5%', value: 0.5 },
  { key: 'near', label: '1%', value: 1 },
  { key: 'wide', label: '2%', value: 2 },
];

type DirFilter = 'all' | 'up' | 'down';

/** "28 Jul" from the snapshot's build time. */
function snapDay(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`;
}

function Chip({ label, count, on, onPress }: {
  label: string; count?: number; on: boolean; onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[s.chip, on && s.chipOn]}
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={count == null ? label : `${label}, ${count} pair${count === 1 ? '' : 's'}`}
    >
      <Text style={[s.chipTxt, on && s.chipTxtOn]}>{label}</Text>
      {count == null ? null : <Text style={s.chipN}>{count}</Text>}
    </TouchableOpacity>
  );
}

function ApproachRow({ a, wide }: { a: Approach; wide: boolean }) {
  const up = a.direction === 'up';
  const tone = up ? theme.green : theme.red;
  const eta = etaLabel(a);
  return (
    <TouchableOpacity
      style={s.row}
      onPress={() => openStock(a.symbol)}
      activeOpacity={0.7}
      accessibilityRole="link"
      accessibilityLabel={
        `${a.symbol}, ${a.pair.label} averages ${a.distance.toFixed(2)} percent apart, `
        + `${crossName(a).toLowerCase()}${eta ? ', ' + eta : ''}`
      }
    >
      <View style={s.gapCol}>
        <Text style={[s.gap, { color: tone }]}>{a.distance.toFixed(2)}%</Text>
        <Text style={s.gapNote}>apart</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={s.symLine}>
          <Text style={s.sym} numberOfLines={1}>{a.symbol}</Text>
          <Text style={[s.pairTag, { color: tone, borderColor: tone }]}>{a.pair.label}</Text>
        </View>
        {wide && a.name ? <Text style={s.name} numberOfLines={1}>{a.name}</Text> : null}
        <Text style={s.detail} numberOfLines={1}>
          <Text style={{ color: tone }}>{up ? '▲' : '▼'} {crossName(a)}</Text>
          {eta ? `  ·  ${eta}` : ''}
          {/* The week-ago gap is the least load-bearing part of the line and
              the first thing to truncate on a phone, so it is dropped there
              rather than cut off mid-word. */}
          {wide && a.was != null ? `  ·  was ${Math.abs(a.was).toFixed(2)}% a week ago` : ''}
        </Text>
      </View>
      {a.price == null ? null : (
        <View style={s.priceCol}>
          <Text style={s.price}>{a.price.toLocaleString('en-IN')}</Text>
          {a.chg == null ? null : (
            <Text style={[s.chg, { color: a.chg >= 0 ? theme.green : theme.red }]}>
              {a.chg >= 0 ? '+' : ''}{a.chg.toFixed(2)}%
            </Text>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function DmaCrossScreen() {
  const [rows, setRows] = useState<SnapshotRow[] | null>(null);
  const [builtAt, setBuiltAt] = useState<number | undefined>();
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [pair, setPair] = useState<PairKey | 'all'>('all');
  const [within, setWithin] = useState(1);
  const [dir, setDir] = useState<DirFilter>('all');
  const [all, setAll] = useState(false);
  const { width } = useResponsive();
  const wide = width >= 720;

  const load = useCallback(async () => {
    setError('');
    try {
      const snap = await api.screenerSnapshot(UNIVERSE);
      if (snap?.rows?.length) {
        setRows(snap.rows);
        setBuiltAt(snap.built_at);
        return;
      }
      setRows([]);
      setError('The end-of-day snapshot has not been built yet. It rebuilds at 16:00 and 02:00 IST.');
    } catch {
      setRows([]);
      setError('Could not reach the end-of-day snapshot. It rebuilds at 16:00 and 02:00 IST.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Every pair within the threshold, whatever the chips say — the counts on
  // the chips have to come from the unfiltered set or they would only ever
  // report the tab you are already looking at.
  const found = useMemo(
    () => scanApproaches(rows || [], { within }),
    [rows, within],
  );
  const counts = useMemo(() => countByPair(found), [found]);
  const shown = useMemo(() => {
    const f = found.filter((a) => (pair === 'all' || a.pair.key === pair)
      && (dir === 'all' || a.direction === dir));
    return all ? f : f.slice(0, 40);
  }, [found, pair, dir, all]);
  const total = useMemo(
    () => found.filter((a) => (pair === 'all' || a.pair.key === pair)
      && (dir === 'all' || a.direction === dir)).length,
    [found, pair, dir],
  );

  const withHistory = useMemo(
    () => (rows || []).some((r) => r && r.ma_gaps && Object.keys(r.ma_gaps).length > 0),
    [rows],
  );

  if (rows == null) return <Loading label="Reading the end-of-day snapshot…" />;

  return (
    <ScrollView
      style={s.wrap}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.muted2} />}
    >
      <Card style={s.card}>
        <View style={s.head}>
          <Text style={s.title}>Approaching a crossover</Text>
          <Text style={s.headNote}>
            {UNIVERSE}{builtAt ? ` · ${snapDay(builtAt)} close` : ''}
          </Text>
        </View>
        <Text style={s.lede}>
          Moving averages still apart but closing on each other, nearest first.
          A pair that is close and widening has already crossed and is left out.
        </Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          <Chip label="All pairs" count={counts.all} on={pair === 'all'} onPress={() => setPair('all')} />
          {PAIRS.map((p) => (
            <Chip
              key={p.key}
              label={p.label}
              count={counts[p.key]}
              on={pair === p.key}
              onPress={() => setPair(p.key)}
            />
          ))}
        </ScrollView>

        <View style={s.controls}>
          <View style={s.ctlGroup}>
            <Text style={s.ctlLabel}>WITHIN</Text>
            {WITHIN.map((w) => (
              <Chip key={w.key} label={w.label} on={within === w.value} onPress={() => setWithin(w.value)} />
            ))}
          </View>
          <View style={s.ctlGroup}>
            <Text style={s.ctlLabel}>DIRECTION</Text>
            <Chip label="Any" on={dir === 'all'} onPress={() => setDir('all')} />
            <Chip label="▲ Bullish" on={dir === 'up'} onPress={() => setDir('up')} />
            <Chip label="▼ Bearish" on={dir === 'down'} onPress={() => setDir('down')} />
          </View>
        </View>

        {pair !== 'all' ? (
          <Text style={s.pairBlurb}>{PAIRS.find((p) => p.key === pair)?.blurb}</Text>
        ) : null}

        {error ? (
          <EmptyState title="No snapshot to read" hint={error} />
        ) : !withHistory ? (
          <EmptyState
            title="No moving-average gaps in this snapshot"
            hint="The snapshot predates this scan. The next scheduled rebuild — 16:00 or 02:00 IST — will carry them."
          />
        ) : shown.length === 0 ? (
          <EmptyState
            title="Nothing is converging that closely"
            hint={`No ${pair === 'all' ? '' : PAIRS.find((p) => p.key === pair)?.label + ' '}pair is within ${within}% and still closing. Widen the threshold, or check back after the next close.`}
          />
        ) : (
          <>
            {shown.map((a) => (
              <ApproachRow key={`${a.symbol}:${a.pair.key}`} a={a} wide={wide} />
            ))}
            {total > shown.length ? (
              <TouchableOpacity onPress={() => setAll(true)} activeOpacity={0.7}>
                <Text style={s.more}>Show all {total} ›</Text>
              </TouchableOpacity>
            ) : null}
          </>
        )}
      </Card>

      <Text style={s.foot}>
        A pending cross is two averages converging, not a signal. The estimate
        assumes the last week's rate continues, which is exactly what price does
        not have to do.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  content: { padding: theme.sp.md, paddingBottom: theme.sp.xl },
  card: { padding: theme.sp.md },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  title: { color: theme.text, fontSize: theme.fs.md, fontWeight: '800' },
  headNote: { color: theme.muted, fontSize: theme.fs.xs, fontFamily: theme.mono },
  lede: { color: theme.muted, fontSize: theme.fs.xs, lineHeight: 17, marginTop: 6 },

  chips: { flexDirection: 'row', gap: 8, paddingVertical: theme.sp.md },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999,
    borderWidth: 1, borderColor: theme.border2, backgroundColor: theme.surface2,
  },
  chipOn: { backgroundColor: theme.brandSoft, borderColor: theme.brand },
  chipTxt: { color: theme.muted2, fontSize: theme.fs.xs, fontWeight: '700' },
  chipTxtOn: { color: theme.brand },
  chipN: { color: theme.muted, fontSize: theme.fs.xs, fontFamily: theme.mono },

  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.lg, marginBottom: theme.sp.sm },
  ctlGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ctlLabel: {
    color: theme.muted, fontSize: 9, fontFamily: theme.mono,
    letterSpacing: 1, fontWeight: '700',
  },
  pairBlurb: {
    color: theme.muted, fontSize: theme.fs.xs, fontStyle: 'italic',
    marginTop: 2, marginBottom: theme.sp.sm,
  },

  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingVertical: 9, borderTopWidth: 1, borderTopColor: theme.border,
  },
  gapCol: { width: 58 },
  gap: { fontSize: theme.fs.sm, fontFamily: theme.mono, fontWeight: '700' },
  gapNote: { color: theme.muted, fontSize: 9, fontFamily: theme.mono },
  symLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sym: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700' },
  pairTag: {
    fontSize: 9, fontFamily: theme.mono, fontWeight: '700',
    borderWidth: 1, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1,
  },
  name: { color: theme.muted, fontSize: theme.fs.xs, marginTop: 1 },
  detail: { color: theme.muted, fontSize: theme.fs.xs, fontFamily: theme.mono, marginTop: 3 },
  priceCol: { alignItems: 'flex-end' },
  price: { color: theme.text, fontSize: theme.fs.sm, fontFamily: theme.mono },
  chg: { fontSize: theme.fs.xs, fontFamily: theme.mono, marginTop: 2 },

  more: { color: theme.brand, fontSize: theme.fs.xs, fontWeight: '700', marginTop: 10 },
  foot: { color: theme.muted, fontSize: theme.fs.xs, lineHeight: 16, marginTop: theme.sp.md },
});
