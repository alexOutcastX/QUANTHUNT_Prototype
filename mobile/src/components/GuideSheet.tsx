// The guide, over whatever you were doing.
//
// Same shape as the disclaimer sheet, for the same reason: it is something you
// open with a question, read one answer from, and dismiss — not somewhere to
// be sent. It draws on top, has a close button, and gives you back the page you
// were on.
//
// Unlike the disclaimer it is long, so it is not one scroll. Chapters are
// listed first and one is read at a time, with a search box that filters across
// every section of every chapter — because the way anyone uses a manual is to
// arrive with a word ("RSI", "credits", "universe") rather than to read it in
// order.
import React, { useMemo, useState } from 'react';
import {
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import {
  GUIDE_CHAPTERS, GUIDE_INTRO, GUIDE_NOTE, GUIDE_TITLE, GuideChapter,
} from '../guide';
import { Sheet } from '../ui';
import { theme } from '../theme';

/** Every word a chapter can be found by, lowercased once per chapter. */
function haystack(c: GuideChapter): string {
  const parts = [c.title, c.blurb];
  for (const s of c.sections) {
    parts.push(s.title);
    for (const b of s.blocks) {
      if (b.kind === 'term') parts.push(b.term);
      parts.push(b.text);
    }
  }
  return parts.join(' ').toLowerCase();
}

export default function GuideSheet({ onClose }: { onClose: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();

  const index = useMemo(
    () => GUIDE_CHAPTERS.map((c) => ({ c, hay: haystack(c) })), [],
  );
  const matches = useMemo(
    () => (query ? index.filter((e) => e.hay.includes(query)).map((e) => e.c) : GUIDE_CHAPTERS),
    [index, query],
  );

  const chapter = openId ? GUIDE_CHAPTERS.find((c) => c.id === openId) || null : null;

  return (
    <Sheet onClose={onClose} maxHeight="92%">
      <View style={s.head}>
        {chapter ? (
          <TouchableOpacity
            onPress={() => setOpenId(null)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Back to the guide contents"
          >
            <Text style={s.back}>‹ Guide</Text>
          </TouchableOpacity>
        ) : (
          <Text style={s.title}>{GUIDE_TITLE}</Text>
        )}
        <TouchableOpacity
          onPress={onClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Close the guide"
        >
          <Text style={s.close}>✕ Close</Text>
        </TouchableOpacity>
      </View>

      {chapter ? (
        <ScrollView bounces={false} contentContainerStyle={s.body}>
          <Text style={s.chTitle}>{chapter.title}</Text>
          <Text style={s.chBlurb}>{chapter.blurb}</Text>
          {chapter.sections.map((sec) => (
            <View key={sec.title} style={s.section}>
              <Text style={s.secTitle}>{sec.title.toUpperCase()}</Text>
              {sec.blocks.map((b, i) => {
                if (b.kind === 'term') {
                  return (
                    <View key={i} style={s.termRow}>
                      <Text style={s.term}>{b.term}</Text>
                      <Text style={s.text}>{b.text}</Text>
                    </View>
                  );
                }
                if (b.kind === 'note') {
                  return <Text key={i} style={s.inlineNote}>{b.text}</Text>;
                }
                if (b.kind === 'li') {
                  return (
                    <View key={i} style={s.liRow}>
                      <Text style={s.bullet}>•</Text>
                      <Text style={s.text}>{b.text}</Text>
                    </View>
                  );
                }
                return <Text key={i} style={s.text}>{b.text}</Text>;
              })}
            </View>
          ))}
          <Text style={s.note}>{GUIDE_NOTE}</Text>
        </ScrollView>
      ) : (
        <ScrollView bounces={false} contentContainerStyle={s.body}>
          <Text style={s.intro}>{GUIDE_INTRO}</Text>
          <TextInput
            style={s.search}
            value={q}
            onChangeText={setQ}
            placeholder="Search the guide — RSI, credits, universe…"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search the guide"
          />
          {matches.length === 0 ? (
            <Text style={s.empty}>
              Nothing in the guide mentions “{q.trim()}”. Try a shorter word.
            </Text>
          ) : null}
          {matches.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={s.card}
              onPress={() => setOpenId(c.id)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={`Open the guide chapter: ${c.title}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>{c.title}</Text>
                <Text style={s.cardBlurb}>{c.blurb}</Text>
              </View>
              <Text style={s.chev}>›</Text>
            </TouchableOpacity>
          ))}
          <Text style={s.note}>{GUIDE_NOTE}</Text>
        </ScrollView>
      )}
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
  back: { color: theme.accent, fontSize: theme.fs.md, fontWeight: '700' },
  close: { color: theme.muted2, fontSize: theme.fs.sm, fontWeight: '700' },
  body: { paddingHorizontal: theme.sp.lg, paddingBottom: theme.sp.xl },
  intro: {
    color: theme.muted2, fontSize: theme.fs.sm + 1, lineHeight: 21,
    marginTop: theme.sp.md,
  },
  search: {
    backgroundColor: theme.surface2,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    color: theme.text,
    fontSize: theme.fs.sm + 1,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm + 2,
    marginTop: theme.sp.md,
  },
  empty: { color: theme.muted, fontSize: theme.fs.sm, marginTop: theme.sp.lg },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.md,
    backgroundColor: theme.surface,
    borderColor: theme.border2,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.sp.md,
    marginTop: theme.sp.sm,
  },
  cardTitle: { color: theme.text, fontSize: theme.fs.md, fontWeight: '700' },
  cardBlurb: { color: theme.muted, fontSize: theme.fs.sm, marginTop: 2, lineHeight: 18 },
  chev: { color: theme.muted, fontSize: theme.fs.lg },
  chTitle: { color: theme.text, fontSize: theme.fs.xl, fontWeight: '800', marginTop: theme.sp.md },
  chBlurb: { color: theme.muted, fontSize: theme.fs.sm + 1, marginTop: 4, lineHeight: 20 },
  section: { marginTop: theme.sp.lg, gap: theme.sp.sm },
  secTitle: {
    color: theme.muted2, fontSize: theme.fs.xs, fontWeight: '800', letterSpacing: 1,
    borderBottomColor: theme.border, borderBottomWidth: 1, paddingBottom: 6,
  },
  text: { color: theme.muted2, fontSize: theme.fs.sm + 1, lineHeight: 21, flex: 1 },
  liRow: { flexDirection: 'row', gap: theme.sp.sm },
  bullet: { color: theme.muted, fontSize: theme.fs.sm + 1, lineHeight: 21 },
  termRow: {
    borderLeftColor: theme.border2, borderLeftWidth: 2,
    paddingLeft: theme.sp.md, gap: 2,
  },
  term: { color: theme.text, fontSize: theme.fs.sm + 1, fontWeight: '700' },
  inlineNote: {
    color: theme.brand, fontSize: theme.fs.sm, lineHeight: 19,
    backgroundColor: theme.surface2, borderRadius: theme.radius.sm,
    paddingHorizontal: theme.sp.md, paddingVertical: theme.sp.sm,
  },
  note: {
    color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 18,
    marginTop: theme.sp.xl, borderTopColor: theme.border2, borderTopWidth: 1,
    paddingTop: theme.sp.md,
  },
});
