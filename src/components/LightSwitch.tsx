// LightSwitch.tsx — a two-position on/off toggle styled like a physical
// light switch (a track + a sliding thumb), for controls that are
// fundamentally binary (playing/stopped) rather than a button whose
// icon/label swaps between two states.

import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, useColorScheme } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

const TRACK_WIDTH = 52;
const TRACK_HEIGHT = 30;
const THUMB_SIZE = 24;
const THUMB_INSET = (TRACK_HEIGHT - THUMB_SIZE) / 2;

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

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: withTiming(on ? onColor : offColor, { duration: 160 }),
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
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
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
