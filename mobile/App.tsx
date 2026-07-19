import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { capgoNotifyReady } from './src/capgo';
import { initPush } from './src/push';
import { initSystemBars } from './src/systemBars';
import { useThemeMode } from './src/theme';
import Shell from './src/Shell';
import UpdateGate from './src/UpdateGate';

// Responsive shell: a left sidebar on desktop/laptop, native bottom tabs on
// phones and tablets (see src/Shell.tsx + src/responsive.ts).
export default function App() {
  const mode = useThemeMode();
  // Tell Capgo the freshly-loaded OTA bundle booted OK (no-op off native), and
  // wire the native status/navigation-bar icon style to the theme.
  useEffect(() => {
    capgoNotifyReady();
    initSystemBars();
    initPush();
  }, []);
  return (
    <SafeAreaProvider>
      {/* Icons flip with the theme: light glyphs on the dark surface, dark
          glyphs on the light surface (the native bars are driven by
          src/systemBars.ts; this is the web/Expo fallback). */}
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <UpdateGate>
        <Shell />
      </UpdateGate>
    </SafeAreaProvider>
  );
}
