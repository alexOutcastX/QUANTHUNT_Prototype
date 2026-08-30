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
//
// Soft, but not porous. This sheet used to offer "Use 10 credits" beside the
// upgrade, so anyone who collected a week of daily bonuses could open the
// backtest without ever subscribing — the wallet was a second, cheaper paywall
// running beside the real one, undercutting the ladder it sat next to. The
// plan is the only way through now. Credits meter how much of a feature you
// use once you have it; they do not sell the feature. See credits.ts.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Btn } from '../ui';
import { theme } from '../theme';
import { hasFeature } from '../member';
import { navigate } from '../navIntent';

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
  children,
}: {
  feature: string;
  title: string;
  blurb?: string;
  requiredPlan?: 'pro' | 'max';
  mode?: GateMode;
  children: React.ReactNode;
}) {
  // One condition, and it is the plan. There is deliberately no local
  // "unlocked" state: anything a component could set to open this door is
  // something a reload could set for free.
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
      </View>
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
});

export default Gate;
