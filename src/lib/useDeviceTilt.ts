// useDeviceTilt.ts — smoothed left-right/up-down phone tilt, shared from ONE
// accelerometer subscription across every GlassGlare on screen (see
// components/GlassGlare.tsx), so a whole row of glass buttons reads as tilting
// together like one physical pane, not each polling the sensor separately.

import { useEffect } from 'react';
import { useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

type AccelerometerModule = {
  setUpdateInterval: (ms: number) => void;
  addListener: (cb: (data: { x: number; y: number; z: number }) => void) => { remove: () => void };
};

// Same defensive runtime require as components/Bookshelf.tsx's own
// Accelerometer use: a static `import` of expo-sensors crashes the WHOLE APP
// at launch on a build that doesn't have it linked yet (the package touches
// a native module eagerly at import time), so this feature just stays inert
// without a build that includes it, instead of taking everything down.
let Accelerometer: AccelerometerModule | null = null;
try {
  Accelerometer = require('expo-sensors').Accelerometer;
} catch {
  Accelerometer = null;
}

const UPDATE_MS = 60;
// Below this (in g's), treat the phone as held level — without a deadzone
// the glare would drift on sensor noise alone even at rest.
const DEADZONE = 0.02;
// Clamp the input tilt magnitude here — past this, the glare has already
// reached GlassGlare's own full travel range, so a steeper tilt wouldn't
// move it any further anyway.
const MAX_TILT = 0.5;

/** Smoothed, clamped device tilt normalized to roughly [-1, 1] on each axis
 *  (x = left/right roll, y = up/down) — 0 whenever expo-sensors isn't linked
 *  (e.g. an older cached build), so callers never need their own fallback. */
export function useDeviceTilt(): { tiltX: SharedValue<number>; tiltY: SharedValue<number> } {
  const tiltX = useSharedValue(0);
  const tiltY = useSharedValue(0);

  useEffect(() => {
    if (!Accelerometer) return;
    Accelerometer.setUpdateInterval(UPDATE_MS);
    const sub = Accelerometer.addListener(({ x, y }) => {
      const clamp = (v: number) => (Math.abs(v) < DEADZONE ? 0 : Math.max(-MAX_TILT, Math.min(MAX_TILT, v)));
      // Ease each new sample in rather than snapping to it — the sensor
      // only updates every UPDATE_MS, which would otherwise look like the
      // highlight jumping between fixed points instead of gliding.
      tiltX.value = withTiming(clamp(x) / MAX_TILT, { duration: 140 });
      tiltY.value = withTiming(clamp(y) / MAX_TILT, { duration: 140 });
    });
    return () => sub.remove();
  }, [tiltX, tiltY]);

  return { tiltX, tiltY };
}
