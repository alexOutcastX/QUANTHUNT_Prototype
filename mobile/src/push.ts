// Push-notification registration for the Capacitor Android shell.
//
// Guarded end to end: on web / Expo Go and on older APKs that predate the
// @capacitor/push-notifications plugin (or when Firebase isn't configured), the
// dynamic import or the native call fails and we no-op. So this ships safely
// now and starts delivering the moment google-services.json + FCM creds land.
//
// Flow: ask permission → register with FCM → on token, POST it to the backend
// (/push/register) so alerts + dev broadcasts can reach this device. Tapping an
// alert notification deep-links to that symbol's analysis.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE } from './api';
import { navigate } from './navIntent';

let started = false;

function isNative(): boolean {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

async function uploadToken(token: string): Promise<void> {
  try {
    // Bind the token to this device's chat account (if set) so DMs can target it.
    const userId = (await AsyncStorage.getItem('taureye.chat.uid')) || '';
    await fetch(API_BASE + '/push/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, platform: 'android', user_id: userId }),
    });
  } catch {
    /* backend unreachable — will retry on next launch */
  }
}

function onTap(data: Record<string, unknown> | undefined): void {
  const sym = data && (data.symbol as string);
  if (sym) navigate('analysis', { sub: 'mb', symbol: String(sym) });
  // (DM taps could deep-link into the thread once chat is a routable page.)
}

export async function initPush(): Promise<void> {
  if (started || !isNative()) return;
  started = true;
  try {
    const mod = await import('@capacitor/push-notifications');
    const { PushNotifications } = mod;

    PushNotifications.addListener('registration', (t: { value: string }) => {
      if (t?.value) uploadToken(t.value);
    });
    PushNotifications.addListener('registrationError', () => {
      /* Firebase not configured yet — ignore */
    });
    PushNotifications.addListener(
      'pushNotificationActionPerformed',
      (a: { notification?: { data?: Record<string, unknown> } }) => onTap(a?.notification?.data),
    );

    const perm = await PushNotifications.requestPermissions();
    if (perm.receive === 'granted') {
      await PushNotifications.register();
    }
  } catch {
    /* plugin absent (old APK) or Firebase not set up — no-op */
    started = false; // allow a retry after an OTA that adds the plugin
  }
}
