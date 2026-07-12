import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { IndexQuote, api } from '../api';
import { theme } from '../theme';

// Scrolling ticker strip (desktop shell): live index levels marquee.
// Pure RN Animated so it works on web and native alike.
export default function TickerStrip() {
  const [rows, setRows] = useState<IndexQuote[]>([]);
  const x = useRef(new Animated.Value(0)).current;
  const [w, setW] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () => api.indices().then((d) => alive && setRows(d.indices)).catch(() => {});
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!w) return;
    x.setValue(0);
    const anim = Animated.loop(
      Animated.timing(x, {
        toValue: -w,
        duration: Math.max(20000, w * 18),
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [w, rows.length, x]);

  if (!rows.length) return null;

  const cells = (key: string) =>
    rows.map((r) => (
      <Text key={key + r.key} style={styles.item}>
        <Text style={styles.sym}>{r.name}</Text>{' '}
        <Text style={styles.lvl}>{r.level.toLocaleString('en-IN', { maximumFractionDigits: 1 })}</Text>{' '}
        <Text style={r.chg >= 0 ? styles.up : styles.dn}>
          {(r.chg >= 0 ? '▲' : '▼') + Math.abs(r.chg).toFixed(2) + '%'}
        </Text>
        <Text style={styles.sep}>{'   ·   '}</Text>
      </Text>
    ));

  return (
    <View style={styles.strip}>
      <Animated.View
        style={[styles.track, { transform: [{ translateX: x }] }]}
      >
        {/* two copies back-to-back for a seamless loop; width of one copy drives the loop */}
        <View style={styles.copy} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
          {cells('a')}
        </View>
        <View style={styles.copy}>{cells('b')}</View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    height: 26,
    overflow: 'hidden',
    backgroundColor: theme.surface,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    justifyContent: 'center',
  },
  track: { flexDirection: 'row' },
  copy: { flexDirection: 'row', paddingHorizontal: 8 },
  item: { fontFamily: theme.mono, fontSize: 10, lineHeight: 26 },
  sym: { color: theme.muted2, fontWeight: '700' },
  lvl: { color: theme.text },
  up: { color: theme.green },
  dn: { color: theme.red },
  sep: { color: theme.border2 },
});
