import type { CapacitorConfig } from '@capacitor/cli';

// Capacitor Android shell for TaurEye. The UI is the same Expo web bundle that
// Flask serves; here it's packaged into a native APK so it can be installed on
// a phone, and Capgo (@capgo/capacitor-updater) delivers over-the-air bundle
// updates without a Play Store round-trip.
//
// webDir points at the Expo web export. Build the bundle with the API base
// baked in (the WebView origin is capacitor://localhost, so same-origin fetches
// would never reach the VM) — see `npm run cap:sync`:
//   EXPO_PUBLIC_API_BASE=http://161.118.174.177 npx expo export -p web -o dist
const config: CapacitorConfig = {
  // App ID + name match the Capgo app (TETerminal) so OTA bundles route to it.
  appId: 'com.taureye.terminal.app',
  appName: 'TETerminal',
  webDir: 'dist',
  android: {
    // The VM API is plain HTTP for now, and Android blocks cleartext by
    // default. Allow it until the backend is behind HTTPS (then remove this
    // and switch EXPO_PUBLIC_API_BASE to the https domain).
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
  plugins: {
    CapacitorUpdater: {
      // Apply a downloaded Capgo update on the next app resume/restart.
      autoUpdate: true,
      // Roll back automatically if a bad bundle fails to boot.
      directUpdate: false,
    },
  },
};

export default config;
