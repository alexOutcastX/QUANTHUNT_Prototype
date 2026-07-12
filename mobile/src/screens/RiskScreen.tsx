import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { RiskHolding, RiskReport, api } from '../api';
import { Btn, Card, EmptyState, Loading, ScreenTitle, SectionTitle, StatTile } from '../ui';
import { theme } from '../theme';

type Row = { symbol: string; qty: string };
const SEED: Row[] = [
  { symbol: 'RELIANCE', qty: '10' },
  { symbol: 'TCS', qty: '5' },
  { symbol: 'HDFCBANK', qty: '15' },
];

const pct = (v: number | null | undefined) => (v == null ? '—' : (v * 100).toFixed(2) + '%');
const inr = (v: number | null | undefined) =>
  v == null ? '—' : '₹' + Math.round(v).toLocaleString('en-IN');

export default function RiskScreen() {
  const [rows, setRows] = useState<Row[]>(SEED);
  const [conf, setConf] = useState(0.95);
  const [report, setReport] = useState<RiskReport | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((prev) => [...prev, { symbol: '', qty: '' }]);
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  const run = () => {
    const holdings: RiskHolding[] = rows
      .map((r) => ({ symbol: r.symbol.trim().toUpperCase().replace(/^NSE:/, ''), qty: Number(r.qty) || 0 }))
      .filter((h) => h.symbol && h.qty > 0);
    if (!holdings.length) {
      setReport(null);
      return;
    }
    setBusy(true);
    setReport(undefined);
    api
      .riskPortfolio(holdings, conf)
      .then(setReport)
      .catch(() => setReport(null))
      .finally(() => setBusy(false));
  };

  return (
    <View style={styles.container}>
      <ScreenTitle title="Portfolio risk" sub="VaR · volatility · beta · drawdown · correlation" />
      <ScrollView contentContainerStyle={styles.body}>
        <SectionTitle>Holdings</SectionTitle>
        <Card>
          {rows.map((r, i) => (
            <View key={i} style={styles.editRow}>
              <TextInput
                value={r.symbol}
                onChangeText={(t) => setRow(i, { symbol: t })}
                placeholder="SYMBOL"
                placeholderTextColor={theme.muted}
                autoCapitalize="characters"
                style={[styles.cell, styles.symCell]}
              />
              <TextInput
                value={r.qty}
                onChangeText={(t) => setRow(i, { qty: t.replace(/[^0-9.]/g, '') })}
                placeholder="Qty"
                placeholderTextColor={theme.muted}
                keyboardType="numeric"
                style={[styles.cell, styles.qtyCell]}
              />
              <TouchableOpacity onPress={() => removeRow(i)} hitSlop={8} activeOpacity={0.6}>
                <Text style={styles.rowX}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity onPress={addRow} activeOpacity={0.7} style={styles.addBtn}>
            <Text style={styles.addTxt}>+ Add holding</Text>
          </TouchableOpacity>
        </Card>

        <View style={styles.confRow}>
          <Text style={styles.confLbl}>VaR confidence</Text>
          {[0.9, 0.95, 0.99].map((c) => (
            <TouchableOpacity
              key={c}
              style={[styles.confChip, conf === c && styles.confChipOn]}
              onPress={() => setConf(c)}
              activeOpacity={0.75}
            >
              <Text style={[styles.confTxt, conf === c && styles.confTxtOn]}>{Math.round(c * 100)}%</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Btn label={busy ? 'Computing…' : 'Run risk analysis'} onPress={run} disabled={busy} />

        {busy ? (
          <Loading label="Fetching 1Y history + computing…" />
        ) : report === undefined ? null : !report || !report.ok ? (
          <EmptyState
            title="Couldn't compute risk"
            hint={report?.reason || 'Need at least two symbols with a year of price history.'}
          />
        ) : (
          <View style={styles.report}>
            <SectionTitle>Portfolio · {report.days} trading days</SectionTitle>
            <View style={styles.statRow}>
              <StatTile label="Market value" value={inr(report.value)} />
              <StatTile
                label={`VaR ${Math.round((report.conf || 0.95) * 100)}% (1d)`}
                value={inr(report.var_amount)}
                sub={pct(report.var_pct)}
                color={theme.red}
              />
              <StatTile label="Volatility (ann.)" value={pct(report.volatility_annual)} />
            </View>
            <View style={styles.statRow}>
              <StatTile label="Max drawdown" value={pct(report.drawdown?.mdd)} color={theme.red} />
              <StatTile label="Sharpe" value={report.sharpe == null ? '—' : report.sharpe.toFixed(2)} />
              <StatTile
                label="Beta vs NIFTY"
                value={report.beta == null ? '—' : report.beta.toFixed(2)}
                color={report.beta == null ? undefined : report.beta > 1 ? theme.red : theme.green}
              />
            </View>

            <SectionTitle>Weights</SectionTitle>
            <Card>
              {Object.entries(report.weights || {})
                .sort((a, b) => b[1] - a[1])
                .map(([s, w]) => (
                  <View key={s} style={styles.wRow}>
                    <Text style={styles.wSym}>{s}</Text>
                    <View style={styles.wBarTrack}>
                      <View style={[styles.wBar, { width: `${Math.min(w * 100, 100)}%` }]} />
                    </View>
                    <Text style={styles.wPct}>{pct(w)}</Text>
                  </View>
                ))}
            </Card>

            {report.correlations && Object.keys(report.correlations).length ? (
              <>
                <SectionTitle>Correlation to portfolio</SectionTitle>
                <Card>
                  {Object.entries(report.correlations)
                    .sort((a, b) => b[1] - a[1])
                    .map(([s, c]) => (
                      <View key={s} style={styles.cRow}>
                        <Text style={styles.wSym}>{s}</Text>
                        <Text
                          style={[
                            styles.cVal,
                            { color: c > 0.7 ? theme.red : c < 0.3 ? theme.green : theme.muted2 },
                          ]}
                        >
                          {c.toFixed(2)}
                        </Text>
                      </View>
                    ))}
                </Card>
              </>
            ) : null}

            {report.symbols_missing && report.symbols_missing.length ? (
              <Text style={styles.warn}>No price history for: {report.symbols_missing.join(', ')}</Text>
            ) : null}
            <Text style={styles.note}>
              Historical 1-day VaR at {Math.round((report.conf || 0.95) * 100)}% from the empirical return
              distribution (1Y daily). Beta vs NIFTY 50. Estimates — not investment advice.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  body: { padding: theme.sp.lg, paddingBottom: 48 },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.md,
    paddingVertical: theme.sp.xs,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  cell: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    color: theme.text,
    fontFamily: theme.mono,
    fontSize: theme.fs.md,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm,
  },
  symCell: { flex: 1, letterSpacing: 1 },
  qtyCell: { width: 84, textAlign: 'right' },
  rowX: { color: theme.muted, fontSize: theme.fs.md, paddingHorizontal: 4 },
  addBtn: { paddingVertical: theme.sp.md, alignItems: 'center' },
  addTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '700' },
  confRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, marginVertical: theme.sp.md },
  confLbl: { color: theme.muted2, fontSize: theme.fs.sm, marginRight: theme.sp.xs },
  confChip: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
  },
  confChipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  confTxt: { color: theme.muted2, fontSize: theme.fs.xs + 1, fontFamily: theme.mono },
  confTxtOn: { color: theme.onAccent, fontWeight: '700' },
  report: { marginTop: theme.sp.md },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginBottom: theme.sp.sm },
  wRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.md, paddingVertical: theme.sp.sm },
  wSym: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm, width: 92 },
  wBarTrack: { flex: 1, height: 8, backgroundColor: theme.surface2, borderRadius: 999, overflow: 'hidden' },
  wBar: { height: 8, backgroundColor: theme.accent, borderRadius: 999 },
  wPct: { color: theme.muted2, fontFamily: theme.mono, fontSize: theme.fs.sm, width: 58, textAlign: 'right' },
  cRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.sp.sm,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  cVal: { fontFamily: theme.mono, fontSize: theme.fs.md, fontWeight: '700' },
  warn: { color: theme.red, fontSize: theme.fs.sm, marginTop: theme.sp.md },
  note: { color: theme.muted, fontSize: theme.fs.sm, marginTop: theme.sp.md, lineHeight: 18 },
});
