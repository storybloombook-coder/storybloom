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
import { useState } from 'react';
import { StyleSheet, type LayoutChangeEvent } from 'react-native';
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
  // True from the moment THIS card starts being dragged until its release
  // animation fully settles. Deliberately NOT derived from comparing the
  // shared draggingIndex to this card's `index` prop -- both change in the
  // very same onEnd() tick (draggingIndex resets to -1, and index itself
  // shifts via onReorder's setPages), so that comparison goes false the
  // instant the drag ends.
  const isSettlingOut = useSharedValue(false);
  // Set (with a computed target, see onEnd) the instant a real reorder is
  // triggered; cleared the moment this card's NEXT onLayout confirms the
  // reordered list has actually landed at its new natural position -- see
  // the long comment on the reorder branch below for why release can't just
  // animate translateY down to 0 and trust layout={LinearTransition} to
  // handle the rest.
  const pendingSnapCorrection = useSharedValue(0);
  const hasPendingCorrection = useSharedValue(false);
  // Mirrors hasPendingCorrection into React state so the `layout` prop
  // (evaluated at render time, not on the UI thread) can be suppressed for
  // exactly the duration of a manual settle -- see onEnd/onCardLayout.
  const [suppressLayoutAnim, setSuppressLayoutAnim] = useState(false);

  function computeTargetIndex(dy: number) {
    'worklet';
    const heights = itemHeights.value;
    // A card that hasn't reported onLayout yet (e.g. right after the list's
    // length last changed, which resets every entry to 0 until each card
    // re-measures) has height 0 here — but MY card is definitely laid out
    // and measured, since I'm mid-drag. Use my own height as the fallback
    // for any slot that reads 0, instead of treating it as truly zero-width.
    // Without this, a handful of still-unmeasured 0-width slots collapse
    // the whole position math toward the top: EVERY card's cumulative
    // offset shrinks toward 0, so even a small/moderate drag walks through
    // many "slots" in one go and overshoots straight to the last index —
    // and a last-card drag's own cumulative starts near 0 for the same
    // reason, so it can just as easily overshoot to the first index. That's
    // exactly a first<->last swap on what should be a modest reorder.
    const myHeight = heights[index] || 100;
    const heightOf = (i: number) => heights[i] || myHeight;
    let cumulative = 0;
    for (let i = 0; i < index; i++) cumulative += heightOf(i) + PAGE_LIST_GAP;
    const myCenterY = cumulative + dy + myHeight / 2;

    // Sticky: stay on whichever slot is already the target (expanded a
    // little on both edges) as long as the center is still roughly inside
    // it — see REORDER_HYSTERESIS above.
    const current = targetIndex.value;
    if (current >= 0 && current < heights.length) {
      let currentStart = 0;
      for (let i = 0; i < current; i++) currentStart += heightOf(i) + PAGE_LIST_GAP;
      const currentSlot = heightOf(current) + PAGE_LIST_GAP;
      if (myCenterY >= currentStart - REORDER_HYSTERESIS && myCenterY < currentStart + currentSlot + REORDER_HYSTERESIS) {
        return current;
      }
    }

    let acc = 0;
    for (let i = 0; i < heights.length; i++) {
      const slot = heightOf(i) + PAGE_LIST_GAP;
      if (myCenterY < acc + slot) return i;
      acc += slot;
    }
    return Math.max(0, heights.length - 1);
  }

  /** How far (in px) this card needs to shift from its OLD natural slot to
   *  its NEW one after moving from `from` to `to` — the exact delta
   *  layout={LinearTransition} would itself animate. Computed manually (by
   *  walking the same heights array LinearTransition's own flex reflow will
   *  land on) so the settle animation below can be driven by ONE value
   *  (translateY) instead of two independently-timed systems racing each
   *  other — see the onEnd reorder branch for why that race was the actual
   *  bug behind "snaps to start position, then slides." */
  function computeSettleOffset(from: number, to: number) {
    'worklet';
    const heights = itemHeights.value;
    const myHeight = heights[from] || 100;
    const heightOf = (i: number) => heights[i] || myHeight;
    let oldOffset = 0;
    for (let i = 0; i < from; i++) oldOffset += heightOf(i) + PAGE_LIST_GAP;
    // Walk the OLD index order, skipping `from` itself (it's the one
    // moving) — each step advances one NEW-array slot, so stopping once
    // `count === to` leaves newOffset holding the cumulative height up to
    // (but not including) the moved card's new slot.
    let newOffset = 0;
    let count = 0;
    for (let i = 0; i < heights.length && count < to; i++) {
      if (i === from) continue;
      newOffset += heightOf(i) + PAGE_LIST_GAP;
      count += 1;
    }
    return newOffset - oldOffset;
  }

  // Fires the actual reorder AND flips off layout={LinearTransition} for
  // this card in the very same React batch — so by the time the reordered
  // list re-renders, this instance already has no layout animation of its
  // own to fight with the manual translateY settle below.
  function commitReorder(from: number, to: number) {
    setSuppressLayoutAnim(true);
    onReorder(from, to);
  }

  const panGesture = Gesture.Pan()
    .activateAfterLongPress(350)
    .onStart(() => {
      dragging.value = 1;
      isSettlingOut.value = true;
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
        // A real reorder. The naive approach — animate translateY down to 0
        // over the same duration/easing as layout={LinearTransition} below,
        // and trust the two to interpolate together as one motion — LOOKED
        // right on paper (both easing out identically, starting at whatever
        // offset makes their sum continuous) but only holds if both
        // animations start at the same wall-clock instant. LinearTransition
        // can't start until React actually processes the reorder (a JS
        // thread round trip + re-render + native layout pass), while
        // translateY's withTiming starts immediately on the UI thread — so
        // in practice translateY got a head start, the two drifted out of
        // phase, and the card visibly snapped to its old slot before
        // LinearTransition caught up. That's the "release near the target,
        // then it jumps back to the start and slides over" bug reported
        // live even after matching duration/easing.
        //
        // Fix: don't rely on two independently-timed systems at all. Compute
        // the exact old-slot-to-new-slot delta ourselves (computeSettleOffset,
        // using the same heights LinearTransition's own reflow would use),
        // animate translateY THERE (not to 0) as the single source of
        // motion, and suppress layout={LinearTransition} for this card (see
        // commitReorder) so there's nothing else racing it. Once this card's
        // NEXT onLayout confirms the reordered list actually landed at the
        // new natural slot, onCardLayout below instantly zeroes translateY —
        // invisible, because at that instant old-slot + settleOffset and
        // new-slot + 0 are the same absolute position by construction.
        const settleOffset = computeSettleOffset(index, target);
        pendingSnapCorrection.value = settleOffset;
        hasPendingCorrection.value = true;
        translateY.value = withTiming(settleOffset, { duration: SETTLE_DURATION, easing: SETTLE_EASING });
        runOnJS(commitReorder)(index, target);
      } else {
        // No reorder — dropped back in the same slot, so there's no layout
        // change to align with. This IS the only motion, so it just needs
        // its own smooth return (timing doesn't need to match anything else
        // here, but reusing the same constants keeps the feel consistent).
        translateY.value = withTiming(0, { duration: SETTLE_DURATION, easing: SETTLE_EASING }, (finished) => {
          if (finished) isSettlingOut.value = false;
        });
      }
    });

  // Single combined transform: this card's own drag offset (if it's the one
  // being dragged), OR a live "make room" shift by the DRAGGED card's height
  // (if the drag's current target would displace it), plus a press scale.
  const animatedStyle = useAnimatedStyle(() => {
    const isMe = isSettlingOut.value;
    const from = draggingIndex.value;
    const to = targetIndex.value;

    let shiftY = 0;
    if (!isMe && from !== -1) {
      // Same unmeasured-height fallback as computeTargetIndex — an
      // unmeasured dragged card would otherwise "make room" by only
      // PAGE_LIST_GAP instead of a full card height, leaving neighbors
      // visibly overlapping the dragged card mid-reorder.
      const draggedHeight = (itemHeights.value[from] || itemHeights.value[index] || 100) + PAGE_LIST_GAP;
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

  // Fires on every native layout pass for this card, including the one right
  // after a reorder lands it at its new natural slot. When a manual settle
  // is pending (see onEnd's reorder branch), THAT is the exact moment to
  // hand off: rebase translateY from "offset relative to the OLD slot" to
  // "offset relative to the NEW slot" by subtracting the same settleOffset
  // the old value was animating toward. That rebase is invisible on screen
  // (the layout position moved by +settleOffset in this exact same frame, so
  // the two changes cancel out), and translateY then has only the leftover
  // distance to finish unwinding to 0 -- continuing to close in on the
  // correct spot instead of restarting from a bare snap.
  function onCardLayout(e: LayoutChangeEvent) {
    onMeasured(index, e.nativeEvent.layout.height);
    if (hasPendingCorrection.value) {
      hasPendingCorrection.value = false;
      translateY.value = translateY.value - pendingSnapCorrection.value;
      translateY.value = withTiming(0, { duration: SETTLE_DURATION, easing: SETTLE_EASING }, (finished) => {
        if (finished) isSettlingOut.value = false;
      });
      setSuppressLayoutAnim(false);
    }
  }

  return (
    <Animated.View
      // Bare LinearTransition defaults to a spring with noticeable overshoot
      // ("bounce") — too much for a card settling into its dropped slot.
      // .duration()/.easing() make it a plain eased timing instead. Suppressed
      // entirely (undefined) for the one reorder this card is actively
      // hand-settling itself via translateY above — see commitReorder/
      // onCardLayout — so there's only ever ONE animated system moving this
      // card at a time instead of two racing each other.
      layout={suppressLayoutAnim ? undefined : LinearTransition.duration(SETTLE_DURATION).easing(SETTLE_EASING)}
      style={[styles.wrapper, animatedStyle]}
      onLayout={onCardLayout}
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
