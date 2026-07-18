import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';

/** A glowing/pulsing dot for "recording or listening is live right now" —
 *  used wherever the mic is actively capturing (word recording, page
 *  dictation) so it reads as an ongoing process, not a static icon. */
export default function PulsingDot({ size = 10, color = '#ff453a' }: { size?: number; color?: string }) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 650 }), -1, true);
    return () => {
      pulse.value = 0;
    };
  }, [pulse]);

  // Amplitude toned down from the original (opacity 0.35-1.0, scale 1.0-1.5)
  // per feedback ("glow could have lower amplitude").
  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.4 + pulse.value * 0.35,
    transform: [{ scale: 1 + pulse.value * 0.25 }],
  }));
  const coreStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.15 }],
  }));

  return (
    <Animated.View style={[styles.wrap, { width: size * 2.2, height: size * 2.2 }]}>
      <Animated.View
        style={[
          styles.glow,
          { width: size * 2.2, height: size * 2.2, borderRadius: size * 1.1, backgroundColor: color },
          glowStyle,
        ]}
      />
      <Animated.View
        style={[styles.core, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }, coreStyle]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute' },
  core: {},
});
