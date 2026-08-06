// SwipeableRow.tsx — swipe-to-reveal-an-action wrapper, shared by the library
// screen (books) and the book-detail page list (pages). It slides ~20% and
// holds; tapping the revealed action fires it, tapping the held-open row snaps
// it closed. Vertical list scrolling is preserved (the pan only claims
// horizontal drags) — safe to nest inside a ScrollView or FlatList.
//
// Swiping LEFT reveals the delete bin on the right. Swiping RIGHT reveals
// whatever `leftActions` renders on the left — the page list uses that for
// move-up/move-down, so reordering is the same physical gesture as deleting,
// just the other way. Each side only exists if its prop was given, and the
// slide clamps at 0 on any side that wasn't.

import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  LinearTransition,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

/** Fraction of the row width it slides open to reveal the delete bin. */
const REVEAL_FRACTION = 0.2;
/** How long a touch must hold before the bin is allowed to start appearing —
 *  avoids a flash on a light touch or a scroll's first ms. */
const REVEAL_DELAY_MS = 140;

export default function SwipeableRow({
  onDelete,
  leftActions,
  children,
}: {
  /** Omit to disable the swipe-left delete side entirely. */
  onDelete?: () => void;
  /** Rendered behind the row's LEFT edge, revealed by swiping right. Given
   *  the row's `close` so an action can dismiss the row after firing. */
  leftActions?: (close: () => void) => ReactNode;
  children: ReactNode;
}) {
  const translateX = useSharedValue(0);
  const startX = useSharedValue(0);
  const width = useSharedValue(0);
  // -1 open-left (bin showing) / 0 closed / 1 open-right (left actions
  // showing) — so we buzz once each time the slide crosses into an open zone,
  // not every frame.
  const zone = useSharedValue(0);
  const hasRight = !!onDelete;
  const hasLeft = !!leftActions;
  // 0 until REVEAL_DELAY_MS after a FRESH touch, then animates to 1 — driven
  // by withDelay/withTiming (not a Date.now() check inside the style
  // worklet) specifically because a style's `useAnimatedStyle` only
  // re-evaluates when a shared value it reads actually changes. A
  // Date.now()-based check only "expired" once something else nudged the
  // worklet to re-run — a fast decisive swipe could finish its withSpring
  // settle (translateX stops changing) BEFORE the delay elapsed, permanently
  // freezing the reveal at opacity 0 with nothing left to trigger a
  // recompute: the bin behind stayed invisible (just a bare gap showing
  // whatever's behind the row) even though the row was fully open.
  // withTiming ticks on its own regardless of other shared-value writes, so
  // it always arrives and the style updates when it does.
  const revealArmed = useSharedValue(0);
  const [revealW, setRevealW] = useState(0);
  const [open, setOpen] = useState(false);

  const setOpenJS = (v: boolean) => setOpen(v);
  const touchTick = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };
  const tick = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-12, 12])
    .onBegin(() => {
      // Fires on first touch, before horizontal/vertical is even decided —
      // the earliest possible moment to hint "this can slide". Only reset the
      // reveal-delay clock for a FRESH swipe (row currently closed) — touching
      // an already-open row must not make its visible action flash away.
      if (zone.value === 0) {
        revealArmed.value = 0;
        revealArmed.value = withDelay(REVEAL_DELAY_MS, withTiming(1, { duration: 0 }));
      }
      runOnJS(touchTick)();
    })
    .onStart(() => {
      startX.value = translateX.value;
    })
    .onUpdate((e) => {
      const reveal = width.value * REVEAL_FRACTION;
      let next = startX.value + e.translationX;
      // Each side is only reachable if the caller gave it something to show.
      if (next > (hasLeft ? reveal : 0)) next = hasLeft ? reveal : 0;
      if (next < (hasRight ? -reveal : 0)) next = hasRight ? -reveal : 0;
      translateX.value = next;
      const z = next <= -reveal / 2 ? -1 : next >= reveal / 2 ? 1 : 0;
      if (z !== zone.value) {
        zone.value = z;
        runOnJS(tick)();
      }
    })
    .onEnd(() => {
      const reveal = width.value * REVEAL_FRACTION;
      const target =
        translateX.value <= -reveal / 2 ? -reveal : translateX.value >= reveal / 2 ? reveal : 0;
      zone.value = target === 0 ? 0 : target < 0 ? -1 : 1;
      translateX.value = withSpring(target, { damping: 22, stiffness: 220 });
      runOnJS(setOpenJS)(target !== 0);
    });

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));
  // Keep the bin hidden at rest (the row dims to 0.7 opacity on press, which
  // would otherwise let it peek through), AND for the first REVEAL_DELAY_MS of
  // any touch — only after that does it fade in over the next few pixels of
  // an actual slide.
  const binStyle = useAnimatedStyle(() => ({
    opacity: revealArmed.value < 1 ? 0 : Math.min(1, Math.max(0, -translateX.value / 8)),
  }));
  // Mirror image of the bin: fades in as the row slides the other way.
  const leftStyle = useAnimatedStyle(() => ({
    opacity: revealArmed.value < 1 ? 0 : Math.min(1, Math.max(0, translateX.value / 8)),
  }));

  const close = () => {
    translateX.value = withSpring(0, { damping: 22, stiffness: 220 });
    zone.value = 0;
    setOpen(false);
  };

  return (
    // layout={LinearTransition} only matters when THIS component is the
    // top-level, key-reordered list item (e.g. the library screen's book
    // list, where a delete removes a row and the rest should settle smoothly
    // rather than snap). When nested inside something else that owns the
    // actual reordering (e.g. DraggablePageCard, which wraps this for the
    // book-detail page list — see its own layout={LinearTransition}), this
    // one is inert, since this component's own position within ITS parent
    // never changes — harmless, just doesn't do anything there.
    <Animated.View
      // .duration() (not bare LinearTransition, which defaults to a
      // bouncy spring) for a gentle, soft settle with no overshoot.
      layout={LinearTransition.duration(220)}
      style={styles.swipeWrap}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        width.value = w;
        setRevealW(w * REVEAL_FRACTION);
      }}
    >
      {hasLeft && (
        <Animated.View style={[styles.actionBehind, styles.leftBehind, { width: revealW }, leftStyle]}>
          {leftActions!(close)}
        </Animated.View>
      )}
      {hasRight && (
        <Animated.View style={[styles.actionBehind, styles.rightBehind, { width: revealW }, binStyle]}>
          <Pressable
            style={styles.actionFill}
            hitSlop={4}
            onPress={() => {
              close();
              onDelete!();
            }}
          >
            <Text style={styles.binIcon}>🗑️</Text>
          </Pressable>
        </Animated.View>
      )}
      <GestureDetector gesture={pan}>
        <Animated.View style={cardStyle}>
          {children}
          {open && <Pressable style={StyleSheet.absoluteFill} onPress={close} />}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // No margin here on purpose — spacing between rows is the CALLER's list
  // layout (e.g. a `gap` on the list's contentContainerStyle), not this
  // component's concern; hardcoding one here would double up with it.
  swipeWrap: { borderRadius: 14, overflow: 'hidden' },
  actionBehind: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightBehind: { right: 0, backgroundColor: 'rgba(255,69,58,0.18)' },
  // Deliberately not red — this side moves a page, it doesn't destroy one.
  leftBehind: { left: 0, backgroundColor: 'rgba(120,150,255,0.16)' },
  actionFill: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' },
  binIcon: { fontSize: 24 },
});
