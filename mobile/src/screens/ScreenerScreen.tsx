import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api, Quote, UniverseSymbol } from '../api';
import { theme } from '../theme';

const PRICE_BATCH = 50; // /ltp caps at 100; fetch the first chunk for the list

export default function ScreenerScreen() {
  const [symbols, setSymbols] = useState<UniverseSymbol[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const u = await api.universe();
      setSymbols(u.symbols);
      if (u.symbols.length) {
        const first = u.symbols.slice(0, PRICE_BATCH).map((s) => s.symbol);
        try {
          setQuotes(await api.ltp(first));
        } catch {
          /* prices are best-effort; list still renders */
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load universe');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return symbols;
    return symbols.filter(
      (s) => s.symbol.includes(q) || s.name.toUpperCase().includes(q),
    );
  }, [symbols, query]);

  const renderRow = ({ item }: { item: UniverseSymbol }) => {
    const q = quotes[item.symbol];
    const chg = q?.chg;
    const chgColor =
      chg == null ? theme.muted : chg >= 0 ? theme.green : theme.red;
    const chgText =
      chg == null ? '—' : `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`;
    return (
      <View style={styles.row}>
        <View style={styles.symWrap}>
          <Text style={styles.sym}>{item.symbol}</Text>
          <Text style={styles.exch}>{item.exchange}</Text>
        </View>
        <View style={styles.priceWrap}>
          <Text style={styles.price}>
            {q?.price != null ? `₹${q.price.toLocaleString('en-IN')}` : '—'}
          </Text>
          <Text style={[styles.chg, { color: chgColor }]}>{chgText}</Text>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
        <Text style={styles.dim}>Loading universe…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        placeholder="Search symbol / name…"
        placeholderTextColor={theme.muted}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="characters"
      />
      {error ? (
        <Text style={styles.error}>{error} — is the backend reachable?</Text>
      ) : null}
      <Text style={styles.count}>
        {filtered.length} / {symbols.length} symbols
        {symbols.length === 0 ? ' · no live data (connect to the VM)' : ''}
      </Text>
      <FlatList
        data={filtered}
        keyExtractor={(s) => s.symbol}
        renderItem={renderRow}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.accent}
          />
        }
        ListEmptyComponent={
          <Text style={styles.dim}>
            Nothing to show yet. Pull to refresh once the backend has data.
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 12 },
  center: {
    flex: 1,
    backgroundColor: theme.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  search: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 8,
    color: theme.text,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: 12,
    fontFamily: theme.mono,
    fontSize: 13,
  },
  count: {
    color: theme.muted,
    fontSize: 11,
    fontFamily: theme.mono,
    marginVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  symWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sym: { color: theme.text, fontWeight: '700', fontSize: 14 },
  exch: {
    color: theme.muted2,
    fontSize: 9,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
    fontFamily: theme.mono,
  },
  priceWrap: { alignItems: 'flex-end' },
  price: { color: theme.text, fontFamily: theme.mono, fontSize: 13 },
  chg: { fontFamily: theme.mono, fontSize: 11, marginTop: 2 },
  dim: { color: theme.muted, fontFamily: theme.mono, fontSize: 12, textAlign: 'center', marginTop: 20 },
  error: { color: theme.red, fontFamily: theme.mono, fontSize: 11, marginTop: 8 },
});
