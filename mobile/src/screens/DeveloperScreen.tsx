import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ApiKey, API_BASE, api } from '../api';
import OwnerGate from '../components/OwnerGate';
import { Btn, Card, EmptyState, Loading, ScreenTitle, SectionTitle } from '../ui';
import { theme } from '../theme';

export default function DeveloperScreen() {
  return (
    <View style={styles.container}>
      <ScreenTitle title="Developer API" sub="Public data API · key-gated /api/v1/*" />
      <OwnerGate title="Developer API">
        <DevInner />
      </OwnerGate>
    </View>
  );
}

function DevInner() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [label, setLabel] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.apiKeysList().then((r) => setKeys(r.keys)).catch(() => setKeys([]));
  }, []);
  useEffect(load, [load]);

  const issue = async () => {
    setBusy(true);
    try {
      const r = await api.apiKeysIssue(label.trim());
      setFresh(r.key);
      setLabel('');
      load();
    } finally {
      setBusy(false);
    }
  };

  const base = API_BASE || 'https://<your-host>';

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <SectionTitle>Issue a key</SectionTitle>
      <Card>
        <View style={styles.issueRow}>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="Label (e.g. sheets-connector)"
            placeholderTextColor={theme.muted}
            style={[styles.input, { flex: 1 }]}
          />
          <Btn label={busy ? '…' : 'Issue'} onPress={issue} disabled={busy} style={{ minWidth: 84 }} />
        </View>
        {fresh ? (
          <View style={styles.freshBox}>
            <Text style={styles.freshLabel}>Copy this key now — it is shown only once:</Text>
            <Text selectable style={styles.freshKey}>{fresh}</Text>
          </View>
        ) : null}
      </Card>

      <SectionTitle>Your keys</SectionTitle>
      {keys === null ? (
        <Loading />
      ) : !keys.length ? (
        <EmptyState title="No keys issued" hint="Issue one above to call the public API." />
      ) : (
        keys.map((k) => (
          <Card key={k.id} style={styles.keyCard}>
            <View style={styles.keyHead}>
              <Text style={styles.keyLabel}>{k.label || '(unlabelled)'}</Text>
              <View style={{ flex: 1 }} />
              <Text style={[styles.keyState, { color: k.active ? theme.green : theme.red }]}>
                {k.active ? 'active' : 'revoked'}
              </Text>
            </View>
            <Text style={styles.keyMeta}>
              id {k.id} · {k.calls} call{k.calls === 1 ? '' : 's'}
              {k.last_used ? ` · last ${new Date(k.last_used * 1000).toLocaleDateString()}` : ''}
            </Text>
            {k.active ? (
              <TouchableOpacity onPress={() => api.apiKeysRevoke(k.id).then(load)} activeOpacity={0.7}>
                <Text style={styles.revoke}>revoke</Text>
              </TouchableOpacity>
            ) : null}
          </Card>
        ))
      )}

      <SectionTitle>Usage</SectionTitle>
      <Card>
        <Text style={styles.docLine}>Pass your key in the <Text style={styles.mono}>X-API-Key</Text> header.</Text>
        <Text style={styles.code} selectable>
          {`curl -H "X-API-Key: te_..." \\\n  "${base}/api/v1/quote?symbols=RELIANCE,TCS"`}
        </Text>
        <Text style={styles.code} selectable>
          {`curl -H "X-API-Key: te_..." \\\n  "${base}/api/v1/indices"`}
        </Text>
        <Text style={styles.note}>
          Endpoints: /api/v1/quote (live LTP) · /api/v1/indices (index levels). Rate-limited per key.
          Keys are stored hashed — revoke anytime.
        </Text>
      </Card>
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
    fontSize: theme.fs.md,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm + 2,
  },
  issueRow: { flexDirection: 'row', gap: theme.sp.sm, alignItems: 'center' },
  freshBox: {
    marginTop: theme.sp.md,
    padding: theme.sp.md,
    backgroundColor: theme.surface2,
    borderRadius: theme.radius.sm,
    borderColor: theme.green,
    borderWidth: 1,
  },
  freshLabel: { color: theme.muted2, fontSize: theme.fs.sm, marginBottom: theme.sp.sm },
  freshKey: { color: theme.green, fontFamily: theme.mono, fontSize: theme.fs.sm },
  keyCard: { marginBottom: theme.sp.sm },
  keyHead: { flexDirection: 'row', alignItems: 'center' },
  keyLabel: { color: theme.text, fontSize: theme.fs.md, fontWeight: '700' },
  keyState: { fontSize: theme.fs.xs + 1, fontWeight: '700' },
  keyMeta: { color: theme.muted2, fontFamily: theme.mono, fontSize: theme.fs.xs + 1, marginTop: 4 },
  revoke: { color: theme.red, fontSize: theme.fs.sm, fontWeight: '700', marginTop: theme.sp.sm },
  docLine: { color: theme.muted2, fontSize: theme.fs.sm, marginBottom: theme.sp.sm },
  mono: { fontFamily: theme.mono, color: theme.text },
  code: {
    color: theme.text,
    fontFamily: theme.mono,
    fontSize: theme.fs.xs + 1,
    backgroundColor: theme.surface2,
    borderRadius: theme.radius.sm,
    padding: theme.sp.md,
    marginBottom: theme.sp.sm,
  },
  note: { color: theme.muted, fontSize: theme.fs.sm, marginTop: theme.sp.sm, lineHeight: 18 },
});
