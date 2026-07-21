// Community messaging: a global room, topic channels, and 1:1 DMs.
// Device-based identity (pick a handle, no login). Near-real-time via polling.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import {
  ChatMessage, ChatUser, Conversation, Overview,
  findUsers, loadIdentity, markRead, messages, openDm, overview, saveIdentity, send,
} from '../chat';
import { Card, EmptyState, Loading } from '../ui';
import { theme } from '../theme';

const ago = (t: number) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - t));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

export default function ChatScreen() {
  const [me, setMe] = useState<ChatUser | null | undefined>(undefined);
  const [handle, setHandle] = useState('');
  const [active, setActive] = useState<Conversation | null>(null);

  useEffect(() => {
    loadIdentity().then((u) => {
      setMe(u);
      if (u) setHandle(u.handle);
    });
  }, []);

  if (me === undefined) return <Loading label="Loading community…" />;

  // ── identity setup ──
  if (!me) {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.setupPad}>
          <Card style={styles.setupCard}>
            <Text style={styles.setupTitle}>Join the community</Text>
            <Text style={styles.setupSub}>
              Pick a handle other traders will see. No email, no password — it's tied to this device.
            </Text>
            <TextInput
              value={handle}
              onChangeText={setHandle}
              placeholder="e.g. bull_raja"
              placeholderTextColor={theme.muted}
              style={styles.setupInput}
              autoCapitalize="none"
              maxLength={24}
            />
            <TouchableOpacity
              style={[styles.primaryBtn, !handle.trim() && { opacity: 0.5 }]}
              disabled={!handle.trim()}
              onPress={async () => {
                const u = await saveIdentity(handle.trim());
                if (u) setMe(u);
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.primaryTxt}>Enter chat</Text>
            </TouchableOpacity>
            <Text style={styles.disc}>
              Be respectful. Messages are public to all app users; not investment advice.
            </Text>
          </Card>
        </ScrollView>
      </View>
    );
  }

  if (active) {
    return <Thread me={me} conv={active} onBack={() => setActive(null)} />;
  }
  return <ConvList me={me} onOpen={setActive} onRename={(u) => setMe(u)} />;
}

