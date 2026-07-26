// The ICT/SMC card's chart view: the matched models drawn on price.
//
// Opens *inside* the card's sheet rather than as a second window, so reading a
// setup never costs you your place in the list. Two rules drive the design:
//
//  • Show the model, not the instrument. Each model carries the bar window it
//    was found in (`focus`), and the chart clips to it — a gap from last week
//    opens on last week, not on two years of history.
//  • Context always stays. Selecting one model hides the *other* models'
//    shapes but keeps the dealing range, OTE band, volume imbalances and order
//    blocks, because a sweep read without knowing you are in discount is not
//    an ICT read at all.
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { api, Candle, SmcRec, SmcZone } from '../api';
import { chartHtml, ZONE_STYLE } from '../chartHtml';
import { theme } from '../theme';
import HtmlView from './HtmlView';

const DAY = 86400;
// Bars of breathing room either side of a model's own window.
const PAD_BARS = 6;

export default function SmcChart({ r, onBack, height }: {
  r: SmcRec;
  onBack: () => void;
  height: number;
}) {
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // null = every matched model at once
  const [focusKey, setFocusKey] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.history(r.symbol, '2y', '1d')
      .then((d) => { if (live) setCandles(d.candles || []); })
      .catch(() => { if (live) setErr('Could not load price history for this symbol.'); });
    return () => { live = false; };
  }, [r.symbol]);

  const focused = focusKey ? r.strategies.find((s) => s.key === focusKey) : null;

  // Clip the series to the focused model's window (or, for "All models", to the
  // widest window any matched model needs).
  const shown = useMemo(() => {
    if (!candles?.length) return [];
    const windows = (focused ? [focused] : r.strategies)
      .map((s) => s.focus)
      .filter(Boolean) as { from: number; to: number }[];
    if (!windows.length) return candles.slice(-120);
    const from = Math.min(...windows.map((w) => w.from)) - PAD_BARS * DAY;
    const to = Math.max(...windows.map((w) => w.to)) + PAD_BARS * DAY;
    const clipped = candles.filter((c) => c.t >= from && c.t <= to);
    return clipped.length >= 10 ? clipped : candles.slice(-120);
  }, [candles, focused, r.strategies]);

  const zones = useMemo<SmcZone[]>(() => {
    const all = r.zones || [];
    if (!focusKey) return all;
    return all.filter((z) => z.owner === 'context' || z.owner === focusKey);
  }, [r.zones, focusKey]);

  const html = useMemo(
    () => chartHtml(shown, DAY, [20, 50], null, { smc: { zones, levels: r.levels || [] } }),
    [shown, zones, r.levels],
  );

  // Legend shows only what is actually on screen right now.
  const kinds = useMemo(() => {
    const seen: string[] = [];
    zones.forEach((z) => { if (!seen.includes(z.kind) && ZONE_STYLE[z.kind]) seen.push(z.kind); });
    return seen;
  }, [zones]);

  const span = shown.length
    ? `${new Date(shown[0].t * 1000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} → ${
        new Date(shown[shown.length - 1].t * 1000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`
    : '';

  return (
    <View>
      <View style={s.head}>
        <TouchableOpacity
          onPress={onBack}
          style={s.back}
          hitSlop={10}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Back to the model list"
        >
          <Text style={s.backTxt}>‹ Models</Text>
        </TouchableOpacity>
        <Text style={s.title} numberOfLines={1}>{r.symbol} · models on chart</Text>
      </View>

      {/* Which model's shapes to show. Context geometry stays on regardless. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow}>
        <Chip label="All models" on={!focusKey} onPress={() => setFocusKey(null)} />
        {r.strategies.map((st) => (
          <Chip key={st.key} label={st.label} on={focusKey === st.key} onPress={() => setFocusKey(st.key)} />
        ))}
      </ScrollView>

      {focused ? <Text style={s.note}>{focused.note}</Text> : null}
      {span ? <Text style={s.span}>{span} · {shown.length} daily bars</Text> : null}

      <View style={[s.chartBox, { height }]}>
        {err ? (
          <Text style={s.msg}>{err}</Text>
        ) : !candles ? (
          <View style={s.centre}><ActivityIndicator color={theme.muted} /></View>
        ) : (
          <HtmlView html={html} style={{ flex: 1 }} />
        )}
      </View>

      <View style={s.legend}>
        {kinds.map((k) => (
          <View key={k} style={s.legItem}>
            <View style={[s.swatch, { backgroundColor: ZONE_STYLE[k].line, opacity: 0.85 }]} />
            <Text style={s.legTxt}>{ZONE_STYLE[k].label}</Text>
          </View>
        ))}
      </View>
      <Text style={s.foot}>
        Zones are drawn from the same candles the models were scored on. Levels shown are the
        engine's structural entry, stop and liquidity targets — not advice.
      </Text>
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[s.chip, on && s.chipOn]}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`Show ${label} on the chart`}
    >
      <Text style={[s.chipTxt, on && s.chipTxtOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, marginBottom: theme.sp.sm },
  back: { paddingVertical: 6, paddingRight: 4 },
  backTxt: { color: theme.accent, fontSize: theme.fs.sm, fontWeight: '700' },
  title: { color: theme.text, fontSize: theme.fs.sm, fontWeight: '700', flex: 1 },
  chipRow: { flexGrow: 0, marginBottom: theme.sp.sm },
  chip: {
    borderColor: theme.border2, borderWidth: 1, borderRadius: 999,
    paddingHorizontal: 11, paddingVertical: 6, marginRight: 6,
  },
  chipOn: { borderColor: theme.accent, backgroundColor: theme.surface2 },
  chipTxt: { color: theme.muted2, fontSize: theme.fs.xs + 1, fontWeight: '600' },
  chipTxtOn: { color: theme.text },
  note: { color: theme.muted2, fontSize: theme.fs.xs + 1, lineHeight: 17, marginBottom: 4 },
  span: { color: theme.muted, fontSize: theme.fs.xs, fontFamily: theme.mono, marginBottom: 6 },
  chartBox: {
    borderColor: theme.border, borderWidth: 1, borderRadius: theme.radius.md,
    overflow: 'hidden', backgroundColor: theme.bg,
  },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  msg: { color: theme.muted, fontSize: theme.fs.sm, textAlign: 'center', padding: theme.sp.lg },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginTop: theme.sp.sm },
  legItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  legTxt: { color: theme.muted, fontSize: theme.fs.xs },
  foot: { color: theme.muted, fontSize: theme.fs.xs, lineHeight: 15, marginTop: theme.sp.sm },
});
