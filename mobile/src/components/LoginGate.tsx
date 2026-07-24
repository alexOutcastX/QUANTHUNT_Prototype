import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Btn } from '../ui';
import { theme } from '../theme';
import { currentMember, memberLogin, restoreMember, subscribeMember } from '../member';

// The app's front door: nothing renders until a member signs in. Credentials
// are checked server-side (/auth/member/login) and the signed session cookie
// carries the membership plan every paywalled feature gates on.
export default function LoginGate({ children }: { children: React.ReactNode }) {
  const [checked, setChecked] = useState(false);
  const [, force] = useState(0);
  const [user, setUser] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const un = subscribeMember(() => force((n) => n + 1));
    restoreMember().finally(() => setChecked(true));
    return un;
  }, []);

  const login = useCallback(async () => {
    if (busy) return;
    setMsg('');
    if (!user.trim() || !pw) {
      setMsg('Enter your username and password.');
      return;
    }
    setBusy(true);
    try {
      await memberLogin(user.trim(), pw);
      setPw('');
    } catch {
      setMsg('Wrong username or password.');
    }
    setBusy(false);
  }, [busy, user, pw]);

  if (currentMember()) return <>{children}</>;

  return (
    <View style={styles.page}>
      {!checked ? (
        <ActivityIndicator color={theme.muted} />
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kb}
        >
          <View style={styles.card}>
            <Text style={styles.brand}>TaurEye</Text>
            <Text style={styles.tag}>Members only — sign in to continue</Text>
            <TextInput
              value={user}
              onChangeText={setUser}
              placeholder="Username"
              placeholderTextColor={theme.muted}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              testID="login-user"
            />
            <TextInput
              value={pw}
              onChangeText={setPw}
              placeholder="Password"
              placeholderTextColor={theme.muted}
              secureTextEntry
              style={styles.input}
              onSubmitEditing={login}
              testID="login-pw"
            />
            {msg ? <Text style={styles.err}>{msg}</Text> : null}
            <Btn label={busy ? 'SIGNING IN…' : 'SIGN IN'} onPress={login} />
            <Text style={styles.foot}>
              Access is by membership. Educational market analytics — not investment advice.
            </Text>
          </View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' },
  kb: { width: '100%', alignItems: 'center' },
  card: {
    width: '90%',
    maxWidth: 380,
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.sp.xl,
  },
  brand: {
    color: theme.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  tag: {
    color: theme.muted2,
    fontSize: theme.fs.sm,
    textAlign: 'center',
    marginTop: theme.sp.xs,
    marginBottom: theme.sp.lg,
  },
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
  err: { color: theme.red, fontSize: theme.fs.sm, marginBottom: theme.sp.md },
  foot: {
    color: theme.muted,
    fontSize: theme.fs.xs,
    textAlign: 'center',
    marginTop: theme.sp.md,
    lineHeight: 16,
  },
});
