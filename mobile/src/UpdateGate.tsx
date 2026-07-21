// Startup gate shown while the app checks Capgo for an over-the-air update and,
// if one exists, downloads + applies it before the UI appears — so a launch
// always lands on the latest bundle. Shows a branded progress screen with a
// percentage and a live status line (checking / downloading / installing /
// on the latest version).
//
// Native (Capacitor) only. On plain web / Expo Go there's no OTA, so the gate
// is skipped and children render immediately.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { theme } from './theme';

const IS_NATIVE = !!(globalThis as { Capacitor?: { isNativePlatform?: () => boolean } })
  .Capacitor?.isNativePlatform?.();

type Handle = { remove?: () => void };

export default function UpdateGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(!IS_NATIVE);
  const [pct, setPct] = useState<number | null>(null);
  const [status, setStatus] = useState('Checking for updates…');
  const [settled, setSettled] = useState(false);
  const fill = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;

  // Ease the progress bar toward the latest percentage.
  useEffect(() => {
    if (pct == null) return;
    Animated.timing(fill, {
      toValue: pct,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [pct, fill]);

  useEffect(() => {
    if (!IS_NATIVE) return;
    let finished = false;
    const started = { flag: false };
    const subs: Handle[] = [];

    const finish = (msg?: string) => {
      if (finished) return;
      finished = true;
      if (msg) setStatus(msg);
      setPct((p) => (p == null ? 100 : p));
      setSettled(true);
      // Hold the "up to date" state briefly, then fade the gate away.
      setTimeout(() => {
        Animated.timing(fade, { toValue: 0, duration: 260, useNativeDriver: true }).start(() =>
          setReady(true),
        );
      }, 300);
    };

    (async () => {
      try {
        const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
        subs.push(
          await CapacitorUpdater.addListener('download', (e: { percent?: number }) => {
            started.flag = true;
            setStatus('Downloading update…');
            setPct(Math.min(99, Math.max(1, Math.round(e.percent ?? 0))));
          }),
        );
        subs.push(
          await CapacitorUpdater.addListener('downloadComplete', () => {
            started.flag = true;
            setStatus('Installing update…');
            setPct(100);
          }),
        );
        subs.push(
          await CapacitorUpdater.addListener('updateAvailable', async () => {
            setStatus('Applying update…');
            setPct(100);
            try {
              // Reload straight into the freshly-downloaded bundle. The gate
              // remounts on the new bundle and settles on "latest version".
              await CapacitorUpdater.reload();
            } catch {
              finish("You're on the latest version");
            }
          }),
        );
        subs.push(
          await CapacitorUpdater.addListener('noNeedUpdate', () =>
            finish("You're on the latest version"),
          ),
        );
        subs.push(
          await CapacitorUpdater.addListener('updateFailed', () =>
            finish('Update check failed — continuing'),
          ),
        );
      } catch {
        finish();
      }
    })();

    // If no download has begun shortly after boot, we're already current (or
    // offline) — reveal the app rather than waiting on an event that won't
    // come. 2.2 s, not 5 s: the no-update case is by far the common one and
    // this timeout was most of the perceived app-startup time.
    const t1 = setTimeout(() => {
      if (!started.flag) finish("You're on the latest version");
    }, 2200);
    // Hard ceiling so a stuck download never traps the user on the splash.
    const t2 = setTimeout(() => finish(), 25000);

    return () => {
      subs.forEach((s) => s.remove?.());
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [fade]);

  if (ready) return <>{children}</>;

  const width = fill.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });
  const checking = pct == null && !settled;
  return (
    <Animated.View style={[styles.wrap, { opacity: fade }]}>
      <View style={styles.center}>
        <Text style={styles.brand}>
          Taur<Text style={{ color: theme.brand }}>Eye</Text>
        </Text>
        <View style={styles.barTrack}>
          <Animated.View style={[styles.barFill, { width }]} />
        </View>
        <View style={styles.statusRow}>
          {checking ? <ActivityIndicator color={theme.brand} size="small" /> : null}
          {settled ? <Text style={styles.tick}>✓</Text> : null}
          <Text style={styles.status}>{status}</Text>
          {pct != null ? <Text style={styles.pct}>{Math.round(pct)}%</Text> : null}
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', zIndex: 999 },
  center: { width: '78%', maxWidth: 360, alignItems: 'center' },
  brand: { color: theme.text, fontSize: 34, fontWeight: '800', letterSpacing: -0.5, marginBottom: 26 },
  barTrack: { width: '100%', height: 8, borderRadius: 999, backgroundColor: theme.surface2, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 999, backgroundColor: theme.brand },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  status: { color: theme.muted2, fontSize: theme.fs.md },
  pct: { color: theme.text, fontFamily: theme.mono, fontSize: theme.fs.md, fontWeight: '700', marginLeft: 2 },
  tick: { color: theme.green, fontSize: theme.fs.md, fontWeight: '800' },
});
