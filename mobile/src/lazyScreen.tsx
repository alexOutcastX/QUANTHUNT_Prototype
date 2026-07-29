// Code-splitting helper. Wrapping a screen's import() in React.lazy makes
// Metro emit it as a separate web chunk, fetched the first time the screen is
// actually opened — so first paint only parses the shell + Dashboard instead
// of every screen in the app. The Suspense boundary lives inside the wrapper,
// keeping call sites drop-in identical to a static import.
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { theme } from './theme';

// The fallback used to be an empty <View>. Opening a tab whose chunk wasn't
// cached therefore painted a blank black rectangle with no spinner, no
// skeleton and no text — indistinguishable from a screen that had crashed.
// The download is the same length either way; what changed is whether the app
// looks broken while it happens.
//
// The delay matters as much as the spinner: a chunk already in the browser
// cache resolves in a few milliseconds, and flashing a spinner for one frame
// reads as a flicker. So nothing is shown for a moment, then a real one.
function Fallback() {
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    const id = setTimeout(() => setShow(true), 120);
    return () => clearTimeout(id);
  }, []);
  if (!show) return <View style={styles.wrap} />;
  return (
    <View style={styles.wrap}>
      <ActivityIndicator color={theme.muted2} />
      <Text style={styles.txt}>Loading…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: 10 },
  txt: { color: theme.muted, fontSize: 13 },
});

// Chunks queued for prefetch, in the order they were registered.
const registry: (() => Promise<unknown>)[] = [];
let prefetched = false;

export type LazyComponent<P> = React.ComponentType<P> & { preload: () => void };

export function lazyScreen<P extends object>(
  load: () => Promise<{ default: React.ComponentType<P> }>,
): LazyComponent<P> {
  const Inner = React.lazy(load);
  let started = false;
  const preload = () => {
    if (started) return;
    started = true;
    // Metro's web import() does not always hand back a real Promise — calling
    // .catch() on it threw, and the throw killed the whole prefetch loop, so
    // NOTHING was warmed. Tolerate either shape.
    try {
      const r = load() as unknown as { then?: unknown; catch?: (f: () => void) => void };
      if (r && typeof r.then === 'function' && typeof r.catch === 'function') {
        r.catch(() => {
          started = false;  // a failed fetch must be retryable
        });
      }
    } catch {
      started = false;
    }
  };
  registry.push(() => {
    preload();
    return Promise.resolve();
  });
  const Wrapped = function LazyScreen(props: P) {
    return (
      <React.Suspense fallback={<Fallback />}>
        <Inner {...props} />
      </React.Suspense>
    );
  } as LazyComponent<P>;
  Wrapped.preload = preload;
  return Wrapped;
}

/**
 * Warm every screen chunk once the app is idle.
 *
 * Splitting the app made FIRST paint cheap — the shell and the dashboard,
 * nothing else. What it also did was move the cost to the moment you open a
 * tab, which is the worst possible time: you have just asked for something and
 * are now watching a spinner while a chunk downloads. Fetching them in the
 * background after the first screen is up gets both — a small first paint AND
 * instant tab switches — because by the time anyone taps, the chunk is in the
 * browser cache and React.lazy resolves synchronously.
 *
 * Deliberately serial and deliberately late: this is spare-capacity work and
 * must never contend with the data the visible screen is fetching.
 */
export function prefetchScreens(delayMs = 2500): void {
  if (prefetched) return;
  prefetched = true;
  const g = globalThis as {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void;
  };
  const run = async () => {
    for (const load of registry) {
      try {
        await load();
      } catch {
        /* one bad chunk must not stop the rest */
      }
      // Yield between chunks so a slow connection never blocks interaction.
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  setTimeout(() => {
    if (g.requestIdleCallback) g.requestIdleCallback(() => { run(); }, { timeout: 4000 });
    else run();
  }, delayMs);
}
