import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { api, Quote } from '../api';
import { theme } from '../theme';
import { Btn, EmptyState, Loading, ScreenTitle } from '../ui';
import { addSymbol, loadWatchlist, removeSymbol } from '../watchlist';

export default function WatchlistScreen() {
  const [list, setList] = useState<string[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchQuotes = useCallback(async (syms: string[]) => {
    if (!syms.length) {
      setQuotes({});
      return;
    }
    setError(null);
    try {
      setQuotes(await api.ltp(syms));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch quotes');
    }
  }, []);

  useEffect(() => {
    (async () => {
      const saved = await loadWatchlist();
      setList(saved);
      await fetchQuotes(saved);
      setLoading(false);
    })();
  }, [fetchQuotes]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchQuotes(list);
    setRefreshing(false);
  }, [list, fetchQuotes]);

  const onAdd = useCallback(async () => {
    const next = await addSymbol(list, input);
    setInput('');
    if (next !== list) {
      setList(next);
      await fetchQuotes(next);
    }
  }, [list, input, fetchQuotes]);

  const onRemove = useCallback(
    async (sym: string) => {
      const next = await removeSymbol(list, sym);
      setList(next);
    },
    [list],
  );

  const renderRow = ({ item }: { item: string }) => {
    const q = quotes[item];
    const chg = q?.chg;
    const chgColor = chg == null ? theme.muted : chg >= 0 ? theme.green : theme.red;
    const chgText = chg == null ? '—' : `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`;
    return (
      <View style={styles.row}>
        <Text style={styles.sym}>{item}</Text>
        <View style={styles.priceWrap}>
          <Text style={styles.price}>
            {q?.price != null ? `₹${q.price.toLocaleString('en-IN')}` : '—'}
          </Text>
          <Text style={[styles.chg, { color: chgColor }]}>{chgText}</Text>
        </View>
        <TouchableOpacity
          onPress={() => onRemove(item)}
          style={styles.del}
          hitSlop={10}
          activeOpacity={0.75}
        >
          <Text style={styles.delText}>✕</Text>
        </TouchableOpacity>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <Loading label="Loading your watchlist…" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenTitle title="Watchlist" sub="Saved symbols with live quotes" />

      <View style={styles.body}>
        <View style={styles.addRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Add symbol — e.g. TCS"
            placeholderTextColor={theme.muted}
            autoCapitalize="characters"
            returnKeyType="done"
            onSubmitEditing={onAdd}
          />
          <Btn label="Add" onPress={onAdd} />
        </View>

        {error ? <Text style={styles.error}>{error} — is the backend reachable?</Text> : null}

        <FlatList
          data={list}
          keyExtractor={(s) => s}
          renderItem={renderRow}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />
          }
          ListEmptyComponent={
            <EmptyState
              title="Your watchlist is empty — add a symbol above."
              hint="Symbols are saved on this device and show live quotes."
            />
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  body: { flex: 1, paddingHorizontal: theme.sp.lg },
  center: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', gap: theme.sp.sm, marginBottom: theme.sp.xs },
  input: {
    flex: 1,
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    color: theme.text,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 10,
    fontFamily: theme.mono,
    fontSize: theme.fs.sm + 1,
  },
  error: { color: theme.red, fontSize: theme.fs.sm, marginTop: theme.sp.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingVertical: theme.sp.md,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  sym: { color: theme.text, fontWeight: '700', fontSize: theme.fs.md, fontFamily: theme.mono, flex: 1 },
  priceWrap: { alignItems: 'flex-end', marginRight: theme.sp.lg },
  price: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm + 1, textAlign: 'right' },
  chg: { fontFamily: theme.mono, fontSize: theme.fs.sm, marginTop: 2, textAlign: 'right' },
  del: { padding: theme.sp.xs },
  delText: { color: theme.muted, fontSize: theme.fs.md + 1 },
});
