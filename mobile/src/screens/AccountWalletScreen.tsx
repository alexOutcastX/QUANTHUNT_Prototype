// Account and Wallet as one page — not two, and not one with tabs.
//
// They were two desk tabs asking the same question — who am I signed in as,
// and what does that entitle me to — so the plan, the credits and the sync
// state were split across two pages that each told half the story. Folding
// them together left a segmented control at the top, which was the same split
// wearing a smaller hat: you still had to know which half a thing was on
// before you could go and look at it. There is one page now and you scroll it.
//
// Order follows how often a thing is looked at: credits and the daily bonus,
// then referrals, then the plan, then the account itself — sign-in state,
// cloud sync and deletion, which are read once and then not again.
//
// The wallet half only exists where its endpoints do (see usePreview), so on
// hosts without it the page is simply the account.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import AccountScreen from './AccountScreen';
import WalletScreen from './WalletScreen';
import { ScreenTitle } from '../ui';
import { usePreview } from '../usePreview';
import { theme } from '../theme';

export default function AccountWalletScreen() {
  const preview = usePreview();
  return (
    <View style={s.container}>
      <ScreenTitle
        title="Account"
        sub={
          preview
            ? 'Credits, daily bonus, referrals and your plan · sign-in and cloud sync'
            : 'Sign-in, membership, cloud sync across devices'
        }
      />
      {preview ? (
        <WalletScreen embedded tail={<AccountScreen embedded />} />
      ) : (
        <AccountScreen />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
});
