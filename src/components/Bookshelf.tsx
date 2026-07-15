// Bookshelf.tsx — a physical shelf of favorited books, spines facing out.
//
// Real 1D physics (not a discrete reorder-and-snap): each spine has a
// position + velocity, damped like a real object settling. There is NO
// restoring force pulling books toward a tidy packed position or toward each
// other — the only things that ever move a spine are a direct drag,
// tilt-gravity, a shake, or a collision with a neighbor; once those stop
// acting on it, it just stays wherever that leaves it (falling horizontally
// and stacking unevenly is the intended, physical look, not a bug). Dragging
// a spine moves it kinematically under your finger; every other spine it
// overlaps gets shoved — an actual velocity kick, not a teleport — and
// settles back with its own momentum. Dragging one spine through the row
// continuously re-ranks the order, so neighbors slide out of the way to open
// a gap, matching a real "push books along a shelf" gesture. The MOMENT that
// live-reordered target rank changes, the two spines now adjacent to the gap
// get a one-time outward kick + a small wiggle + a haptic tick — a preview
// of where it'll land, not just a reaction once you actually drop it in
// (see GAP_NUDGE_KICK/GAP_WIGGLE_KICK).
//
// Interaction: LONG-PRESS a spine to pick it up and drag; a quick tap opens
// the book (same activateAfterLongPress + nested Pressable pattern already
// used for page cards — see DraggablePageCard.tsx / book/[id].tsx). Dragging
// it vertically lifts it "into the air" — past LIFT_THRESHOLD it stops
// colliding with neighbors so it can hover freely over a gap, then lowering
// it back (while still holding it) squeezes it in with a real collision bump
// at wherever it lands. Letting go while it's still lifted doesn't snap it
// back to the shelf line — real gravity (LIFT_GRAVITY) takes over and it
// actually FALLS the rest of the way down, landing with its fall velocity
// zeroed at the shelf surface, same physics-in-the-frame-loop approach as
// everything else here (see the lift/fall note above LIFT_GRAVITY). Grabbing
// it off-center from its own midpoint (like picking up a real book near one
// end) makes it rotate/tilt as it's shoved, via its own small rotational
// spring-damper — see ROTATION_* below. Once it's actually LIFTED (not just
// being shoved along the shelf), a grab point that's off-center on BOTH axes
// (a corner) makes it hang at a natural diagonal angle instead — like a real
// book suspended from an off-center point, rotating until its center of
// mass ends up below the grip, further skewed by the phone's own sensed
// tilt (see the "Diagonal corner-hang" note near ROTATION_TORQUE below).
//
// Tilt the PHONE (via expo-sensors' Accelerometer, not a true gyroscope, but
// it's the axis that matters for left-right tilt) and the shelf's own
// "gravity" tilts with it — past a deadzone AND past static friction (real
// shelves have friction; see FRICTION below), books slide toward the low
// side and pile against the wall through the same collision system as a
// drag. Every spine also visibly LEANS in proportion to the current tilt,
// even before anything actually slides, so you can see gravity's direction
// on the shelf itself — and a spine that's pinned against a wall (nowhere
// left to slide) with the tilt still getting steeper topples fully onto its
// side instead of just leaning (see TILT_LEAN_DEG_PER_UNIT/FALL_* below;
// same rotational spring-damper as the grab-point tilt, just aimed at a
// tilt-driven target instead of level). Shake the phone hard enough (a
// sudden jolt in total acceleration) and the whole shelf mixes itself up —
// randomized order, each spine kicked outward so they tumble into place
// rather than silently snapping. A fast vertical phone movement also gives
// the whole shelf a physically-real vertical hop, driven directly by the
// sensed jerk — see BOUNCE_* below.
// NEEDS A DEV-CLIENT BUILD WITH expo-sensors LINKED — a static `import` of it
// crashes the WHOLE APP at launch on a build that doesn't have it (the
// package touches a native module eagerly at import time), so it's required
// defensively below and every sensor-driven feature stays inert without one.

import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
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
// Spines are always this width — they never shrink to cram more books onto
// one shelf (that read as "squeezing" and looked inconsistent between
// visits). Once more books are favorited than fit at this width, the extras
// spill onto additional numbered shelves instead (see the shelf switcher).
const SPINE_WIDTH = 56;
// Actual rendered height of a spine (see the `spine` style — top:0, bottom:8
// inside a SHELF_HEIGHT-tall shelf). Used to normalize where on the spine a
// drag gesture started, for the grab-point-dependent rotation below.
const SPINE_VISIBLE_HEIGHT = SHELF_HEIGHT - 8;
// Width of the visible bookend wall at each end of the shelf (see the
// `shelfWall` style). The sliding range is inset by this much on each side
// so a pinned spine always stops just short of the wall instead of
// overlapping/covering it — relying on z-order to hide the seam looked
// glitchy on real hardware, insetting the range avoids the overlap
// altogether.
const WALL_WIDTH = 6;

// Grab-point-dependent tilt: picking a spine up off-center from its own
// midpoint (like a real book grabbed near one end) makes it rotate as it's
// shoved around, pivoting harder the farther from center you grabbed it —
// a lightweight rotational spring-damper, same shape as the horizontal
// physics, with the drag supplying "torque" instead of a driving force.
const ROTATION_MAX = 22; // degrees, clamp WHILE BEING DRAGGED
// Cut hard again from 70/14 — even that still read as "way too crazy and
// fast" on real hardware. Real books settle calmly, not snappily; lower
// stiffness + more damping means a slower, heavier-feeling approach to
// whatever the current target is (gentle lean, drag-torque, or a topple).
const ROTATION_STIFFNESS = 32;
const ROTATION_DAMPING = 20;
// Scales (how far off-center you grabbed) * (how fast it's being shoved)
// into a torque. Sign is a first pass, not yet confirmed on hardware — if a
// book tips the wrong way for where it was grabbed, flip this to negative.
const ROTATION_TORQUE = 0.16;
// How much of the "ideal pendulum" corner-hang angle to actually use — see
// the note at its use site. Confirmed on hardware to need taming from 1.0;
// 0.3 was still "way too much" on a second pass, cut hard again.
const CORNER_HANG_STRENGTH = 0.12;
// Collision-impact rotation: on top of the continuous shove torque above,
// the dragged spine gets an extra instantaneous rotational jolt exactly
// when it hits another book — scaled by the grab point (same lever-arm
// idea as ROTATION_TORQUE) and how deep the impact is. First pass, not yet
// confirmed on hardware.
const COLLISION_ROTATION_KICK = 1.0;

