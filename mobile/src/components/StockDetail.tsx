import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Candle, Fundamentals, api } from '../api';
import { chartHtml } from '../chartHtml';
import { Row, calcSignal } from '../screener';
import { theme } from '../theme';
import HtmlView from './HtmlView';

const num = (v: number | null | undefined, d = 2) =>
  v == null || !isFinite(v) ? '—' : v.toFixed(d);
const pct = (v: number | null | undefined, d = 1) =>
  v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + '%';
const money = (v: number | null | undefined) =>
  v == null || !isFinite(v) ? '—' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

// Per-stock research view: 6-month chart, live technicals from the scan row,
// and fundamentals — the RN counterpart of the web app's report modal.
export default function StockDetail({ row, onClose }: { row: Row; onClose: () => void }) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [fund, setFund] = useState<Fundamentals | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [hist, f] = await Promise.all([
        api.history(row.sym, '6mo', '1d').catch(() => null),
        api.fundamentals(row.sym).catch(() => null),
      ]);
      if (!alive) return;
      if (hist && Array.isArray(hist.candles)) setCandles(hist.candles);
      else setErr('Chart data unavailable');
      if (f && !f.error) setFund(f);
      setBusy(false);
    })();
    return () => {
      alive = false;
    };
  }, [row.sym]);

  const sig = calcSignal(row);
  const sigColor = sig === 'buy' ? theme.green : sig === 'sell' ? theme.red : theme.muted2;
  const chgColor = row.chg == null ? theme.muted : row.chg >= 0 ? theme.green : theme.red;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sym}>
              {row.sym} <Text style={[styles.sig, { color: sigColor }]}>{sig.toUpperCase()}</Text>
            </Text>
            <Text style={styles.price}>
              {money(row.price)}{' '}
              <Text style={{ color: chgColor }}>{pct(row.chg, 2)}</Text>
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.chartBox}>
            {busy ? (
              <View style={styles.center}>
                <ActivityIndicator color={theme.accent} />
              </View>
            ) : candles.length ? (
              <HtmlView html={chartHtml(candles, 86400)} style={styles.web} />
            ) : (
              <View style={styles.center}>
                <Text style={styles.dim}>{err || 'No chart data'}</Text>
              </View>
            )}
          </View>

          <Text style={styles.section}>Technicals (live)</Text>
          <View style={styles.grid}>
            <Cell k="RSI (14)" v={num(row.rsi, 0)} />
            <Cell k="MACD hist" v={num(row.macd, 2)} />
            <Cell k="W%R" v={num(row.willr, 0)} />
            <Cell k="Boll %B" v={num(row.bollb, 2)} />
            <Cell k="vs 20 DMA" v={pct(row.d20)} c />
            <Cell k="vs 50 DMA" v={pct(row.d50)} c />
            <Cell k="vs 200 DMA" v={pct(row.d200)} c />
            <Cell k="Rel. volume" v={row.relvol != null ? row.relvol.toFixed(1) + 'x' : '—'} />
            <Cell k="Beta (1Y)" v={num(row.beta)} />
            <Cell k="52w high" v={money(row.high52)} />
            <Cell k="52w low" v={money(row.low52)} />
            <Cell
              k="Squeeze"
              v={row.sqzFire ? 'FIRED' : row.sqzOn ? 'ON' : row.sqzOn === false ? 'off' : '—'}
            />
          </View>

          <Text style={styles.section}>Pivots</Text>
          <View style={styles.grid}>
            <Cell k="S1 / S2 / S3" v={`${num(row.s1)} / ${num(row.s2)} / ${num(row.s3)}`} wide />
            <Cell k="R1 / R2 / R3" v={`${num(row.r1)} / ${num(row.r2)} / ${num(row.r3)}`} wide />
          </View>

          <Text style={styles.section}>Fundamentals</Text>
          {fund ? (
            <>
              <View style={styles.grid}>
                <Cell k="P/E" v={num(fund.pe)} />
                <Cell k="Fwd P/E" v={num(fund.forward_pe)} />
                <Cell k="P/B" v={num(fund.pb)} />
                <Cell k="EPS" v={num(fund.eps)} />
                <Cell k="ROE" v={fund.roe != null ? fund.roe + '%' : '—'} />
                <Cell k="ROCE" v={fund.roce != null ? fund.roce + '%' : '—'} />
                <Cell k="D/E" v={num(fund.debt_equity)} />
                <Cell k="Div yield" v={fund.dividend_yield != null ? fund.dividend_yield + '%' : '—'} />
                <Cell k="Mkt cap" v={fund.market_cap_cr != null ? '₹' + fund.market_cap_cr.toLocaleString('en-IN') + ' cr' : '—'} />
                <Cell k="Sector" v={fund.sector || '—'} wide />
              </View>
              {fund.description ? <Text style={styles.desc}>{fund.description}</Text> : null}
            </>
          ) : (
            <Text style={styles.dim}>{busy ? 'Loading…' : 'Fundamentals unavailable.'}</Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Cell({ k, v, wide, c }: { k: string; v: string; wide?: boolean; c?: boolean }) {
  const color =
    c && v !== '—' ? (v.startsWith('+') ? theme.green : theme.red) : theme.text;
  return (
    <View style={[styles.cell, wide && styles.cellWide]}>
      <Text style={styles.cellK}>{k}</Text>
      <Text style={[styles.cellV, { color }]} numberOfLines={1}>
        {v}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    top: 50,
    backgroundColor: theme.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  sym: { color: theme.text, fontSize: 17, fontWeight: '800' },
  sig: { fontSize: 12, fontFamily: theme.mono, fontWeight: '700' },
  price: { color: theme.text, fontFamily: theme.mono, fontSize: 14, marginTop: 3 },
  close: { color: theme.muted2, fontSize: 17, padding: 4 },
  body: { padding: 16, paddingBottom: 40 },
  chartBox: {
    height: 260,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  web: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dim: { color: theme.muted, fontFamily: theme.mono, fontSize: 12 },
  section: {
    color: theme.accent,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 18,
    marginBottom: 8,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '33.33%', marginBottom: 12, paddingRight: 8 },
  cellWide: { width: '66.66%' },
  cellK: { color: theme.muted2, fontSize: 10, fontFamily: theme.mono },
  cellV: { fontSize: 13, fontFamily: theme.mono, marginTop: 2 },
  desc: { color: theme.muted2, fontSize: 12, lineHeight: 18, marginTop: 4 },
});
