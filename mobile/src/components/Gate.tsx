// The one place a paywall is implemented.
//
// Before this, hasFeature() was exported from member.ts and called nowhere in
// the interface: the plan ladder, /paywall/<feature> and billing.allows() all
// existed and were tested, while every feature stayed open to anyone who could
// sign in. Gating in one component rather than per screen means it cannot be
// forgotten on a new screen and cannot drift between old ones.
//
// Deliberately soft. A hard "Pro only" door teaches a visitor the product is
// not for them; a blurred result with the count still readable teaches them
// what they are missing, which is the difference between a bounce and a sale.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Btn } from '../ui';
import { theme } from '../theme';
import { hasFeature } from '../member';
import { navigate } from '../navIntent';
import { chargeFor, chargeMessage } from '../credits';

export type GateMode = 'blur' | 'replace';

const PLAN_LABEL: Record<string, string> = {
  free: 'Free',
  pro: 'Pro — ₹1,499/month',
  max: 'Max — ₹4,999/month',
};

export function Gate({
  feature,
  title,
  blurb,
  requiredPlan = 'max',
  mode = 'replace',
  creditAction,
  creditCost,
  creditRef,
  children,
}: {
  feature: string;
  title: string;
  blurb?: string;
  requiredPlan?: 'pro' | 'max';
  mode?: GateMode;
  /** When set, the sheet offers paying with credits as the second way in. */
  creditAction?: string;
  creditCost?: number;
  /** Stable per unlock, so a retried charge cannot bill twice. */
  creditRef?: string;
  children: React.ReactNode;
}) {
  // An unlock bought with credits lasts for this mount. It is deliberately not
  // persisted here: the ledger is the record, and re-deriving entitlement from
  // client state would let a reload grant it for free.
  const [unlocked, setUnlocked] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);

  const buy = React.useCallback(async () => {
    if (!creditAction || busy) return;
    setBusy(true);
    setNote(null);
    const r = await chargeFor(creditAction, creditRef || `gate:${feature}`);
    if (r.ok || (!r.ok && r.reason === 'covered-by-plan')) setUnlocked(true);
    else setNote(chargeMessage(r));
    setBusy(false);
  }, [creditAction, creditRef, feature, busy]);

  if (hasFeature(feature) || unlocked) return <>{children}</>;

  const sheet = (
    <View style={s.sheet} accessibilityRole="summary">
      <Text style={s.title}>{title}</Text>
      {blurb ? <Text style={s.blurb}>{blurb}</Text> : null}
      <View style={s.actions}>
        <Btn
          label={`Unlock with ${PLAN_LABEL[requiredPlan] ?? requiredPlan}`}
          onPress={() => navigate('desk', { sub: 'wallet' })}
        />
        {creditAction && creditCost ? (
          <Btn
            label={busy ? 'Charging…' : `Use ${creditCost} credits`}
            onPress={buy}
            kind="ghost"
            disabled={busy}
          />
        ) : null}
      </View>
      {note ? <Text style={s.note}>{note}</Text> : null}
      {creditAction && creditCost ? (
        <Text style={s.alt}>
          No subscription needed — credits work as a one-off.
        </Text>
      ) : null}
    </View>
  );

  if (mode === 'blur') {
    return (
      <View>
        {/* The content stays on screen, unreadable but visibly present: a count
            of results is far more persuasive than a description of them. */}
        <View style={s.blurred} pointerEvents="none" accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants">
          {children}
        </View>
        {sheet}
      </View>
    );
  }
  return sheet;
}

const s = StyleSheet.create({
  blurred: { opacity: 0.18 },
  sheet: {
    backgroundColor: theme.surface2,
    borderWidth: 1,
    borderColor: theme.border2,
    borderRadius: theme.radius.lg,
    padding: theme.sp.lg,
    gap: theme.sp.sm,
    margin: theme.sp.lg,
    alignItems: 'center',
  },
  title: { color: theme.text, fontSize: theme.fs.lg, fontWeight: '700', textAlign: 'center' },
  blurb: { color: theme.muted2, fontSize: theme.fs.sm, textAlign: 'center', lineHeight: 19 },
  actions: { flexDirection: 'row', gap: theme.sp.sm, flexWrap: 'wrap',
    justifyContent: 'center', marginTop: theme.sp.xs },
  alt: { color: theme.muted, fontSize: theme.fs.xs, textAlign: 'center' },
  note: { color: theme.red, fontSize: theme.fs.sm, textAlign: 'center' },
});

export default Gate;
