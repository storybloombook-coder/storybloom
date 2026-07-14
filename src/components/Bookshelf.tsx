// Bookshelf.tsx — a physical shelf of favorited books, spines facing out.
//
// Real 1D physics (not a discrete reorder-and-snap): each spine has a
// position + velocity. At rest it's pulled toward its "home slot" (its rank
// on the shelf) by a spring, damped like a real object settling. Dragging a
// spine moves it kinematically under your finger; every other spine it
// overlaps gets shoved — an actual velocity kick, not a teleport — and
// settles back with its own momentum. Dragging one spine through the row
// continuously re-ranks the order, so neighbors slide out of the way to open
// a gap, matching a real "push books along a shelf" gesture.
//
// Interaction: LONG-PRESS a spine to pick it up and drag; a quick tap opens
// the book (same activateAfterLongPress + nested Pressable pattern already
// used for page cards — see DraggablePageCard.tsx / book/[id].tsx). Dragging
// it vertically lifts it "into the air" — past LIFT_THRESHOLD it stops
// colliding with neighbors so it can hover freely over a gap, then lowering
// it back squeezes it in with a real collision bump at wherever it lands.
//
// Tilt the PHONE (via expo-sensors' Accelerometer, not a true gyroscope, but
// it's the axis that matters for left-right tilt) and the shelf's own
// "gravity" tilts with it — past a deadzone, books slide toward the low side
// and pile against the wall through the same collision system as a drag.
// Shake the phone hard enough (a sudden jolt in total acceleration) and the
// whole shelf mixes itself up — randomized order, each spine kicked outward
// so they tumble into place rather than silently snapping.
// NEEDS A NEW DEV-CLIENT BUILD — expo-sensors is a native module not present
// in the currently-installed dev-client APK. A static `import` of it crashes
// the WHOLE APP at launch (the package touches a native module eagerly at
// import time), so it's required defensively below and both features just
// stay inert until a build that actually links it exists.

import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import type { BookSummary } from '../lib/db';

type AccelerometerModule = {
  setUpdateInterval: (ms: number) => void;
  addListener: (cb: (data: { x: number; y: number; z: number }) => void) => { remove: () => void };
};

// See the top-of-file note: this MUST be a runtime require inside a try/catch,
// not a static `import`, or the whole app crashes at launch until a dev-client
// build actually links expo-sensors.
let Accelerometer: AccelerometerModule | null = null;
try {
  Accelerometer = require('expo-sensors').Accelerometer;
} catch {
  Accelerometer = null;
}

const SHELF_HEIGHT = 130;
const SPINE_GAP = 4;
const MIN_SPINE_WIDTH = 30;
const MAX_SPINE_WIDTH = 56;

// Physics tuning — soft enough to feel weighty, damped enough not to jitter.
const STIFFNESS = 90; // spring pull toward home slot
const DAMPING = 14; // velocity drag
const BUMP = 3; // extra velocity kick imparted on collision
const MAX_DT = 0.032; // clamp huge frame gaps (e.g. after a background pause)

// Lift-out-of-the-shelf tuning. Past LIFT_THRESHOLD the dragged spine is
// "in the air" — it stops colliding with neighbors (so it can hover freely
// over a gap) while still live-reordering, then squeezes back in with a real
// collision bump the moment it's lowered back below the threshold.
const LIFT_THRESHOLD = 20;
const LIFT_MIN = -80; // how high it can be lifted
const LIFT_MAX = 24; // a little downward give too

// Tilt the phone and the shelf's own "gravity" tips with it — books slide
// toward the low side and pile against the wall, same collision system as a
// drag. Accelerometer x is ~0 held level, ~±1g at a full 90° side-tilt.
const GRAVITY_STRENGTH = 260;
const TILT_UPDATE_MS = 80;
// Below this, treat the phone as "held level" — a real phone is essentially
// never perfectly flat, and without a deadzone that ambient tilt would keep
// the physics loop (and its battery cost) running permanently. Above it, a
// deliberate tilt is unambiguous.
const TILT_DEADZONE = 0.12;

// Shake-to-mix: a sudden jolt in total acceleration (not just tilt) shuffles
// the whole shelf, same physics as everything else — a randomized order plus
// an outward velocity kick per spine so they visibly tumble before settling,
// rather than silently snapping to a new arrangement.
const SHAKE_DELTA = 1.0; // jump in |acceleration| (g) between readings
const SHAKE_DEBOUNCE_MS = 1200;
const SHAKE_KICK = 220;

/** Deterministic, distinct-enough hue per book id — there's no real spine
 *  artwork, so color is how spines read as different books. */
function hueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Move `bookIndex` to the rank implied by its current x, shifting the rest —
 *  called continuously while dragging so neighbors "make room" live. */
