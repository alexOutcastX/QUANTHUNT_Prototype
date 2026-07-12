import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Alert, api } from '../api';
import OwnerGate from '../components/OwnerGate';
import SymbolInput from '../components/SymbolInput';
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
      <ScreenTitle title="Alerts" sub="Server-side price / technical alerts" />
      <OwnerGate title="Alerts">
        <AlertsInner />
      </OwnerGate>
    </View>
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
    <ScrollView contentContainerStyle={styles.body}>
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
    </ScrollView>
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
});
