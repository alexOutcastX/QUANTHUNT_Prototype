// Gainers and losers, as one sliding panel instead of a column of stacked
// cards.
//
// NIFTY movers and SENSEX movers were two full-width cards, one under the
// other, and every index anyone wanted to add would have been another. Side by
// side in a slider they cost the height of one, and adding a fifth is a choice
// the reader makes rather than a redesign.
//
// The first panel is the whole market rather than an index. Every movers list
// on the page was scoped to a constituent list — NIFTY 500 for breadth, NIFTY
// 50 and SENSEX here — so the day's biggest actual moves, which are almost
// never large caps, appeared nowhere at all.
//
// Which indices are in it is remembered per device. Removing them all is
// allowed: it leaves an empty slot with an Add button, which is a legitimate
// preference and not a broken page.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Card, EmptyState, Loading, SectionTitle } from '../ui';
import { Icon } from '../icons';
import { theme } from '../theme';
import { api } from '../api';
import { navigate, openStock } from '../navIntent';

const KEY = 'taureye.home.slider.v1';

/** The whole traded universe, as opposed to any one index's constituents. */
export const MARKET = '__market__';

/** What the slider opens with. */
export const DEFAULT_INDICES = [MARKET, 'NIFTY 50', 'BSE SENSEX'];

/** What it used to open with, before the market panel existed. A stored list
 *  identical to this was never customised — it is the old default sitting in
 *  storage — so it adopts the new one rather than being frozen without a
 *  panel the user never had the chance to decline. */
const LEGACY_DEFAULT = ['NIFTY 50', 'BSE SENSEX'];

const labelFor = (name: string) => (name === MARKET ? 'Across the market' : name);

/** Indices the picker offers. Anything /index serves is valid here. */
export const PICKABLE = [
  MARKET,
  'NIFTY 50', 'BSE SENSEX', 'NIFTY BANK', 'NIFTY IT', 'NIFTY AUTO',
  'NIFTY PHARMA', 'NIFTY FMCG', 'NIFTY METAL', 'NIFTY ENERGY',
  'NIFTY REALTY', 'NIFTY NEXT 50', 'NIFTY MIDCAP 100', 'NIFTY 500',
];

type Row = { symbol: string; price?: number | null; chg?: number | null };
/** Already split into the two lists a panel shows, because the market panel
 *  arrives that way and an index's constituents have to be sorted into it. */
type Panel = { up: Row[]; down: Row[]; note?: string } | 'loading' | 'failed';

const pct = (v?: number | null) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%');
const colorOf = (v?: number | null) => (v == null ? theme.muted : v >= 0 ? theme.green : theme.red);

function topBottom(rows: Row[], n: number): { up: Row[]; down: Row[] } {
  const priced = rows.filter((r) => r.chg != null);
  priced.sort((a, b) => (b.chg as number) - (a.chg as number));
  return { up: priced.slice(0, n), down: priced.slice(-n).reverse() };
}

const crore = (v: number) => (v >= 1e7 ? `${Math.round(v / 1e7)}cr` : `${Math.round(v / 1e5)}L`);