// Ambient tilt lean: even without touching a book, every spine visibly
// tilts a little as the phone tilts — the same rotation spring-damper above,
// just aimed at a target that tracks tiltX instead of always being level, so
// you can SEE gravity's direction on the shelf even before anything falls or
// slides. Three deliberately separate stages as tilt increases (tiltX is
// roughly sin(tilt angle) in g's). The two thresholds below are derived from
// real physics, not just feel:
//   - TOPPLE angle: a rigid block standing on edge tips over once its center
//     of mass passes beyond its base — tan(θ) = thickness / height. Typical
//     books: paperback (~2cm / 20cm) ≈ 5.7°, hardcover novel (~3.5cm / 24cm)
//     ≈ 8.3°, thick hardcover (~5cm / 26cm) ≈ 10.9°. Averaging these gives
//     ~8.5° for an "average" book.
//   - SLIDE angle: an object on an incline slides once tan(θ) exceeds the
//     static friction coefficient. Paper/cloth book covers on a wood or
//     laminate shelf are typically μ ≈ 0.35, giving arctan(0.35) ≈ 19.3°.
//   1. Past TILT_DEADZONE (~7°)          — just the proportional lean, above.
//   2. Past FALL_TILT_THRESHOLD (~8.5°)  — topples fully onto its side, UNLESS
//      it's pinned against a wall — a rigid wall holds a book upright rather
//      than being what tips it over (see the "pinned" check at its use site).
//   3. Past SLIDE_TILT_THRESHOLD (~19°)  — gravity ALSO starts actually
//      sliding books across the shelf (see the `gravity` computation below),
//      not just leaning/toppling them in place.
const TILT_LEAN_DEG_PER_UNIT = 11; // degrees of lean per unit of tiltX — calmer baseline
// Temporarily disabled — flip back to true to re-enable. While off, tilt
// only ever produces the gentle lean below (capped at MAX_LEAN_DEG), never
// a full topple or actual sliding across the shelf.
const FALL_ENABLED = false;
const SLIDE_ENABLED = false;
// Hard cap on the ambient lean angle while FALL_ENABLED is off — "just a
// little tilt," not a progression toward toppling.
const MAX_LEAN_DEG = 7;
const FALL_TILT_THRESHOLD = 0.148; // sin(8.5°) — average book's topple angle
const FALL_ROTATION_DEG = 78; // not quite 90 — reads as "fallen", not glued flat
const SLIDE_TILT_THRESHOLD = 0.33; // sin(19.3°) — arctan(0.35) friction coefficient

// Physics tuning — soft enough to feel weighty, damped enough not to jitter.
// No home-slot spring — books never get pulled toward a tidy packed
// position or toward each other; they only move via drag, tilt-gravity, a
// shake, or a collision, and just stay wherever that leaves them (falling
// horizontally and stacking unevenly is the intended, physical look).
const DAMPING = 22; // velocity drag — heavier/calmer settling than the original 14
const BUMP = 1.6; // extra velocity kick imparted on collision — gentler than the original 3
const MAX_DT = 0.032; // clamp huge frame gaps (e.g. after a background pause)

// Quick swipe across the shelf (distinct from the long-press-to-drag
// interaction): a normal-speed brush of the finger across several spines
// gives each one it passes over a one-time outward impulse in the swipe
// direction, so they shake/jostle as your finger goes by — like flicking a
// finger across a real row of books. Doesn't pick anything up or reorder;
// purely a physical reaction. Only fires when no spine is actively being
// dragged, and each spine is only impulsed once per continuous swipe.
const SWIPE_IMPULSE = 160; // outward velocity kick
const SWIPE_WIGGLE = 100; // rotational velocity kick, degrees/sec

// Make-room reaction: while dragging a spine (especially while lifted,
// hovering to insert it into a gap), the moment its live-reordered target
// rank changes, the two spines that are now its immediate neighbors get a
// one-time outward velocity kick (part apart to open the gap) plus a small
// rotational wiggle — a preview that "this is where it'll land" instead of
// only reacting once you actually drop it in. A one-time KICK, not a
// restoring force, so it doesn't reintroduce the "drawn toward a slot"
// behavior that was deliberately removed elsewhere.
const GAP_NUDGE_KICK = 50; // outward velocity kick, same order as collision BUMP
const GAP_WIGGLE_KICK = 35; // small rotational velocity kick, degrees/sec

// Lift-out-of-the-shelf tuning. Past LIFT_THRESHOLD the dragged spine is
// "in the air" — it stops colliding with neighbors (so it can hover freely
// over a gap) while still live-reordering, then squeezes back in with a real
// collision bump the moment it's lowered back below the threshold.
const LIFT_THRESHOLD = 20;
const LIFT_MIN = -120; // how high it can be lifted — widened 50% (was -80), books
// were getting clipped/feeling like they vanished when dragged up near the old limit
const LIFT_MAX = 24; // a little downward give too
// Releasing a lifted spine used to withSpring(0) it back down — but that
// spring was gated behind `isMe` in the style, which flips false the instant
// the drag ends, so the animation was invisible and it just snapped to the
// shelf line instantly ("stuck to the shelf" instead of falling). Lift is
// now a per-spine value physically integrated in the frame loop like
// everything else: real gravity pulls a released spine down, it lands with
// its velocity zeroed at the shelf line, and it's visible the whole time
// because nothing gates it on which spine is currently being dragged.
const LIFT_GRAVITY = 1500; // 1.5x faster fall — 1000 felt too slow/floaty on release