// ── conversation list ─────────────────────────────────────────────────────────
function ConvList({
  me, onOpen, onRename,
}: { me: ChatUser; onOpen: (c: Conversation) => void; onRename: (u: ChatUser) => void }) {
  const [ov, setOv] = useState<Overview | null>(null);
  const [newDm, setNewDm] = useState(false);

  const load = useCallback(() => {
    overview(me.user_id).then(setOv).catch(() => setOv({ rooms: [], dms: [], online: 0 }));
  }, [me.user_id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  if (newDm) {
    return (
      <NewDm
        me={me}
        onClose={() => setNewDm(false)}
        onPicked={async (peer) => {
          const r = await openDm(me.user_id, peer.user_id);
          setNewDm(false);
          if (r?.conv) onOpen({ conv: r.conv, name: peer.handle, kind: 'dm', unread: 0, peer: peer.user_id });
        }}
      />
    );
  }

  const Row = ({ c }: { c: Conversation }) => (
    <TouchableOpacity style={styles.row} onPress={() => onOpen(c)} activeOpacity={0.7}>
      <View style={[styles.avatar, c.kind === 'dm' && { backgroundColor: theme.brandSoft }]}>
        <Text style={styles.avatarTxt}>{c.kind === 'global' ? '◎' : c.kind === 'dm' ? '@' : '#'}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName} numberOfLines={1}>{c.name}</Text>
        <Text style={styles.rowLast} numberOfLines={1}>
          {c.last ? `${c.last.handle}: ${c.last.text}` : c.desc || 'No messages yet'}
        </Text>
      </View>
      {c.last ? <Text style={styles.rowTime}>{ago(c.last.ts)}</Text> : null}
      {c.unread > 0 ? (
        <View style={styles.badge}><Text style={styles.badgeTxt}>{c.unread > 99 ? '99+' : c.unread}</Text></View>
      ) : null}
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Community</Text>
          <Text style={styles.subtle}>
            {ov ? `${ov.online} online · you are ${me.handle}` : 'Loading…'}
          </Text>
        </View>
        <TouchableOpacity style={styles.newBtn} onPress={() => setNewDm(true)} activeOpacity={0.8}>
          <Text style={styles.newTxt}>✎ Message</Text>
        </TouchableOpacity>
      </View>
      {!ov ? (
        <Loading />
      ) : (
        <ScrollView contentContainerStyle={styles.listPad}>
          <Text style={styles.sec}>ROOMS</Text>
          {ov.rooms.map((c) => <Row key={c.conv} c={c} />)}
          <Text style={styles.sec}>DIRECT MESSAGES</Text>
          {ov.dms.length ? ov.dms.map((c) => <Row key={c.conv} c={c} />) : (
            <Text style={styles.emptyDm}>No DMs yet — tap “✎ Message” to start one.</Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ── user search for a new DM ───────────────────────────────────────────────────
function NewDm({
  me, onClose, onPicked,
}: { me: ChatUser; onClose: () => void; onPicked: (u: ChatUser) => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<ChatUser[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return; }
    const t = setTimeout(() => {
      findUsers(q.trim(), me.user_id).then((r) => setRes(r.users || [])).catch(() => setRes([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, me.user_id]);
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} hitSlop={10}><Text style={styles.back}>‹ Back</Text></TouchableOpacity>
        <Text style={[styles.title, { flex: 1, textAlign: 'center' }]}>New message</Text>
        <View style={{ width: 54 }} />
      </View>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search handles…"
        placeholderTextColor={theme.muted}
        style={styles.search}
        autoCapitalize="none"
        autoFocus
      />
      <ScrollView contentContainerStyle={styles.listPad}>
        {q.trim().length < 2 ? (
          <EmptyState icon="✎" title="Find someone" hint="Type at least 2 letters of a handle." />
        ) : res.length ? (
          res.map((u) => (
            <TouchableOpacity key={u.user_id} style={styles.row} onPress={() => onPicked(u)} activeOpacity={0.7}>
              <View style={[styles.avatar, { backgroundColor: theme.brandSoft }]}><Text style={styles.avatarTxt}>@</Text></View>
              <Text style={[styles.rowName, { flex: 1 }]}>{u.handle}</Text>
              <Text style={styles.rowTime}>Message ›</Text>
            </TouchableOpacity>
          ))
        ) : (
          <EmptyState icon="◇" title="No matches" hint="No handle found for that search." />
        )}
      </ScrollView>
    </View>
  );
}

// ── message thread ─────────────────────────────────────────────────────────────
function Thread({ me, conv, onBack }: { me: ChatUser; conv: Conversation; onBack: () => void }) {
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const sinceRef = useRef(0);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const poll = useCallback(async () => {
    try {
      const r = await messages(conv.conv, sinceRef.current, me.user_id);
      const fresh = r.messages || [];
      if (fresh.length) {
        sinceRef.current = fresh[fresh.length - 1].id;
        setMsgs((prev) => [...(prev || []), ...fresh]);
        markRead(me.user_id, conv.conv, sinceRef.current).catch(() => {});
      } else if (msgs === null) {
        setMsgs([]);
      }
    } catch {
      if (msgs === null) setMsgs([]);
    }
  }, [conv.conv, me.user_id, msgs]);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 3500);
    return () => clearInterval(t);
  }, [poll]);

  useEffect(() => {
    if (msgs?.length) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
  }, [msgs]);

  const doSend = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setText('');
    try {
      const r = await send(conv.conv, me.user_id, t);
      if (r?.message) {
        sinceRef.current = Math.max(sinceRef.current, r.message.id);
        setMsgs((prev) => [...(prev || []), r.message as ChatMessage]);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={10}><Text style={styles.back}>‹</Text></TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.title} numberOfLines={1}>
            {conv.kind === 'dm' ? '@' : conv.kind === 'channel' ? '#' : ''}{conv.name}
          </Text>
          <Text style={styles.subtle}>{conv.kind === 'dm' ? 'Direct message' : conv.desc || 'Community room'}</Text>
        </View>
      </View>
      {msgs === null ? (
        <Loading />
      ) : (
        <FlatList
          ref={listRef}
          data={msgs}
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={styles.threadPad}
          ListEmptyComponent={<EmptyState icon="✎" title="No messages yet" hint="Say hello." />}
          renderItem={({ item }) => {
            const mine = item.user_id === me.user_id;
            return (
              <View style={[styles.bubbleRow, mine && { justifyContent: 'flex-end' }]}>
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
                  {!mine ? <Text style={styles.bubbleHandle}>{item.handle}</Text> : null}
                  <Text style={[styles.bubbleTxt, mine && { color: theme.onAccent }]}>{item.text}</Text>
                  <Text style={[styles.bubbleTime, mine && { color: theme.onAccent, opacity: 0.7 }]}>{ago(item.ts)}</Text>
                </View>
              </View>
            );
          }}
        />
      )}
      <View style={styles.inputBar}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Message…"
          placeholderTextColor={theme.muted}
          style={styles.input}
          multiline
          maxLength={1000}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!text.trim() || sending) && { opacity: 0.5 }]}
          onPress={doSend}
          disabled={!text.trim() || sending}
          activeOpacity={0.8}
        >
          {sending ? <ActivityIndicator color={theme.onAccent} size="small" /> : <Text style={styles.sendTxt}>➤</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.sp.lg,
    paddingTop: theme.sp.md, paddingBottom: theme.sp.sm, gap: theme.sp.sm,
    borderBottomColor: theme.border, borderBottomWidth: 1, backgroundColor: theme.surface,
  },
  title: { color: theme.text, fontSize: theme.fs.lg, fontWeight: '800' },
  subtle: { color: theme.muted, fontSize: theme.fs.xs + 1, marginTop: 1 },
  back: { color: theme.brand, fontSize: theme.fs.xl, fontWeight: '700', paddingRight: 6 },
  newBtn: { backgroundColor: theme.accent, borderRadius: 999, paddingHorizontal: theme.sp.md, paddingVertical: 7 },
  newTxt: { color: theme.onAccent, fontSize: theme.fs.sm, fontWeight: '800' },
  listPad: { padding: theme.sp.lg, gap: 2 },
  sec: { color: theme.muted, fontSize: theme.fs.xs + 1, fontWeight: '800', letterSpacing: 1.2, marginTop: theme.sp.md, marginBottom: theme.sp.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.md, paddingVertical: theme.sp.md, borderBottomColor: theme.border, borderBottomWidth: 1 },
  avatar: { width: 40, height: 40, borderRadius: 999, backgroundColor: theme.surface2, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { color: theme.brand, fontSize: theme.fs.md, fontWeight: '800' },
  rowName: { color: theme.text, fontSize: theme.fs.md, fontWeight: '700' },
  rowLast: { color: theme.muted2, fontSize: theme.fs.sm, marginTop: 2 },
  rowTime: { color: theme.muted, fontSize: theme.fs.xs + 1 },
  badge: { minWidth: 22, height: 22, borderRadius: 999, backgroundColor: theme.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginLeft: 6 },
  badgeTxt: { color: '#fff', fontSize: theme.fs.xs, fontWeight: '800' },
  emptyDm: { color: theme.muted, fontSize: theme.fs.sm, paddingVertical: theme.sp.md },
  // setup
  setupPad: { padding: theme.sp.lg, paddingTop: theme.sp.xl },
  setupCard: { gap: theme.sp.sm, padding: theme.sp.xl },
  setupTitle: { color: theme.text, fontSize: theme.fs.xl, fontWeight: '800' },
  setupSub: { color: theme.muted2, fontSize: theme.fs.sm, lineHeight: 20 },
  setupInput: {
    backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1,
    borderRadius: theme.radius.md, color: theme.text, fontSize: theme.fs.lg, fontWeight: '700',
    paddingHorizontal: theme.sp.md, paddingVertical: theme.sp.md, marginTop: theme.sp.sm,
  },
  primaryBtn: { backgroundColor: theme.accent, borderRadius: theme.radius.md, alignItems: 'center', paddingVertical: 13, marginTop: theme.sp.sm },
  primaryTxt: { color: theme.onAccent, fontSize: theme.fs.md, fontWeight: '800' },
  disc: { color: theme.muted, fontSize: theme.fs.xs + 1, lineHeight: 16, marginTop: theme.sp.sm },
  search: {
    backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1,
    borderRadius: theme.radius.md, color: theme.text, fontSize: theme.fs.md,
    margin: theme.sp.lg, marginBottom: 0, paddingHorizontal: theme.sp.md, paddingVertical: theme.sp.sm + 2,
  },
  // thread
  threadPad: { padding: theme.sp.lg, gap: theme.sp.sm, flexGrow: 1 },
  bubbleRow: { flexDirection: 'row' },
  bubble: { maxWidth: '82%', borderRadius: theme.radius.lg, paddingHorizontal: theme.sp.md, paddingVertical: theme.sp.sm },
  bubbleOther: { backgroundColor: theme.surface2, borderTopLeftRadius: 4 },
  bubbleMine: { backgroundColor: theme.accent, borderTopRightRadius: 4 },
  bubbleHandle: { color: theme.brand, fontSize: theme.fs.xs + 1, fontWeight: '800', marginBottom: 2 },
  bubbleTxt: { color: theme.text, fontSize: theme.fs.md, lineHeight: 20 },
  bubbleTime: { color: theme.muted, fontSize: 9, alignSelf: 'flex-end', marginTop: 3 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: theme.sp.sm, padding: theme.sp.sm, paddingHorizontal: theme.sp.md, borderTopColor: theme.border, borderTopWidth: 1, backgroundColor: theme.surface },
  input: {
    flex: 1, maxHeight: 120, backgroundColor: theme.surface2, borderColor: theme.border2, borderWidth: 1,
    borderRadius: theme.radius.lg, color: theme.text, fontSize: theme.fs.md,
    paddingHorizontal: theme.sp.md, paddingVertical: Platform.OS === 'ios' ? 10 : 6,
  },
  sendBtn: { width: 42, height: 42, borderRadius: 999, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' },
  sendTxt: { color: theme.onAccent, fontSize: theme.fs.lg, fontWeight: '800' },
});
