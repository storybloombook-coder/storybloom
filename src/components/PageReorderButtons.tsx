// PageReorderButtons.tsx — the up/down controls revealed by swiping a page
// card to the right (see SwipeableRow's `leftActions`).
//
// This replaces long-press-to-drag reordering, which was removed. Dragging a
// variable-height card needs the list's measured heights to decide which slot
// the finger is over, and needs the dropped card's own settle animation to
// hand off to the list's layout animation at exactly the right frame. Both of
// those depend on onLayout arriving when expected; when it didn't, a card was
// left parked at a half-finished offset, overlapping its neighbours and
// unable to recover — which is what people kept reporting.
//
// Nothing here measures anything or animates a position. A tap moves the page
// one slot and the list's own LinearTransition draws the change. It cannot
// get stuck, because there is no intermediate state to get stuck in.

import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';

function bump() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

function blocked() {
  // A distinct, softer buzz for "that's as far as it goes" — a disabled
  // button that does nothing at all reads as a broken button.
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}

export default function PageReorderButtons({
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  upLabel,
  downLabel,
}: {
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  /** Accessibility labels — localized by the caller. */
  upLabel: string;
  downLabel: string;
}) {
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={upLabel}
        accessibilityState={{ disabled: !canMoveUp }}
        hitSlop={6}
        onPress={() => {
          if (!canMoveUp) {
            blocked();
            return;
          }
          bump();
          onMoveUp();
        }}
        style={({ pressed }) => [
          styles.button,
          styles.buttonDivider,
          !canMoveUp && styles.buttonDisabled,
          pressed && canMoveUp && styles.buttonPressed,
        ]}
      >
        <Text style={[styles.glyph, !canMoveUp && styles.glyphDisabled]}>▲</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={downLabel}
        accessibilityState={{ disabled: !canMoveDown }}
        hitSlop={6}
        onPress={() => {
          if (!canMoveDown) {
            blocked();
            return;
          }
          bump();
          onMoveDown();
        }}
        style={({ pressed }) => [
          styles.button,
          !canMoveDown && styles.buttonDisabled,
          pressed && canMoveDown && styles.buttonPressed,
        ]}
      >
        <Text style={[styles.glyph, !canMoveDown && styles.glyphDisabled]}>▼</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // The two buttons split the revealed strip in half, top and bottom, and
  // fill it completely. Small floating buttons in the middle of an otherwise
  // empty panel left most of the revealed area doing nothing and gave the
  // finger a much smaller target than the gesture had just opened up.
  wrap: { flex: 1, width: '100%', alignSelf: 'stretch' },
  button: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(120,150,255,0.22)',
  },
  // A hairline between the halves, so it reads as two controls rather than
  // one tall panel with two glyphs on it.
  buttonDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.25)' },
  buttonPressed: { backgroundColor: 'rgba(120,150,255,0.55)' },
  buttonDisabled: { backgroundColor: 'rgba(128,128,128,0.1)' },
  glyph: { fontSize: 16, color: '#dbe4ff', fontWeight: '700' },
  glyphDisabled: { color: 'rgba(160,160,160,0.45)' },
});
