import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { HolidaysResp, api } from '../api';
import { theme } from '../theme';
import { Card, EmptyState, Loading, ScreenTitle } from '../ui';

export default function HolidaysScreen() {
  const [data, setData] = useState<HolidaysResp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.holidays().then(setData).catch((e) => setErr(e instanceof Error ? e.message : 'Failed'));
  }, []);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <View style={styles.container}>
      <ScreenTitle title="Holidays" sub="NSE market holidays · 2026" />
      {err ? (
        <EmptyState
          title="Couldn't load the holiday calendar"
          hint={`${err} — check that the backend is reachable and try again.`}
        />
      ) : !data ? (
        <Loading label="Loading holiday calendar…" />
      ) : (
        <ScrollView>
          <Card style={styles.statusCard}>
            <View style={[styles.dot, { backgroundColor: data.open ? theme.green : theme.red }]} />
            <View style={{ flex: 1 }}>
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
          </Card>
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
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.md,
    marginHorizontal: theme.sp.lg,
    marginBottom: theme.sp.lg,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusTxt: { color: theme.text, fontSize: theme.fs.md, fontWeight: '700' },
  statusSub: { color: theme.muted, fontSize: theme.fs.sm, marginTop: 3 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: theme.sp.lg,
    paddingVertical: theme.sp.md - 2,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    gap: theme.sp.md,
  },
  past: { opacity: 0.45 },
  pastTxt: {},
  date: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm, width: 100 },
  day: { color: theme.muted2, fontSize: theme.fs.sm, width: 90 },
  name: { color: theme.text, fontSize: theme.fs.md, flex: 1 },
  note: { color: theme.muted, fontSize: theme.fs.sm, padding: theme.sp.lg, lineHeight: 17 },
});
