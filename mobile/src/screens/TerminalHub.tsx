// Terminal + Backtest, one destination.
//
// They were two top-level buttons doing halves of the same job: the terminal
// asks "what is this company connected to and what is it doing", the backtest
// asks "would this rule have worked on it". Both are the tools you reach for
// once you have already found a name, both are on the same plan, and both were
// competing for a slot in a nav bar that has room for four.
//
// The switch lives inside the terminal's own header row rather than in a band
// above it. A strip of its own would push a full-bleed workspace down the page
// to say something the header already had room for. Backtest has no header of
// its own, so there the switch row IS its header — same bar, same position,
// nothing moves as you flip between them.
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import BacktestScreen from './BacktestScreen';
import TerminalScreen from './TerminalScreen';
import { peekNav, subscribeNav } from '../navIntent';
import { theme } from '../theme';

export type TerminalSection = 'graph' | 'bt';

const SECTIONS: { key: TerminalSection; label: string }[] = [
  { key: 'graph', label: 'Graph' },
  { key: 'bt', label: 'Backtest' },
];

// Every sub-key that used to mean "the backtest page", from the Desk tab, the
// old top-level route and the command palette. They all land here now.
const BT_SUBS = new Set(['bt', 'backtest']);

function sectionFor(page?: string, sub?: string): TerminalSection | null {
  // The page counts too: a quick-link that still says navigate('backtest')
  // with no sub means the backtest, and arriving on the graph instead would
  // read as a broken link.
  if (page && BT_SUBS.has(page)) return 'bt';
  if (!sub) return null;
  if (BT_SUBS.has(sub)) return 'bt';
  if (sub === 'graph' || sub === 'terminal') return 'graph';
  return null;
}

export function SectionSwitch({
  value,
  onChange,
}: {
  value: TerminalSection;
  onChange: (k: TerminalSection) => void;
}) {
  return (
    <View style={s.switchWrap} accessibilityRole="tablist">
      {SECTIONS.map((sec) => {
        const on = sec.key === value;
        return (
          <TouchableOpacity
            key={sec.key}
            style={[s.switchBtn, on && s.switchBtnOn]}
            onPress={() => onChange(sec.key)}
            activeOpacity={0.75}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
          >
            <Text style={[s.switchTxt, on && s.switchTxtOn]}>{sec.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function TerminalHub() {
  const [section, setSection] = useState<TerminalSection>(() => {
    const p = peekNav();
    return sectionFor(p?.page, p?.sub) || 'graph';
  });
  // A navigate('terminal', { sub: 'bt' }) that arrives while this hub is
  // already mounted must still switch it — otherwise the Desk's backtest link
  // would look like it did nothing.
  useEffect(
    () =>
      subscribeNav(() => {
        const p = peekNav();
        const k = sectionFor(p?.page, p?.sub);
        if (k) setSection(k);
      }),
    [],
  );

  const sw = <SectionSwitch value={section} onChange={setSection} />;

  if (section === 'graph') return <TerminalScreen switcher={sw} />;
  return (
    <View style={s.host}>
      <View style={s.btHead}>
        <Text style={s.btTitle} numberOfLines={1}>BACKTEST</Text>
        {sw}
      </View>
      <BacktestScreen />
    </View>
  );
}

const s = StyleSheet.create({
  host: { flex: 1, backgroundColor: theme.bg },
  // Deliberately the same paddings as TerminalScreen's own head row, so the
  // switch does not shift by a pixel when you use it.
  btHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 12,
    gap: 8,
  },
  btTitle: {
    color: theme.text, fontFamily: theme.mono, fontSize: 13,
    fontWeight: '700', letterSpacing: 1, flex: 1,
  },
  switchWrap: {
    flexDirection: 'row',
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: 999,
    backgroundColor: theme.surface2,
    overflow: 'hidden',
  },
  switchBtn: { paddingHorizontal: 12, paddingVertical: 5 },
  switchBtnOn: { backgroundColor: theme.accent },
  switchTxt: {
    color: theme.muted, fontFamily: theme.mono, fontSize: 11,
    fontWeight: '700', letterSpacing: 1,
  },
  switchTxtOn: { color: theme.bg },
});
