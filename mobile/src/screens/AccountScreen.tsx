// Account — email + OTP sign-in, cloud-sync status, sign-out and DPDP-style
// account deletion. Signing in keeps watchlists, alerts and paper trades in
// sync across devices (see session.ts for the pull/push rules).
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { API_BASE, api } from '../api';
import { Linking } from 'react-native';
import {
  deleteAccount,
  onSignedIn,
  refreshSession,
  sessionEmail,
  signOut,
  subscribeSession,
  syncNow,
  syncState,
} from '../session';
import { Btn, Card } from '../ui';
import { theme } from '../theme';

type Step = 'email' | 'code';

export default function AccountScreen() {
  const [me, setMe] = useState<string | null>(sessionEmail());
  const [sync, setSync] = useState(syncState());
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    refreshSession();
    return subscribeSession(() => {
      setMe(sessionEmail());
      setSync(syncState());
    });
  }, []);

  const requestCode = async () => {
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
      setNote('Enter a valid email address.');
      return;
    }
    setBusy(true);
    setNote('');
    try {
      const r = await api.otpRequest(e);
      if (r.dev_code) {
        // dev servers without SMTP echo the code so the flow stays testable
        setNote(`Dev mode — your code is ${r.dev_code}`);
        setStep('code');
      } else if (r.sent) {
        setNote(`Code sent to ${e} — check your inbox.`);
        setStep('code');
      } else {
        setNote(r.detail || 'Could not send the code.');
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Could not send the code.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setNote('');
    try {
      const r = await api.otpVerify(email.trim().toLowerCase(), code.trim(), consent);
      if (r.user) {
        onSignedIn(r.user.email);
        setNote('');
        setStep('email');
        setCode('');
      } else if (r.error === 'consent-required') {
        setNote('Tick the Terms & Privacy box to create the account.');
      } else {
        setNote(r.detail || 'Wrong or expired code.');
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : '';
      setNote(m === 'consent-required'
        ? 'Tick the Terms & Privacy box to create the account.'
        : m || 'Wrong or expired code.');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    try {
      await deleteAccount();
      setNote('Account and all stored data deleted.');
    } catch {
      setNote('Deletion failed — try again.');
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const syncLabel =
    sync.state === 'synced'
      ? `Synced${sync.lastSync ? ' · ' + new Date(sync.lastSync).toLocaleTimeString() : ''}`
      : sync.state === 'syncing'
        ? 'Syncing…'
        : sync.state === 'error'
          ? 'Sync error — will retry on next change'
          : 'Off';

  return (
    <ScrollView style={s.wrap} contentContainerStyle={s.pad}>
      {me ? (
        <>
          <Card style={s.card}>
            <Text style={s.label}>SIGNED IN AS</Text>
            <Text style={s.email}>{me}</Text>
            <Text style={s.label}>CLOUD SYNC</Text>
            <Text style={s.value}>{syncLabel}</Text>
            <Text style={s.hint}>
              Watchlists, alerts, paper trades and the simulator sync to your account and follow
              you across devices.
            </Text>
            <View style={s.row}>
              <Btn label="Sync now" onPress={() => syncNow()} disabled={busy} />
              <Btn label="Sign out" kind="ghost" onPress={() => signOut()} disabled={busy} />
            </View>
          </Card>
          <Card style={s.card}>
            <Text style={s.label}>DELETE ACCOUNT</Text>
            <Text style={s.hint}>
              Permanently removes your account and every document stored for it on the server.
              Data on this device is kept. This cannot be undone.
            </Text>
            <TouchableOpacity style={[s.dangerBtn, confirmDelete && s.dangerBtnArmed]} onPress={onDelete} disabled={busy} activeOpacity={0.8}>
              <Text style={s.dangerTxt}>{confirmDelete ? 'Tap again to permanently delete' : 'Delete my account'}</Text>
            </TouchableOpacity>
          </Card>
        </>
      ) : (
        <Card style={s.card}>
          <Text style={s.title}>Sign in</Text>
          <Text style={s.hint}>
            One account keeps your watchlists, alerts and paper trades in sync across the app and
            the website. We only store your email.
          </Text>
          {step === 'email' ? (
            <>
              <TextInput
                style={s.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={theme.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                onSubmitEditing={requestCode}
              />
              <Btn label={busy ? 'Sending…' : 'Email me a code'} onPress={requestCode} disabled={busy} />
            </>
          ) : (
            <>
              <Text style={s.value}>{email.trim().toLowerCase()}</Text>
              <TextInput
                style={s.input}
                value={code}
                onChangeText={setCode}
                placeholder="6-digit code"
                placeholderTextColor={theme.muted}
                keyboardType="number-pad"
                maxLength={6}
                onSubmitEditing={verify}
              />
              <TouchableOpacity style={s.consentRow} onPress={() => setConsent((v) => !v)} activeOpacity={0.75}>
                <View style={[s.checkbox, consent && s.checkboxOn]}>
                  {consent ? <Text style={s.tick}>✓</Text> : null}
                </View>
                <Text style={s.consentTxt}>
                  I accept the{' '}
                  <Text style={s.link} onPress={() => Linking.openURL((API_BASE || '') + '/legal.html').catch(() => {})}>
                    Terms & Privacy Policy
                  </Text>
                </Text>
              </TouchableOpacity>
              <View style={s.row}>
                <Btn label={busy ? 'Verifying…' : 'Sign in'} onPress={verify} disabled={busy || code.trim().length < 6} />
                <Btn label="Back" kind="ghost" onPress={() => { setStep('email'); setCode(''); setNote(''); }} />
              </View>
            </>
          )}
        </Card>
      )}
      {note ? <Text style={s.note}>{note}</Text> : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  pad: { padding: theme.sp.lg, gap: theme.sp.md },
  card: { padding: theme.sp.lg, gap: theme.sp.sm },
  title: { color: theme.text, fontSize: theme.fs.xl, fontWeight: '800' },
  label: { color: theme.muted, fontSize: theme.fs.xs, letterSpacing: 1, fontWeight: '700', marginTop: theme.sp.xs },
  email: { color: theme.text, fontSize: theme.fs.lg, fontWeight: '700', fontFamily: theme.mono },
  value: { color: theme.text, fontSize: theme.fs.md, fontFamily: theme.mono },
  hint: { color: theme.muted, fontSize: theme.fs.sm, lineHeight: 18 },
  input: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    color: theme.text,
    paddingHorizontal: theme.sp.md,
    paddingVertical: 10,
    fontFamily: theme.mono,
    fontSize: theme.fs.md,
  },
  row: { flexDirection: 'row', gap: theme.sp.md, marginTop: theme.sp.sm },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.md, marginTop: theme.sp.xs },
  checkbox: {
    width: 20, height: 20, borderRadius: 5,
    borderColor: theme.border2, borderWidth: 1.5, backgroundColor: theme.surface2,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: theme.brandSoft, borderColor: theme.brand },
  tick: { color: theme.brand, fontSize: 13, fontWeight: '800', lineHeight: 15 },
  consentTxt: { color: theme.muted2, fontSize: theme.fs.sm, flex: 1 },
  link: { color: theme.brand, textDecorationLine: 'underline' },
  dangerBtn: {
    borderColor: theme.red, borderWidth: 1, borderRadius: theme.radius.md,
    paddingVertical: 10, alignItems: 'center', marginTop: theme.sp.xs,
  },
  dangerBtnArmed: { backgroundColor: theme.red },
  dangerTxt: { color: theme.text, fontWeight: '700', fontSize: theme.fs.sm + 1 },
  note: { color: theme.muted2, fontSize: theme.fs.sm, paddingHorizontal: theme.sp.xs },
});
