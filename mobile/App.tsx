import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { capgoNotifyReady } from './src/capgo';
import Shell from './src/Shell';

// Responsive shell: a left sidebar on desktop/laptop, native bottom tabs on
// phones and tablets (see src/Shell.tsx + src/responsive.ts).
export default function App() {
  // Tell Capgo the freshly-loaded OTA bundle booted OK (no-op off native).
  useEffect(() => {
    capgoNotifyReady();
  }, []);
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Shell />
    </SafeAreaProvider>
  );
}
