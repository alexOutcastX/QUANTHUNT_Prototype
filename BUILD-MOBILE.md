# Building the TaurEye mobile app (Android APK / iOS)

The `mobile/` Expo app that powers the website also builds into a native
mobile app. Builds run on Expo's EAS cloud — nothing to install locally
except the CLI.

## One-time setup (your machine, ~10 minutes)

1. Create a free account at https://expo.dev.
2. In the repo:

```bash
cd mobile
npm install
npx eas-cli login          # log in with the expo.dev account
npx eas-cli init           # links the app to your account (creates projectId)
```

## Android APK (sideload on your phone — fastest path)

```bash
cd mobile
npx eas-cli build --platform android --profile preview
```

- Takes ~10–15 min in the EAS cloud (free tier queues are fine).
- When it finishes you get a URL/QR — open it on your phone and install
  the APK (allow "install from unknown sources" when prompted).
- The `preview` profile points the app at the VM over plain http. Android
  release builds normally block cleartext http — preview/internal builds
  allow it, but **the long-term path is HTTPS** (below).

## Production build (Play Store)

1. First enable HTTPS on the server (`deploy/enable-https.sh`, see
   DEPLOY-ORACLE.md) — release builds require it.
2. Edit `mobile/eas.json` → `production.env.EXPO_PUBLIC_API_BASE` to your
   `https://` domain.
3. `npx eas-cli build --platform android --profile production` → an `.aab`
   for the Play Console (one-time $25 developer account).
4. `npx eas-cli submit --platform android` automates the upload once the
   Play Console app exists.

## iOS

Requires an Apple Developer account ($99/year):

```bash
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios
```

Until then, the app runs in **Expo Go** for personal use
(`cd mobile && npx expo start`, scan the QR with the Expo Go app), and the
website is an installable **PWA** ("Add to Home Screen") — both free.

## Versioning

`app.json` `version` mirrors the repo VERSION at build time;
`production.autoIncrement` bumps the Android `versionCode` automatically.
