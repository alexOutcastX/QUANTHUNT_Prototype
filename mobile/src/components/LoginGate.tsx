import React, { useCallback, useEffect, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import BullRun from './BullRun';
import { Btn } from '../ui';
import { theme } from '../theme';
import { SignupPolicy, api } from '../api';
import { currentMember, memberLogin, memberRegister, restoreMember, subscribeMember } from '../member';
import { landOnHome } from '../navIntent';

// The app's front door: nothing renders until a member signs in. Credentials
// are checked server-side (/auth/member/login) and the signed session cookie
// carries the membership plan every paywalled feature gates on.
/** Same-tab navigation to the public site. No-op where there is no location
 *  (the native shell has no server-rendered landing to reach). */
function openSite() {
  try {
    const loc = (globalThis as { location?: { assign?: (u: string) => void } }).location;
    loc?.assign?.('/');
  } catch {
    /* nothing sensible to do */
  }
}

export default function LoginGate({ children }: { children: React.ReactNode }) {
  const [checked, setChecked] = useState(false);
  const [, force] = useState(0);
  const [user, setUser] = useState('');
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [msg, setMsg] = useState('');
  // One form, two modes. A separate sign-up screen means someone who typed a
  // username into the wrong one has to type it again.
  const [mode, setMode] = useState<'in' | 'up'>('in');
  // The server decides whether signup is open at all, how long a password has
  // to be, and whether an invite code is needed. Asking it means the rules the
  // form states are the rules the server enforces.
  const [policy, setPolicy] = useState<SignupPolicy | null>(null);

  useEffect(() => {
    const un = subscribeMember(() => force((n) => n + 1));
    restoreMember().finally(() => setChecked(true));
    api.signupPolicy().then(setPolicy).catch(() => setPolicy(null));
    return un;
  }, []);

  const submit = useCallback(async () => {
    if (busy) return;
    setMsg('');
    if (!user.trim() || !pw) {
      setMsg(mode === 'up'
        ? 'Choose a username and a password.'
        : 'Enter your username and password.');
      return;
    }
    setBusy(true);
    setShowPw(false);
    try {
      if (mode === 'up') await memberRegister(user.trim(), pw, code.trim());
      else await memberLogin(user.trim(), pw);
      // Sign in and you are on the home page, not on whatever screen the last
      // session was left open at.
      await landOnHome();
      setPw('');
      setCode('');
    } catch (e) {
      // The server's own sentence — it knows whether the name is taken, the
      // password is short or the invite code is wrong, and re-wording that
      // here as "something went wrong" makes the caller guess which.
      const said = e instanceof Error ? e.message : '';
      const useful = said && !/^(signup-refused|HTTP \d+)$/.test(said);
      setMsg(mode === 'up'
        ? (useful ? said : 'Could not create that account.')
        : 'Wrong username or password.');
    }
    setBusy(false);
  }, [busy, user, pw, code, mode]);

  const canSignUp = policy ? policy.open : false;
  const swap = (next: 'in' | 'up') => {
    setMode(next);
    setMsg('');
    setPw('');
    setShowPw(false);
  };

  if (currentMember()) return <>{children}</>;

  return (
    <View style={styles.page}>
      {!checked ? (
        // The boot wait, where the old app put the galloping bull: this is the
        // one moment the user has nothing to look at, and a spinner said
        // nothing about whose app they had opened.
        <View style={styles.boot}>
          <BullRun size={170} />
          <Text style={styles.bootLine}>Checking your session…</Text>
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kb}
        >
          <View style={styles.card}>
            {/* The real brand mark, carried over from the marketing site so the
                app's front door and taureye.com are recognisably one product. */}
            <Image
              source={require('../../assets/brand/logo.png')}
              style={styles.mark}
              resizeMode="contain"
              accessibilityLabel="TaurEye"
            />
            <Image
              source={require('../../assets/brand/wordmark.png')}
              style={styles.wordmark}
              resizeMode="contain"
              accessible={false}
            />
            <Text style={styles.tag}>
              {mode === 'up'
                ? 'Create your TaurEye account'
                : 'Members only — sign in to continue'}
            </Text>
            {canSignUp ? (
              <View style={styles.modeRow}>
                <TouchableOpacity
                  style={[styles.modeBtn, mode === 'in' && styles.modeBtnOn]}
                  onPress={() => swap('in')}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityState={{ selected: mode === 'in' }}
                  testID="mode-signin"
                >
                  <Text style={[styles.modeTxt, mode === 'in' && styles.modeTxtOn]}>Sign in</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modeBtn, mode === 'up' && styles.modeBtnOn]}
                  onPress={() => swap('up')}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityState={{ selected: mode === 'up' }}
                  testID="mode-signup"
                >
                  <Text style={[styles.modeTxt, mode === 'up' && styles.modeTxtOn]}>Create account</Text>
                </TouchableOpacity>
              </View>
            ) : null}
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
            {/* Show/hide. A typo in a field you cannot read is the most common
                reason a correct password appears to fail, and on a phone
                keyboard it is close to guaranteed. */}
            <View style={styles.pwRow}>
              <TextInput
                value={pw}
                onChangeText={setPw}
                placeholder="Password"
                placeholderTextColor={theme.muted}
                secureTextEntry={!showPw}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, styles.pwInput]}
                onSubmitEditing={submit}
                testID="login-pw"
              />
              <TouchableOpacity
                style={styles.pwEye}
                onPress={() => setShowPw((v) => !v)}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityState={{ selected: showPw }}
                accessibilityLabel={showPw ? 'Hide password' : 'Show password'}
                hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                testID="login-pw-toggle"
              >
                <Text style={styles.pwEyeTxt}>{showPw ? 'Hide' : 'Show'}</Text>
              </TouchableOpacity>
            </View>
            {mode === 'up' && policy?.invite_required ? (
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder="Invite code"
                placeholderTextColor={theme.muted}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
                testID="login-code"
              />
            ) : null}
            {/* The rules, before you break them. The server owns these numbers
                and the form reads them from it, so the two cannot drift. */}
            {mode === 'up' && policy ? (
              <Text style={styles.rules}>
                {policy.username_min}–{policy.username_max} characters, starting with a letter.
                Password at least {policy.password_min}.
              </Text>
            ) : null}
            {msg ? <Text style={styles.err}>{msg}</Text> : null}
            <Btn
              label={busy
                ? (mode === 'up' ? 'CREATING…' : 'SIGNING IN…')
                : (mode === 'up' ? 'CREATE ACCOUNT' : 'SIGN IN')}
              onPress={submit}
            />
            <Text style={styles.foot}>
              {mode === 'up'
                ? 'Educational market analytics — not investment advice. By creating an account you accept the disclaimer.'
                : 'Access is by membership. Educational market analytics — not investment advice.'}
            </Text>
            {/* Somewhere to go when you are not a member yet, rather than
                dead-ending on a password box. Navigates in place: signed out,
                `/` serves the public landing page. Linking.openURL would open
                a second tab, which is not what a "read more" link should do. */}
            <Pressable onPress={openSite} accessibilityRole="link">
              <Text style={styles.link}>New here? Read about TaurEye →</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  modeRow: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: theme.surface2,
    borderRadius: 999,
    padding: 3,
    marginBottom: theme.sp.md,
  },
  modeBtn: { flex: 1, alignItems: 'center', borderRadius: 999, paddingVertical: 7 },
  modeBtnOn: { backgroundColor: theme.accent },
  modeTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '700' },
  modeTxtOn: { color: theme.onAccent },
  rules: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 17, marginBottom: 6 },
  page: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' },
  boot: { alignItems: 'center', gap: 10 },
  pwRow: { position: 'relative', justifyContent: 'center', marginBottom: theme.sp.md },
  // The shared input style owns the bottom gap; keep it on the row so the
  // absolutely-positioned button stays centred on the field itself.
  pwInput: { paddingRight: 64, marginBottom: 0 },
  pwEye: { position: 'absolute', right: 6, paddingHorizontal: 8, paddingVertical: 6,
    minWidth: 48, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  pwEyeTxt: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '700' },
  bootLine: { color: theme.muted, fontSize: 13 },
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
  mark: { width: 74, height: 74, alignSelf: 'center', marginBottom: theme.sp.sm },
  wordmark: { width: 168, height: 34, alignSelf: 'center' },
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
  link: {
    color: theme.accent,
    fontSize: theme.fs.sm,
    textAlign: 'center',
    marginTop: theme.sp.md,
    fontWeight: '600',
  },
  foot: {
    color: theme.muted,
    fontSize: theme.fs.xs,
    textAlign: 'center',
    marginTop: theme.sp.md,
    lineHeight: 16,
  },
});
