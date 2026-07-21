// Navigation-mode flag: the redesigned 5-tab shell (Today · Screens · Symbol ·
// Desk · Terminal) is the default; "classic" restores the previous layout
// (Dashboard/Screener/Terminal/Analysis/More + desktop pages bar) as a
// fallback while the redesign beds in. Persisted so the choice survives
// restarts; subscribable so Shell can flip live when toggled from Settings.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'taureye.nav.classic';

let classic = false;
const listeners = new Set<() => void>();

// Kicked off at import time; Shell awaits this before first paint so a
// classic-mode user never sees the new shell flash in.
const hydrated: Promise<void> = AsyncStorage.getItem(KEY)
  .then((v) => {
    classic = v === '1';
  })
  .catch(() => {});

export function navModeReady(): Promise<void> {
  return hydrated;
}

export function isClassicNav(): boolean {
  return classic;
}

export function setClassicNav(v: boolean): void {
  if (v === classic) return;
  classic = v;
  AsyncStorage.setItem(KEY, v ? '1' : '0').catch(() => {});
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* ignore */
    }
  });
}

export function subscribeNavMode(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
