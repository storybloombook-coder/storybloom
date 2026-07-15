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
// a gap, matching a real "push books along a shelf" gesture.
//
// Interaction: LONG-PRESS a spine to pick it up and drag; a quick tap opens
// the book (same activateAfterLongPress + nested Pressable pattern already
// used for page cards — see DraggablePageCard.tsx / book/[id].tsx). Dragging
// it vertically lifts it "into the air" — past LIFT_THRESHOLD it stops
// colliding with neighbors so it can hover freely over a gap, then lowering
// it back squeezes it in with a real collision bump at wherever it lands.
// Grabbing it off-center from its own midpoint (like picking up a real book
// near one end) makes it rotate/tilt as it's shoved, via its own small
// rotational spring-damper — see ROTATION_* below.
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
// Actual rendered height of a spine (see the `spine` style — top:0, bottom:8
// inside a SHELF_HEIGHT-tall shelf). Used to normalize where on the spine a
// drag gesture started, for the grab-point-dependent rotation below.
const SPINE_VISIBLE_HEIGHT = SHELF_HEIGHT - 8;

// Grab-point-dependent tilt: picking a spine up off-center from its own
// midpoint (like a real book grabbed near one end) makes it rotate as it's
// shoved around, pivoting harder the farther from center you grabbed it —
// a lightweight rotational spring-damper, same shape as the horizontal
// physics, with the drag supplying "torque" instead of a driving force.
const ROTATION_MAX = 22; // degrees, clamp WHILE BEING DRAGGED
const ROTATION_STIFFNESS = 140; // pulls rotation back toward its current target
const ROTATION_DAMPING = 12;
// Scales (how far off-center you grabbed) * (how fast it's being shoved)
// into a torque. Sign is a first pass, not yet confirmed on hardware — if a
// book tips the wrong way for where it was grabbed, flip this to negative.
const ROTATION_TORQUE = 0.16;

// Ambient tilt lean: even without touching a book, every spine visibly
// tilts a little as the phone tilts — the same rotation spring-damper above,
// just aimed at a target that tracks tiltX instead of always being level, so
// you can SEE gravity's direction on the shelf even before anything slides.
const TILT_LEAN_DEG_PER_UNIT = 16; // degrees of lean per unit of tiltX
// Past this tilt, a spine that's already pinned against a wall (nowhere left
// to slide) stops merely leaning and topples fully onto its side instead —
// same spring, just retargeted to a much steeper angle.
const FALL_TILT_THRESHOLD = 0.5;
const FALL_ROTATION_DEG = 78; // not quite 90 — reads as "fallen", not glued flat

// Physics tuning — soft enough to feel weighty, damped enough not to jitter.
// No home-slot spring — books never get pulled toward a tidy packed
// position or toward each other; they only move via drag, tilt-gravity, a
// shake, or a collision, and just stay wherever that leaves them (falling
// horizontally and stacking unevenly is the intended, physical look).
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
// Terminal velocity is gravity/DAMPING now that the home-slot spring is off
// while tilting (see the frame loop) — at the old 260 that worked out to
// under ~20px/s even at a firm tilt, reading as "barely moving." Raised ~7x
// so a moderate tilt visibly slides a spine within roughly a second.
const GRAVITY_STRENGTH = 1800;
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
// pull — below this magnitude gravity can't move anything at all.
const FRICTION = 350;

// Shake-to-mix: a sudden jolt in total acceleration (not just tilt) shuffles
// the whole shelf, same physics as everything else — a randomized order plus
// an outward velocity kick per spine so they visibly tumble before settling,
// rather than silently snapping to a new arrangement.
const SHAKE_DELTA = 1.0; // jump in |acceleration| (g) between readings
const SHAKE_DEBOUNCE_MS = 1200;
const SHAKE_KICK = 220;