// Tilt the phone and the shelf's own "gravity" tips with it — books slide
// toward the low side and pile against the wall, same collision system as a
// drag. Accelerometer x is ~0 held level, ~±1g at a full 90° side-tilt.
// Terminal velocity is gravity/DAMPING now that the home-slot spring is off
// while tilting (see the frame loop). Cut back down from 1800 — combined
// with the higher DAMPING above, 1800 read as "way too crazy and fast" on
// real hardware; 900 gives a calmer, heavier slide once SLIDE_TILT_THRESHOLD
// is crossed instead of a sudden lurch.
const GRAVITY_STRENGTH = 900;
const TILT_UPDATE_MS = 80;
// Below this, treat the phone as "held level" — a real phone is essentially
// never perfectly flat, and without a deadzone that ambient tilt would keep
// the physics loop (and its battery cost) running permanently. Above it, a
// deliberate tilt is unambiguous.
const TILT_DEADZONE = 0.12;
// Real shelves have friction: a book doesn't creep the instant gravity is
// non-zero, it needs enough tilt to overcome static friction first, and even
// while sliding, friction (not just velocity damping) constantly opposes the
// motion. Modeled as a Coulomb-friction force that's subtracted from gravity's
// pull — below this magnitude gravity can't move anything at all. Kept at the
// same μ≈0.35 (paper/cloth-on-wood) ratio to GRAVITY_STRENGTH as before, just
// rescaled down with it: 0.35 * 900 ≈ 315.
const FRICTION = 315;

// Shake-to-mix: a sudden jolt in total acceleration (not just tilt) shuffles
// the whole shelf, same physics as everything else — a randomized order plus
// an outward velocity kick per spine so they visibly tumble before settling,
// rather than silently snapping to a new arrangement.
// Temporarily disabled — flip back to true to re-enable, rest of the
// mechanism is untouched.
const SHAKE_ENABLED = false;
const SHAKE_DELTA = 1.0; // jump in |acceleration| (g) between readings
const SHAKE_DEBOUNCE_MS = 1200;
const SHAKE_KICK = 220;

// Jump/hop: a fast vertical phone movement gives the whole shelf a physically
// real vertical kick — driven directly by the sensed vertical jerk (not a
// canned bounce animation), then a tiny mass-spring-damper settles it back
// down, same principle as the horizontal physics elsewhere in this file.
const BOUNCE_STIFFNESS = 260; // spring pulling the shelf back to rest height
const BOUNCE_DAMPING = 22; // heavier/calmer settle than the original 18
const BOUNCE_STRENGTH = 650; // was 900 — gentler hop, part of the general "heavier" pass
const BOUNCE_MAX = 26; // clamp how far the shelf visually hops, px
// Low-pass filter rate for estimating "steady" vertical accelerometer reading
// (i.e. however the phone is currently being held) so only the SUDDEN
// deviation from that — the jerk — drives the hop, not gravity itself.
const BASELINE_LOWPASS = 0.06;

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
  // x is offset by WALL_WIDTH (the inset sliding range) — subtract it back
  // out so rank 0 lines up with x === WALL_WIDTH, not x === 0.
  const targetRank = Math.min(order.length - 1, Math.max(0, Math.round((x - WALL_WIDTH) / slot)));
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

function hapticGap() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

