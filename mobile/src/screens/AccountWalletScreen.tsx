// Account and Wallet as one destination.
//
// They were two desk tabs asking the same question — who am I signed in as,
// and what does that entitle me to — so the plan, the credits and the sync
// state were split across two pages that each told half the story. One page
// now: identity and data on the left segment, the credit economy on the other.
//
// The wallet half only exists where its endpoints do (see usePreview), so on
// hosts without it the page is simply the account, with no segments and no
// dead tab to tap.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import AccountScreen from './AccountScreen';
import WalletScreen from './WalletScreen';
import { ScreenTitle, Segmented } from '../ui';
import { usePreview } from '../usePreview';
import { theme } from '../theme';

type Tab = 'account' | 'wallet';

export default function AccountWalletScreen() {
  const preview = usePreview();
  const [tab, setTab] = useState<Tab>('account');
  const wallet = preview && tab === 'wallet';
  return (
    <View style={s.container}>
      <ScreenTitle
        title="Account"
        sub={
          wallet
            ? 'Credits, daily bonus, referrals and your plan'
            : 'Sign-in, membership, cloud sync across devices'
        }
      />
      {preview ? (
        <Segmented
          items={[
            { key: 'account', label: 'Account' },
            { key: 'wallet', label: 'Wallet' },
          ]}
          value={tab}
          onChange={setTab}
        />
      ) : null}
      {wallet ? <WalletScreen embedded /> : <AccountScreen />}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
});
