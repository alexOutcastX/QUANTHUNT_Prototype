// Six-frame gallop flipbook — carried over from the previous TaurEye app, where
// it ran on the boot screen while the market snapshot warmed.
//
// The frames are registered on the bull's centre of mass, so it gallops in
// place rather than drifting across the box. All six are mounted at once and
// only their opacity changes: swapping a single <Image>'s source flashes on
// first paint of each frame, and a boot screen is exactly where that shows.
//
// The original flipbooked with a CSS animation. React Native has no CSS, so the
// frame index is driven by a timer here — same 0.6s cycle, same order.
import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Image, StyleSheet, View } from 'react-native';

const FRAMES = [
  require('../../assets/brand/bull/0.png'),
  require('../../assets/brand/bull/1.png'),
  require('../../assets/brand/bull/2.png'),
  require('../../assets/brand/bull/3.png'),
  require('../../assets/brand/bull/4.png'),
  require('../../assets/brand/bull/5.png'),
];

const RATIO = 200 / 363;        // frame height / width
const CYCLE_MS = 600;           // one full gallop
const FRAME_MS = CYCLE_MS / FRAMES.length;

export default function BullRun({ size = 170 }: { size?: number }) {
  const [frame, setFrame] = useState(0);
  const [still, setStill] = useState(false);

  useEffect(() => {
    let alive = true;
    // A galloping animation is precisely what reduce-motion is asking us not to
    // play. Fall back to a single standing frame rather than to nothing, so the
    // boot screen still shows the brand.
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => alive && setStill(on))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setStill);
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);

  useEffect(() => {
    if (still) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), FRAME_MS);
    return () => clearInterval(id);
  }, [still]);

  const shown = still ? 0 : frame;
  return (
    <View
      style={[styles.box, { width: size, height: Math.round(size * RATIO) }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {FRAMES.map((src, i) => (
        <Image
          key={i}
          source={src}
          style={[styles.frame, { opacity: i === shown ? 1 : 0 }]}
          resizeMode="contain"
          fadeDuration={0}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: 'relative' },
  frame: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
});
