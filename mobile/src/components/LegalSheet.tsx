// The disclaimer, over whatever you were doing.
//
// The header's DISCLAIMER control used to call Linking.openURL('/legal.html'),
// which on the web replaces the app with a plain document and in a standalone
// install opens a page with nothing to go back to — you could read the
// disclaimer, and then you were stuck in it. It is a thing you glance at and
// dismiss, so it is a sheet: it draws over the page, has a close button, and
// hands you back exactly where you were.
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LEGAL_NOTE, LEGAL_SECTIONS, LEGAL_TITLE } from '../legal';
import { Sheet } from '../ui';
import { theme } from '../theme';

export default function LegalSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet onClose={onClose} maxHeight="92%">
      <View style={s.head}>
        <Text style={s.title}>{LEGAL_TITLE}</Text>
        <TouchableOpacity
          onPress={onClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Close the disclaimer"
        >
          <Text style={s.close}>✕ Close</Text>
        </TouchableOpacity>
      </View>
      <ScrollView bounces={false} contentContainerStyle={s.body}>
        {LEGAL_SECTIONS.map((sec) => (
          <View key={sec.title} style={s.section}>
            <Text style={s.secTitle}>{sec.title.toUpperCase()}</Text>
            {sec.blocks.map((b, i) => (
              <View key={i} style={b.kind === 'li' ? s.liRow : undefined}>
                {b.kind === 'li' ? <Text style={s.bullet}>•</Text> : null}
                <Text style={s.text}>{b.text}</Text>
              </View>
            ))}
          </View>
        ))}
        <Text style={s.note}>{LEGAL_NOTE}</Text>
      </ScrollView>
    </Sheet>
  );
}

const s = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.sp.lg,
    paddingTop: theme.sp.lg,
    paddingBottom: theme.sp.md,
    borderBottomColor: theme.border2,
    borderBottomWidth: 1,
  },
  title: { color: theme.text, fontSize: theme.fs.lg, fontWeight: '800' },
  close: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '700' },
  body: { paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.xl },
  section: { marginTop: theme.sp.lg, gap: theme.sp.sm },
  secTitle: {
    color: theme.muted2, fontSize: theme.fs.xs, fontWeight: '800', letterSpacing: 1,
    borderBottomColor: theme.border, borderBottomWidth: 1, paddingBottom: 6,
  },
  liRow: { flexDirection: 'row', gap: theme.sp.sm },
  bullet: { color: theme.muted, fontSize: theme.fs.sm + 1, lineHeight: 21 },
  text: { color: theme.muted2, fontSize: theme.fs.sm + 1, lineHeight: 21, flex: 1 },
  note: {
    color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 18,
    marginTop: theme.sp.xl, borderTopColor: theme.border2, borderTopWidth: 1,
    paddingTop: theme.sp.md,
  },
});
