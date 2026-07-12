import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api, Candle } from '../api';
import { chartHtml } from '../chartHtml';
import HtmlView from '../components/HtmlView';
import SymbolInput from '../components/SymbolInput';
import { theme } from '../theme';
import { ChipBtn, Loading } from '../ui';

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
      <SymbolInput
        containerStyle={styles.searchWrap}
        inputStyle={styles.search}
        value={input}
        onChangeText={setInput}
        onSelect={(s) => setSymbol(s.trim().toUpperCase().replace(/^NSE:/, ''))}
        onSubmit={() => setSymbol(input.trim().toUpperCase().replace(/^NSE:/, ''))}
        placeholder="Symbol — e.g. RELIANCE"
      />
      <View style={styles.chips}>
        {PERIODS.map((pp, i) => (
          <ChipBtn key={pp.label} label={pp.label} on={i === pIdx} onPress={() => setPIdx(i)} />
        ))}
      </View>

      {error ? <Text style={styles.error}>{error} — is the backend reachable?</Text> : null}

      <View style={styles.chartWrap}>
        {loading ? (
          <Loading label={`Loading ${symbol}…`} />
        ) : (
          <HtmlView key={html.length + symbol + p.label} html={html} style={styles.web} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  searchWrap: { marginHorizontal: theme.sp.md, marginTop: theme.sp.md },
  search: {
    backgroundColor: theme.surface,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    color: theme.text,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 10,
    fontFamily: theme.mono,
    fontSize: theme.fs.md,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.sp.sm,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.md,
  },
  error: {
    color: theme.red,
    fontSize: theme.fs.sm,
    lineHeight: 17,
    paddingHorizontal: theme.sp.md,
    paddingBottom: theme.sp.sm,
  },
  chartWrap: { flex: 1 },
  web: { flex: 1, backgroundColor: theme.bg },
});
