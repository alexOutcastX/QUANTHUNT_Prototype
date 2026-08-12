import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  PlansResp, ReferralResp, WalletResp, PublicIntegrations, api,
} from '../api';
import { theme } from '../theme';
import {
  Btn, Card, EmptyState, Loading, ScreenTitle, SectionTitle, StatTile,
} from '../ui';

/**
 * Wallet, credits, refer-and-earn and plans on one screen.
 *
 * Everything here is preview-gated on the server, so on taureye.com the
 * endpoints 404 and the nav entry is hidden. Nothing is charged: the plan
 * buttons record an intent and say so plainly rather than pretending to be a
 * checkout that will work.
 */
export default function WalletScreen() {
  const [wallet, setWallet] = useState<WalletResp | null>(null);
  const [ref, setRef] = useState<ReferralResp | null>(null);
  const [plans, setPlans] = useState<PlansResp | null>(null);
  const [integrations, setIntegrations] = useState<PublicIntegrations | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setErr(null);
    Promise.all([
      api.wallet(), api.referral(), api.billingPlans(), api.integrationsPublic(),
    ])
      .then(([w, r, p, i]) => { setWallet(w); setRef(r); setPlans(p); setIntegrations(i); })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  useEffect(() => { load(); api.trackEvent('wallet.view'); }, [load]);

  const claim = async () => {
    const c = code.trim();
    if (!c) return;
    setBusy(true);
    setNote(null);
    try {
      const out = await api.referralClaim(c);
      setNote(`Applied. You earned ${out.referee_credits} credits.`);
      setCode('');
      load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'That code could not be applied.');
    } finally {
      setBusy(false);
    }
  };

  const choose = async (planKey: string) => {
    setBusy(true);
    setNote(null);
    try {
      const out = await api.billingCheckout(planKey);
      setNote(out.provider_configured
        ? `Checkout started with ${out.provider}.`
        : `${out.message} (${out.provider} is not connected yet.)`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not start checkout.');
    } finally {
      setBusy(false);
    }
  };

  if (err) {
    return (
      <View style={styles.container}>
        <ScreenTitle title="Wallet" sub="Credits, referrals and plan" />
        <EmptyState
          title="Couldn't load your wallet"
          hint={`${err} — these features are only available on the preview host for now.`}
        />
      </View>
    );
  }
  if (!wallet || !ref || !plans) {
    return (
      <View style={styles.container}>
        <ScreenTitle title="Wallet" sub="Credits, referrals and plan" />
        <Loading label="Loading your wallet…" />
      </View>
    );
  }

  const current = plans.current;

  return (
    <View style={styles.container}>
      <ScreenTitle title="Wallet" sub={`Signed in as ${wallet.account}`} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {note ? <Card style={styles.note}><Text style={styles.noteTxt}>{note}</Text></Card> : null}

        <View style={styles.tiles}>
          <StatTile label="Credits" value={String(wallet.balances.credits)} />
          <StatTile label="Balance" value={`₹${(wallet.balances.INR / 100).toFixed(2)}`} />
          <StatTile label="Referrals" value={String(ref.count)} />
        </View>

        {/* ── refer and earn ── */}
        <SectionTitle>Refer and earn</SectionTitle>
        <Card>
          <Text style={styles.label}>Your code</Text>
          <Text style={styles.code}>{ref.code}</Text>
          <Text style={styles.hint}>
            Share it. They get {ref.reward_referee} credits when they apply it, you get{' '}
            {ref.reward_referrer} credits. You've earned {ref.credits_earned} so far.
          </Text>

          {ref.referred_by ? (
            <Text style={styles.hint}>You joined via {ref.referred_by}.</Text>
          ) : (
            <View style={styles.row}>
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder="Enter a friend's code"
                placeholderTextColor={theme.muted}
                autoCapitalize="characters"
                style={styles.input}
              />
              <Btn label="Apply" onPress={claim} disabled={busy || !code.trim()} />
            </View>
          )}
        </Card>

        {/* ── plan ── */}
        <SectionTitle>Your plan</SectionTitle>
        <Card>
          <Text style={styles.planNow}>
            {current.plan.toUpperCase()}
            <Text style={styles.hint}>
              {current.status === 'none' ? '  · included with your account' : `  · ${current.status}`}
            </Text>
          </Text>
          {current.expired ? (
            <Text style={styles.warn}>Your subscription lapsed — you're back on {current.plan}.</Text>
          ) : null}
        </Card>

        {plans.plans.map((p) => {
          const isCurrent = p.key === current.plan;
          return (
            <Card key={p.key} style={isCurrent ? styles.planCurrent : undefined}>
              <View style={styles.planHead}>
                <Text style={styles.planName}>{p.name}</Text>
                <Text style={styles.planPrice}>
                  {p.price_inr === 0 ? 'Free' : `₹${p.price_inr.toFixed(0)}/${p.period}`}
                </Text>
              </View>
              <Text style={styles.hint}>{p.blurb}</Text>
              {p.credits_per_period > 0 ? (
                <Text style={styles.hint}>{p.credits_per_period} credits every {p.period}.</Text>
              ) : null}
              {isCurrent ? (
                <Text style={styles.currentTag}>Current plan</Text>
              ) : p.key === 'free' ? null : (
                <Btn label={`Choose ${p.name}`} onPress={() => choose(p.key)} disabled={busy} />
              )}
            </Card>
          );
        })}

        {!plans.provider_configured ? (
          <Card style={styles.note}>
            <Text style={styles.noteTxt}>
              Payments aren't connected yet ({plans.provider}). Choosing a plan records your
              interest and charges nothing.
            </Text>
          </Card>
        ) : null}

        {/* ── sign-in options that are wired but not switched on ── */}
        {integrations && !integrations.google.enabled ? (
          <>
            <SectionTitle>Sign-in options</SectionTitle>
            <Card>
              <Text style={styles.label}>Google Sign-In</Text>
              <Text style={styles.hint}>{integrations.google.reason}</Text>
            </Card>
          </>
        ) : null}

        {/* ── ledger ── */}
        <SectionTitle>Recent activity</SectionTitle>
        {wallet.history.length === 0 ? (
          <Card><Text style={styles.hint}>Nothing yet. Referrals and plan credits show up here.</Text></Card>
        ) : (
          wallet.history.map((h) => (
            <Card key={h.id} style={styles.ledgerRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.ledgerReason}>{h.reason}</Text>
                <Text style={styles.hint}>
                  {new Date(h.ts * 1000).toLocaleDateString()} · {h.currency}
                </Text>
              </View>
              <Text style={[styles.amount, { color: h.amount >= 0 ? theme.green : theme.red }]}>
                {h.amount >= 0 ? '+' : ''}{h.amount}
              </Text>
            </Card>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg, padding: theme.sp.md },
  tiles: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  label: { color: theme.muted, fontSize: theme.fs.sm, marginBottom: 4 },
  code: {
    fontFamily: theme.mono, color: theme.text, fontSize: 26,
    letterSpacing: 4, marginBottom: 6,
  },
  hint: { color: theme.muted, fontSize: theme.fs.sm, marginTop: 4, lineHeight: 18 },
  warn: { color: theme.red, fontSize: theme.fs.sm, marginTop: 6 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 10 },
  input: {
    flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radius.md,
    paddingHorizontal: 10, paddingVertical: 8, color: theme.text,
    fontFamily: theme.mono, letterSpacing: 2,
  },
  note: { borderColor: theme.accent, borderWidth: 1 },
  noteTxt: { color: theme.text, fontSize: theme.fs.sm, lineHeight: 18 },
  planNow: { color: theme.text, fontSize: theme.fs.lg, fontWeight: '700' },
  planCurrent: { borderColor: theme.accent, borderWidth: 1 },
  planHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  planName: { color: theme.text, fontSize: theme.fs.md, fontWeight: '700' },
  planPrice: { color: theme.accent, fontFamily: theme.mono, fontSize: theme.fs.md },
  currentTag: { color: theme.accent, fontSize: theme.fs.sm, marginTop: 8 },
  ledgerRow: { flexDirection: 'row', alignItems: 'center' },
  ledgerReason: { color: theme.text, fontSize: theme.fs.sm },
  amount: { fontFamily: theme.mono, fontSize: theme.fs.md, fontWeight: '700' },
});
