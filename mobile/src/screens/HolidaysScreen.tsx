import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { HolidaysResp, api } from '../api';
import { theme } from '../theme';

export default function HolidaysScreen() {
  const [data, setData] = useState<HolidaysResp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.holidays().then(setData).catch((e) => setErr(e instanceof Error ? e.message : 'Failed'));
  }, []);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <View style={styles.container}>
      <View style={styles.head}>
        <Text style={styles.title}>
          MARKET HOLIDAYS <Text style={styles.titleDim}>· NSE · 2026</Text>
        </Text>
      </View>
      {err ? (
        <View style={styles.center}>
          <Text style={styles.dim}>{err}</Text>
        </View>
      ) : !data ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : (
        <ScrollView>
          <View style={styles.statusCard}>
            <View style={[styles.dot, { backgroundColor: data.open ? theme.green : theme.red }]} />
            <View>
              <Text style={styles.statusTxt}>
                Market is {data.open ? 'OPEN' : 'CLOSED'}
              </Text>
              <Text style={styles.statusSub}>
                {data.now_ist} IST
                {data.next_holiday
                  ? ` · next holiday: ${data.next_holiday.name} (${data.next_holiday.date})`
                  : ''}
              </Text>
            </View>
          </View>
          {data.holidays.map((h) => {
            const past = h.date < today;
            return (
              <View key={h.date} style={[styles.row, past && styles.past]}>
                <Text style={[styles.date, past && styles.pastTxt]}>{h.date}</Text>
                <Text style={[styles.day, past && styles.pastTxt]}>{h.day}</Text>
                <Text style={[styles.name, past && styles.pastTxt]}>{h.name}</Text>
              </View>
            );
          })}
          <Text style={styles.note}>{data.note}</Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  head: { paddingHorizontal: 14, paddingVertical: 12 },
  title: { color: theme.text, fontFamily: theme.mono, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  titleDim: { color: theme.muted, fontWeight: '400' },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 14,
    marginBottom: 14,
    padding: 14,
    backgroundColor: theme.surface,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 8,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusTxt: { color: theme.text, fontFamily: theme.mono, fontSize: 14, fontWeight: '700' },
  statusSub: { color: theme.muted, fontFamily: theme.mono, fontSize: 10, marginTop: 3 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    gap: 12,
  },
  past: { opacity: 0.45 },
  pastTxt: {},
  date: { color: theme.text, fontFamily: theme.mono, fontSize: 12, width: 100 },
  day: { color: theme.muted2, fontFamily: theme.mono, fontSize: 11, width: 90 },
  name: { color: theme.text, fontFamily: theme.mono, fontSize: 12, flex: 1 },
  note: { color: theme.muted, fontFamily: theme.mono, fontSize: 9, padding: 14, lineHeight: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dim: { color: theme.muted, fontFamily: theme.mono, fontSize: 12 },
});
