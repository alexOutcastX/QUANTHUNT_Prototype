// Announcements: a public in-app inbox of dev broadcasts, plus an owner-only
// composer. Works with no Firebase — messages appear here for everyone; once FCM
// is configured they also push to devices.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Broadcast, api } from '../api';
import { Card, EmptyState, Loading, SectionTitle } from '../ui';
import { theme } from '../theme';

const when = (t: number) =>
  new Date(t * 1000).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export default function AnnouncementsScreen() {
  const [items, setItems] = useState<Broadcast[] | null>(null);
  const [owner, setOwner] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [flash, setFlash] = useState('');

  const load = useCallback(() => {
    api.broadcasts().then((r) => setItems((r.items || []).slice().reverse())).catch(() => setItems([]));
    api.authStatus().then((s) => setOwner(!!s.owner)).catch(() => setOwner(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    if (sending || (!title.trim() && !body.trim())) return;
    setSending(true);
    try {
      const r = await api.broadcastSend(title.trim(), body.trim());
      if (r.ok) {
        setTitle(''); setBody('');
        setFlash(r.sent ? `Sent · pushed to ${r.sent} device${r.sent === 1 ? '' : 's'}` : 'Posted (push not configured)');
        load();
      } else {
        setFlash('Send failed');
      }
    } catch {
      setFlash('Owner login required to broadcast');
    } finally {
      setSending(false);
      setTimeout(() => setFlash(''), 2600);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.body}>
        {owner ? (
          <Card style={styles.composer}>
            <SectionTitle>Broadcast to all users</SectionTitle>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Title (e.g. New build live)"
              placeholderTextColor={theme.muted}
              style={styles.input}
              maxLength={80}
            />
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder="Message…"
              placeholderTextColor={theme.muted}
              style={[styles.input, styles.bodyInput]}
              multiline
              maxLength={500}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (sending || (!title.trim() && !body.trim())) && { opacity: 0.5 }]}
              onPress={send}
              disabled={sending || (!title.trim() && !body.trim())}
              activeOpacity={0.8}
            >
              {sending ? <ActivityIndicator color={theme.onAccent} size="small" /> : <Text style={styles.sendTxt}>Send announcement</Text>}
            </TouchableOpacity>
          </Card>
        ) : null}

        <SectionTitle>Announcements</SectionTitle>
        {items === null ? (
          <Loading />
        ) : items.length ? (
          items.map((b, i) => (
            <Card key={i} style={styles.item}>
              {b.title ? <Text style={styles.itemTitle}>{b.title}</Text> : null}
              {b.body ? <Text style={styles.itemBody}>{b.body}</Text> : null}
              <Text style={styles.itemWhen}>{when(b.ts)}</Text>
            </Card>
          ))
        ) : (
          <EmptyState icon="▤" title="No announcements yet" hint="Updates and notices from the team will appear here." />
        )}
      </ScrollView>
      {flash ? <View style={styles.toast} pointerEvents="none"><Text style={styles.toastTxt}>{flash}</Text></View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  body: { padding: theme.sp.lg, paddingBottom: 44 },
  composer: { gap: theme.sp.sm, marginBottom: theme.sp.md },
  input: {
    backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1,
    borderRadius: theme.radius.sm + 2, color: theme.text, fontSize: theme.fs.md,
    paddingHorizontal: theme.sp.md, paddingVertical: theme.sp.sm + 2,
  },
  bodyInput: { minHeight: 72, textAlignVertical: 'top' },
  sendBtn: { backgroundColor: theme.accent, borderRadius: theme.radius.sm + 2, alignItems: 'center', paddingVertical: 11 },
  sendTxt: { color: theme.onAccent, fontSize: theme.fs.md, fontWeight: '800' },
  item: { gap: 4, marginBottom: theme.sp.sm },
  itemTitle: { color: theme.text, fontSize: theme.fs.md + 1, fontWeight: '800' },
  itemBody: { color: theme.muted2, fontSize: theme.fs.sm + 1, lineHeight: 20 },
  itemWhen: { color: theme.muted, fontSize: theme.fs.xs + 1, marginTop: 2 },
  toast: { position: 'absolute', bottom: 24, left: 0, right: 0, alignItems: 'center' },
  toastTxt: {
    backgroundColor: theme.surface3, borderColor: theme.border2, borderWidth: 1, borderRadius: 999,
    color: theme.text, fontSize: theme.fs.sm, fontWeight: '600', overflow: 'hidden',
    paddingHorizontal: theme.sp.lg, paddingVertical: theme.sp.sm,
  },
});
