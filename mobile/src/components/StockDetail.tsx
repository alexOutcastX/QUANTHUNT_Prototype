import React, { useEffect, useState } from 'react';
import {
  Linking,
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
import { useResponsive } from '../responsive';
import { Row, calcSignal } from '../screener';
import { theme } from '../theme';
import { Card, EmptyState, Loading, SectionTitle } from '../ui';
import HtmlView from './HtmlView';

// Timeframes, each fetching the deepest history its feed allows: Yahoo caps
// 5m/15m at 60 days and 1h (which also feeds the 4h resample) at 2 years;
// daily and up go back 5-10+ years.
const TFS: { k: string; interval: string; period: string; barSec: number }[] = [
  { k: '5m', interval: '5m', period: '60d', barSec: 300 },
  { k: '15m', interval: '15m', period: '60d', barSec: 900 },
  { k: '1h', interval: '1h', period: '2y', barSec: 3600 },
  { k: '4h', interval: '4h', period: '2y', barSec: 14400 },
  { k: '1D', interval: '1d', period: '5y', barSec: 86400 },
  { k: '1W', interval: '1wk', period: '10y', barSec: 604800 },
  { k: '1M', interval: '1mo', period: 'max', barSec: 2592000 },
];

// TradingView deep link for the symbol (indices map to TV's index tickers).
const TV_MAP: Record<string, string> = {
  'NIFTY 50': 'NSE:NIFTY', 'NIFTY': 'NSE:NIFTY',
  'NIFTY BANK': 'NSE:BANKNIFTY', 'BANKNIFTY': 'NSE:BANKNIFTY',
  'BSE SENSEX': 'BSE:SENSEX', 'SENSEX': 'BSE:SENSEX',
  'NIFTY IT': 'NSE:CNXIT', 'NIFTY 100': 'NSE:CNX100', 'NIFTY 500': 'NSE:CNX500',
  'NIFTY MIDCAP 100': 'NSE:NIFTYMIDCAP100', 'NIFTY SMALLCAP 100': 'NSE:NIFTYSMLCAP100',
};
const tvUrl = (sym: string) => {
  const s = sym.trim().toUpperCase();
  const tv = TV_MAP[s] || 'NSE:' + s.replace(/\s+/g, '');
  return 'https://www.tradingview.com/chart/?symbol=' + encodeURIComponent(tv);
};

const num = (v: number | null | undefined, d = 2) =>
  v == null || !isFinite(v) ? '—' : v.toFixed(d);
const pct = (v: number | null | undefined, d = 1) =>
  v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + '%';
const money = (v: number | null | undefined) =>
  v == null || !isFinite(v) ? '—' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

// Per-stock research view: 6-month chart, live technicals from the scan row,
// and fundamentals — the RN counterpart of the web app's report modal.
export default function StockDetail({ row, onClose }: { row: Row; onClose: () => void }) {
  const { isDesktop } = useResponsive();
  const [candles, setCandles] = useState<Candle[]>([]);
  const [fund, setFund] = useState<Fundamentals | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tf, setTf] = useState('1D');
  // Callers like the Recommendations / SMC lists open us with only { sym, price }
  // — no live technicals. Detect that and pull the full scan row ourselves so the
  // Technicals / Pivots / Signals sections aren't all "—".
  const [live, setLive] = useState<Row | null>(null);
  const [tries, setTries] = useState(0);
  const needsScan = row.rsi == null && row.d50 == null;
  const tfDef = TFS.find((t) => t.k === tf) || TFS[4];

  // Fundamentals + live scan row: once per symbol.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [f, scan] = await Promise.all([
        api.fundamentals(row.sym).catch(() => null),
        needsScan ? api.scan([row.sym]).catch(() => null) : Promise.resolve(null),
      ]);
      if (!alive) return;
      if (f && !f.error) setFund(f);
      const sr = scan?.data?.[row.sym];
      if (sr) setLive({ ...row, ...(sr as Partial<Row>) } as Row);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.sym]);

  // Chart history: refetched per timeframe (deepest window the feed allows).
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setErr(null);
    api.history(row.sym, tfDef.period, tfDef.interval)
      .then((hist) => {
        if (!alive) return;
        if (hist && Array.isArray(hist.candles) && hist.candles.length) setCandles(hist.candles);
        else { setCandles([]); setErr('Chart data unavailable'); }
      })
      .catch(() => { if (alive) { setCandles([]); setErr('Chart data unavailable'); } })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.sym, tf, tries]);

  // Prefer the freshly-scanned row (full technicals) over the sparse caller row.
  const r = live || row;
  const sig = calcSignal(r);
  const sigColor = sig === 'buy' ? theme.green : sig === 'sell' ? theme.red : theme.muted2;
  const chgColor = r.chg == null ? theme.muted : r.chg >= 0 ? theme.green : theme.red;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <View style={styles.symRow}>
              <Text style={styles.sym}>{row.sym}</Text>
              <View style={[styles.sigPill, { borderColor: sigColor }]}>
                <Text style={[styles.sigPillTxt, { color: sigColor }]}>{sig.toUpperCase()}</Text>
              </View>
            </View>
            <View style={styles.priceRow}>
              <Text style={styles.price}>{money(r.price)}</Text>
              <Text style={[styles.chg, { color: chgColor }]}>{pct(r.chg, 2)}</Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={12} activeOpacity={0.75} style={styles.closeBtn}>
            <Text style={styles.close}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {/* Timeframes (deepest history each feed allows) + TradingView link */}
          <View style={styles.tfRow}>
            {TFS.map((t) => (
              <TouchableOpacity
                key={t.k}
                style={[styles.tfChip, tf === t.k && styles.tfChipOn]}
                onPress={() => setTf(t.k)}
                activeOpacity={0.75}
              >
                <Text style={[styles.tfTxt, tf === t.k && styles.tfTxtOn]}>{t.k}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.tfChip, styles.tvBtn]}
              onPress={() => Linking.openURL(tvUrl(row.sym)).catch(() => {})}
              activeOpacity={0.75}
            >
              <Text style={styles.tvTxt}>TradingView ⤴</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.chartBox, { height: isDesktop ? 500 : 400 }]}>
            {busy ? (
              <Loading label={`Loading ${row.sym} chart…`} />
            ) : candles.length ? (
              <HtmlView html={chartHtml(candles, tfDef.barSec, undefined, undefined, { panes: true })} style={styles.web} />
            ) : (
              <View style={styles.center}>
                <EmptyState
                  icon="◫"
                  title={err || 'No chart data'}
                  hint="Price history could not be fetched — the data feed may be busy."
                />
                <TouchableOpacity style={styles.retryBtn} onPress={() => setTries((t) => t + 1)} activeOpacity={0.75}>
                  <Text style={styles.retryTxt}>⟳ Retry</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          <SectionTitle>Technicals (live)</SectionTitle>
          <Card style={styles.sectionCard}>
            <View style={styles.grid}>
              <Cell k="RSI (14)" v={num(r.rsi, 0)} />
              <Cell k="MACD hist" v={num(r.macd, 2)} />
              <Cell k="W%R" v={num(r.willr, 0)} />
              <Cell k="Boll %B" v={num(r.bollb, 2)} />
              <Cell k="vs 20 DMA" v={pct(r.d20)} c />
              <Cell k="vs 50 DMA" v={pct(r.d50)} c />
              <Cell k="vs 200 DMA" v={pct(r.d200)} c />
              <Cell k="Rel. volume" v={r.relvol != null ? r.relvol.toFixed(1) + 'x' : '—'} />
              <Cell k="Beta (1Y)" v={num(r.beta)} />
              <Cell k="52w high" v={money(r.high52)} />
              <Cell k="52w low" v={money(r.low52)} />
              <Cell
                k="Squeeze"
                v={r.sqzFire ? 'FIRED' : r.sqzOn ? 'ON' : r.sqzOn === false ? 'off' : '—'}
              />
            </View>
          </Card>

          {(() => {
            const events: string[] = [];
            if (r.golden_cross) events.push('Golden cross (50↑200)');
            if (r.death_cross) events.push('Death cross (50↓200)');
            if (r.cross_20_50_up) events.push('20-DMA crossed ↑ 50');
            if (r.cross_20_50_down) events.push('20-DMA crossed ↓ 50');
            if (r.macd_bull_cross) events.push('MACD bullish cross');
            if (r.macd_bear_cross) events.push('MACD bearish cross');
            if (r.gap_up) events.push('Gapped up');
            if (r.gap_down) events.push('Gapped down');
            if (r.new_high_52w) events.push('New 52-week high');
            if (r.new_low_52w) events.push('New 52-week low');
            if (r.volume_spike) events.push('Volume spike');
            if (r.cam_break_up) events.push('Camarilla H4 breakout');
            if (r.cam_break_down) events.push('Camarilla L4 breakdown');
            return events.length ? (
              <>
                <SectionTitle>Signals today</SectionTitle>
                <View style={styles.sigWrap}>
                  {events.map((e, i) => (
                    <View key={i} style={styles.sigChip}>
                      <Text style={styles.sigChipTxt}>{e}</Text>
                    </View>
                  ))}
                </View>
              </>
            ) : null;
          })()}

          <SectionTitle>Pivots</SectionTitle>
          <Card style={styles.sectionCard}>
            <View style={styles.grid}>
              <Cell k="S1 / S2 / S3" v={`${num(r.s1)} / ${num(r.s2)} / ${num(r.s3)}`} wide />
              <Cell k="R1 / R2 / R3" v={`${num(r.r1)} / ${num(r.r2)} / ${num(r.r3)}`} wide />
              <Cell k="Camarilla H3 / H4" v={`${num(r.cam_h3)} / ${num(r.cam_h4)}`} wide />
              <Cell k="Camarilla L3 / L4" v={`${num(r.cam_l3)} / ${num(r.cam_l4)}`} wide />
            </View>
          </Card>

          <SectionTitle>Fundamentals</SectionTitle>
          {fund ? (
            <Card style={styles.sectionCard}>
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
            </Card>
          ) : (
            <Card style={styles.sectionCard}>
              <Text style={styles.dim}>
                {busy ? 'Loading fundamentals…' : 'Fundamentals unavailable for this stock right now.'}
              </Text>
            </Card>
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
    backgroundColor: theme.bg,
    borderColor: theme.border2,
    borderWidth: 1,
    borderTopLeftRadius: theme.radius.lg + 2,
    borderTopRightRadius: theme.radius.lg + 2,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.sp.lg,
    backgroundColor: theme.surface,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  symRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm },
  sym: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.xl, fontWeight: '800' },
  sigPill: { borderWidth: 1, borderRadius: theme.radius.pill, paddingHorizontal: 9, paddingVertical: 2 },
  sigPillTxt: { fontSize: theme.fs.xs + 1, fontFamily: theme.mono, fontWeight: '800', letterSpacing: 0.5 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: theme.sp.sm, marginTop: 5 },
  price: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.lg, fontWeight: '700' },
  chg: { fontFamily: theme.mono, fontSize: theme.fs.md, fontWeight: '700' },
  closeBtn: { width: 34, height: 34, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface2, borderColor: theme.border, borderWidth: 1 },
  close: { color: theme.muted2, fontSize: theme.fs.md },
  sigWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginBottom: theme.sp.sm },
  sigChip: { backgroundColor: theme.brandSoft, borderColor: theme.brand, borderWidth: 1, borderRadius: theme.radius.pill, paddingHorizontal: 11, paddingVertical: 4 },
  sigChipTxt: { color: theme.brand, fontSize: theme.fs.xs + 1, fontWeight: '700' },
  body: { padding: theme.sp.lg, paddingBottom: theme.sp.xl + 16 },
  tfRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginBottom: theme.sp.sm, alignItems: 'center' },
  tfChip: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  tfChipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  tfTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontFamily: theme.mono, fontWeight: '700' },
  tfTxtOn: { color: theme.onAccent },
  tvBtn: { marginLeft: 'auto', borderColor: theme.brand },
  tvTxt: { color: theme.brand, fontSize: theme.fs.sm, fontWeight: '700' },
  chartBox: {
    height: 260,
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
  },
  web: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  retryBtn: {
    marginTop: theme.sp.sm,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.sp.lg,
    paddingVertical: 7,
  },
  retryTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '700' },
  dim: { color: theme.muted, fontSize: theme.fs.sm, lineHeight: 18, marginBottom: theme.sp.sm },
  sectionCard: { paddingBottom: theme.sp.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '33.33%', marginBottom: theme.sp.md, paddingRight: theme.sp.sm },
  cellWide: { width: '66.66%' },
  cellK: { color: theme.muted2, fontSize: theme.fs.xs + 1, letterSpacing: 0.3 },
  cellV: { fontSize: theme.fs.md, fontFamily: theme.mono, marginTop: 3 },
  desc: { color: theme.muted2, fontSize: theme.fs.sm, lineHeight: 19, marginTop: theme.sp.xs, marginBottom: theme.sp.sm },
  signals: { color: theme.green, fontSize: theme.fs.sm, lineHeight: 19, marginBottom: theme.sp.sm },
});
