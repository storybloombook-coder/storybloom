import * as Haptics from 'expo-haptics';
import { Children, cloneElement, forwardRef, isValidElement, type ReactElement, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
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
 * Keep a button's own label on one line, shrinking it rather than wrapping.
 *
 * Russian runs 35-100% longer than English across this app's strings ("Move
 * page up" -> "Переместить страницу вверх"), so labels sized by eye in
 * English wrap to two lines in Russian — which grows the button, and in a
 * side-by-side row leaves it a different height from its neighbour. Rather
 * than chase that string by string as each one is spotted, every button
 * caps its own label.
 *
 * Applied ONLY when the button's single direct child is a Text, i.e. when
 * that Text unambiguously IS the label. Buttons that pair a title with a
 * subtitle ("Add pictures" / "From your library or files") are laid out to
 * be multi-line on purpose, and squeezing their second line onto one would
 * make things worse, not better. A call site that sets numberOfLines or
 * adjustsFontSizeToFit itself always wins.
 */
function capSoleLabel(children: ReactNode): ReactNode {
  const items = Children.toArray(children);
  if (items.length !== 1) return children;
  const only = items[0];
  if (!isValidElement(only) || only.type !== Text) return children;
  const props = only.props as { numberOfLines?: number; adjustsFontSizeToFit?: boolean };
  if (props.numberOfLines !== undefined || props.adjustsFontSizeToFit !== undefined) return children;
  return cloneElement(only as ReactElement<Record<string, unknown>>, {
    numberOfLines: 1,
    adjustsFontSizeToFit: true,
    // Below ~70% the label is noticeably smaller than its neighbours, which
    // reads as a mistake; past that it ellipsizes instead, which at least
    // keeps every button the same height.
    minimumFontScale: 0.7,
  });
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
        {capSoleLabel(children)}
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
