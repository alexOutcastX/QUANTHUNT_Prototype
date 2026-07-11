import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { api, Candle } from '../api';
import { chartHtml } from '../chartHtml';
import HtmlView from '../components/HtmlView';
import { theme } from '../theme';

const PERIODS: { label: string; period: string; interval: string; barSec: number }[] = [
  { label: '5D', period: '5d', interval: '15m', barSec: 900 },
  { label: '1M', period: '1mo', interval: '1d', barSec: 86400 },
  { label: '6M', period: '6mo', interval: '1d', barSec: 86400 },
  { label: '1Y', period: '1y', interval: '1d', barSec: 86400 },
  { label: '5Y', period: '5y', interval: '1wk', barSec: 604800 },
];

// Normal charting — native lightweight-charts fed by the Flask /history API.
export default function ChartScreen() {
  const [input, setInput] = useState('RELIANCE');
  const [symbol, setSymbol] = useState('RELIANCE');
  const [pIdx, setPIdx] = useState(3); // 1Y
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const p = PERIODS[pIdx];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.history(symbol, p.period, p.interval);
      setCandles(Array.isArray(res.candles) ? res.candles : []);
      if (res.error) setError(res.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load history');
      setCandles([]);
    } finally {
      setLoading(false);
    }
  }, [symbol, p.period, p.interval]);

  useEffect(() => {
    load();
  }, [load]);

  const html = useMemo(() => chartHtml(candles, p.barSec), [candles, p.barSec]);

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        value={input}
        onChangeText={setInput}
        onSubmitEditing={() => setSymbol(input.trim().toUpperCase().replace(/^NSE:/, ''))}
        placeholder="Symbol — e.g. RELIANCE"
        placeholderTextColor={theme.muted}
        autoCapitalize="characters"
        returnKeyType="go"
      />
      <View style={styles.chips}>
        {PERIODS.map((pp, i) => (
          <TouchableOpacity
            key={pp.label}
            style={[styles.chip, i === pIdx && styles.chipActive]}
            onPress={() => setPIdx(i)}
          >
            <Text style={[styles.chipText, i === pIdx && styles.chipTextActive]}>{pp.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {error ? <Text style={styles.error}>{error} — is the backend reachable?</Text> : null}

      <View style={styles.chartWrap}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.accent} />
            <Text style={styles.dim}>Loading {symbol}…</Text>
          </View>
        ) : (
          <HtmlView key={html.length + symbol + p.label} html={html} style={styles.web} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  search: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 8,
    color: theme.text,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginHorizontal: 12,
    marginTop: 12,
    fontFamily: theme.mono,
    fontSize: 13,
  },
  chips: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  chip: {
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.muted2, fontFamily: theme.mono, fontSize: 12 },
  chipTextActive: { color: theme.bg, fontWeight: '700' },
  error: {
    color: theme.red,
    fontFamily: theme.mono,
    fontSize: 11,
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  chartWrap: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  dim: { color: theme.muted, fontFamily: theme.mono, fontSize: 12 },
  web: { flex: 1, backgroundColor: theme.bg },
});
