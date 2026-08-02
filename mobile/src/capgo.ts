// Capgo OTA glue. Only does anything inside the Capacitor Android shell; on
// web / Expo Go it's a no-op (the dynamic import fails or reports non-native).

// ── OTA is OFF ───────────────────────────────────────────────────────────────
// The Capgo subscription has lapsed, so every OTA call would fail — and the
// failures are not free. UpdateGate blocks the first paint on Capgo's answer,
// and notifyAppReady() exists to tell Capgo the new bundle booted; without a
// live subscription the first stalls the launch behind a doomed network call
// and the second is pointless.
//
// Deliberately a flag rather than deleting the code: the dependency stays in
// package.json and the native shell keeps the plugin, so turning OTA back on
// when the subscription resumes is this one constant and nothing else. Ripping
// it out would mean a native rebuild to put it back.
//
// While this is false the app updates only through a new APK / a web deploy.
export const OTA_ENABLED = false;

// notifyAppReady() must run once the JS has booted, otherwise Capgo assumes the
// freshly-downloaded bundle crashed and rolls back to the previous one.
export async function capgoNotifyReady(): Promise<void> {
  if (!OTA_ENABLED) return;
  try {
    const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (!cap?.isNativePlatform?.()) return;
    const mod = await import('@capgo/capacitor-updater');
    await mod.CapacitorUpdater.notifyAppReady();
  } catch {
    /* not in a Capgo-enabled native shell — ignore */
  }
}