function reorderForDrag(order: number[], bookIndex: number, x: number, slot: number): number[] {
  'worklet';
  const currentRank = order.indexOf(bookIndex);
  const targetRank = Math.min(order.length - 1, Math.max(0, Math.round(x / slot)));
  if (targetRank === currentRank) return order;
  const next = order.slice();
  next.splice(currentRank, 1);
  next.splice(targetRank, 0, bookIndex);
  return next;
}

function hapticStart() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

function hapticDrop() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
}

function Spine({
  book,
  index,
  spineWidth,
  containerWidth,
  xs,
  order,
  draggingIndex,
  lastDragX,
  dragLiftY,
  onOpen,
  onReordered,
}: {
  book: BookSummary;
  index: number;
  spineWidth: number;
  containerWidth: number;
  xs: SharedValue<number[]>;
  order: SharedValue<number[]>;
  draggingIndex: SharedValue<number>;
  /** x of the actively-dragged spine as of the last physics tick — lets the
   *  frame loop finite-difference a real velocity, so letting go mid-shove
   *  keeps that momentum instead of snapping straight to the spring. */
  lastDragX: SharedValue<number>;
  /** How far the actively-dragged spine has been lifted off the shelf line
   *  (negative = up). Only meaningful while draggingIndex === this index. */
  dragLiftY: SharedValue<number>;
  onOpen: (book: BookSummary) => void;
  onReordered: (order: number[]) => void;
}) {
  const startX = useSharedValue(0);
  const slot = spineWidth + SPINE_GAP;

  const persist = (ord: number[]) => onReordered(ord);

  const pan = Gesture.Pan()
    .activateAfterLongPress(300)
    .onStart(() => {
      startX.value = xs.value[index];
      lastDragX.value = xs.value[index];
      draggingIndex.value = index;
      dragLiftY.value = 0;
      runOnJS(hapticStart)();
    })
    .onUpdate((e) => {
      let nx = startX.value + e.translationX;
      nx = Math.min(Math.max(nx, 0), containerWidth - spineWidth);
      xs.value[index] = nx;
      order.value = reorderForDrag(order.value, index, nx, slot);
      dragLiftY.value = Math.min(LIFT_MAX, Math.max(LIFT_MIN, e.translationY));
    })
    .onEnd(() => {
      const wasLifted = Math.abs(dragLiftY.value) > LIFT_THRESHOLD;
      draggingIndex.value = -1;
      dragLiftY.value = withSpring(0, { damping: 14, stiffness: 200 });
      runOnJS(persist)(order.value);
      if (wasLifted) runOnJS(hapticDrop)();
    });

  const style = useAnimatedStyle(() => {
    const isMe = draggingIndex.value === index;
    const lifted = isMe && Math.abs(dragLiftY.value) > LIFT_THRESHOLD;
    return {
      transform: [
        { translateX: xs.value[index] ?? index * slot },
        { translateY: isMe ? dragLiftY.value : 0 },
        { scale: lifted ? 1.08 : 1 },
      ],
      zIndex: isMe ? 10 : 1,
      shadowOpacity: lifted ? 0.55 : 0.3,
      shadowRadius: lifted ? 7 : 3,
    };
  });

  const hue = hueFromId(book.id);

  return (
    <Animated.View
      style={[
        styles.spine,
        { width: spineWidth, backgroundColor: `hsl(${hue}, 42%, 34%)` },
        style,
      ]}
    >
      <GestureDetector gesture={pan}>
        <Pressable style={styles.spinePressable} onPress={() => onOpen(book)}>
          <View style={[styles.spineHighlight, { backgroundColor: `hsl(${hue}, 42%, 46%)` }]} />
          <View style={styles.spineTitleWrap}>
            <Text
              style={styles.spineTitle}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {book.title}
            </Text>
          </View>
          <View style={styles.spineBand} />
        </Pressable>
      </GestureDetector>
    </Animated.View>
  );
}