// Jump/hop: a fast vertical phone movement gives the whole shelf a physically
// real vertical kick — driven directly by the sensed vertical jerk (not a
// canned bounce animation), then a tiny mass-spring-damper settles it back
// down, same principle as the horizontal physics elsewhere in this file.
const BOUNCE_STIFFNESS = 260; // spring pulling the shelf back to rest height
const BOUNCE_DAMPING = 18;
const BOUNCE_STRENGTH = 900; // scales sensed vertical jerk into a hop force
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
  bounceY,
  rotations,
  grabOffsetFrac,
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
  /** Whole-shelf vertical hop offset from a fast phone movement — applies to
   *  every spine equally, on top of any individual drag-lift. */
  bounceY: SharedValue<number>;
  /** Per-spine rotation (degrees), settled by its own spring-damper in the
   *  frame loop — driven by grabOffsetFrac while this spine is being dragged. */
  rotations: SharedValue<number[]>;
  /** Where on the spine (-1 top .. +1 bottom, relative to its own center)
   *  the currently-dragged spine was grabbed. Only meaningful while dragging. */
  grabOffsetFrac: SharedValue<number>;
  onOpen: (book: BookSummary) => void;
  onReordered: (order: number[]) => void;
}) {
  const startX = useSharedValue(0);
  const slot = spineWidth + SPINE_GAP;

  const persist = (ord: number[]) => onReordered(ord);

  const pan = Gesture.Pan()
    .activateAfterLongPress(300)
    .onStart((e) => {
      startX.value = xs.value[index];
      lastDragX.value = xs.value[index];
      draggingIndex.value = index;
      dragLiftY.value = 0;
      grabOffsetFrac.value = Math.min(
        1,
        Math.max(-1, (e.y - SPINE_VISIBLE_HEIGHT / 2) / (SPINE_VISIBLE_HEIGHT / 2))
      );
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
        { translateY: (isMe ? dragLiftY.value : 0) + bounceY.value },
        { rotate: `${rotations.value[index] ?? 0}deg` },
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
  const tiltX = useSharedValue(0);
  // Grab-point-dependent tilt while dragging — see the constants above.
  const rotations = useSharedValue<number[]>(books.map(() => 0));
  const rotationVs = useSharedValue<number[]>(books.map(() => 0));
  const grabOffsetFrac = useSharedValue(0);

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
    // `order` holds RANKS as old-index values — remap those values (not just
    // their positions) through the same old->new lookup.
    order.value = order.value.map((oldIndex) => {
      const id = oldIds[oldIndex];
      const newIndex = newIds.indexOf(id);
      return newIndex >= 0 ? newIndex : oldIndex;
    });
  }, [books, xs, vxs, order, rotations, rotationVs]);
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
    const rawGravity = Math.abs(tiltX.value) > TILT_DEADZONE ? tiltX.value * GRAVITY_STRENGTH : 0;
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
          Math.abs(rotationVs.value[i]) > 0.5
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
      // Rotation always integrates, dragged spine or not — torque only while
      // it's the one being dragged. When not dragged, the spring's TARGET
      // isn't always level: it tracks the phone's tilt (ambient lean), and
      // if this spine is pinned against a wall with nowhere left to slide
      // and the tilt gets steep enough, the target becomes a full topple —
      // same spring, just aimed somewhere other than 0. This is also what
      // makes a released spine settle back down rather than snap to level.
      const isDragged = i === draggingIndex.value;
      let restTarget = 0;
      if (!isDragged && Math.abs(tiltX.value) > TILT_DEADZONE) {
        restTarget = tiltX.value * TILT_LEAN_DEG_PER_UNIT;
        const atLeftWall = nextXs[i] <= 0.5;
        const atRightWall = nextXs[i] >= maxX - 0.5;
        const pinned = (tiltX.value < 0 && atLeftWall) || (tiltX.value > 0 && atRightWall);
        if (pinned && Math.abs(tiltX.value) > FALL_TILT_THRESHOLD) {
          restTarget = Math.sign(tiltX.value) * FALL_ROTATION_DEG;
        }
      }
      const torque = isDragged ? grabOffsetFrac.value * draggedVel * ROTATION_TORQUE : 0;
      const rotSpring = -(nextRotations[i] - restTarget) * ROTATION_STIFFNESS;
      const rotDamping = -nextRotationVs[i] * ROTATION_DAMPING;
      nextRotationVs[i] += (rotSpring + rotDamping + torque) * dt;
      // Dragging keeps the tighter clamp (a shove shouldn't spin a book past
      // a believable hand-tilt); ambient lean/fall gets the wider one so a
      // pinned spine can actually topple onto its side.
      const clampMax = isDragged ? ROTATION_MAX : FALL_ROTATION_DEG;
      nextRotations[i] = Math.min(clampMax, Math.max(-clampMax, nextRotations[i] + nextRotationVs[i] * dt));

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
    rotations.value = nextRotations;
    rotationVs.value = nextRotationVs;
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
              bounceY={bounceY}
              rotations={rotations}
              grabOffsetFrac={grabOffsetFrac}
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
