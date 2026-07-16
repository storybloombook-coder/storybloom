// LightSwitch.tsx — a two-position on/off toggle styled like a physical
// light switch (a track + a sliding thumb). Playback controls (play/stop)
// turned out to feel better as a button whose icon/label swaps instead —
// this is for the other kind of binary control: a momentary confirmation
// flip for a one-time action (e.g. the ambient sheet's "apply to all
// pages", which isn't a persisted setting — it flips ON while the action
// runs, then back OFF, with no separate popup needed).

import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, useColorScheme } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

const TRACK_WIDTH = 52;
const TRACK_HEIGHT = 30;
const THUMB_SIZE = 24;
const THUMB_INSET = (TRACK_HEIGHT - THUMB_SIZE) / 2;
/** How far the whole switch shrinks while held — a physical "give" under
 *  your finger, same idea as TactileButton's press-scale. */
const PRESS_SCALE = 0.9;

export default function LightSwitch({
  on,
  onToggle,
  onColor = '#2fb344',
  disabled,
}: {
  on: boolean;
  onToggle: () => void;
  /** Track color while ON — defaults to the app's confirm-green. */
  onColor?: string;
  disabled?: boolean;
}) {
  const isDark = useColorScheme() === 'dark';
  const offColor = isDark ? '#3a3a3c' : '#d0d0d5';
  const pressScale = useSharedValue(1);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: withTiming(on ? onColor : offColor, { duration: 160 }),
    transform: [{ scale: pressScale.value }],
  }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: withTiming(on ? TRACK_WIDTH - THUMB_SIZE - THUMB_INSET : THUMB_INSET, { duration: 160 }) },
    ],
  }));

  return (
    <Pressable
      disabled={disabled}
      hitSlop={8}
      onPressIn={() => {
        pressScale.value = withTiming(PRESS_SCALE, { duration: 80 });
      }}
      onPressOut={() => {
        pressScale.value = withTiming(1, { duration: 120 });
      }}
      onPress={() => {
        // A firmer click than the default Light tick — this is meant to read
        // as a physical flip, not just a tap acknowledgment.
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        onToggle();
      }}
      style={disabled ? styles.disabled : undefined}
    >
      <Animated.View style={[styles.track, trackStyle]}>
        <Animated.View style={[styles.thumb, thumbStyle]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  disabled: { opacity: 0.4 },
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    justifyContent: 'center',
  },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 2,
  },
});
