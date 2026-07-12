import React, { useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { IndexQuote, api } from '../api';
import { FX_PAIRS, FxRates, convert, getFxRates } from '../fx';
import { theme } from '../theme';
import { ChipBtn, EmptyState, Loading, ScreenTitle } from '../ui';

// Currency is computed client-side from a live FX feed; the other three tabs
// pull their category from the /indices backend route.
type MktCat = 'domestic' | 'international' | 'depository';
type Tab = MktCat | 'currency';

const TABS: { key: Tab; label: string }[] = [
  { key: 'domestic', label: 'Domestic' },
  { key: 'international', label: 'Global' },
  { key: 'currency', label: 'Currency' },
  { key: 'depository', label: 'Depository' },
];

type MktState = { rows: IndexQuote[] | null; asof: number | null; err: string | null };
const EMPTY: MktState = { rows: null, asof: null, err: null };

export default function IndicesScreen() {
  const [tab, setTab] = useState<Tab>('domestic');
  const [mkt, setMkt] = useState<Record<MktCat, MktState>>({
    domestic: EMPTY,
    international: EMPTY,
    depository: EMPTY,
  });
  const [fx, setFx] = useState<FxRates | null>(null);
  const [fxLoaded, setFxLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Fetch one market category (domestic uses the default, no query param).
  const loadMkt = async (cat: MktCat) => {
    try {
      const d = await api.indices(cat === 'domestic' ? undefined : cat);
      setMkt((m) => ({ ...m, [cat]: { rows: d.indices, asof: d.asof, err: null } }));
    } catch (e) {
      setMkt((m) => ({
        ...m,
        [cat]: { ...m[cat], err: e instanceof Error ? e.message : 'Failed to load indices' },
      }));
    }
  };

  // Lazy-load a market tab the first time it's opened (domestic loads on mount).
  useEffect(() => {
    if (tab !== 'currency' && mkt[tab].rows === null && mkt[tab].err === null) {
      loadMkt(tab);
    }
  }, [tab]);

  // Keep the active market tab fresh every 5 min.
  useEffect(() => {
    if (tab === 'currency') return;
    const t = setInterval(() => loadMkt(tab), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [tab]);

  // Live currency rates (free, no-key feed) — refresh every 30 min like the SaaS.
  useEffect(() => {
    let alive = true;
    getFxRates().then((r) => {
      if (!alive) return;
      setFx(r);
      setFxLoaded(true);
    });
    const id = setInterval(() => getFxRates(true).then((r) => alive && setFx(r)), 30 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Currency rows computed live from USD-based cross rates.
  const fxRows = useMemo(() => {
    if (!fx) return [] as { pair: string; rate: number }[];
    return FX_PAIRS.map(([from, to]) => ({ pair: `${from}/${to}`, rate: convert(fx, 1, from, to) }))
      .filter((p): p is { pair: string; rate: number } => p.rate != null);
  }, [fx]);

  const onRefresh = async () => {
    setRefreshing(true);
    if (tab === 'currency') {
      const r = await getFxRates(true);
      setFx(r);
      setFxLoaded(true);
    } else {
      await loadMkt(tab);
    }
    setRefreshing(false);
  };

  const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const fmtRate = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 4 });

  // A signed percentage cell that tolerates null (short-history ADRs).
  const pctCell = (v: number | null | undefined, digits: number) =>
    v == null ? (
      <Text style={styles.cell}>—</Text>
    ) : (
      <Text style={[styles.cell, v >= 0 ? styles.up : styles.dn]}>
        {(v >= 0 ? '+' : '') + v.toFixed(digits)}%
      </Text>
    );

  const active = tab === 'currency' ? null : mkt[tab];
  const asof = active?.asof ?? null;

  // Per-tab count shown in the chip once the tab's data is in.
  const countFor = (key: Tab): number | null => {
    if (key === 'currency') return fxLoaded ? fxRows.length : null;
    return mkt[key].rows ? mkt[key].rows!.length : null;
  };

  const subFor: Record<Tab, string> = {
    domestic: 'NSE / BSE · refreshes every 5 min',
    international: 'Global indices · refreshes every 5 min',
    currency: 'Live FX · free public feed',
    depository: 'US-listed Indian ADRs (USD)',
  };

  const right =
    tab === 'currency'
      ? fx?.updated
        ? <Text style={styles.asof}>{fx.updated}</Text>
        : undefined
      : asof
        ? (
          <Text style={styles.asof}>
            as of{' '}
            {new Date(asof * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        )
        : undefined;

  return (
    <View style={styles.container}>
      <ScreenTitle title="Indices" sub={subFor[tab]} right={right} />

      <View style={styles.tabs}>
        {TABS.map((t) => {
          const c = countFor(t.key);
          return (
            <ChipBtn
              key={t.key}
              label={t.label + (c != null ? ` ${c}` : '')}
              on={tab === t.key}
              onPress={() => setTab(t.key)}
            />
          );
        })}
      </View>

      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />
        }
      >
        {tab === 'currency' ? (
          !fxLoaded ? (
            <Loading label="Loading currency rates…" />
          ) : fxRows.length === 0 ? (
            <EmptyState
              title="Couldn't load currency rates"
              hint="The public FX feed is briefly unavailable — pull to refresh in a moment."
            />
          ) : (
            <>
              <Text style={styles.note}>Live cross rates from a free public feed (USD-based).</Text>
              <View style={styles.headRow}>
                <Text style={[styles.hcell, styles.nameCol]}>Pair</Text>
                <Text style={styles.hcell}>Rate</Text>
              </View>
              {fxRows.map((p) => (
                <View key={p.pair} style={styles.row}>
                  <Text style={[styles.cell, styles.nameCol, styles.name]}>{p.pair}</Text>
                  <Text style={styles.cell}>{fmtRate(p.rate)}</Text>
                </View>
              ))}
            </>
          )
        ) : active!.err ? (
          <EmptyState
            title="Couldn't load index levels"
            hint={`${active!.err} — pull to refresh once the backend is reachable.`}
          />
        ) : active!.rows === null ? (
          <Loading label="Loading index levels…" />
        ) : active!.rows.length === 0 ? (
          <EmptyState
            title="No index data right now"
            hint="Sources may be briefly unavailable — pull to refresh in a moment."
          />
        ) : (
          <>
            <View style={styles.headRow}>
              <Text style={[styles.hcell, styles.nameCol]}>Index</Text>
              <Text style={styles.hcell}>Level</Text>
              <Text style={styles.hcell}>Day %</Text>
              <Text style={styles.hcell}>1Y %</Text>
            </View>
            {active!.rows.map((r) => (
              <View key={r.key} style={styles.row}>
                <Text style={[styles.cell, styles.nameCol, styles.name]}>{r.name}</Text>
                <Text style={styles.cell}>{fmt(r.level)}</Text>
                {pctCell(r.chg, 2)}
                {pctCell(r.y1, 1)}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  asof: { color: theme.muted, fontFamily: theme.mono, fontSize: theme.fs.xs },
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.sp.sm,
    paddingHorizontal: theme.sp.lg,
    paddingBottom: theme.sp.md,
  },
  note: {
    color: theme.muted,
    fontSize: theme.fs.xs + 1,
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.sm,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.sm,
    backgroundColor: theme.surface2,
    borderTopColor: theme.border,
    borderTopWidth: 1,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.md,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  hcell: {
    flex: 1,
    color: theme.muted2,
    fontSize: theme.fs.xs + 1,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    textAlign: 'right',
  },
  cell: { flex: 1, color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm, textAlign: 'right' },
  nameCol: { flex: 2, textAlign: 'left' },
  name: { fontWeight: '700' },
  up: { color: theme.green },
  dn: { color: theme.red },
});
