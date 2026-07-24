// Membership session — the login gate's state.
//
// The whole app renders behind LoginGate: nothing loads until a member signs
// in with a username + password (server-checked, signed te_member cookie).
// The member record carries a PLAN and its feature list, so screens gate
// paywalled features with hasFeature('backtest') etc. — the plan ladder lives
// in members.py and rides down with /auth/member.
//
// A cached copy is kept in AsyncStorage so a native app that is briefly
// offline at launch still opens for a previously signed-in member; the server
// remains the authority the moment a request succeeds.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, Member } from './api';

const CACHE_KEY = 'taureye.member.v1';

let member: Member | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* ignore */
    }
  });
}

export function subscribeMember(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function currentMember(): Member | null {
  return member;
}

export function hasFeature(feature: string): boolean {
  return !!member?.features?.includes(feature);
}

/** Boot check: server session first, cached member only as an offline fallback. */
export async function restoreMember(): Promise<Member | null> {
  try {
    const res = await api.memberMe();
    member = res.member;
    if (member) await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(member));
    else await AsyncStorage.removeItem(CACHE_KEY);
  } catch {
    // offline — trust the cached session until the server is reachable again
    const raw = await AsyncStorage.getItem(CACHE_KEY).catch(() => null);
    member = raw ? (JSON.parse(raw) as Member) : null;
  }
  emit();
  return member;
}

export async function memberLogin(username: string, password: string): Promise<Member> {
  const res = await api.memberLogin(username, password);
  if (!res.member) throw new Error('bad-credentials');
  member = res.member;
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(member)).catch(() => {});
  emit();
  return member;
}

export async function memberLogout(): Promise<void> {
  try {
    await api.memberLogout();
  } catch {
    /* clearing locally regardless */
  }
  member = null;
  await AsyncStorage.removeItem(CACHE_KEY).catch(() => {});
  emit();
}
