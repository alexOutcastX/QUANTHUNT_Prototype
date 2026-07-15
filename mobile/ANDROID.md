# TaurEye Android (Capacitor + Capgo OTA)

The Android app is a **Capacitor** shell that loads the same Expo web bundle
(`mobile/dist`) the Flask server serves. **Capgo** (`@capgo/capacitor-updater`)
delivers over-the-air bundle updates so you can push UI changes without a Play
Store round-trip.

- App id: `com.taureye.terminal.app` · webDir: `dist` · API base resolves to the VM
  automatically inside the app (runtime Capacitor detection in `src/api.ts`;
  cleartext HTTP is enabled in the manifest until the backend has TLS).

## Build the APK

You need the Android SDK (Android Studio). If you don't have it locally, use CI
(next section) instead.

```bash
cd mobile
npm ci
npm run cap:sync        # export web bundle → copy into the android project
npm run cap:apk         # → android/app/build/outputs/apk/debug/app-debug.apk
```

Copy `app-debug.apk` to the phone and install it (enable "install unknown
apps"). The debug APK is self-signed, so no keystore is needed for a first
sideload. `npm run cap:open` opens the project in Android Studio for a
signed release build.

## Build the APK in CI (no local Android tooling)

Actions → **"Android APK (Capacitor + Capgo)"** → Run workflow. GitHub's runner
has the Android SDK; it exports the bundle, syncs Capacitor, builds the debug
APK and uploads it as the `taureye-android-debug` artifact. Download, install on
the phone. Optionally tick *capgo_upload* (needs a `CAPGO_TOKEN` repo secret) to
also publish an OTA bundle.

## Push updates over the air (Capgo)

Install the phone app once from an APK above (Capgo only updates an already
installed native app), then set it up once:

```bash
cd mobile
npm i -g @capgo/cli
npx @capgo/cli login <YOUR_CAPGO_TOKEN>
npx @capgo/cli app add com.taureye.terminal.app        # one time
```

**Automated (recommended).** Add a `CAPGO_TOKEN` repository secret. From then on,
**every push to `production` that touches `mobile/**` auto-publishes an OTA
bundle to the `production` channel** (the `ota` job in
`.github/workflows/android.yml`), alongside the web deploy — so installed phones
update themselves. Until the secret is set the job succeeds as a no-op.

**Manual** (one-off push without shipping):

```bash
cd mobile && npm run cap:build
npx @capgo/cli bundle upload -c production -b <version> --path dist
```

The app checks Capgo on launch/resume and applies the new bundle
(`autoUpdate: true`). `App.tsx` calls `notifyAppReady()` so a good bundle is
kept and a broken one rolls back automatically.

## Notes
- **Backend must be reachable from the phone.** The app talks to the VM at
  `http://161.118.174.177`. Put the backend behind HTTPS and set
  `EXPO_PUBLIC_API_BASE=https://your-domain` (workflow input or build env), then
  remove `android:usesCleartextTraffic` from the manifest.
- **CORS**: the WebView origin is `https://localhost`. If cross-origin requests
  with credentials are blocked, the Flask CORS config needs to allow that origin
  with `supports_credentials`.
