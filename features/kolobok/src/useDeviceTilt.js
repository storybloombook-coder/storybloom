// useDeviceTilt.js — smoothed left-right/up-down phone tilt, shared from ONE
// accelerometer subscription across every GlassGlare on screen (see
// GlassGlare.jsx), so the whole row of buttons reads as tilting together
// like one physical pane, not each polling the sensor separately.
//
// Kept local/JS here rather than imported across the package boundary, since
// features/kolobok is its own self-contained package (CLAUDE.md) -- mirrors
// the app shell's own src/lib/useDeviceTilt.ts.

import { useEffect } from 'react';
import { useSharedValue, withTiming } from 'react-native-reanimated';
import { Accelerometer } from 'expo-sensors';

const UPDATE_MS = 60;
// Below this (in g's), treat the phone as held level -- without a deadzone
// the glare would drift on sensor noise alone even at rest.
const DEADZONE = 0.02;
// Clamp the input tilt magnitude here -- past this, the glare has already
// reached GlassGlare's own full travel range, so a steeper tilt wouldn't
// move it any further anyway.
const MAX_TILT = 0.5;

/** Smoothed, clamped device tilt normalized to roughly [-1, 1] on each axis
 *  (x = left/right roll, y = up/down). */
export function useDeviceTilt() {
  const tiltX = useSharedValue(0);
  const tiltY = useSharedValue(0);

  useEffect(() => {
    Accelerometer.setUpdateInterval(UPDATE_MS);
    const sub = Accelerometer.addListener(({ x, y }) => {
      const clamp = (v) => (Math.abs(v) < DEADZONE ? 0 : Math.max(-MAX_TILT, Math.min(MAX_TILT, v)));
      // Ease each new sample in rather than snapping to it -- the sensor
      // only updates every UPDATE_MS, which would otherwise look like the
      // highlight jumping between fixed points instead of gliding.
      tiltX.value = withTiming(clamp(x) / MAX_TILT, { duration: 140 });
      tiltY.value = withTiming(clamp(y) / MAX_TILT, { duration: 140 });
    });
    return () => sub.remove();
  }, [tiltX, tiltY]);

  return { tiltX, tiltY };
}
