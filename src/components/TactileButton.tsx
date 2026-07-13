import * as Haptics from 'expo-haptics';
import { forwardRef, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type View,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

export interface TactileButtonProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  /** How firm the haptic tap feels. Defaults to a light tick. */
  hapticStyle?: Haptics.ImpactFeedbackStyle;
  /** How far the button shrinks on press, 0-1. Defaults to a subtle 0.96. */
  pressScale?: number;
}

/**
 * A Pressable that gives tactile feedback on every tap: a haptic tick plus a
 * quick scale-down/up animation. Use this instead of a bare Pressable for any
 * tappable control in the app.
 */
const TactileButton = forwardRef<View, TactileButtonProps>(function TactileButton(
  { onPress, disabled, style, children, hapticStyle = Haptics.ImpactFeedbackStyle.Light, pressScale = 0.96, ...rest },
  ref
) {
  const scale = useSharedValue(1);
  // Capped darken-toward-gray overlay while held — 0 (invisible) to 1, which
  // maps to darkenOverlay's own fixed low alpha, not full black.
  const pressDarken = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const darkenStyle = useAnimatedStyle(() => ({ opacity: pressDarken.value }));

  return (
    <Pressable
      ref={ref}
      disabled={disabled}
      onPressIn={() => {
        scale.value = withTiming(pressScale, { duration: 80 });
        pressDarken.value = withTiming(1, { duration: 80 });
      }}
      onPressOut={() => {
        scale.value = withTiming(1, { duration: 120 });
        pressDarken.value = withTiming(0, { duration: 120 });
      }}
      onPress={(e) => {
        Haptics.impactAsync(hapticStyle);
        onPress?.(e);
      }}
      {...rest}
    >
      <Animated.View
        style={[style, animatedStyle, styles.clip, disabled ? { opacity: 0.4 } : null]}
      >
        {children}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.darkenOverlay, darkenStyle]} />
      </Animated.View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  // overflow:'hidden' clips the overlay to whatever borderRadius `style`
  // gave the button, whatever its value — no need to know it here.
  clip: { overflow: 'hidden' },
  darkenOverlay: { backgroundColor: 'rgba(0,0,0,0.18)' },
});

export default TactileButton;
