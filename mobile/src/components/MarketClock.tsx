// The clock at the top of the home page.
//
// It used to show the local time and a separate "Market closed" pill, both
// India-only. Indian traders watch overnight US and morning Asia, and "is
// Tokyo open yet" is a question the page could answer without being asked
// twice — so the clock takes a market, and shows that market's local time,
// date and session state. India is the default and the app is unchanged for
// anyone who never touches it.
//
// The chip row above the picker is the part that earns its place: eight dots
// answer "what is open right now" at a glance, without opening anything.
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dropdown } from '../ui';
import { theme } from '../theme';
import {
  DEFAULT_MARKET,
  MARKETS,
  fmtSession,
  marketByKey,
  marketStatus,
  zonedNow,
} from '../markets';

const KEY = 'taureye.clock.market.v1';

export default function MarketClock({ indiaOpen }: { indiaOpen?: boolean | null }) {
  const [sel, setSel] = useState(DEFAULT_MARKET);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => {
        if (v && MARKETS.some((m) => m.key === v)) setSel(v);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const pick = (k: string) => {
    setSel(k);
    AsyncStorage.setItem(KEY, k).catch(() => {});
  };

  const market = marketByKey(sel);
  // Every market's state, recomputed once a minute rather than once a second:
  // eight Intl formatters per tick is real work for a row of dots that can
  // only change on a minute boundary.
  const minute = Math.floor(now.getTime() / 60000);
  const all = useMemo(
    () =>
      MARKETS.map((m) => {
        const at = zonedNow(m.tz, new Date(minute * 60000), m.zoneLabel);
        return { m, st: marketStatus(m, at, m.key === 'IN' ? indiaOpen : null) };
      }),
    [minute, indiaOpen],
  );

  const at = zonedNow(market.tz, now, market.zoneLabel);
  const st = marketStatus(market, at, market.holidaysKnown ? indiaOpen : null);

  return (
    <View>
      <View style={s.line}>
        <Text style={s.date}>{at.date || '—'}</Text>
        <Text style={s.sep}>·</Text>
        <Text style={s.clock}>{at.time}</Text>
        {at.zone ? <Text style={s.zone}>{at.zone}</Text> : null}
        <View style={[s.pill, { borderColor: st.open ? theme.green : theme.border2 }]}>
          <View style={[s.dot, { backgroundColor: st.open ? theme.green : theme.red }]} />
          <Text style={s.pillTxt}>{st.note}</Text>
        </View>
      </View>

      {/* What is open right now, everywhere, without opening the picker. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.chips}
      >
        {all.map(({ m, st: ms }) => {
          const on = m.key === sel;
          return (
            <TouchableOpacity
              key={m.key}
              style={[s.chip, on && s.chipOn]}
              onPress={() => pick(m.key)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${m.index}, ${m.place}. ${ms.note}. Show this market's clock`}
            >
              <View style={[s.chipDot, { backgroundColor: ms.open ? theme.green : theme.red }]} />
              <Text style={[s.chipTxt, on && s.chipTxtOn]}>{m.index}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={s.pickRow}>
        <Dropdown
          label="Market clock"
          value={sel}
          options={MARKETS.map((m) => ({ key: m.key, label: `${m.place} · ${m.index}` }))}
          onChange={pick}
          style={s.dd}
        />
        <Text style={s.hours} numberOfLines={1}>
          {fmtSession(market)} local
          {/* Said plainly, because it is the one thing this widget cannot know:
              only the NSE calendar is published in the app. */}
          {market.holidaysKnown ? '' : ' · holidays not tracked'}
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  date: { color: theme.muted2, fontSize: theme.fs.sm },
  sep: { color: theme.muted },
  clock: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.md, fontWeight: '700' },
  zone: { color: theme.muted, fontFamily: theme.mono, fontSize: theme.fs.xs },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1,
    borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 3,
  },
  dot: { width: 7, height: 7, borderRadius: 999 },
  pillTxt: { color: theme.muted2, fontSize: theme.fs.xs, fontWeight: '600' },
  chips: { flexDirection: 'row', gap: 6, paddingVertical: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface2,
    borderRadius: theme.radius.pill, paddingHorizontal: 9, paddingVertical: 4,
  },
  chipOn: { borderColor: theme.brand, backgroundColor: theme.brandSoft },
  chipDot: { width: 6, height: 6, borderRadius: 999 },
  chipTxt: { color: theme.muted2, fontSize: theme.fs.xs, fontWeight: '600' },
  chipTxtOn: { color: theme.brand },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  dd: { minWidth: 200 },
  hours: { color: theme.muted, fontSize: theme.fs.xs, fontFamily: theme.mono },
});
