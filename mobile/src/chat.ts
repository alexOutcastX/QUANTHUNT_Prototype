// In-app messaging client: device identity + the /chat API.
//
// Identity is a persistent device account — a user_id + handle kept in
// AsyncStorage (no login). The same user_id is stored under a key push.ts reads,
// so this device's push token binds to the user and DMs can reach it.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE } from './api';

const UID_KEY = 'taureye.chat.uid';
const HANDLE_KEY = 'taureye.chat.handle';

export type ChatUser = { user_id: string; handle: string };
export type ChatMessage = {
  id: number;
  conv: string;
  user_id: string | null;
  handle: string;
  text: string;
  ts: number;
};
export type ChatLast = { handle: string; text: string; ts: number };
export type Conversation = {
  conv: string;
  name: string;
  kind: 'global' | 'channel' | 'dm';
  unread: number;
  desc?: string;
  peer?: string;
  last?: ChatLast;
};
export type Overview = { rooms: Conversation[]; dms: Conversation[]; online: number };

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return (await res.json().catch(() => ({}))) as T;
}
async function get<T>(path: string): Promise<T> {
  const res = await fetch(API_BASE + path, { credentials: 'include' });
  return (await res.json()) as T;
}

// ── identity ─────────────────────────────────────────────────────────────────
export async function loadIdentity(): Promise<ChatUser | null> {
  try {
    const [uid, handle] = await Promise.all([
      AsyncStorage.getItem(UID_KEY),
      AsyncStorage.getItem(HANDLE_KEY),
    ]);
    return uid && handle ? { user_id: uid, handle } : null;
  } catch {
    return null;
  }
}

// Create or rename this device's account and persist it. A blank existing uid
// lets the server mint one.
export async function saveIdentity(handle: string): Promise<ChatUser | null> {
  try {
    const cur = await AsyncStorage.getItem(UID_KEY);
    const r = await post<{ ok: boolean; user_id: string; handle: string }>('/chat/identity', {
      user_id: cur || '',
      handle,
    });
    if (r?.user_id) {
      await AsyncStorage.multiSet([
        [UID_KEY, r.user_id],
        [HANDLE_KEY, r.handle],
      ]);
      return { user_id: r.user_id, handle: r.handle };
    }
  } catch {
    /* offline */
  }
  return null;
}

// ── conversations + messages ──────────────────────────────────────────────────
export const overview = (uid: string) =>
  get<Overview>('/chat/overview?user_id=' + encodeURIComponent(uid));

export const messages = (conv: string, since = 0, uid = '') =>
  get<{ conv: string; messages: ChatMessage[] }>(
    '/chat/messages?conv=' + encodeURIComponent(conv) + '&since=' + since +
      '&user_id=' + encodeURIComponent(uid),
  );

export const send = (conv: string, uid: string, text: string) =>
  post<{ ok: boolean; message?: ChatMessage; reason?: string }>('/chat/messages', {
    conv,
    user_id: uid,
    text,
  });

export const findUsers = (q: string, exclude: string) =>
  get<{ users: ChatUser[] }>(
    '/chat/users?q=' + encodeURIComponent(q) + '&exclude=' + encodeURIComponent(exclude),
  );

export const openDm = (from: string, to: string) =>
  post<{ ok: boolean; conv: string }>('/chat/dm', { from, to });

export const markRead = (uid: string, conv: string, lastId: number) =>
  post('/chat/read', { user_id: uid, conv, last_id: lastId });

export const remove = (id: number, uid: string) =>
  fetch(API_BASE + '/chat/messages/' + id, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: uid }),
  }).then((r) => r.ok);
