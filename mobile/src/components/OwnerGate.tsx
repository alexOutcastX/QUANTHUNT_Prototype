import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { api, setSessionToken, usesHeaderSessions } from '../api';
import { Btn, Card, EmptyState, Loading } from '../ui';
import { theme } from '../theme';

// Wraps owner-only surfaces (alerts, API keys). Shows a passcode unlock until
// the instance owner is authenticated; then renders `children`.
export default function OwnerGate({ title, children }: { title: string; children: React.ReactNode }) {
  const [status, setStatus] = useState<{ configured: boolean; owner: boolean } | null>(null);
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');

  const refresh = useCallback(() => {
    api.authStatus().then(setStatus).catch(() => setStatus({ configured: false, owner: false }));
  }, []);
  useEffect(refresh, [refresh]);

  const login = useCallback(async () => {
    setMsg('');
    try {
      const r = await api.authLogin(pw);
      // Native shell keeps the owner session as a header token (see api.ts).
      if (usesHeaderSessions && r.token) setSessionToken('owner', r.token);
      setPw('');
      refresh();
    } catch {
      setMsg('Incorrect passcode.');
    }
  }, [pw, refresh]);

  if (!status) return <Loading />;
  if (status.owner) return <>{children}</>;

  if (!status.configured) {
    return (
      <EmptyState
        icon="◈"
        title={`${title} is owner-only`}
        hint="Set APP_PASSWORD on the server to enable owner features."
      />
    );
  }

  return (
    <View style={styles.wrap}>
      <Card>
        <Text style={styles.lead}>{msg || `${title} is private. Enter the owner passcode.`}</Text>
        <TextInput
          value={pw}
          onChangeText={setPw}
          placeholder="Owner passcode"
          placeholderTextColor={theme.muted}
          secureTextEntry
          style={styles.input}
          onSubmitEditing={login}
        />
        <Btn label="UNLOCK" onPress={login} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: theme.sp.lg },
  lead: { color: theme.muted2, fontSize: theme.fs.sm, marginBottom: theme.sp.md, lineHeight: 18 },
  input: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    color: theme.text,
    fontSize: theme.fs.md,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm + 2,
    marginBottom: theme.sp.md,
  },
});
