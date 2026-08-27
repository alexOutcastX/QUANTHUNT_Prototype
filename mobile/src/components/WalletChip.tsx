// Streak and credit balance, as ONE control in the header.
//
// These began as two chips (StreakChip + CreditPill). Measuring the header bar
// settled it: two chips cost ~118px in a row that was already 62px over budget
// at 1440, and the fix is not to shrink the navigation — it is that two
// adjacent controls which both open the Wallet were always one control.
//
// Shows the balance always, and the streak only when there is one or a claim is
// waiting. An unclaimed bonus rings the chip green: an invitation, not an alarm.
import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { api } from '../api';
import { theme } from '../theme';
import { navigate } from '../navIntent';
import { currentMember, subscribeMember } from '../member';
import { subscribeCredits } from '../credits';

const POLL_MS = 60000;

export default function WalletChip() {
  const [credits, setCredits] = React.useState<number | null>(null);
  const [streak, setStreak] = React.useState(0);
  const [claimable, setClaimable] = React.useState(false);

  const load = React.useCallback(() => {
    if (!currentMember()) return;
    // One call: /wallet/earn carries the balance and the daily status together,
    // so the chip costs a single request rather than two.
    api.walletEarn()
      .then((e) => {
        setCredits(e.balance);
        setStreak(e.daily.streak);
        setClaimable(e.daily.claimable);
      })
      // Preview-gated off the public domain, so a 404 here means "not
      // available", not "broken". Hide rather than show an error in the chrome.
      .catch(() => setCredits(null));
  }, []);

  React.useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    const unMember = subscribeMember(load);
    const unCredits = subscribeCredits(load);
    return () => { clearInterval(id); unMember(); unCredits(); };
  }, [load]);

  if (credits === null) return null;

  const showStreak = streak > 0 || claimable;
  const label = claimable
    ? `${credits} credits. Today's bonus is unclaimed. Open wallet`
    : streak
      ? `${credits} credits, day ${streak} streak. Open wallet`
      : `${credits} credits. Open wallet`;

  return (
    <TouchableOpacity
      style={[s.chip, claimable && s.chipLive]}
      onPress={() => navigate('desk', { sub: 'wallet' })}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
    >
      {showStreak ? (
        <Text style={[s.streak, claimable && s.streakLive]}>
          ▲{streak || ''}
        </Text>
      ) : null}
      <Text style={s.dot}>◆</Text>
      <Text style={s.num}>{credits}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    height: 32,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border2,
    backgroundColor: theme.surface2,
  },
  chipLive: { borderColor: theme.green },
  streak: { color: theme.muted, fontFamily: theme.mono, fontSize: theme.fs.xs + 1, fontWeight: '700' },
  streakLive: { color: theme.green },
  dot: { color: theme.brand, fontSize: 10 },
  num: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm, fontWeight: '700' },
});
