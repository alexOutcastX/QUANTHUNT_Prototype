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

export type GateMode = 'blur' | 'replace';

const PLAN_LABEL: Record<string, string> = {
  free: 'Free',
  member: 'Member — ₹499/month',
  pro: 'Pro — ₹1,499/month',
};

export function Gate({
  feature,
  title,
  blurb,
  requiredPlan = 'pro',
  mode = 'replace',
  creditAction,
  creditCost,
  onSpendCredits,
  children,
}: {
  feature: string;
  title: string;
  blurb?: string;
  requiredPlan?: 'member' | 'pro';
  mode?: GateMode;
  /** When set, the sheet offers paying with credits as the second way in. */
  creditAction?: string;
  creditCost?: number;
  onSpendCredits?: () => void;
  children: React.ReactNode;
}) {
  if (hasFeature(feature)) return <>{children}</>;

  const sheet = (
    <View style={s.sheet} accessibilityRole="summary">
      <Text style={s.title}>{title}</Text>
      {blurb ? <Text style={s.blurb}>{blurb}</Text> : null}
      <View style={s.actions}>
        <Btn
          label={`Unlock with ${PLAN_LABEL[requiredPlan] ?? requiredPlan}`}
          onPress={() => navigate('desk', { sub: 'wallet' })}
        />
        {creditAction && creditCost && onSpendCredits ? (
          <Btn label={`Use ${creditCost} credits`} onPress={onSpendCredits} kind="ghost" />
        ) : null}
      </View>
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
});

export default Gate;