function MoverList({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <View style={s.half}>
      <Text style={s.colTitle}>{title}</Text>
      {rows.map((r) => (
        <TouchableOpacity
          key={r.symbol}
          style={s.row}
          onPress={() => openStock(r.symbol)}
          activeOpacity={0.7}
          accessibilityRole="link"
          accessibilityLabel={`Open ${r.symbol}, ${pct(r.chg)}`}
        >
          <Text style={s.sym} numberOfLines={1}>{r.symbol}</Text>
          <Text style={[s.chg, { color: colorOf(r.chg) }]}>{pct(r.chg)}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function IndexSlider({ level }: { level?: (name: string) => { level?: number | null; chg?: number | null } | null }) {
  const [names, setNames] = useState<string[]>(DEFAULT_INDICES);
  const [hydrated, setHydrated] = useState(false);
  const [data, setData] = useState<Record<string, Panel>>({});
  const [page, setPage] = useState(0);
  const [width, setWidth] = useState(0);
  const [picking, setPicking] = useState(false);
  const scroller = useRef<ScrollView>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => {
        if (!v) return;
        const arr = JSON.parse(v);
        // An empty list is a real choice; a malformed one is not.
        if (!Array.isArray(arr) || !arr.every((x) => typeof x === 'string')) return;
        const untouched =
          arr.length === LEGACY_DEFAULT.length && arr.every((x, i) => x === LEGACY_DEFAULT[i]);
        setNames(untouched ? DEFAULT_INDICES : arr);
      })
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, []);

  const save = useCallback((next: string[]) => {
    setNames(next);
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    for (const name of names) {
      if (data[name]) continue;
      setData((d) => ({ ...d, [name]: 'loading' }));
      const fail = () => setData((d) => ({ ...d, [name]: 'failed' }));
      if (name === MARKET) {
        api
          .marketMovers(4)
          .then((m) =>
            setData((d) => ({
              ...d,
              [name]: {
                up: (m.gainers || []) as Row[],
                down: (m.losers || []) as Row[],
                // The floor is not tidying and the exclusions are not
                // rounding: without them this list is rights entitlements and
                // shells that printed one trade, plus every split of the day
                // sitting at -90%. Both are stated rather than assumed.
                note: m.universe
                  ? `${m.universe.toLocaleString('en-IN')} names over ₹${crore(m.min_turnover)} turnover` +
                    (m.excluded ? ` · ${m.excluded} corporate action${m.excluded > 1 ? 's' : ''} excluded` : '')
                  : undefined,
              },
            })),
          )
          .catch(fail);
        continue;
      }
      api
        .indexConstituents(name)
        .then((idx) =>
          setData((d) => ({ ...d, [name]: topBottom((idx.data || []) as Row[], 4) })),
        )
        .catch(fail);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names, hydrated]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return;
    setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  };
  const goto = (i: number) => {
    setPage(i);
    scroller.current?.scrollTo({ x: i * width, animated: true });
  };
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const add = (name: string) => {
    setPicking(false);
    if (names.includes(name)) {
      goto(names.indexOf(name));
      return;
    }
    save([...names, name]);
    // Land on what was just added, once it has a page to land on.
    setTimeout(() => goto(names.length), 60);
  };

  const remove = (name: string) => {
    const next = names.filter((n) => n !== name);
    save(next);
    setPage((p) => Math.max(0, Math.min(p, next.length - 1)));
  };

  const unused = PICKABLE.filter((n) => !names.includes(n));

  return (
    <Card style={s.card}>
      <View style={s.head}>
        <SectionTitle>Movers</SectionTitle>
        <View style={s.headR}>
          {names.length > 1 ? (
            <View style={s.dots}>
              {names.map((n, i) => (
                <TouchableOpacity
                  key={n}
                  onPress={() => goto(i)}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${labelFor(n)}`}
                  accessibilityState={{ selected: i === page }}
                >
                  <View style={[s.dot, i === page && s.dotOn]} />
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          <TouchableOpacity
            style={s.add}
            onPress={() => setPicking((v) => !v)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityState={{ expanded: picking }}
            accessibilityLabel="Add an index to this slider"
          >
            <Icon name="plus" size={14} color={theme.brand} />
          </TouchableOpacity>
        </View>
      </View>

      {picking ? (
        <View style={s.picker}>
          {unused.length ? (
            unused.map((n) => (
              <TouchableOpacity
                key={n}
                style={s.pick}
                onPress={() => add(n)}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={`Add ${labelFor(n)}`}
              >
                <Text style={s.pickTxt}>{labelFor(n)}</Text>
              </TouchableOpacity>
            ))
          ) : (
            <Text style={s.pickNone}>Every index is already in the slider.</Text>
          )}
        </View>
      ) : null}

      <View onLayout={onLayout}>
        {!names.length ? (
          <EmptyState
            title="No indices in the slider"
            hint="Add the whole market, or an index, and its gainers and losers show up here."
            action={{ label: 'Add an index', onPress: () => setPicking(true) }}
          />
        ) : width ? (
          <ScrollView
            ref={scroller}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={32}
            style={{ width }}
          >
            {names.map((name) => {
              const p = data[name];
              const lv = name === MARKET ? null : level?.(name) || null;
              const split = p && p !== 'loading' && p !== 'failed' ? p : null;
              return (
                <View key={name} style={{ width }}>
                  <View style={s.panelHead}>
                    <View style={{ flex: 1 }}>
                      {/* Remove sits beside the NAME, not out at the right
                          edge: there it landed directly under the card's Add
                          button, two small round targets in a stack. */}
                      <View style={s.nameRow}>
                        <Text style={s.idxName} numberOfLines={1}>{labelFor(name)}</Text>
                        <TouchableOpacity
                          onPress={() => remove(name)}
                          hitSlop={{ top: 12, bottom: 12, left: 8, right: 12 }}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${labelFor(name)} from the slider`}
                        >
                          <Icon name="close" size={11} color={theme.muted} />
                        </TouchableOpacity>
                      </View>
                      {lv?.level != null ? (
                        <Text style={s.idxLvl}>
                          {lv.level.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          <Text style={{ color: colorOf(lv.chg) }}>  {pct(lv.chg)}</Text>
                        </Text>
                      ) : split?.note ? (
                        <Text style={s.note} numberOfLines={2}>{split.note}</Text>
                      ) : null}
                    </View>
                  </View>
                  {!p || p === 'loading' ? (
                    <Loading />
                  ) : split && (split.up.length || split.down.length) ? (
                    <View style={s.cols}>
                      <MoverList title="GAINERS" rows={split.up} />
                      <MoverList title="LOSERS" rows={split.down} />
                    </View>
                  ) : (
                    <EmptyState
                      title={name === MARKET ? 'Market movers unavailable' : 'Constituents unavailable'}
                      hint={`${labelFor(name)} — quotes are briefly unreachable. Pull to refresh.`}
                    />
                  )}
                  <TouchableOpacity
                    onPress={() =>
                      navigate('screens', name === MARKET
                        ? { sub: 'screener' }
                        : { sub: 'screener', index: name })
                    }
                    activeOpacity={0.7}
                    accessibilityRole="link"
                    accessibilityLabel={`Open ${labelFor(name)} in the screener`}
                  >
                    <Text style={s.more}>Open in screener ›</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>
        ) : (
          <Loading />
        )}
      </View>
    </Card>
  );
}

const s = StyleSheet.create({
  card: { marginBottom: theme.sp.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headR: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 999, backgroundColor: theme.border2 },
  dotOn: { backgroundColor: theme.brand, width: 16 },
  add: {
    width: 26, height: 26, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.brandSoft, borderWidth: 1, borderColor: theme.brand,
  },
  picker: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 8 },
  pick: {
    borderWidth: 1, borderColor: theme.border2, backgroundColor: theme.surface2,
    borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 4,
  },
  pickTxt: { color: theme.muted2, fontSize: theme.fs.xs, fontWeight: '600' },
  pickNone: { color: theme.muted, fontSize: theme.fs.xs, paddingVertical: 6 },
  panelHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  idxName: { color: theme.muted2, fontSize: theme.fs.xs, fontWeight: '700', letterSpacing: 0.6 },
  idxLvl: { color: theme.text, fontSize: theme.fs.md, fontFamily: theme.mono, fontWeight: '700' },
  note: { color: theme.muted, fontSize: theme.fs.xs, lineHeight: 15 },
  cols: { flexDirection: 'row', gap: theme.sp.md },
  half: { flex: 1, minWidth: 0 },
  colTitle: { color: theme.muted, fontSize: 9, fontWeight: '700', letterSpacing: 0.8, marginBottom: 2 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6,
    paddingVertical: 5, borderTopWidth: 1, borderTopColor: theme.border,
  },
  sym: { color: theme.text, fontSize: theme.fs.xs, fontWeight: '600', flexShrink: 1 },
  chg: { fontSize: theme.fs.xs, fontFamily: theme.mono, fontWeight: '700' },
  more: { color: theme.brand, fontSize: theme.fs.xs, fontWeight: '700', marginTop: 8 },
});
