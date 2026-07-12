import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, api, Candle } from '../api';
import { chartHtml, MA_CONFIG, DEFAULT_MA } from '../chartHtml';
import HtmlView from '../components/HtmlView';
import OwnerGate from '../components/OwnerGate';
import StockDetail from '../components/StockDetail';
import SymbolInput from '../components/SymbolInput';
import { Row } from '../screener';
import { theme } from '../theme';
import { Btn, ChipBtn, Loading } from '../ui';
import { addSymbol, loadWatchlist, normSymbol, removeSymbol } from '../watchlist';

const PERIODS: { label: string; period: string; interval: string; barSec: number }[] = [
  { label: '5D', period: '5d', interval: '15m', barSec: 900 },
  { label: '1M', period: '1mo', interval: '1d', barSec: 86400 },
  { label: '6M', period: '6mo', interval: '1d', barSec: 86400 },
  { label: '1Y', period: '1y', interval: '1d', barSec: 86400 },
  { label: '5Y', period: '5y', interval: '1wk', barSec: 604800 },
];

const MA_KEY = 'taureye.chart.ma.v1';

// Normal charting — native lightweight-charts fed by the Flask /history API.
// Extends the base chart with toggleable SMA overlays + a volume panel (inside
// the iframe), a watchlist star, an inline owner-gated alert form, and a Report
// button that opens the shared stock-detail modal.
export default function ChartScreen() {
  const [input, setInput] = useState('RELIANCE');
  const [symbol, setSymbol] = useState('RELIANCE');
  const [pIdx, setPIdx] = useState(3); // 1Y
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Feature state
  const [maSet, setMaSet] = useState<number[]>(DEFAULT_MA);
  const [watch, setWatch] = useState<string[]>([]);
  const [showAlert, setShowAlert] = useState(false);
  const [alertType, setAlertType] = useState<Alert['type']>('price_above');
  const [alertPrice, setAlertPrice] = useState('');
  const [alertMsg, setAlertMsg] = useState('');
  const [reportRow, setReportRow] = useState<Row | null>(null);
  const [reportBusy, setReportBusy] = useState(false);

  const p = PERIODS[pIdx];
  const watched = watch.includes(symbol);

  // Load persisted MA set + watchlist once.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(MA_KEY);
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) setMaSet(arr.filter((x) => typeof x === 'number'));
        }
      } catch {
        /* keep default MA set */
      }
      setWatch(await loadWatchlist());
    })();
  }, []);

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

  // Reset the inline alert form whenever the symbol changes.
  useEffect(() => {
    setShowAlert(false);
    setAlertMsg('');
    setAlertPrice('');
  }, [symbol]);

  const toggleMA = useCallback((period: number) => {
    setMaSet((prev) => {
      const next = prev.includes(period) ? prev.filter((x) => x !== period) : [...prev, period];
      AsyncStorage.setItem(MA_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const toggleWatch = useCallback(async () => {
    setWatch(watched ? await removeSymbol(watch, symbol) : await addSymbol(watch, symbol));
  }, [watch, watched, symbol]);

  const lastClose = useMemo(() => {
    for (let i = candles.length - 1; i >= 0; i--) {
      if (candles[i].c != null) return candles[i].c as number;
    }
    return null;
  }, [candles]);

  const openAlert = useCallback(() => {
    setAlertMsg('');
    setShowAlert((v) => {
      const next = !v;
      if (next && !alertPrice && lastClose != null) setAlertPrice(String(lastClose));
      return next;
    });
  }, [alertPrice, lastClose]);

  const submitAlert = useCallback(async () => {
    const v = parseFloat(alertPrice);
    if (!isFinite(v) || v <= 0) {
      setAlertMsg('Enter a valid price threshold.');
      return;
    }
    try {
      await api.alertsCreate(symbol, alertType, v);
      setAlertMsg(`Alert set: ${symbol} ${alertType === 'price_above' ? '≥' : '≤'} ₹${v}`);
      setAlertPrice('');
    } catch (e) {
      setAlertMsg(e instanceof Error ? e.message : 'Could not create alert.');
    }
  }, [alertPrice, alertType, symbol]);

  const openReport = useCallback(async () => {
    setReportBusy(true);
    try {
      const res = await api.scan([symbol]);
      const sc = (res.data && res.data[symbol]) || {};
      setReportRow({ sym: symbol, ...sc });
    } catch {
      setReportRow({ sym: symbol });
    } finally {
      setReportBusy(false);
    }
  }, [symbol]);

  const html = useMemo(() => chartHtml(candles, p.barSec, maSet), [candles, p.barSec, maSet]);

  return (
    <View style={styles.container}>
      <SymbolInput
        containerStyle={styles.searchWrap}
        inputStyle={styles.search}
        value={input}
        onChangeText={setInput}
        onSelect={(s) => setSymbol(normSymbol(s))}
        onSubmit={() => setSymbol(normSymbol(input))}
        placeholder="Symbol — e.g. RELIANCE"
      />

      {/* Action row: watchlist star, alert, report */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.action, watched && styles.actionOn]}
          onPress={toggleWatch}
          activeOpacity={0.75}
        >
          <Text style={[styles.actionTxt, watched && styles.actionTxtOn]}>
            {watched ? '★ Watching' : '☆ Watch'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.action, showAlert && styles.actionOn]}
          onPress={openAlert}
          activeOpacity={0.75}
        >
          <Text style={[styles.actionTxt, showAlert && styles.actionTxtOn]}>＋ Alert</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.action}
          onPress={openReport}
          activeOpacity={0.75}
          disabled={reportBusy}
        >
          <Text style={styles.actionTxt}>{reportBusy ? 'Loading…' : '▦ Report'}</Text>
        </TouchableOpacity>
      </View>

      {/* Inline, owner-gated create-alert form */}
      {showAlert ? (
        <View style={styles.alertBox}>
          <OwnerGate title="Alerts">
            <View style={styles.alertForm}>
              <Text style={styles.alertLead}>Notify when {symbol} price is</Text>
              <View style={styles.alertRow}>
                <ChipBtn
                  label="Above"
                  on={alertType === 'price_above'}
                  onPress={() => setAlertType('price_above')}
                />
                <ChipBtn
                  label="Below"
                  on={alertType === 'price_below'}
                  onPress={() => setAlertType('price_below')}
                />
                <TextInput
                  value={alertPrice}
                  onChangeText={setAlertPrice}
                  placeholder="₹ price"
                  placeholderTextColor={theme.muted}
                  keyboardType="numeric"
                  style={styles.alertInput}
                  onSubmitEditing={submitAlert}
                />
                <Btn label="ADD" onPress={submitAlert} style={styles.alertAdd} />
              </View>
              {alertMsg ? <Text style={styles.alertMsg}>{alertMsg}</Text> : null}
            </View>
          </OwnerGate>
        </View>
      ) : null}

      {/* Moving-average overlay toggles */}
      <View style={styles.maRow}>
        <Text style={styles.maLabel}>MA</Text>
        {MA_CONFIG.map((m) => {
          const on = maSet.includes(m.period);
          return (
            <TouchableOpacity
              key={m.period}
              style={[styles.maChip, on && { borderColor: m.color }]}
              onPress={() => toggleMA(m.period)}
              activeOpacity={0.75}
            >
              <View style={[styles.maDot, { backgroundColor: on ? m.color : theme.border2 }]} />
              <Text style={[styles.maTxt, on && { color: m.color }]}>{m.period}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Timeframe chips */}
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

      {reportRow ? <StockDetail row={reportRow} onClose={() => setReportRow(null)} /> : null}
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
  actions: {
    flexDirection: 'row',
    gap: theme.sp.sm,
    paddingHorizontal: theme.sp.md,
    paddingTop: theme.sp.md,
  },
  action: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm + 2,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionOn: { borderColor: theme.accent },
  actionTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '600' },
  actionTxtOn: { color: theme.text },
  alertBox: {
    marginHorizontal: theme.sp.md,
    marginTop: theme.sp.sm,
    backgroundColor: theme.surface,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.md,
  },
  alertForm: { padding: theme.sp.md },
  alertLead: { color: theme.muted2, fontSize: theme.fs.sm, marginBottom: theme.sp.sm },
  alertRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.sp.sm },
  alertInput: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    color: theme.text,
    fontFamily: theme.mono,
    fontSize: theme.fs.md,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 8,
    minWidth: 96,
    flexGrow: 1,
  },
  alertAdd: { paddingHorizontal: theme.sp.md, paddingVertical: 9 },
  alertMsg: { color: theme.muted2, fontSize: theme.fs.sm, marginTop: theme.sp.sm, fontFamily: theme.mono },
  maRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.sm,
    paddingHorizontal: theme.sp.md,
    paddingTop: theme.sp.md,
  },
  maLabel: {
    color: theme.muted,
    fontSize: theme.fs.xs + 1,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  maChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  maDot: { width: 8, height: 8, borderRadius: 4 },
  maTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontFamily: theme.mono },
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
