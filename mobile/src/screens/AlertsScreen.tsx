import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Alert, Quote, api } from '../api';
import OwnerGate from '../components/OwnerGate';
import SymbolInput from '../components/SymbolInput';
import { LocalAlert, loadLocalAlerts, removeLocalAlert } from '../localalerts';
import { Btn, Card, EmptyState, Loading, ScreenTitle, SectionTitle } from '../ui';
import { theme } from '../theme';

const TYPES: { key: Alert['type']; label: string; unit: string }[] = [
  { key: 'price_above', label: 'Price ≥', unit: '₹' },
  { key: 'price_below', label: 'Price ≤', unit: '₹' },
  { key: 'pct_above', label: 'Day % ≥', unit: '%' },
  { key: 'pct_below', label: 'Day % ≤', unit: '%' },
  { key: 'rsi_above', label: 'RSI ≥', unit: '' },
  { key: 'rsi_below', label: 'RSI ≤', unit: '' },
];
const labelFor = (t: Alert['type']) => TYPES.find((x) => x.key === t)?.label || t;

export default function AlertsScreen() {
  return (
    <View style={styles.container}>
      <ScreenTitle title="Alerts" sub="Live price-target alerts (this device) + server-side technical alerts" />
      <ScrollView contentContainerStyle={styles.body}>
        <TargetAlerts />
        <View style={styles.divider} />
        <SectionTitle>Server alerts</SectionTitle>
        <OwnerGate title="Server alerts">
          <AlertsInner />
        </OwnerGate>
      </ScrollView>
    </View>
  );
}

// ── On-device price-target alerts with a live "upside remaining" readout ──────
// Available to every user (the server alerts below are owner-only). Polls live
// quotes every 30s and recomputes how much upside is left to each target.
function TargetAlerts() {
  const [alerts, setAlerts] = useState<LocalAlert[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});

  useEffect(() => {
    loadLocalAlerts().then(setAlerts);
  }, []);

  const symsKey = alerts.map((a) => a.sym).join(',');
  useEffect(() => {
    if (!symsKey) {
      setQuotes({});
      return;
    }
    const syms = symsKey.split(',');
    const fetch = () => api.ltp(syms).then(setQuotes).catch(() => {});
    fetch();
    const id = setInterval(fetch, 30000);
    return () => clearInterval(id);
  }, [symsKey]);

  const onDelete = async (id: string) => setAlerts(await removeLocalAlert(alerts, id));

  if (!alerts.length) {
    return (
      <>
        <SectionTitle>Price-target alerts · live upside</SectionTitle>
        <EmptyState
          title="No target alerts yet"
          hint="Tap Alert on any Momentum stock — the remaining upside to its target updates live here."
        />
      </>
    );
  }

  return (
    <>
      <SectionTitle>Price-target alerts · live upside</SectionTitle>
      {alerts.map((a) => {
        const price = quotes[a.sym]?.price ?? null;
        const remaining = price != null && price > 0 ? ((a.target - price) / price) * 100 : null;
        const reached = remaining != null && remaining <= 0;
        return (
          <Card key={a.id} style={styles.alertCard}>
            <View style={styles.alertHead}>
              <Text style={styles.alertSym}>{a.sym}</Text>
              <Text style={styles.alertRule}>target ₹{a.target.toLocaleString('en-IN')}</Text>
              <View style={{ flex: 1 }} />
              {reached ? (
                <Text style={styles.fired}>● TARGET HIT</Text>
              ) : remaining != null ? (
                <Text style={styles.upBig}>+{remaining.toFixed(1)}%</Text>
              ) : (
                <Text style={styles.armed}>…</Text>
              )}
            </View>
            <View style={styles.tgtRow}>
              <Text style={styles.tgtStat}>LTP {price != null ? '₹' + price.toLocaleString('en-IN') : '—'}</Text>
              <Text style={styles.tgtStat}>entry ₹{a.entryPrice.toLocaleString('en-IN')}</Text>
              <Text style={styles.tgtStat}>
                upside remaining {remaining != null ? (remaining > 0 ? '+' + remaining.toFixed(1) + '%' : 'reached ✓') : '—'}
              </Text>
            </View>
            <View style={styles.alertActions}>
              <TouchableOpacity onPress={() => onDelete(a.id)} activeOpacity={0.7}>
                <Text style={[styles.action, { color: theme.red }]}>remove</Text>
              </TouchableOpacity>
            </View>
          </Card>
        );
      })}
      <Text style={styles.note}>Upside remaining updates from live quotes every 30 seconds.</Text>
    </>
  );
}

