import type { CapacitorConfig } from '@capacitor/cli';

// Capacitor Android shell for TaurEye. The UI is the same Expo web bundle that
// Flask serves; here it's packaged into a native APK so it can be installed on
// a phone.
//
// There is no over-the-air update path. Capgo used to provide one, but the
// subscription has ended, so the plugin is configured OFF below and a phone
// updates by installing a newer APK over the old one.
//
// webDir points at the Expo web export. Build the bundle with the API base
// baked in (the WebView origin is https://localhost, so same-origin fetches
// would never leave the phone) — see `npm run cap:sync`:
//   EXPO_PUBLIC_API_BASE=https://taureye.com npx expo export -p web -o dist
// Cleartext and mixed content are DERIVED from that base rather than set by
// hand: now that it is an https domain both come out false, and they would
// only come back if someone pointed the shell at a plain-http host again.
const apiBase = process.env.EXPO_PUBLIC_API_BASE || 'https://taureye.com';
const plainHttp = apiBase.startsWith('http://');

const config: CapacitorConfig = {
  // Unchanged on purpose: the application ID is the app's identity to Android,
  // so keeping it is what lets a new APK install OVER the one already on a
  // phone and keep its sign-in and local data instead of arriving as a second,
  // empty copy of the app.
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
      // OFF while the Capgo subscription is lapsed. Left as false rather than
      // deleted so re-enabling is one edit when a plan is active again.
      //
      // This is not cosmetic. With autoUpdate on, every launch reaches out to
      // Capgo for a bundle that cannot be served, which costs the user a failed
      // request and a wait on the very first screen — for a feature that is not
      // running. Off, the shell simply boots the bundle it shipped with.
      autoUpdate: false,
    },
  },
};

export default config;
