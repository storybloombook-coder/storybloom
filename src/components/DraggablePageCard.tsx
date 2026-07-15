// DraggablePageCard.tsx — long-press-to-drag wrapper for a book's page cards
// (book/[id].tsx). Mirrors DraggableThumb.tsx's shared-value architecture
// (draggingIndex/targetIndex driving every sibling's "make room" shift), but
// for a single vertical column of VARIABLE-height cards instead of a fixed
// grid — so position math tracks each card's real measured height instead of
// a constant cell size.
//
// Reordering only — deletion is a separate swipe-left-to-reveal-a-bin
// gesture (SwipeableRow.tsx, the same one the library screen uses for
// books), not a drag-onto-a-fixed-bin-target like this used to be. This
// component MUST be the outer wrapper and SwipeableRow nested INSIDE it
// (i.e. <DraggablePageCard><SwipeableRow>{content}</SwipeableRow></...>),
// never the other way — this is the element that actually gets dragged
// across/over its neighbors (zIndex while dragging, translateY-based
// "make room" shifts on its neighbors, layout={LinearTransition} on
// reorder-settle). SwipeableRow's own `overflow: hidden` would clip any of
// that the instant it moved beyond its own row's bounds if it were the
// outer element — that exact regression happened once already.

import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  LinearTransition,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

export const PAGE_LIST_GAP = 12;

function triggerDragHaptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

export default function DraggablePageCard({
  index,
  draggingIndex,
  targetIndex,
  itemHeights,
  onReorder,
  onMeasured,
  children,
}: {
  index: number;
  /** Shared across every card: -1 when nothing is being dragged. */
  draggingIndex: SharedValue<number>;
  targetIndex: SharedValue<number>;
  /** One measured height per page, kept in sync via onMeasured. */
  itemHeights: SharedValue<number[]>;
  onReorder: (from: number, to: number) => void;
  onMeasured: (index: number, height: number) => void;
  children: ReactNode;
}) {
  const translateY = useSharedValue(0);
  const dragging = useSharedValue(0);

  function computeTargetIndex(dy: number) {
    'worklet';
    const heights = itemHeights.value;
    let cumulative = 0;
    for (let i = 0; i < index; i++) cumulative += (heights[i] ?? 0) + PAGE_LIST_GAP;
    const myHeight = heights[index] ?? 0;
    const myCenterY = cumulative + dy + myHeight / 2;
    let acc = 0;
    for (let i = 0; i < heights.length; i++) {
      const slot = (heights[i] ?? 0) + PAGE_LIST_GAP;
      if (myCenterY < acc + slot) return i;
      acc += slot;
    }
    return Math.max(0, heights.length - 1);
  }

  const panGesture = Gesture.Pan()
    .activateAfterLongPress(350)
    .onStart(() => {
      dragging.value = 1;
      draggingIndex.value = index;
      targetIndex.value = index;
      runOnJS(triggerDragHaptic)();
    })
    .onUpdate((e) => {
      translateY.value = e.translationY;
      targetIndex.value = computeTargetIndex(e.translationY);
    })
    .onEnd(() => {
      const target = computeTargetIndex(translateY.value);
      translateY.value = withTiming(0);
      dragging.value = 0;
      draggingIndex.value = -1;
      targetIndex.value = -1;
      if (target !== index) {
        runOnJS(onReorder)(index, target);
      }
    });

  // Single combined transform: this card's own drag offset (if it's the one
  // being dragged), OR a live "make room" shift by the DRAGGED card's height
  // (if the drag's current target would displace it), plus a press scale.
  const animatedStyle = useAnimatedStyle(() => {
    const isMe = draggingIndex.value === index;
    const from = draggingIndex.value;
    const to = targetIndex.value;

    let shiftY = 0;
    if (!isMe && from !== -1) {
      const draggedHeight = (itemHeights.value[from] ?? 0) + PAGE_LIST_GAP;
      if (to > from && index > from && index <= to) shiftY = -draggedHeight;
      else if (to < from && index < from && index >= to) shiftY = draggedHeight;
    }

    return {
      transform: [
        { translateY: isMe ? translateY.value : withTiming(shiftY) },
        { scale: withTiming(dragging.value ? 1.03 : 1) },
      ],
      zIndex: dragging.value ? 100 : 0,
      shadowOpacity: withTiming(dragging.value ? 0.25 : 0),
    };
  });

  return (
    <Animated.View
      // Bare LinearTransition defaults to a spring with noticeable overshoot
      // ("bounce") — too much for a card settling into its dropped slot.
      // .duration() makes it a plain eased timing instead: no overshoot at
      // all, just a gentle, soft settle.
      layout={LinearTransition.duration(220)}
      style={[styles.wrapper, animatedStyle]}
      onLayout={(e) => onMeasured(index, e.nativeEvent.layout.height)}
    >
      <GestureDetector gesture={panGesture}>
        <Animated.View>{children}</Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
  },
});