function AlertsInner() {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [sym, setSym] = useState('');
  const [symInput, setSymInput] = useState('');
  const [type, setType] = useState<Alert['type']>('price_above');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkMsg, setCheckMsg] = useState('');

  const load = useCallback(() => {
    api.alertsList().then((r) => setAlerts(r.alerts)).catch(() => setAlerts([]));
  }, []);
  useEffect(load, [load]);

  const add = async () => {
    const s = (sym || symInput).trim().toUpperCase().replace(/^NSE:/, '');
    const v = Number(value);
    if (!s || !value || Number.isNaN(v)) return;
    setBusy(true);
    try {
      await api.alertsCreate(s, type, v);
      setValue('');
      load();
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    setCheckMsg('Checking…');
    try {
      const r = await api.alertsCheck();
      setCheckMsg(`Checked ${r.checked} symbol(s) · ${r.fired.length} fired`);
      load();
    } catch {
      setCheckMsg('Check failed.');
    }
  };

  const unit = TYPES.find((t) => t.key === type)?.unit || '';

  return (
    <View>
      <SectionTitle>New alert</SectionTitle>
      <Card>
        <SymbolInput
          value={symInput}
          onChangeText={setSymInput}
          onSelect={(s) => setSym(s)}
          onSubmit={() => setSym(symInput)}
          inputStyle={styles.input}
          placeholder="Symbol"
        />
        <View style={styles.typeRow}>
          {TYPES.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.typeChip, type === t.key && styles.typeChipOn]}
              onPress={() => setType(t.key)}
              activeOpacity={0.75}
            >
              <Text style={[styles.typeTxt, type === t.key && styles.typeTxtOn]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.valueRow}>
          <TextInput
            value={value}
            onChangeText={(t) => setValue(t.replace(/[^0-9.-]/g, ''))}
            placeholder={`Threshold ${unit}`}
            placeholderTextColor={theme.muted}
            keyboardType="numeric"
            style={[styles.input, { flex: 1 }]}
          />
          <Btn label={busy ? '…' : 'Add'} onPress={add} disabled={busy} style={{ minWidth: 84 }} />
        </View>
      </Card>

      <View style={styles.checkRow}>
        <Btn label="Check now" kind="ghost" onPress={check} />
        {checkMsg ? <Text style={styles.checkMsg}>{checkMsg}</Text> : null}
      </View>

      <SectionTitle>Your alerts</SectionTitle>
      {alerts === null ? (
        <Loading />
      ) : !alerts.length ? (
        <EmptyState title="No alerts yet" hint="Add one above — it's evaluated server-side against live quotes." />
      ) : (
        alerts.map((a) => (
          <Card key={a.id} style={styles.alertCard}>
            <View style={styles.alertHead}>
              <Text style={styles.alertSym}>{a.symbol}</Text>
              <Text style={styles.alertRule}>
                {labelFor(a.type)} {a.value}
              </Text>
              <View style={{ flex: 1 }} />
              {a.triggered_at ? (
                <Text style={styles.fired}>● FIRED</Text>
              ) : a.active ? (
                <Text style={styles.armed}>● armed</Text>
              ) : (
                <Text style={styles.paused}>paused</Text>
              )}
            </View>
            <View style={styles.alertActions}>
              <TouchableOpacity onPress={() => api.alertsToggle(a.id, !a.active).then(load)} activeOpacity={0.7}>
                <Text style={styles.action}>{a.triggered_at || !a.active ? 're-arm' : 'pause'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => api.alertsDelete(a.id).then(load)} activeOpacity={0.7}>
                <Text style={[styles.action, { color: theme.red }]}>delete</Text>
              </TouchableOpacity>
            </View>
          </Card>
        ))
      )}
      <Text style={styles.note}>
        Alerts evaluate on the server. "Check now" pulls live quotes and fires matches; a configured
        ALERT_WEBHOOK receives fired alerts (push/email need SMTP/FCM setup).
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  body: { padding: theme.sp.lg, paddingBottom: 44 },
  input: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    color: theme.text,
    fontFamily: theme.mono,
    fontSize: theme.fs.md,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm + 2,
  },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.sm, marginVertical: theme.sp.md },
  typeChip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: theme.surface2,
    borderColor: theme.border,
    borderWidth: 1,
  },
  typeChipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  typeTxt: { color: theme.muted2, fontSize: theme.fs.xs + 1 },
  typeTxtOn: { color: theme.onAccent, fontWeight: '700' },
  valueRow: { flexDirection: 'row', gap: theme.sp.sm, alignItems: 'center' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.md, marginVertical: theme.sp.md },
  checkMsg: { color: theme.muted2, fontSize: theme.fs.sm },
  alertCard: { marginBottom: theme.sp.sm },
  alertHead: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.md },
  alertSym: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.md, fontWeight: '700' },
  alertRule: { color: theme.muted2, fontFamily: theme.mono, fontSize: theme.fs.sm },
  fired: { color: theme.green, fontSize: theme.fs.xs + 1, fontWeight: '700' },
  armed: { color: theme.muted2, fontSize: theme.fs.xs + 1 },
  paused: { color: theme.muted, fontSize: theme.fs.xs + 1 },
  alertActions: { flexDirection: 'row', gap: theme.sp.lg, marginTop: theme.sp.sm },
  action: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '700' },
  note: { color: theme.muted, fontSize: theme.fs.sm, marginTop: theme.sp.lg, lineHeight: 18 },
  divider: { height: 1, backgroundColor: theme.border, marginVertical: theme.sp.lg },
  upBig: { color: theme.green, fontSize: theme.fs.md, fontWeight: '800', fontFamily: theme.mono },
  tgtRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.md, marginTop: theme.sp.sm },
  tgtStat: { color: theme.muted2, fontSize: theme.fs.sm, fontFamily: theme.mono },
});
