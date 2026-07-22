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
// Cleartext is derived from the API base the shell is built against: the
// moment EXPO_PUBLIC_API_BASE points at an https domain (see
// docs/TLS-RUNBOOK.md), the next APK build drops cleartext and mixed content
// automatically. Until then the plain-HTTP VM IP still needs both.
const apiBase = process.env.EXPO_PUBLIC_API_BASE || 'http://161.118.174.177';
const plainHttp = apiBase.startsWith('http://');

const config: CapacitorConfig = {
  // App ID + name match the Capgo app (TETerminal) so OTA bundles route to it.
  appId: 'com.taureye.terminal.app',
  appName: 'TETerminal',
  webDir: 'dist',
  android: {
    allowMixedContent: plainHttp,
  },
  server: {
    androidScheme: 'https',
    cleartext: plainHttp,
  },
  plugins: {
    CapacitorUpdater: {
      // Apply a downloaded Capgo update on the next app resume/restart.
      autoUpdate: true,
      // Roll back automatically if a bad bundle fails to boot.
      directUpdate: false,
      // Self-assign the device to the `production` channel — that's where the
      // android.yml OTA job publishes every bundle. Without this the app has no
      // channel to pull from, so autoUpdate never fetches anything. (The Capgo
      // console must have "allow self-assign" enabled on the production channel.)
      defaultChannel: 'production',
    },
  },
};

export default config;