export default function Bookshelf({
  books,
  onOpen,
  onReorder,
}: {
  /** Favorited books, already sorted left-to-right (by shelfPosition). */
  books: BookSummary[];
  onOpen: (book: BookSummary) => void;
  /** Called with the new left-to-right book ids after a drag settles. */
  onReorder: (bookIds: string[]) => void;
}) {
  const [containerWidth, setContainerWidth] = useState(0);
  const n = books.length;

  const spineWidth = useMemo(() => {
    if (containerWidth === 0 || n === 0) return MAX_SPINE_WIDTH;
    const fit = (containerWidth - (n - 1) * SPINE_GAP) / n;
    return Math.max(MIN_SPINE_WIDTH, Math.min(MAX_SPINE_WIDTH, Math.floor(fit)));
  }, [containerWidth, n]);

  // books arrives pre-sorted by shelf position, so initial rank == array
  // index — these seed values already match, no snap-into-place on mount.
  const xs = useSharedValue<number[]>(books.map((_, i) => i * (spineWidth + SPINE_GAP)));
  const vxs = useSharedValue<number[]>(books.map(() => 0));
  const order = useSharedValue<number[]>(books.map((_, i) => i));
  const draggingIndex = useSharedValue(-1);
  const lastDragX = useSharedValue(0);
  const dragLiftY = useSharedValue(0);
  const widthShared = useSharedValue(containerWidth);
  const slotShared = useSharedValue(spineWidth + SPINE_GAP);
  const tiltX = useSharedValue(0);
  // Shared-value writes must happen in an effect, not during render (Reanimated
  // strict mode warns/misbehaves otherwise).
  useEffect(() => {
    widthShared.value = containerWidth;
  }, [containerWidth, widthShared]);
  useEffect(() => {
    slotShared.value = spineWidth + SPINE_GAP;
  }, [spineWidth, slotShared]);

  const lastMagnitude = useRef(1);
  const lastShakeAt = useRef(0);

  /** Randomize the shelf order and give every spine an outward velocity kick
   *  so they visibly tumble into their new slots instead of silently
   *  snapping — then persist the new order like a drag would. */
  function shuffleShelf() {
    const len = xs.value.length;
    if (len < 2) return;
    const shuffled = order.value.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }
    order.value = shuffled;
    const kicked = vxs.value.slice();
    for (let i = 0; i < len; i++) kicked[i] = (Math.random() - 0.5) * 2 * SHAKE_KICK;
    vxs.value = kicked;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    handleReordered(shuffled);
  }

  // Tilt the phone, tilt the shelf's gravity; shake it hard enough and the
  // whole shelf mixes itself up. Accelerometer updates land on the JS thread;
  // writing a shared value from there is fine — the physics loop just reads
  // whatever it last saw. No-ops until a dev-client build actually links
  // expo-sensors.
  useEffect(() => {
    if (!Accelerometer) return;
    Accelerometer.setUpdateInterval(TILT_UPDATE_MS);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      tiltX.value = x;

      const magnitude = Math.sqrt(x * x + y * y + z * z);
      const delta = Math.abs(magnitude - lastMagnitude.current);
      lastMagnitude.current = magnitude;
      const now = Date.now();
      if (
        delta > SHAKE_DELTA &&
        now - lastShakeAt.current > SHAKE_DEBOUNCE_MS &&
        draggingIndex.value === -1
      ) {
        lastShakeAt.current = now;
        shuffleShelf();
      }
    });
    return () => sub.remove();
  }, [tiltX]);

  useFrameCallback((frame) => {
    const dt = Math.min((frame.timeSincePreviousFrame ?? 16) / 1000, MAX_DT);
    const len = xs.value.length;
    if (len === 0) return;
    // Cheap early-out once everything's settled and nothing is being dragged —
    // this callback runs for the lifetime of the component (including while
    // the user has navigated elsewhere, since Expo Router keeps the screen
    // mounted), so skip the array-clone/sort/spring work entirely when idle
    // rather than paying it 60x/sec for no visible effect.
    const gravity = Math.abs(tiltX.value) > TILT_DEADZONE ? tiltX.value * GRAVITY_STRENGTH : 0;
    if (draggingIndex.value === -1 && gravity === 0) {
      let settled = true;
      for (let i = 0; i < len; i++) {
        if (Math.abs(vxs.value[i]) > 0.5) {
          settled = false;
          break;
        }
      }
      if (settled) return;
    }
    const nextXs = xs.value.slice();
    const nextVxs = vxs.value.slice();
    const ord = order.value;
    const slot = slotShared.value;
    const maxX = Math.max(0, widthShared.value - spineWidth);

    // Velocity of whichever spine is being dragged, finite-differenced against
    // its position at the end of the LAST physics tick (lastDragX) — not the
    // per-tick array copy, which would always diff against itself and read ~0.
    const draggedVel =
      draggingIndex.value >= 0 && dt > 0
        ? (xs.value[draggingIndex.value] - lastDragX.value) / dt
        : 0;
    if (draggingIndex.value >= 0) lastDragX.value = xs.value[draggingIndex.value];
    // Lifted "into the air" — floats free of horizontal collision until it's
    // lowered back toward the shelf line, where it lands with a real bump.
    const draggedLifted = draggingIndex.value >= 0 && Math.abs(dragLiftY.value) > LIFT_THRESHOLD;

    for (let i = 0; i < len; i++) {
      if (i === draggingIndex.value) {
        // Kinematic: position already set by the gesture.
        nextVxs[i] = draggedVel;
        continue;
      }
      const rank = ord.indexOf(i);
      const homeX = rank * slot;
      // While gravity is active, the home-slot spring is switched off entirely
      // — at STIFFNESS=90 it was strong enough to cancel out any realistic
      // GRAVITY_STRENGTH, capping tilt displacement at a few invisible pixels.
      // Real tilt behavior needs gravity to actually win: books slide freely
      // until the wall or a neighbor (the collision pass below) stops them,
      // same as a real object on a tilted shelf. The spring only resumes once
      // the phone is leveled again, pulling everything back to its rank slot.
      const springForce = gravity === 0 ? (homeX - nextXs[i]) * STIFFNESS : 0;
      const dampingForce = -nextVxs[i] * DAMPING;
      nextVxs[i] += (springForce + dampingForce + gravity) * dt;
      nextXs[i] += nextVxs[i] * dt;
    }

    // Pairwise collision — a couple of relaxation passes keeps adjacent
    // overlaps stable instead of jittering. The kick scales with the dragged
    // spine's actual speed (plus a floor from sheer overlap) so a fast shove
    // knocks a neighbor harder than a slow nudge.
    for (let pass = 0; pass < 2; pass++) {
      // Array.from() isn't safe to call from a worklet (crashes with "tried to
      // synchronously call a Remote Function") — build the index list by hand.
      const sortedByX: number[] = [];
      for (let idx = 0; idx < len; idx++) sortedByX.push(idx);
      sortedByX.sort((a, b) => nextXs[a] - nextXs[b]);
      for (let k = 0; k < len - 1; k++) {
        const i = sortedByX[k];
        const j = sortedByX[k + 1];
        const overlap = nextXs[i] + spineWidth - nextXs[j];
        if (overlap <= 0) continue;
        const iDragged = i === draggingIndex.value;
        const jDragged = j === draggingIndex.value;
        if ((iDragged || jDragged) && draggedLifted) continue;
        if (iDragged && !jDragged) {
          nextXs[j] += overlap;
          nextVxs[j] += overlap * BUMP + Math.max(0, draggedVel) * 0.5;
        } else if (jDragged && !iDragged) {
          nextXs[i] -= overlap;
          nextVxs[i] -= overlap * BUMP + Math.max(0, -draggedVel) * 0.5;
        } else if (!iDragged && !jDragged) {
          nextXs[i] -= overlap / 2;
          nextXs[j] += overlap / 2;
          nextVxs[i] -= (overlap * BUMP) / 2;
          nextVxs[j] += (overlap * BUMP) / 2;
        }
      }
    }

    for (let i = 0; i < len; i++) {
      if (nextXs[i] < 0) {
        nextXs[i] = 0;
        if (nextVxs[i] < 0) nextVxs[i] = 0;
      } else if (nextXs[i] > maxX) {
        nextXs[i] = maxX;
        if (nextVxs[i] > 0) nextVxs[i] = 0;
      }
    }

    xs.value = nextXs;
    vxs.value = nextVxs;
  });

  function handleReordered(ord: number[]) {
    onReorder(ord.map((bookIndex) => books[bookIndex].id));
  }

  function onLayout(e: LayoutChangeEvent) {
    setContainerWidth(e.nativeEvent.layout.width);
  }

  if (n === 0) return null;

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <Text style={styles.label}>⭐ Bookshelf</Text>
      <View style={[styles.shelfArea, { height: SHELF_HEIGHT }]}>
        {containerWidth > 0 &&
          books.map((book, index) => (
            <Spine
              key={book.id}
              book={book}
              index={index}
              spineWidth={spineWidth}
              containerWidth={containerWidth}
              xs={xs}
              order={order}
              draggingIndex={draggingIndex}
              lastDragX={lastDragX}
              dragLiftY={dragLiftY}
              onOpen={onOpen}
              onReordered={handleReordered}
            />
          ))}
      </View>
      <View style={styles.shelfLip} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 18 },
  label: { fontSize: 13, fontWeight: '700', marginBottom: 6, marginLeft: 2, opacity: 0.6 },
  shelfArea: { position: 'relative' },
  spine: {
    position: 'absolute',
    top: 0,
    bottom: 8,
    borderRadius: 4,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 1, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
  spinePressable: { flex: 1 },
  spineHighlight: { position: 'absolute', top: 0, bottom: 0, left: 3, width: 2, opacity: 0.7 },
  spineTitleWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '90deg' }],
  },
  spineTitle: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 13,
    fontWeight: '700',
    width: SHELF_HEIGHT - 24,
    textAlign: 'center',
  },
  spineBand: {
    position: 'absolute',
    bottom: 14,
    left: 4,
    right: 4,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 2,
  },
  shelfLip: {
    height: 14,
    marginTop: -1,
    backgroundColor: '#8a5a34',
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 4,
  },
});
