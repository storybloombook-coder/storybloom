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
  Easing,
  LinearTransition,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

export const PAGE_LIST_GAP = 12;
// A hovering finger is never perfectly still — a few px of natural tremor
// right at a slot boundary would otherwise flip the target index back and
// forth every frame, making neighbors visibly jitter up/down instead of
// holding a single clean "make room" shift. Sticking to whichever slot is
// ALREADY the target until the center moves decisively past it (by this
// margin, on either edge) absorbs that tremor.
const REORDER_HYSTERESIS = 10;
// Shared by this card's own translateY-reset AND layout={LinearTransition}
// below — see the settle-continuity note at the .onEnd() reorder branch for
// why they need to match exactly.
const SETTLE_DURATION = 220;
const SETTLE_EASING = Easing.out(Easing.cubic);

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

    // Sticky: stay on whichever slot is already the target (expanded a
    // little on both edges) as long as the center is still roughly inside
    // it — see REORDER_HYSTERESIS above.
    const current = targetIndex.value;
    if (current >= 0 && current < heights.length) {
      let currentStart = 0;
      for (let i = 0; i < current; i++) currentStart += (heights[i] ?? 0) + PAGE_LIST_GAP;
      const currentSlot = (heights[current] ?? 0) + PAGE_LIST_GAP;
      if (myCenterY >= currentStart - REORDER_HYSTERESIS && myCenterY < currentStart + currentSlot + REORDER_HYSTERESIS) {
        return current;
      }
    }

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
      dragging.value = 0;
      draggingIndex.value = -1;
      targetIndex.value = -1;
      if (target !== index) {
        // A real reorder — this card is about to move to a new NATURAL slot,
        // which layout={LinearTransition} bridges by animating the gap
        // between the OLD slot's position and the NEW one (nothing to do
        // with translateY — it's a completely separate transform). Right
        // now, translateY still holds the raw drag offset, i.e. the card is
        // sitting exactly where the finger let go, which is generally NOT
        // the old natural slot. If translateY snapped to 0 here, the card
        // would visually jump BACK to its old natural slot for an instant
        // before LinearTransition even started — a release that didn't
        // continue smoothly from where it was let go.
        // Instead, animate translateY down to 0 over the EXACT SAME
        // duration/easing as LinearTransition below. Two transforms summed
        // together, both easing out at the same rate, interpolate as ONE
        // continuous motion: at any moment the total offset is (gap between
        // old and new slot) + (remaining drag offset), which starts at
        // "wherever the finger released it" and glides straight to the new
        // slot — no snap, no separate "switch" animation.
        translateY.value = withTiming(0, { duration: SETTLE_DURATION, easing: SETTLE_EASING });
        runOnJS(onReorder)(index, target);
      } else {
        // No reorder — dropped back in the same slot, so there's no layout
        // change to align with. This IS the only motion, so it just needs
        // its own smooth return (timing doesn't need to match anything else
        // here, but reusing the same constants keeps the feel consistent).
        translateY.value = withTiming(0, { duration: SETTLE_DURATION, easing: SETTLE_EASING });
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

    // While a drag is in progress, animate the live "make room" preview
    // shift smoothly. The MOMENT it ends (from === -1), any card that WAS
    // previewed-shifted is exactly one whose REAL layout position is about
    // to change from the reorder (see onReorder above) — the same set of
    // indices in both cases. layout={LinearTransition} on the list item
    // already animates that real position change; also animating this
    // preview transform back to 0 at the same time stacked a second
    // transition on top of it, which read as a hard bounce on every
    // neighbor the drag had displaced — same root cause as the dragged
    // card's own bounce, just not yet fixed for its neighbors. Snap
    // instantly here and let LinearTransition own the settle alone.
    const shiftStyle = from === -1 ? shiftY : withTiming(shiftY);

    return {
      transform: [
        { translateY: isMe ? translateY.value : shiftStyle },
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
      // .duration()/.easing() make it a plain eased timing instead — and
      // MUST exactly match SETTLE_DURATION/SETTLE_EASING used for translateY
      // above, so the two separate transforms (this one bridging old-slot to
      // new-slot, translateY unwinding the raw drag offset) interpolate
      // together as one continuous motion instead of two independently-timed
      // ones that don't line up (which is what read as a hard bounce).
      layout={LinearTransition.duration(SETTLE_DURATION).easing(SETTLE_EASING)}
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
