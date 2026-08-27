// Tap any number and find out what it means.
//
// The audit counted 195 numbers on the home screen and 421 on Backtest, none
// of which said what they were or whether higher was better. This is the
// smallest thing that fixes that without changing a single screen's layout:
// wrap a figure, get an explanation.
//
// The glossary is one JSON file shared by every use, so a term is written once
// and reads the same everywhere.
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';
import { Btn, Sheet } from '../ui';
import GLOSSARY from '../data/glossary.json';

export type Term = {
  id: string; term: string; plain: string; better: string; detail: string;
};

const BY_ID: Record<string, Term> = Object.fromEntries(
  (GLOSSARY as Term[]).map((t) => [t.id, t]),
);

export function lookup(id: string): Term | null {
  return BY_ID[id] ?? null;
}

export function allTerms(): Term[] {
  return (GLOSSARY as Term[]).slice().sort((a, b) => a.term.localeCompare(b.term));
}

const BETTER_LABEL: Record<string, string> = {
  higher: 'Higher is better',
  lower: 'Lower is better',
  context: 'Neither high nor low is automatically good',
};

/**
 * Wraps a label or a figure. The child keeps rendering exactly as it did — this
 * adds a dotted underline and a tap target, nothing else, so it can go around
 * existing text without touching layout.
 */
export default function TermTip({
  id,
  children,
  style,
}: {
  id: string;
  children: React.ReactNode;
  style?: object;
}) {
  const [open, setOpen] = React.useState(false);
  const term = lookup(id);
  // An unknown id must not swallow the content it was wrapping.
  if (!term) return <>{children}</>;

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${term.term}. What does this mean?`}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        style={[s.wrap, style]}
      >
        {children}
      </TouchableOpacity>
      {/* Sheet renders when mounted rather than taking an `open` prop. */}
      {open ? (
        <Sheet onClose={() => setOpen(false)}>
          <View style={s.body}>
            <Text style={s.title}>{term.term}</Text>
            <Text style={s.plain}>{term.plain}</Text>
            <Text style={s.better}>{BETTER_LABEL[term.better] ?? ''}</Text>
            <Text style={s.detail}>{term.detail}</Text>
            <Btn label="Got it" onPress={() => setOpen(false)} />
          </View>
        </Sheet>
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  // A dotted underline is the long-standing convention for "there is more
  // here", and it costs no layout.
  wrap: { borderBottomWidth: 1, borderBottomColor: theme.border2, borderStyle: 'dotted' },
  body: { gap: theme.sp.sm, padding: theme.sp.lg },
  title: { color: theme.text, fontSize: theme.fs.xl, fontWeight: '800' },
  plain: { color: theme.text, fontSize: theme.fs.lg, lineHeight: 24 },
  better: { color: theme.brand, fontSize: theme.fs.sm, fontWeight: '700' },
  detail: { color: theme.muted2, fontSize: theme.fs.md, lineHeight: 21 },
});
