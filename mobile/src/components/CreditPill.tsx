// The credit balance, in the header, on every screen.
//
// The wallet used to live at Tab → Desk → More → Wallet: four taps, inside a
// nineteen-item menu, for the entire credit economy. A currency nobody can see
// is a currency nobody uses, and a balance that moves without being noticed
// teaches people the number is decorative.
//
// Polls rather than subscribes because spending happens server-side across
// several endpoints; a single poll on focus is cheaper than wiring every one of
// them to a client store, and the number is never urgent to the second.
import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { api } from '../api';
import { theme } from '../theme';
import { navigate } from '../navIntent';
import { currentMember, subscribeMember } from '../member';

const POLL_MS = 60000;

export default function CreditPill() {
  const [credits, setCredits] = React.useState<number | null>(null);

  const load = React.useCallback(() => {
    if (!currentMember()) return;
    api.wallet()
      .then((w) => setCredits(w.balances.credits))
      // Preview-gated off the public domain, so a 404 here is expected rather
      // than broken. Hide the pill instead of showing an error in the chrome.
      .catch(() => setCredits(null));
  }, []);

  React.useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    const un = subscribeMember(load);
    return () => { clearInterval(id); un(); };
  }, [load]);

  if (credits === null) return null;

  return (
    <TouchableOpacity
      style={s.pill}
      onPress={() => navigate('desk', { sub: 'wallet' })}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`${credits} credits. Open wallet`}
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
    >
      <Text style={s.dot}>◆</Text>
      <Text style={s.num}>{credits}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    // 32px tall inside a 64px bar, with hitSlop taking the touch target past 44.
    height: 32,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border2,
    backgroundColor: theme.surface2,
  },
  dot: { color: theme.brand, fontSize: 11 },
  num: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.sm, fontWeight: '700' },
});
