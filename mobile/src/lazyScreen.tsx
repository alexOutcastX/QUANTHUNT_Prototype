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

export function lazyScreen<P extends object>(
  load: () => Promise<{ default: React.ComponentType<P> }>,
): React.ComponentType<P> {
  const Inner = React.lazy(load);
  return function LazyScreen(props: P) {
    return (
      <React.Suspense fallback={<Fallback />}>
        <Inner {...props} />
      </React.Suspense>
    );
  };
}
