import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  DMA_CHOICES, DmaPeriod, DmaSide, MACD_DEFAULTS, MACD_LABELS, MacdMode,
  MacdParams, SIDE_LABELS, describeMacd,
} from '../macdStrategy';
import { theme } from '../theme';
import { Btn, Card, Dropdown } from '../ui';

/**
 * The MACD strategy's settings. Shown only while that strategy is selected.
 *
 * Deliberately dropdowns and steppers rather than free text: every field here
 * feeds a filter, and a half-typed "2" in an RSI box would silently empty the
 * results list while the user was still typing the "0" of "20".
 */
export default function MacdControls({
  value, onChange, matched, total,
}: {
  value: MacdParams;
  onChange: (p: MacdParams) => void;
  matched?: number;
  total?: number;
}) {
  const set = <K extends keyof MacdParams>(k: K, v: MacdParams[K]) =>
    onChange({ ...value, [k]: v });

  const step = (k: 'rsi_min' | 'rsi_max' | 'near_pct', by: number, lo: number, hi: number) => {
    const next = Math.max(lo, Math.min(hi, value[k] + by));
    // RSI min can never cross above max — an inverted band matches nothing and
    // looks like a broken screen rather than a bad setting.
    if (k === 'rsi_min' && next > value.rsi_max) return;
    if (k === 'rsi_max' && next < value.rsi_min) return;
    set(k, next);
  };

  return (
    <Card style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.label}>Moving average</Text>
        <Dropdown
          value={value.dma}
          options={DMA_CHOICES.map((d) => ({ key: d, label: `${d}-DMA` }))}
          onChange={(v) => set('dma', v as DmaPeriod)}
        />
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Price position</Text>
        <Dropdown
          value={value.side}
          options={(Object.keys(SIDE_LABELS) as DmaSide[]).map((k) => ({ key: k, label: SIDE_LABELS[k] }))}
          onChange={(v) => set('side', v as DmaSide)}
        />
      </View>

      {value.side === 'approaching' || value.side === 'just_above' ? (
        <View style={styles.row}>
          <Text style={styles.label}>Within</Text>
          <View style={styles.stepper}>
            <Btn label="−" onPress={() => step('near_pct', -1, 1, 30)} />
            <Text style={styles.stepVal}>{value.near_pct}%</Text>
            <Btn label="+" onPress={() => step('near_pct', 1, 1, 30)} />
          </View>
        </View>
      ) : null}

      <View style={styles.row}>
        <Text style={styles.label}>MACD</Text>
        <Dropdown
          value={value.macd}
          options={(Object.keys(MACD_LABELS) as MacdMode[]).map((k) => ({ key: k, label: MACD_LABELS[k] }))}
          onChange={(v) => set('macd', v as MacdMode)}
        />
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>RSI band</Text>
        <View style={styles.stepper}>
          <Btn label="−" onPress={() => step('rsi_min', -5, 0, 100)} />
          <Text style={styles.stepVal}>{value.rsi_min}</Text>
          <Btn label="+" onPress={() => step('rsi_min', 5, 0, 100)} />
          <Text style={styles.dash}>to</Text>
          <Btn label="−" onPress={() => step('rsi_max', -5, 0, 100)} />
          <Text style={styles.stepVal}>{value.rsi_max}</Text>
          <Btn label="+" onPress={() => step('rsi_max', 5, 0, 100)} />
        </View>
      </View>

      <Text style={styles.summary}>
        {describeMacd(value)}
        {matched != null && total != null ? `  ·  ${matched} of ${total} match` : ''}
      </Text>

      <View style={styles.actions}>
        <Btn label="Reset" onPress={() => onChange({ ...MACD_DEFAULTS })} />
        <Btn label="RSI off" onPress={() => onChange({ ...value, rsi_min: 0, rsi_max: 100 })} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  label: { color: theme.muted, fontSize: theme.fs.sm, minWidth: 110 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepVal: {
    fontFamily: theme.mono, color: theme.text, fontSize: theme.fs.md,
    minWidth: 34, textAlign: 'center',
  },
  dash: { color: theme.muted, fontSize: theme.fs.sm, marginHorizontal: 2 },
  summary: { color: theme.muted, fontSize: theme.fs.sm, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
});
