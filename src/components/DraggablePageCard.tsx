// DraggablePageCard.tsx — long-press-to-drag wrapper for a book's page cards
// (book/[id].tsx). Mirrors DraggableThumb.tsx's shared-value architecture
// (draggingIndex/targetIndex driving every sibling's "make room" shift), but
// for a single vertical column of VARIABLE-height cards instead of a fixed
// grid — so position math tracks each card's real measured height instead of
// a constant cell size.
//
// Dragging past a fixed trash-bin zone (bottom-center of the screen, see
// book/[id].tsx) deletes the page instead of reordering it.

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

export interface BinBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function triggerDragHaptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

export default function DraggablePageCard({
  index,
  draggingIndex,
  targetIndex,
  itemHeights,
  binHover,
  binBounds,
  onReorder,
  onDelete,
  onMeasured,
  children,
}: {
  index: number;
  /** Shared across every card: -1 when nothing is being dragged. */
  draggingIndex: SharedValue<number>;
  targetIndex: SharedValue<number>;
  /** One measured height per page, kept in sync via onMeasured. */
  itemHeights: SharedValue<number[]>;
  /** 0/1 — whichever card is being dragged writes this; the trash bin reads it. */
  binHover: SharedValue<number>;
  binBounds: BinBounds;
  onReorder: (from: number, to: number) => void;
  onDelete: (index: number) => void;
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

  function overBin(absX: number, absY: number) {
    'worklet';
    return absX >= binBounds.left && absX <= binBounds.right && absY >= binBounds.top && absY <= binBounds.bottom;
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
      binHover.value = overBin(e.absoluteX, e.absoluteY) ? 1 : 0;
    })
    .onEnd((e) => {
      const hovering = overBin(e.absoluteX, e.absoluteY);
      const target = computeTargetIndex(e.translationY);
      translateY.value = withTiming(0);
      dragging.value = 0;
      draggingIndex.value = -1;
      targetIndex.value = -1;
      binHover.value = 0;
      if (hovering) {
        runOnJS(onDelete)(index);
      } else if (target !== index) {
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
      layout={LinearTransition}
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
