import React, { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { IndexQuote, api } from '../api';
import { theme } from '../theme';
import { EmptyState, Loading, ScreenTitle } from '../ui';

export default function IndicesScreen() {
  const [rows, setRows] = useState<IndexQuote[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [asof, setAsof] = useState<number | null>(null);

  const load = async () => {
    try {
      const d = await api.indices();
      setRows(d.indices);
      setAsof(d.asof);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load indices');
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

  return (
    <View style={styles.container}>
      <ScreenTitle
        title="Indices"
        sub="Live levels · refreshes every 5 min"
        right={
          asof ? (
            <Text style={styles.asof}>
              as of{' '}
              {new Date(asof * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </Text>
          ) : undefined
        }
      />
      {err ? (
        <EmptyState
          title="Couldn't load index levels"
          hint={`${err} — pull to refresh once the backend is reachable.`}
        />
      ) : !rows ? (
        <Loading label="Loading index levels…" />
      ) : (
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
              tintColor={theme.accent}
            />
          }
        >
          <View style={styles.headRow}>
            <Text style={[styles.hcell, styles.nameCol]}>Index</Text>
            <Text style={styles.hcell}>Level</Text>
            <Text style={styles.hcell}>Day %</Text>
            <Text style={styles.hcell}>1Y %</Text>
          </View>
          {rows.map((r) => (
            <View key={r.key} style={styles.row}>
              <Text style={[styles.cell, styles.nameCol, styles.name]}>{r.name}</Text>
              <Text style={styles.cell}>{fmt(r.level)}</Text>
              <Text style={[styles.cell, r.chg >= 0 ? styles.up : styles.dn]}>
                {(r.chg >= 0 ? '+' : '') + r.chg.toFixed(2)}%
              </Text>
              <Text style={[styles.cell, r.y1 >= 0 ? styles.up : styles.dn]}>
                {(r.y1 >= 0 ? '+' : '') + r.y1.toFixed(1)}%
              </Text>
            </View>
          ))}
          {!rows.length ? (
            <EmptyState
              title="No index data right now"
              hint="Sources may be briefly unavailable — pull to refresh in a moment."
            />
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  asof: { color: theme.muted, fontFamily: theme.mono, fontSize: theme.fs.xs },
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
