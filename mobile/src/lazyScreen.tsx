// Code-splitting helper. Wrapping a screen's import() in React.lazy makes
// Metro emit it as a separate web chunk, fetched the first time the screen is
// actually opened — so first paint only parses the shell + Dashboard instead
// of every screen in the app. The Suspense boundary lives inside the wrapper,
// keeping call sites drop-in identical to a static import.
import React from 'react';
import { View } from 'react-native';

export function lazyScreen<P extends object>(
  load: () => Promise<{ default: React.ComponentType<P> }>,
): React.ComponentType<P> {
  const Inner = React.lazy(load);
  return function LazyScreen(props: P) {
    return (
      <React.Suspense fallback={<View style={{ flex: 1 }} />}>
        <Inner {...props} />
      </React.Suspense>
    );
  };
}
