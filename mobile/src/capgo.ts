// Capgo OTA glue. Only does anything inside the Capacitor Android shell; on
// web / Expo Go it's a no-op (the dynamic import fails or reports non-native).
//
// notifyAppReady() must run once the JS has booted, otherwise Capgo assumes the
// freshly-downloaded bundle crashed and rolls back to the previous one.
export async function capgoNotifyReady(): Promise<void> {
  try {
    const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (!cap?.isNativePlatform?.()) return;
    const mod = await import('@capgo/capacitor-updater');
    await mod.CapacitorUpdater.notifyAppReady();
  } catch {
    /* not in a Capgo-enabled native shell — ignore */
  }
}
