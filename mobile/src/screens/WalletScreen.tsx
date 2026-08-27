import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  EarnResp, GiftQuote, PlansResp, ReferralResp, WalletResp, PublicIntegrations, api,
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
  const [earn, setEarn] = useState<EarnResp | null>(null);
  const [gift, setGift] = useState<GiftQuote | null>(null);
  const [giftTo, setGiftTo] = useState('');
  const [giftAmt, setGiftAmt] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setErr(null);
    Promise.all([
      api.wallet(), api.referral(), api.billingPlans(), api.integrationsPublic(),
      api.walletEarn(), api.giftQuote(),
    ])
      .then(([w, r, p, i, e, g]) => {
        setWallet(w); setRef(r); setPlans(p); setIntegrations(i); setEarn(e); setGift(g);
      })
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

  const claimDaily = async () => {
    setBusy(true);
    setNote(null);
    try {
      const out = await api.walletDaily();
      if (out.ok) {
        const bonus = out.streak_bonus
          ? ` Plus ${out.streak_bonus} for a ${out.streak}-day streak.`
          : '';
        setNote(`+${out.awarded} credits.${bonus}`);
      } else {
        setNote("Already claimed today — come back tomorrow to keep the streak.");
      }
      load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not claim today’s bonus.');
    } finally {
      setBusy(false);
    }
  };

  const sendGift = async () => {
    const amt = Number(giftAmt);
    if (!giftTo.trim() || !amt) return;
    setBusy(true);
    setNote(null);
    try {
      const out = await api.sendGift(giftTo.trim(), amt, '');
      setNote(`Sent ${out.amount} credits to ${out.to}.`);
      setGiftTo(''); setGiftAmt('');
      load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'That gift could not be sent.');
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

        {/* ── daily bonus ──
            The habit loop. Deliberately deterministic and keyed on the trading
            day, so a weekend never breaks a streak — see rewards.py. */}
        {earn ? (
          <>
            <SectionTitle>Daily bonus</SectionTitle>
            <Card>
              <View style={styles.dailyRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dailyStreak}>
                    {earn.daily.streak > 0 ? `Day ${earn.daily.streak}` : 'No streak yet'}
                  </Text>
                  <Text style={styles.label}>
                    {earn.daily.claimable
                      ? `Claim ${earn.daily.credits} credits for today`
                      : 'Claimed today — come back tomorrow'}
                  </Text>
                  {earn.daily.next_milestone ? (
                    <Text style={styles.dailyNext}>
                      {earn.daily.next_milestone - earn.daily.streak} more day
                      {earn.daily.next_milestone - earn.daily.streak === 1 ? '' : 's'} to a{' '}
                      {earn.daily.next_milestone_bonus}-credit bonus
                    </Text>
                  ) : null}
                </View>
                <Btn
                  label={earn.daily.claimable ? 'Claim' : 'Claimed'}
                  onPress={claimDaily}
                  disabled={busy || !earn.daily.claimable}
                />
              </View>
            </Card>

            <SectionTitle>Ways to earn</SectionTitle>
            <Card>
              {earn.earn.map((w) => (
                <View key={w.key} style={styles.earnRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowLabel}>{w.label}</Text>
                    <Text style={styles.rowSub}>{w.detail}</Text>
                  </View>
                  <Text style={styles.rowAmt}>{w.credits ? `+${w.credits}` : '—'}</Text>
                </View>
              ))}
            </Card>

            {/* What the currency is FOR. A balance with no visible price list is
                a number; showing what it buys is what makes it feel like money. */}
            <SectionTitle>What credits buy</SectionTitle>
            <Card>
              {earn.prices.map((pr) => (
                <View key={pr.action} style={styles.earnRow}>
                  <Text style={[styles.rowLabel, { flex: 1 }]}>{pr.label}</Text>
                  <Text style={styles.rowCost}>{pr.credits}</Text>
                </View>
              ))}
              <Text style={styles.freeNote}>
                Quotes, charts, news and your watchlist are always free.
              </Text>
            </Card>
          </>
        ) : null}

        {/* ── gifting ──
            Only bought or earned-by-purchase credits move. Daily bonuses,
            streaks and referral rewards stay with the account that earned
            them, or two accounts pass one allowance back and forth. */}
        {gift ? (
          <>
            <SectionTitle>Send credits</SectionTitle>
            <Card>
              <Text style={styles.label}>
                {gift.giftable} of your {gift.balance} credits can be sent ·{' '}
                {gift.remaining_today} left today
              </Text>
              <View style={styles.row}>
                <TextInput
                  value={giftTo}
                  onChangeText={setGiftTo}
                  placeholder="Their username"
                  placeholderTextColor={theme.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                />
                <TextInput
                  value={giftAmt}
                  onChangeText={(t) => setGiftAmt(t.replace(/[^0-9]/g, ''))}
                  placeholder={`min ${gift.minimum}`}
                  placeholderTextColor={theme.muted}
                  keyboardType="numeric"
                  style={[styles.input, { maxWidth: 110 }]}
                />
                <Btn
                  label="Send"
                  onPress={sendGift}
                  disabled={busy || !giftTo.trim() || Number(giftAmt) < gift.minimum}
                />
              </View>
              <Text style={styles.hint}>
                Earned credits — daily bonuses, streaks and referrals — stay with you.
              </Text>
            </Card>
          </>
        ) : null}

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
  dailyRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.md },
  dailyStreak: { color: theme.text, fontSize: theme.fs.xl, fontWeight: '700' },
  dailyNext: { color: theme.brand, fontSize: theme.fs.sm, marginTop: 4 },
  earnRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.md,
    paddingVertical: theme.sp.sm, minHeight: 44 },
  rowLabel: { color: theme.text, fontSize: theme.fs.md },
  rowSub: { color: theme.muted, fontSize: theme.fs.sm, marginTop: 2 },
  rowAmt: { color: theme.green, fontFamily: theme.mono, fontSize: theme.fs.md, fontWeight: '700' },
  rowCost: { color: theme.muted2, fontFamily: theme.mono, fontSize: theme.fs.md },
  freeNote: { color: theme.muted, fontSize: theme.fs.sm, marginTop: theme.sp.sm,
    fontStyle: 'italic' },
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