function hapticSwipe() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
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
  liftYs,
  lastDragLiftY,
  bounceY,
  rotations,
  grabOffsetFrac,
  grabOffsetXPx,
  grabOffsetYPx,
  shelfSwipeGesture,
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
  /** Per-spine height off the shelf line (negative = up). Kinematic (set
   *  directly by the gesture) while this spine is being dragged; a real
   *  gravity-driven fall in the frame loop the rest of the time — see
   *  LIFT_GRAVITY above. */
  liftYs: SharedValue<number[]>;
  /** Vertical counterpart to lastDragX — lets the frame loop finite-difference
   *  a real vertical velocity so a fast release carries its momentum into
   *  the fall instead of starting the drop from a dead stop. */
  lastDragLiftY: SharedValue<number>;
  /** Whole-shelf vertical hop offset from a fast phone movement — applies to
   *  every spine equally, on top of any individual drag-lift. */
  bounceY: SharedValue<number>;
  /** Per-spine rotation (degrees), settled by its own spring-damper in the
   *  frame loop — driven by grabOffsetFrac while this spine is being dragged. */
  rotations: SharedValue<number[]>;
  /** Where on the spine (-1 top .. +1 bottom, relative to its own center)
   *  the currently-dragged spine was grabbed. Only meaningful while dragging. */
  grabOffsetFrac: SharedValue<number>;
  /** Raw pixel offset of the grab point from the spine's own center, on each
   *  axis — used (together) for the diagonal corner-hang while lifted. */
  grabOffsetXPx: SharedValue<number>;
  grabOffsetYPx: SharedValue<number>;
  /** The whole-shelf quick-swipe gesture (see SWIPE_IMPULSE above) — this
   *  spine's own long-press drag is marked simultaneous with it so a fast
   *  swipe across several books still registers even though it starts on
   *  top of a spine's own gesture-handler view. */
  shelfSwipeGesture: GestureType;
  onOpen: (book: BookSummary) => void;
  onReordered: (order: number[]) => void;
}) {
  const startX = useSharedValue(0);
  const slot = spineWidth + SPINE_GAP;

  const persist = (ord: number[]) => onReordered(ord);

  const pan = Gesture.Pan()
    .activateAfterLongPress(300)
    .simultaneousWithExternalGesture(shelfSwipeGesture)
    .onStart((e) => {
      startX.value = xs.value[index];
      lastDragX.value = xs.value[index];
      draggingIndex.value = index;
      liftYs.value[index] = 0;
      lastDragLiftY.value = 0;
      grabOffsetFrac.value = Math.min(
        1,
        Math.max(-1, (e.y - SPINE_VISIBLE_HEIGHT / 2) / (SPINE_VISIBLE_HEIGHT / 2))
      );
      // Raw (unnormalized) pixel offsets from center, on BOTH axes — the
      // spine's real aspect ratio (narrow width, tall height) matters for a
      // believable corner-hang angle, which normalized fractions would lose.
      grabOffsetXPx.value = e.x - spineWidth / 2;
      grabOffsetYPx.value = e.y - SPINE_VISIBLE_HEIGHT / 2;
      runOnJS(hapticStart)();
    })
    .onUpdate((e) => {
      let nx = startX.value + e.translationX;
      nx = Math.min(Math.max(nx, WALL_WIDTH), containerWidth - spineWidth - WALL_WIDTH);
      xs.value[index] = nx;
      order.value = reorderForDrag(order.value, index, nx, slot);
      liftYs.value[index] = Math.min(LIFT_MAX, Math.max(LIFT_MIN, e.translationY));
    })
    .onEnd(() => {
      const wasLifted = Math.abs(liftYs.value[index]) > LIFT_THRESHOLD;
      draggingIndex.value = -1;
      // No withSpring — leave it to the frame loop's real gravity fall (see
      // LIFT_GRAVITY). Its current velocity (finite-differenced there from
      // lastDragLiftY) carries over, so a fast downward release already
      // falls with momentum instead of starting from rest.
      runOnJS(persist)(order.value);
      if (wasLifted) runOnJS(hapticDrop)();
    });

  const style = useAnimatedStyle(() => {
    const isMe = draggingIndex.value === index;
    const liftY = liftYs.value[index] ?? 0;
    const lifted = Math.abs(liftY) > LIFT_THRESHOLD;
    const rotation = rotations.value[index] ?? 0;
    // A rectangle toppling over pivots on whichever bottom corner is still
    // touching the shelf — not its own center. Rotating purely around
    // center (the default) made a falling book visibly lift off/"float"
    // above the shelf line as the angle grew, since the center itself
    // doesn't move but the bottom edge swings up and away from it. Blend
    // the pivot from center (gentle leans look natural rotating in place)
    // toward the bottom corner in the fall direction as rotation approaches
    // a full topple, so the grounded corner stays anchored to the shelf.
    const pivotFrac = Math.min(1, Math.abs(rotation) / FALL_ROTATION_DEG);
    const pivotX = Math.sign(rotation) * (spineWidth / 2) * pivotFrac;
    const pivotY = (SPINE_VISIBLE_HEIGHT / 2) * pivotFrac;
    return {
      transform: [
        { translateX: xs.value[index] ?? index * slot },
        { translateY: liftY + bounceY.value },
        { translateX: pivotX },
        { translateY: pivotY },
        { rotate: `${rotation}deg` },
        { translateX: -pivotX },
        { translateY: -pivotY },
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
              // The wrap is rotated 90deg, so the Text's own WIDTH runs along
              // the spine's height (plenty of room) but its HEIGHT is what
              // ends up constrained to the spine's actual (narrow) width —
              // capping it here is what lets adjustsFontSizeToFit shrink the
              // font to truly fit 2-3 lines instead of just getting clipped
              // by the spine's overflow:hidden.
              style={[styles.spineTitle, { height: spineWidth - 6 }]}
              numberOfLines={3}
              adjustsFontSizeToFit
              minimumFontScale={0.5}
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

/** Renders exactly one shelf's worth of books (already sliced to fit at
 *  SPINE_WIDTH) and owns all the physics for that page. Remounted (via a
 *  `key` on the shelf index) every time the pagination outer component
 *  switches pages — a fresh page is a genuinely different set of books, not
 *  a reorder, so a clean remount is simpler and safer than trying to remap
 *  physics state across an entirely different book set (see the prevIds
 *  remap effect below, which only ever has to handle a REORDER of the SAME
 *  set within one page). */
function ShelfPage({
  books,
  containerWidth,
  onOpen,
  onReorder,
}: {
  /** This page's books, already sliced + sorted left-to-right. */
  books: BookSummary[];
  /** Full shelf width available (spines never shrink to fit; see SPINE_WIDTH). */
  containerWidth: number;
  onOpen: (book: BookSummary) => void;
  /** Called with the new left-to-right book ids (this page only) after a drag settles. */
  onReorder: (bookIds: string[]) => void;
}) {
  const spineWidth = SPINE_WIDTH;

  // books arrives pre-sorted by shelf position, so initial rank == array
  // index — these seed values already match, no snap-into-place on mount.
  const xs = useSharedValue<number[]>(books.map((_, i) => WALL_WIDTH + i * (spineWidth + SPINE_GAP)));
  const vxs = useSharedValue<number[]>(books.map(() => 0));
  const order = useSharedValue<number[]>(books.map((_, i) => i));
  const draggingIndex = useSharedValue(-1);
  const lastDragX = useSharedValue(0);
  // Per-spine lift height — see the LIFT_GRAVITY note above the constants.
  const liftYs = useSharedValue<number[]>(books.map(() => 0));
  const liftVYs = useSharedValue<number[]>(books.map(() => 0));
  const lastDragLiftY = useSharedValue(0);
  const widthShared = useSharedValue(containerWidth);
  const tiltX = useSharedValue(0);
  // Grab-point-dependent tilt while dragging — see the constants above.
  const rotations = useSharedValue<number[]>(books.map(() => 0));
  const rotationVs = useSharedValue<number[]>(books.map(() => 0));
  const grabOffsetFrac = useSharedValue(0);
  // Raw pixel grab-point offsets for the diagonal corner-hang while lifted.
  const grabOffsetXPx = useSharedValue(0);
  const grabOffsetYPx = useSharedValue(0);
  // Tracks which two books were most recently the dragged spine's immediate
  // neighbors (-1 = none), so the frame loop can detect the MOMENT that
  // changes and fire a one-time make-room kick + haptic, instead of
  // reapplying it continuously every frame.
  const gapLeft = useSharedValue(-1);
  const gapRight = useSharedValue(-1);
  // Which spines have already been impulsed during the CURRENT swipe pass —
  // reset at the start of every swipe so each spine only gets hit once per
  // continuous brush across the shelf, not once per frame it's under the
  // finger.
  const swipedIndices = useSharedValue<number[]>([]);

  // xs/vxs/order/rotations/rotationVs are all indexed by POSITION in the
  // `books` array, but the parent re-sorts that array (by shelfPosition)
  // every time a reorder is persisted — so a book's array position can
  // change on the very next render after its own drag ends. Without this,
  // whichever book ends up at a given position inherits the ANIMATED STATE
  // (x, velocity, rotation) that used to belong to whoever was there before,
  // which looks like two books' spines instantly swapping places/tilt the
  // moment a reorder saves. Remap every per-book array from old position to
  // new position whenever the id SEQUENCE changes (but the SET doesn't —
  // a changed set already remounts the whole component via the parent's key).
  const prevIds = useRef<string[]>(books.map((b) => b.id));
  useEffect(() => {
    const newIds = books.map((b) => b.id);
    const oldIds = prevIds.current;
    prevIds.current = newIds;
    if (newIds.length !== oldIds.length) return; // set changed — remount handles it
    let reordered = false;
    for (let i = 0; i < newIds.length; i++) {
      if (newIds[i] !== oldIds[i]) {
        reordered = true;
        break;
      }
    }
    if (!reordered) return;
    const oldIndexOf = new Map(oldIds.map((id, i) => [id, i]));
    const permute = (arr: number[]) =>
      newIds.map((id) => {
        const oldIndex = oldIndexOf.get(id);
        return oldIndex !== undefined ? arr[oldIndex] : 0;
      });
    xs.value = permute(xs.value);
    vxs.value = permute(vxs.value);
    rotations.value = permute(rotations.value);
    rotationVs.value = permute(rotationVs.value);
    liftYs.value = permute(liftYs.value);
    liftVYs.value = permute(liftVYs.value);
    // `order` holds RANKS as old-index values — remap those values (not just
    // their positions) through the same old->new lookup.
    order.value = order.value.map((oldIndex) => {
      const id = oldIds[oldIndex];
      const newIndex = newIds.indexOf(id);
      return newIndex >= 0 ? newIndex : oldIndex;
    });
  }, [books, xs, vxs, order, rotations, rotationVs, liftYs, liftVYs]);
  // Whole-shelf vertical hop from a fast phone movement — see the jerk/bounce
  // note above the constants and the frame loop below.
  const jerkY = useSharedValue(0);
  const bounceY = useSharedValue(0);
  const bounceVY = useSharedValue(0);
  // Shared-value writes must happen in an effect, not during render (Reanimated
  // strict mode warns/misbehaves otherwise).
  useEffect(() => {
    widthShared.value = containerWidth;
  }, [containerWidth, widthShared]);

  const lastMagnitude = useRef(1);
  const lastShakeAt = useRef(0);
  // Low-pass estimate of the "steady" vertical reading for however the phone
  // is currently being held, so only a SUDDEN deviation from it (a jerk)
  // drives the hop — not gravity itself. `null` until the first reading seeds
  // it, so the very first sample doesn't register as a huge fake jerk.
  const baselineY = useRef<number | null>(null);

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
      // Sign flip confirmed on real hardware: raw `x` had tilting the phone
      // right sliding books left — the opposite of intended.
      tiltX.value = -x;

      // Vertical jerk for the hop: isolate the SUDDEN deviation from however
      // the phone is currently being held (the low-pass baseline) rather than
      // reacting to gravity/orientation itself.
      if (baselineY.current === null) {
        baselineY.current = y;
      } else {
        baselineY.current += (y - baselineY.current) * BASELINE_LOWPASS;
      }
      jerkY.value = y - baselineY.current;

      const magnitude = Math.sqrt(x * x + y * y + z * z);
      const delta = Math.abs(magnitude - lastMagnitude.current);
      lastMagnitude.current = magnitude;
      const now = Date.now();
      if (
        SHAKE_ENABLED &&
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

    // Whole-shelf vertical hop — a tiny independent mass-spring-damper driven
    // directly by the sensed jerk, always integrated (it's O(1), unlike the
    // collision pass below) so a jerk registers even while the shelf is
    // otherwise fully at rest.
    const bounceSpring = -bounceY.value * BOUNCE_STIFFNESS;
    const bounceDamping = -bounceVY.value * BOUNCE_DAMPING;
    bounceVY.value += (bounceSpring + bounceDamping + jerkY.value * BOUNCE_STRENGTH) * dt;
    bounceY.value = Math.min(BOUNCE_MAX, Math.max(-BOUNCE_MAX, bounceY.value + bounceVY.value * dt));

    // Cheap early-out once everything's settled and nothing is being dragged —
    // this callback runs for the lifetime of the component (including while
    // the user has navigated elsewhere, since Expo Router keeps the screen
    // mounted), so skip the array-clone/sort/spring work entirely when idle
    // rather than paying it 60x/sec for no visible effect.
    // Sliding is gated behind SLIDE_TILT_THRESHOLD specifically (~20°) — a
    // lesser tilt only leans/topples books in place (see the rotation
    // target below), it never translates them across the shelf. Also
    // temporarily disabled outright via SLIDE_ENABLED (see its declaration).
    const rawGravity =
      SLIDE_ENABLED && Math.abs(tiltX.value) > SLIDE_TILT_THRESHOLD ? tiltX.value * GRAVITY_STRENGTH : 0;
    // Friction: a book won't creep at all unless gravity's pull exceeds it,
    // and even while sliding, friction keeps opposing the motion (Coulomb
    // friction, not just velocity damping) — without this ANY tilt above the
    // deadzone caused slow perpetual drift with no sense of "holding still."
    const gravity =
      rawGravity === 0
        ? 0
        : Math.abs(rawGravity) <= FRICTION
          ? 0
          : rawGravity - Math.sign(rawGravity) * FRICTION;
    // Note: gravity can be 0 here even with a real tilt, if friction is
    // canceling it out (see above) — but a tilt below FRICTION strength
    // should still visibly lean the books, so also bail out of the early
    // skip whenever there's ANY tilt past the deadzone, not just when it's
    // strong enough to actually slide something.
    if (draggingIndex.value === -1 && gravity === 0 && Math.abs(tiltX.value) <= TILT_DEADZONE) {
      let settled = true;
      for (let i = 0; i < len; i++) {
        if (
          Math.abs(vxs.value[i]) > 0.5 ||
          Math.abs(rotations.value[i]) > 0.2 ||
          Math.abs(rotationVs.value[i]) > 0.5 ||
          Math.abs(liftYs.value[i]) > 0.5 ||
          Math.abs(liftVYs.value[i]) > 0.5
        ) {
          settled = false;
          break;
        }
      }
      if (settled) return;
    }
    const nextXs = xs.value.slice();
    const nextVxs = vxs.value.slice();
    const nextRotations = rotations.value.slice();
    const nextRotationVs = rotationVs.value.slice();
    const nextLiftYs = liftYs.value.slice();
    const nextLiftVYs = liftVYs.value.slice();
    const maxX = Math.max(WALL_WIDTH, widthShared.value - spineWidth - WALL_WIDTH);

    // Velocity of whichever spine is being dragged, finite-differenced against
    // its position at the end of the LAST physics tick (lastDragX) — not the
    // per-tick array copy, which would always diff against itself and read ~0.
    const draggedVel =
      draggingIndex.value >= 0 && dt > 0
        ? (xs.value[draggingIndex.value] - lastDragX.value) / dt
        : 0;
    if (draggingIndex.value >= 0) lastDragX.value = xs.value[draggingIndex.value];
    // Same finite-differencing for the vertical lift, so a fast release
    // carries its momentum into the fall instead of starting from rest.
    const draggedLiftVel =
      draggingIndex.value >= 0 && dt > 0
        ? (liftYs.value[draggingIndex.value] - lastDragLiftY.value) / dt
        : 0;
    if (draggingIndex.value >= 0) lastDragLiftY.value = liftYs.value[draggingIndex.value];
    // Lifted "into the air" — floats free of horizontal collision until it's
    // lowered back toward the shelf line, where it lands with a real bump.
    const draggedLifted = draggingIndex.value >= 0 && Math.abs(liftYs.value[draggingIndex.value]) > LIFT_THRESHOLD;

    // Make-room preview: the moment the dragged spine's live-reordered target
    // rank puts it into a NEW gap, kick that gap's two neighbors apart (plus
    // a small wiggle) and buzz once — a one-time reaction to the CHANGE, not
    // a continuous force, so it doesn't linger into a restoring spring.
    if (draggingIndex.value >= 0) {
      const rank = order.value.indexOf(draggingIndex.value);
      const newLeft = rank > 0 ? order.value[rank - 1] : -1;
      const newRight = rank < order.value.length - 1 ? order.value[rank + 1] : -1;
      if (newLeft !== gapLeft.value || newRight !== gapRight.value) {
        gapLeft.value = newLeft;
        gapRight.value = newRight;
        if (newLeft >= 0) {
          nextVxs[newLeft] -= GAP_NUDGE_KICK;
          nextRotationVs[newLeft] -= GAP_WIGGLE_KICK;
        }
        if (newRight >= 0) {
          nextVxs[newRight] += GAP_NUDGE_KICK;
          nextRotationVs[newRight] += GAP_WIGGLE_KICK;
        }
        runOnJS(hapticGap)();
      }
    } else if (gapLeft.value !== -1 || gapRight.value !== -1) {
      gapLeft.value = -1;
      gapRight.value = -1;
    }

    for (let i = 0; i < len; i++) {
      // Rotation always integrates, dragged spine or not — torque only while
      // it's the one being dragged. When not dragged, the spring's TARGET
      // isn't always level: it tracks the phone's tilt (ambient lean), and
      // if this spine is pinned against a wall with nowhere left to slide
      // and the tilt gets steep enough, the target becomes a full topple —
      // same spring, just aimed somewhere other than 0. This is also what
      // makes a released spine settle back down rather than snap to level.
      const isDragged = i === draggingIndex.value;
      const isLifted = Math.abs(liftYs.value[i]) > LIFT_THRESHOLD;
      let restTarget = 0;
      if (isDragged && isLifted) {
        // Diagonal corner-hang: rotate toward wherever the grab point implies
        // the center of mass should hang below it, plus however much the
        // phone's own tilt has shifted "down" sideways on screen.
        // Raw atan2 gives the FULL "ideal pendulum" angle, which swings
        // toward ±90° for almost any grab near the vertical center (the
        // denominator shrinks toward 0) — felt wild/uncontrolled on real
        // hardware. A held book has enough rigidity/grip friction that it
        // only leans PART of the way there, not a free-swinging pendulum —
        // CORNER_HANG_STRENGTH scales it down to a believable slight lean.
        const cornerHangDeg = Math.atan2(grabOffsetXPx.value, grabOffsetYPx.value) * (180 / Math.PI);
        const tiltLean = Math.abs(tiltX.value) > TILT_DEADZONE ? tiltX.value * TILT_LEAN_DEG_PER_UNIT : 0;
        restTarget = Math.min(
          FALL_ROTATION_DEG,
          Math.max(-FALL_ROTATION_DEG, cornerHangDeg * CORNER_HANG_STRENGTH + tiltLean)
        );
      } else if (!isDragged && Math.abs(tiltX.value) > TILT_DEADZONE) {
        // A wall is rigid — a book resting against the wall it would be
        // leaning INTO can't tilt that way at all, gentle lean or full
        // topple alike (the far wall, if any, is irrelevant). Checked
        // first and unconditionally, not just when FALL_ENABLED.
        const atLeftWall = nextXs[i] <= WALL_WIDTH + 0.5;
        const atRightWall = nextXs[i] >= maxX - 0.5;
        const bracedByWall = (tiltX.value < 0 && atLeftWall) || (tiltX.value > 0 && atRightWall);
        if (bracedByWall) {
          restTarget = 0;
        } else if (FALL_ENABLED) {
          restTarget = tiltX.value * TILT_LEAN_DEG_PER_UNIT;
          // Past the fall threshold a book topples fully onto its side.
          if (Math.abs(tiltX.value) > FALL_TILT_THRESHOLD) {
            restTarget = Math.sign(tiltX.value) * FALL_ROTATION_DEG;
          }
        } else {
          // FALL_ENABLED off: just the gentle lean, hard-capped at
          // MAX_LEAN_DEG — no progression toward a full topple at all.
          restTarget = Math.sign(tiltX.value) * Math.min(MAX_LEAN_DEG, Math.abs(tiltX.value) * TILT_LEAN_DEG_PER_UNIT);
        }
      }
      const torque = isDragged ? grabOffsetFrac.value * draggedVel * ROTATION_TORQUE : 0;
      const rotSpring = -(nextRotations[i] - restTarget) * ROTATION_STIFFNESS;
      const rotDamping = -nextRotationVs[i] * ROTATION_DAMPING;
      nextRotationVs[i] += (rotSpring + rotDamping + torque) * dt;
      // Dragging while still flat on the shelf keeps the tighter clamp (a
      // shove shouldn't spin a book past a believable hand-tilt); lifted (or
      // ambient lean/fall) gets the wider one so a hang/topple can actually
      // reach a believable angle.
      const clampMax = isDragged && !isLifted ? ROTATION_MAX : FALL_ROTATION_DEG;
      nextRotations[i] = Math.min(clampMax, Math.max(-clampMax, nextRotations[i] + nextRotationVs[i] * dt));

      // Lift height: kinematic (already set by the gesture) while dragged —
      // just track its velocity so a release carries momentum. Otherwise
      // real gravity pulls it down until it lands flush at the shelf line.
      if (isDragged) {
        nextLiftVYs[i] = draggedLiftVel;
      } else {
        const liftDamping = -nextLiftVYs[i] * DAMPING;
        nextLiftVYs[i] += (liftDamping + LIFT_GRAVITY) * dt;
        nextLiftYs[i] += nextLiftVYs[i] * dt;
        if (nextLiftYs[i] > 0) {
          nextLiftYs[i] = 0;
          nextLiftVYs[i] = 0;
        } else if (nextLiftYs[i] < LIFT_MIN) {
          nextLiftYs[i] = LIFT_MIN;
          if (nextLiftVYs[i] < 0) nextLiftVYs[i] = 0;
        }
      }

      if (isDragged) {
        // Kinematic: position already set by the gesture.
        nextVxs[i] = draggedVel;
        continue;
      }
      // No restoring "home slot" force — books never get pulled toward each
      // other or snapped into a tidy packed row on their own. The only things
      // that ever move a book are a direct drag, tilt-gravity, a shake, and
      // the collision pass below keeping neighbors from overlapping; once
      // those stop acting on it, it just stays wherever it physically is.
      const dampingForce = -nextVxs[i] * DAMPING;
      nextVxs[i] += (dampingForce + gravity) * dt;
      nextXs[i] += nextVxs[i] * dt;
    }

    // A leaning/toppling book's effective footprint isn't just its upright
    // spineWidth — as it rotates (around its grounded corner, see the style)
    // its top edge sweeps sideways in the fall direction, like a falling
    // rod, reaching into a neighbor's space even though its base x-position
    // hasn't moved. Approximate the extra reach on whichever side it's
    // currently leaning/falling toward as height*sin(angle) — but scaled by
    // the SAME pivotFrac the render style uses (how far into a full topple
    // the current rotation already is), not the raw sin() alone. Height is
    // much bigger than width for these thin spines, so an un-scaled sin()
    // made even a gentle ~7° ambient lean add ~15px of reach — since every
    // spine leans the same direction under one tilt, that pushed the WHOLE
    // shelf apart just from leaning, with no real topple involved. Scaling
    // by pivotFrac makes a small lean's reach negligible while still giving
    // a real topple (pivotFrac -> 1) the full sweep for genuine collisions.
    const rightReach: number[] = [];
    const leftReach: number[] = [];
    for (let i = 0; i < len; i++) {
      const pivotFrac = Math.min(1, Math.abs(nextRotations[i]) / FALL_ROTATION_DEG);
      const rad = (Math.abs(nextRotations[i]) * Math.PI) / 180;
      const sweep = Math.sin(rad) * SPINE_VISIBLE_HEIGHT * pivotFrac;
      rightReach.push(spineWidth / 2 + (nextRotations[i] > 0 ? sweep : 0));
      leftReach.push(spineWidth / 2 + (nextRotations[i] < 0 ? sweep : 0));
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
        // Same shape as the old `nextXs[i] + spineWidth - nextXs[j]` when
        // neither is rotated (rightReach/leftReach both reduce to
        // spineWidth/2) — but grows when either is leaning/toppling toward
        // the other.
        const overlap = nextXs[i] - nextXs[j] + rightReach[i] + leftReach[j];
        if (overlap <= 0) continue;
        const iDragged = i === draggingIndex.value;
        const jDragged = j === draggingIndex.value;
        if ((iDragged || jDragged) && draggedLifted) continue;
        if (iDragged && !jDragged) {
          nextXs[j] += overlap;
          nextVxs[j] += overlap * BUMP + Math.max(0, draggedVel) * 0.5;
          // Extra rotational jolt for the DRAGGED spine itself at the moment
          // of impact — on top of the continuous shove torque — using the
          // same grab-point lever-arm idea, scaled by how deep it hit.
          nextRotationVs[i] += grabOffsetFrac.value * overlap * COLLISION_ROTATION_KICK;
        } else if (jDragged && !iDragged) {
          nextXs[i] -= overlap;
          nextVxs[i] -= overlap * BUMP + Math.max(0, -draggedVel) * 0.5;
          nextRotationVs[j] -= grabOffsetFrac.value * overlap * COLLISION_ROTATION_KICK;
        } else if (!iDragged && !jDragged) {
          nextXs[i] -= overlap / 2;
          nextXs[j] += overlap / 2;
          nextVxs[i] -= (overlap * BUMP) / 2;
          nextVxs[j] += (overlap * BUMP) / 2;
        }
      }
    }

    for (let i = 0; i < len; i++) {
      if (nextXs[i] < WALL_WIDTH) {
        nextXs[i] = WALL_WIDTH;
        if (nextVxs[i] < 0) nextVxs[i] = 0;
      } else if (nextXs[i] > maxX) {
        nextXs[i] = maxX;
        if (nextVxs[i] > 0) nextVxs[i] = 0;
      }
    }

    xs.value = nextXs;
    vxs.value = nextVxs;
    rotations.value = nextRotations;
    rotationVs.value = nextRotationVs;
    liftYs.value = nextLiftYs;
    liftVYs.value = nextLiftVYs;
  });

  function handleReordered(ord: number[]) {
    onReorder(ord.map((bookIndex) => books[bookIndex].id));
  }

  // Quick swipe across the shelf — see SWIPE_IMPULSE above. No long-press
  // requirement (unlike each spine's own drag gesture), and marked
  // simultaneous with every spine's pan (via .simultaneousWithExternalGesture
  // on the Spine side) so a fast brush still registers even though it
  // begins on top of a spine's own gesture-handler view.
  const shelfSwipeGesture = Gesture.Pan()
    .onStart(() => {
      swipedIndices.value = [];
    })
    .onUpdate((e) => {
      if (draggingIndex.value !== -1) return; // a real drag is in progress — don't also impulse
      const dir = e.velocityX >= 0 ? 1 : -1;
      const len = xs.value.length;
      for (let i = 0; i < len; i++) {
        if (swipedIndices.value.includes(i)) continue;
        const left = xs.value[i];
        const right = left + spineWidth;
        if (e.x < left || e.x > right) continue;
        vxs.value[i] += dir * SWIPE_IMPULSE;
        rotationVs.value[i] += dir * SWIPE_WIGGLE;
        swipedIndices.value = [...swipedIndices.value, i];
        runOnJS(hapticSwipe)();
      }
    });

  if (books.length === 0) return null;

  return (
    <GestureDetector gesture={shelfSwipeGesture}>
      <View style={[styles.shelfArea, { height: SHELF_HEIGHT }]}>
        {/* Solid bookend walls at the shelf's own physical boundary — the
            same edges the physics already pins spines against, just made
            visible instead of an invisible wall. Rendered behind the
            spines (default z-index), so a pinned book naturally covers it. */}
        <View style={[styles.shelfWall, styles.shelfWallLeft]} />
        <View style={[styles.shelfWall, styles.shelfWallRight]} />
        {books.map((book, index) => (
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
            liftYs={liftYs}
            lastDragLiftY={lastDragLiftY}
            bounceY={bounceY}
            rotations={rotations}
            grabOffsetFrac={grabOffsetFrac}
            grabOffsetXPx={grabOffsetXPx}
            grabOffsetYPx={grabOffsetYPx}
            shelfSwipeGesture={shelfSwipeGesture}
            onOpen={onOpen}
            onReordered={handleReordered}
          />
        ))}
      </View>
    </GestureDetector>
  );
}

/** Page-switch selector — shown only when there are more shelves than one
 *  (see the pagination note above Bookshelf). Numbered rather than dots since
 *  "shelf 2 of 3" reads clearer than an ambiguous row of dots here. */
function ShelfSwitcher({
  count,
  current,
  onSelect,
}: {
  count: number;
  current: number;
  onSelect: (index: number) => void;
}) {
  const indices: number[] = [];
  for (let i = 0; i < count; i++) indices.push(i);
  return (
    <View style={styles.shelfSwitcher}>
      {indices.map((i) => (
        <Pressable
          key={i}
          onPress={() => onSelect(i)}
          hitSlop={4}
          style={[styles.shelfDot, i === current && styles.shelfDotActive]}
        >
          <Text style={[styles.shelfDotText, i === current && styles.shelfDotTextActive]}>{i + 1}</Text>
        </Pressable>
      ))}
    </View>
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

  // Spines are a fixed width (see SPINE_WIDTH) — once more books are
  // favorited than fit one shelf at that width, the rest spill onto
  // additional numbered shelves instead of shrinking or scrolling.
  const booksPerShelf =
    containerWidth > 0
      ? Math.max(1, Math.floor((containerWidth - 2 * WALL_WIDTH + SPINE_GAP) / (SPINE_WIDTH + SPINE_GAP)))
      : 1;
  const shelfCount = Math.max(1, Math.ceil(books.length / booksPerShelf));
  const [currentShelf, setCurrentShelf] = useState(0);
  useEffect(() => {
    if (currentShelf > shelfCount - 1) setCurrentShelf(Math.max(0, shelfCount - 1));
  }, [shelfCount, currentShelf]);

  const pageStart = currentShelf * booksPerShelf;
  const pageBooks = books.slice(pageStart, pageStart + booksPerShelf);

  /** A drag only reorders within the CURRENT page — splice its new order
   *  back into the full shelf-wide id list at the same slice position. */
  function handlePageReorder(pageBookIds: string[]) {
    const allIds = books.map((b) => b.id);
    allIds.splice(pageStart, pageBookIds.length, ...pageBookIds);
    onReorder(allIds);
  }

  function onLayout(e: LayoutChangeEvent) {
    setContainerWidth(e.nativeEvent.layout.width);
  }

  if (books.length === 0) return null;

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <Text style={styles.label}>Bookshelf</Text>
      {containerWidth > 0 && (
        <ShelfPage
          key={currentShelf}
          books={pageBooks}
          containerWidth={containerWidth}
          onOpen={onOpen}
          onReorder={handlePageReorder}
        />
      )}
      <View style={styles.shelfLip} />
      {shelfCount > 1 && (
        <ShelfSwitcher count={shelfCount} current={currentShelf} onSelect={setCurrentShelf} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 18 },
  label: { fontSize: 13, fontWeight: '700', marginBottom: 6, marginLeft: 2, opacity: 0.6 },
  shelfArea: { position: 'relative' },
  shelfSwitcher: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 8 },
  shelfDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  shelfDotActive: { backgroundColor: '#8a5a34' },
  shelfDotText: { fontSize: 12, fontWeight: '700', opacity: 0.6 },
  shelfDotTextActive: { color: '#fff', opacity: 1 },
  shelfWall: {
    position: 'absolute',
    top: 0,
    bottom: 8, // matches `spine`'s own bottom inset — sits on the same shelf line
    width: 6,
    backgroundColor: '#6b4423',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 2,
  },
  shelfWallLeft: { left: 0, borderTopLeftRadius: 3, borderBottomLeftRadius: 3 },
  shelfWallRight: { right: 0, borderTopRightRadius: 3, borderBottomRightRadius: 3 },
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
    // The fixed `height` given inline (so adjustsFontSizeToFit has a real box
    // to shrink into) means Android would otherwise top-align short text
    // instead of centering it in that box — this is what actually centers a
    // title that fits on one line.
    textAlignVertical: 'center',
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
