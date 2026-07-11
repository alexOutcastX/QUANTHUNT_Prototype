import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
        <TouchableOpacity onPress={() => onRemove(item)} style={styles.del} hitSlop={10}>
          <Text style={styles.delText}>✕</Text>
        </TouchableOpacity>
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

  return (
    <View style={styles.container}>
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
        <TouchableOpacity style={styles.addBtn} onPress={onAdd}>
          <Text style={styles.addBtnText}>Add</Text>
        </TouchableOpacity>
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
          <Text style={styles.empty}>
            Your watchlist is empty. Add a symbol above — it's saved on this device and shows live
            quotes.
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 12 },
  center: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 4 },
  input: {
    flex: 1,
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 8,
    color: theme.text,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontFamily: theme.mono,
    fontSize: 13,
  },
  addBtn: {
    backgroundColor: theme.accent,
    borderRadius: 8,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  addBtnText: { color: theme.bg, fontWeight: '700', fontSize: 13 },
  error: { color: theme.red, fontFamily: theme.mono, fontSize: 11, marginTop: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  sym: { color: theme.text, fontWeight: '700', fontSize: 14, flex: 1 },
  priceWrap: { alignItems: 'flex-end', marginRight: 16 },
  price: { color: theme.text, fontFamily: theme.mono, fontSize: 13 },
  chg: { fontFamily: theme.mono, fontSize: 11, marginTop: 2 },
  del: { padding: 4 },
  delText: { color: theme.muted2, fontSize: 15 },
  empty: {
    color: theme.muted,
    fontFamily: theme.mono,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 30,
    lineHeight: 18,
    paddingHorizontal: 16,
  },
});
