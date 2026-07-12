import React, { useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { IndexQuote, api } from '../api';
import { theme } from '../theme';

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
      <View style={styles.head}>
        <Text style={styles.title}>
          INDICES <Text style={styles.titleDim}>· LIVE LEVELS · 5-MIN REFRESH</Text>
        </Text>
        {asof ? (
          <Text style={styles.asof}>
            as of {new Date(asof * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        ) : null}
      </View>
      {err ? (
        <View style={styles.center}>
          <Text style={styles.dim}>{err}</Text>
        </View>
      ) : !rows ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} />
        </View>
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
          <View style={styles.row}>
            <Text style={[styles.hcell, styles.nameCol]}>INDEX</Text>
            <Text style={styles.hcell}>LEVEL</Text>
            <Text style={styles.hcell}>DAY %</Text>
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
            <Text style={[styles.dim, { padding: 24 }]}>
              No index data right now — sources may be briefly unavailable.
            </Text>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  head: { paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  title: { color: theme.text, fontFamily: theme.mono, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  titleDim: { color: theme.muted, fontWeight: '400' },
  asof: { color: theme.muted, fontFamily: theme.mono, fontSize: 10, marginLeft: 'auto' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  hcell: { flex: 1, color: theme.muted2, fontFamily: theme.mono, fontSize: 9, letterSpacing: 1, textAlign: 'right' },
  cell: { flex: 1, color: theme.text, fontFamily: theme.mono, fontSize: 12, textAlign: 'right' },
  nameCol: { flex: 2, textAlign: 'left' },
  name: { fontWeight: '700' },
  up: { color: theme.green },
  dn: { color: theme.red },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dim: { color: theme.muted, fontFamily: theme.mono, fontSize: 12 },
});
