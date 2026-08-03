import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

const PRESS_SCALE = 0.88;
const PRESS_IN_MS = 80;
const PRESS_OUT_MS = 120;

// Animated-capable outer Pressable -- lets callers pass a useAnimatedStyle()
// result (e.g. a pulsing shadow) straight into `style` alongside plain
// objects, same as any other Reanimated-wrapped component. A plain
// Pressable can't consume a shared-value-backed style directly.
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** A circular icon button (the 3D scene's story/eye/menu/locale controls)
 *  with tactile feedback on every tap: a haptic tick, a quick scale-down/up
 *  press animation, and a subtle darken overlay while held -- mirroring the
 *  app shell's own src/components/TactileButton.tsx so both halves of the
 *  app feel the same. Kept local/JS here rather than imported across the
 *  package boundary, since features/kolobok is its own self-contained
 *  package (CLAUDE.md).
 *
 *  `style` positions/sizes the OUTER Pressable (these buttons are laid out
 *  via position:absolute, so the Pressable itself -- not just its child --
 *  must own that box, or the touch target ends up at the wrong place/size).
 *  `innerStyle` carries the visual look (background/border-radius) on the
 *  inner Animated.View that actually scales/darkens on press, so the two
 *  concerns don't fight each other.
 *
 *  `disabled` forwards straight to the underlying Pressable, which already
 *  skips onPressIn/onPressOut/onPress entirely while disabled -- no extra
 *  guarding needed here for the tactile feedback to correctly not fire. */
export function TactileButton({
  onPress, style, innerStyle, children, accessibilityRole, accessibilityLabel, hitSlop, disabled,
}) {
  const scale = useSharedValue(1);
  const pressDarken = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const darkenStyle = useAnimatedStyle(() => ({ opacity: pressDarken.value }));

  return (
    <AnimatedPressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      hitSlop={hitSlop}
      disabled={disabled}
      style={style}
      onPressIn={() => {
        scale.value = withTiming(PRESS_SCALE, { duration: PRESS_IN_MS });
        pressDarken.value = withTiming(1, { duration: PRESS_IN_MS });
      }}
      onPressOut={() => {
        scale.value = withTiming(1, { duration: PRESS_OUT_MS });
        pressDarken.value = withTiming(0, { duration: PRESS_OUT_MS });
      }}
      onPress={(e) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.(e);
      }}
    >
      <Animated.View style={[StyleSheet.absoluteFill, innerStyle, styles.clip, animatedStyle]}>
        {children}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.darken, darkenStyle]} />
      </Animated.View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  // overflow:'hidden' clips the darken overlay to innerStyle's own
  // borderRadius, whatever it is -- no need to know it here.
  clip: { overflow: 'hidden' },
  darken: { backgroundColor: 'rgba(0,0,0,0.18)' },
});
