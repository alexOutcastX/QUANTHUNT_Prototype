import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Shell from './src/Shell';

// Responsive shell: a left sidebar on desktop/laptop, native bottom tabs on
// phones and tablets (see src/Shell.tsx + src/responsive.ts).
export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Shell />
    </SafeAreaProvider>
  );
}
