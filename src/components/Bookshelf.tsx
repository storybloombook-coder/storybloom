// Bookshelf.tsx — a physical shelf of favorited books, spines facing out.
//
// Every book is a real rigid body — an oriented rectangle with position,
// angle and momentum — simulated by src/lib/shelfPhysics.ts. This file owns
// the shelf's INPUTS (drag, tilt, swipe, shake) and its rendering; it owns no
// physics of its own.
//
// That split matters, because the behaviour people expect from a shelf falls
// out of it rather than being scripted. A book leans because contacts hold it
// at an angle. It topples because gravity took its centre of mass past its
// own edge — no threshold, no timer, no "fallen" flag. It stays down
// afterwards because gravity doesn't run backwards. A book on its side
// occupies its full length, so the row has to make room for it, and books
// can come to rest on top of each other. The previous model — a 1D particle
// with a rotation spring aimed at a tilt-derived target — could express none
// of those, which is why each was reported as a bug in turn.
//
// Shelf ORDER is likewise an outcome, not a list: it's read back off where
// the books physically ended up (orderByPosition) whenever a drag settles.
//
// Interaction: LONG-PRESS a spine to pick it up, a quick tap opens the book
// (same activateAfterLongPress + nested Pressable pattern as page cards, see
// DraggablePageCard.tsx). While held, a book becomes kinematic — nothing can
// push it, it pushes everything — so shoving one through the row genuinely
// shoves the row. Release hands it back to the simulation carrying the
// throw's velocity. Tilt the phone and gravity tips with it. Brush a finger
// across the shelf and each book it passes gets one impulse. Shake hard and
// the shelf re-shelves itself. A fast vertical movement hops the whole shelf
// (BOUNCE_*) — that one is a view offset, deliberately not part of the
// simulation, since it moves the shelf rather than the books on it.
// NEEDS A DEV-CLIENT BUILD WITH expo-sensors LINKED — a static `import` of it
// crashes the WHOLE APP at launch on a build that doesn't have it (the
// package touches a native module eagerly at import time), so it's required
// defensively below and every sensor-driven feature stays inert without one.

import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useColorScheme, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  runOnUI,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import type { BookSummary } from '../lib/db';
import { t, useLocaleStore } from '../lib/i18n';
import {
  driveHeld,
  horizontalExtent,
  isAsleep,
  makeBody,
  makeKinematic,
  orderByPosition,
  restoreDynamics,
  step,
  wake,
  // Explicitly imported (rather than relying on inference) because `Body` is
  // also a DOM global in the ambient types — without this the shelf's own
  // bodies silently become the wrong type.
  type Body,
  type World,
} from '../lib/shelfPhysics';

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
// Layout width of a book's contact shadow. It's never this wide on screen —
// the shadow is scaled to the book's real horizontal extent every frame (see
// contactStyle) — this is just a fixed box for scaleX to work against, since
// animating `width` would mean a layout pass per frame.
const CONTACT_SHADOW_WIDTH = 2 * SPINE_WIDTH;

// Everything that used to live here — the rotation spring-damper, the
// corner-hang strength, the topple/slide angle thresholds, the lean cap, the
// collision bump — described a model where a book was a 1D particle with a
// rotation SPRING bolted on. None of it survived the move to real rigid
// bodies: a book now leans because contacts hold it at an angle and topples
// because gravity took its centre of mass past its own edge, so there is
// nothing left to tune here. The knobs that remain live in shelfPhysics.ts
// (restitution, friction, solver iterations, sleep thresholds).
// Gesture updates arrive at screen rate but carry no timestamp; one frame
// at 60Hz is the honest assumption for integrating the held swing.
// A newly favourited book appears this many of its own heights up and
// drops in, so adding one reads as placing it on the shelf rather than it
// blinking into existence.
const SPAWN_DROP_HEIGHT = 3; // half-heights, i.e. 1.5x the full height
const DRAG_DT = 1 / 60;
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

// (The old "make room" kick is gone: neighbours are now pushed out of the
// way by the dragged book actually colliding with them, so a preview of
// where it will land isn't something that has to be faked.)

// Lift-out-of-the-shelf tuning. Past LIFT_THRESHOLD the dragged spine is
// "in the air" — it stops colliding with neighbors (so it can hover freely
// over a gap) while still live-reordering, then squeezes back in with a real
// collision bump the moment it's lowered back below the threshold.
const LIFT_THRESHOLD = 20;
// (No LIFT_MIN/MAX/GRAVITY any more: how high a book can be held is just how
// far your finger goes, and a released one falls under the simulation's own
// gravity like anything else. Note the shelf sits inside library.tsx's
// FlatList, which clips its content at its own top edge — lift far enough
// and a book still disappears behind that boundary. A reserved-headroom
// spacer was tried once and reverted: a zone visibly growing and shrinking
// looked worse than the clipping.)

// Tilt the phone and the shelf's own "gravity" tips with it — books slide
// toward the low side and pile against the wall, same collision system as a
// drag. Accelerometer x is ~0 held level, ~±1g at a full 90° side-tilt.
// Terminal velocity is gravity/DAMPING now that the home-slot spring is off
// while tilting (see the frame loop). Cut back down from 1800 — combined
// with the higher DAMPING above, 1800 read as "way too crazy and fast" on
// real hardware; 900 gives a calmer, heavier slide once SLIDE_TILT_THRESHOLD
// is crossed instead of a sudden lurch.
const GRAVITY_STRENGTH = 900;
// How much sensed tilt becomes sideways gravity. Below 1 because a phone at
// a natural reading angle should lean the row, not empty it.
const TILT_GRAVITY_SCALE = 0.85;
const TILT_UPDATE_MS = 80;
// Below this, treat the phone as "held level" — a real phone is essentially
// never perfectly flat, and without a deadzone that ambient tilt would keep
// the physics loop (and its battery cost) running permanently. Above it, a
// deliberate tilt is unambiguous.
const TILT_DEADZONE = 0.12;
// (Friction moved into shelfPhysics.ts, where it belongs: it's now a real
// Coulomb cone on each contact rather than a force subtracted from gravity,
// which is also what lets a leaning book stay leaning.)

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
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

// Bookbinding materials, not a colour wheel. The old scheme was one hue per
// book at a fixed `42% 34%`, which gave every spine the same weight and read
// as a swatch chart. Real shelves are mostly deep, desaturated cloth and
// leather with the occasional cream linen and one loud outlier, so that's
// what these are — and the variety comes from having genuinely different
// LIGHTNESSES sitting next to each other, not from hue alone.
const SPINE_MATERIALS: { h: number; s: number; l: number }[] = [
  { h: 6, s: 36, l: 29 }, // oxblood
  { h: 24, s: 30, l: 33 }, // tan leather
  { h: 42, s: 28, l: 64 }, // cream linen
  { h: 96, s: 17, l: 27 }, // olive cloth
  { h: 168, s: 25, l: 26 }, // teal cloth
  { h: 210, s: 30, l: 30 }, // navy buckram
  { h: 266, s: 16, l: 32 }, // aubergine
  { h: 350, s: 14, l: 23 }, // near-black plum
  { h: 34, s: 52, l: 47 }, // ochre — the loud one
  { h: 152, s: 14, l: 40 }, // sage paper
];

type SpineLook = {
  base: string;
  /** Stamped detail — foil on a dark spine, ink on a pale one. */
  foil: string;
  /** The base colour's own HSL parts, so anything that needs to shade a piece
   *  of this spine can do it in the same material (see shadeSpine). */
  h: number;
  s: number;
  l: number;
};

/** Everything about how one book's spine is bound, derived from its id so a
 *  book looks the same on every visit (a shelf that reshuffles its own
 *  appearance reads as broken, not organic). */
function spineLook(id: string): SpineLook {
  const h = hashId(`look:${id}`);
  const m = SPINE_MATERIALS[h % SPINE_MATERIALS.length];
  // Jitter within the material so two books bound in the same cloth are still
  // distinguishable side by side, without leaving the material's character.
  const light = m.l + ((h >>> 5) % 9) - 4;
  const sat = Math.max(8, m.s + ((h >>> 11) % 7) - 3);
  // Pale materials (cream linen, ochre) need dark ink; everything else takes
  // light foil.
  const pale = light > 50;
  return {
    base: `hsl(${m.h}, ${sat}%, ${light}%)`,
    foil: pale ? `hsl(${m.h}, ${Math.min(40, sat + 8)}%, 26%)` : `hsl(42, 38%, 78%)`,
    h: m.h,
    s: sat,
    l: light,
  };
}

/** The colour of one fragment of a spine. The spine's 3D read comes from
 *  overlays that only exist while it's whole (see SpineBinding); once it's in
 *  pieces each piece has to carry its own share of that shading, or the book
 *  visibly goes flat in the moment before it comes apart. So the edges stay
 *  dark, the crown stays bright, the head stays lit — baked into the
 *  fragment's own colour, plus a little grain so the debris isn't uniform. */
function shadeSpine(look: SpineLook, col: number, row: number): string {
  let l = look.l;
  if (col === 0) l -= 7;
  if (col === CRUMBLE_COLS - 1) l -= 9;
  if (col === 1) l += 4;
  if (row === 0) l += 5;
  l += (hashId(`grain:${col}:${row}`) % 5) - 2;
  return `hsl(${look.h}, ${look.s}%, ${Math.min(94, Math.max(4, l))}%)`;
}

/** Per-book height, 84-100% of the shelf's usable height. Derived from the
 *  id so a book is the same height on every visit -- a shelf that reshuffles
 *  its own proportions each time you open it reads as broken, not organic.
 *  Only the HEIGHT varies: spine width is load-bearing for the slot maths,
 *  collision reach and shelf capacity, so varying that is a separate job. */
/** Per-book spine thickness. Only possible now that collision is real: the
 *  old model keyed slot maths, collision reach and shelf capacity off one
 *  shared SPINE_WIDTH, so varying it would have broken all three. Bodies
 *  carry their own half-extents, so a thin book is simply a thin box. */
function spineWidthFromId(id: string): number {
  const h = hashId(`w:${id}`);
  return Math.round(SPINE_WIDTH * (0.68 + ((h % 1000) / 1000) * 0.5));
}

function spineHeightFromId(id: string): number {
  // A second, independent hash mix so height doesn't correlate with hue --
  // otherwise every blue book would also be the tallest.
  // 72-100% of the shelf's usable height. The old 84-100% band was too timid
  // to read as a real shelf; the ceiling stays at 100% because a spine hangs
  // off `bottom: 8` inside a SHELF_HEIGHT-tall area, so anything above that
  // would poke out through the shelf label.
  const h = hashId(`h:${id}`);
  return Math.round(SPINE_VISIBLE_HEIGHT * (0.72 + ((h % 1000) / 1000) * 0.28));
}


function hapticStart() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

function hapticDrop() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
}


function hapticSwipe() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

function Spine({
  book,
  index,
  world,
  draggingIndex,
  bounceY,
  shelfSwipeGesture,
  onOpen,
  onReordered,
}: {
  book: BookSummary;
  index: number;
  /** The shared simulation. This spine reads its own body out of it every
   *  frame and writes to it only while being dragged. */
  world: SharedValue<World>;
  draggingIndex: SharedValue<number>;
  /** Whole-shelf vertical hop — a view offset, not part of the simulation. */
  bounceY: SharedValue<number>;
  shelfSwipeGesture: GestureType;
  onOpen: (book: BookSummary) => void;
  /** Called with the new left-to-right ORDER as body indices; the shelf
   *  maps those back to ids. */
  onReordered: (rankedIndices: number[]) => void;
}) {
  const spineHeight = spineHeightFromId(book.id);
  const spineWidth = spineWidthFromId(book.id);
  const grabDX = useSharedValue(0);
  const grabDY = useSharedValue(0);
  // Where on the book it was grabbed, in the body's own frame — this offset
  // is the lever arm gravity swings it on. See driveHeld.
  const grabLocalX = useSharedValue(0);
  const grabLocalY = useSharedValue(0);

  function persist(ranked: number[]) {
    onReordered(ranked);
  }

  const pan = Gesture.Pan()
    .activateAfterLongPress(300)
    .simultaneousWithExternalGesture(shelfSwipeGesture)
    .onStart((e) => {
      const b = world.value.bodies[index];
      if (!b) return;
      draggingIndex.value = index;
      // Hand the book to the finger. It stops being pushed by anything and
      // starts pushing everything -- which is what picking one up does.
      makeKinematic(b);
      // WHERE it was grabbed, in the book's own frame: the gesture reports
      // view coordinates (origin top-left, y down), the simulation works
      // from the centre with y up. This offset is the lever arm gravity
      // swings the book on -- see driveHeld.
      grabLocalX.value = e.x - b.halfW;
      grabLocalY.value = b.halfH - e.y;
      // Where the finger is in world space right now, so translation can be
      // measured from it.
      grabDX.value = b.x + (grabLocalX.value * Math.cos(b.angle) - grabLocalY.value * Math.sin(b.angle));
      grabDY.value = b.y + (grabLocalX.value * Math.sin(b.angle) + grabLocalY.value * Math.cos(b.angle));
      runOnJS(hapticStart)();
    })
    .onUpdate((e) => {
      const w = world.value;
      const b = w.bodies[index];
      if (!b) return;
      // Where the finger is now, in world space. Screen y grows downward,
      // the simulation's grows upward, hence the negated translation.
      const pivotX = Math.min(
        Math.max(grabDX.value + e.translationX, w.leftWall),
        w.rightWall,
      );
      const pivotY = Math.max(0, grabDY.value - e.translationY);
      // The book hangs from that point rather than being pinned level, so
      // where you grabbed it decides whether it stays flat or swings.
      // Everything it runs into is still resolved by the solver on the next
      // step, so shoving a book through the row genuinely shoves the row.
      driveHeld(b, pivotX, pivotY, grabLocalX.value, grabLocalY.value, w.gx, w.gy, DRAG_DT);
      b.vx = 0;
      b.vy = 0;
    })
    .onEnd((e) => {
      const w = world.value;
      const b = w.bodies[index];
      if (!b) return;
      draggingIndex.value = -1;
      restoreDynamics(b);
      // Carry the throw. Gesture velocity is px/s in screen space, so the
      // vertical component flips sign coming into the simulation.
      b.vx = e.velocityX;
      b.vy = -e.velocityY;
      const wasLifted = b.y > b.halfH + LIFT_THRESHOLD;
      // Order is read back off where the books physically ARE -- the
      // simulation is the source of truth, not a list kept beside it.
      runOnJS(persist)(orderByPosition(w.bodies));
      if (wasLifted) runOnJS(hapticDrop)();
    });

  const style = useAnimatedStyle(() => {
    const b = world.value.bodies[index];
    if (!b) return { transform: [{ translateX: 0 }] };
    const isMe = draggingIndex.value === index;
    const lifted = b.y > b.halfH + LIFT_THRESHOLD;
    // The element is laid out with its bottom on the shelf line, so both
    // offsets are measured from there. No pivot juggling: the simulation
    // rotates a body about its own centre, and so does RN, so they agree by
    // construction -- the old code had to fake a grounded pivot because its
    // "rotation" wasn't attached to a real body.
    return {
      transform: [
        { translateX: b.x - b.halfW },
        { translateY: -(b.y - b.halfH) + bounceY.value },
        // Screen rotation is clockwise-positive with y down; the simulation
        // is counter-clockwise-positive with y up. Hence the negation.
        { rotate: `${(-b.angle * 180) / Math.PI}deg` },
        { scale: lifted ? 1.08 : 1 },
      ],
      zIndex: isMe ? 10 : 1,
      shadowOpacity: lifted ? 0.55 : 0.3,
      shadowRadius: lifted ? 7 : 3,
    };
  });

  // A contact shadow that belongs to the SIMULATION, not to the element: it
  // pools under the book where it actually meets the shelf, stretches as the
  // book leans (a leaning book covers more shelf), and thins and fades as one
  // is lifted away. The element's own `shadowOpacity` can't do any of that,
  // because it rotates and lifts along with the book it's attached to.
  const contactStyle = useAnimatedStyle(() => {
    const b = world.value.bodies[index];
    if (!b) return { opacity: 0 };
    const lift = Math.max(0, b.y - b.halfH);
    const near = Math.max(0.12, 1 - lift / 100); // 1 on the shelf, ->0 lifted
    const ext = horizontalExtent(b);
    return {
      opacity: 0.3 * near,
      transform: [
        { translateX: b.x - CONTACT_SHADOW_WIDTH / 2 },
        { translateY: bounceY.value },
        // A lifted book's shadow spreads as it softens, same as a real one.
        { scaleX: (ext * 2 * (1 + (1 - near) * 0.5)) / CONTACT_SHADOW_WIDTH },
        { scaleY: 0.55 + 0.45 * near },
      ],
    };
  });

  const look = spineLook(book.id);

  return (
    <>
    <Animated.View style={[styles.contactShadow, contactStyle]} pointerEvents="none" />
    <Animated.View
      style={[
        styles.spine,
        { width: spineWidth, height: spineHeight, backgroundColor: look.base },
        style,
      ]}
    >
      <GestureDetector gesture={pan}>
        <Pressable style={styles.spinePressable} onPress={() => onOpen(book)}>
          <SpineBinding />
          <View style={styles.spineTitleWrap}>
            <Text
              // The wrap is rotated 90deg, so the Text's own WIDTH runs along
              // the spine's height (plenty of room) but its HEIGHT is what
              // ends up constrained to the spine's actual (narrow) width —
              // capping it here is what lets adjustsFontSizeToFit shrink the
              // font to truly fit 2-3 lines instead of just getting clipped
              // by the spine's overflow:hidden.
              style={[styles.spineTitle, { height: spineWidth - 6, color: look.foil }]}
              numberOfLines={3}
              adjustsFontSizeToFit
              minimumFontScale={0.5}
              ellipsizeMode="tail"
            >
              {book.title}
            </Text>
          </View>
        </Pressable>
      </GestureDetector>
    </Animated.View>
    </>
  );
}

/** What makes a flat rectangle read as the rounded back of a book: it's dark
 *  where it turns away at both edges, brighter along the crown, and its head
 *  catches the light from above.
 *
 *  Only the form. Stamped decoration — ruled lines, inset panels, raised
 *  leather bands, a publisher's mark at the foot — was tried here and taken
 *  back out: at 40-66px wide it crowded the title rather than dressing it,
 *  and the shelf reads better with the material and the shape doing the work.
 *  All plain Views: no gradients, no SVG, nothing measured. */
function SpineBinding() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[styles.spineEdge, styles.spineEdgeLeft]} />
      <View style={[styles.spineEdge, styles.spineEdgeRight]} />
      <View style={styles.spineSheen} />
      <View style={styles.spineHead} />
    </View>
  );
}

/** Where one book physically is. The JS thread's read-only view of a body —
 *  it can't reach into the simulation, so the simulation posts this out. */
type Pose = { x: number; y: number; angle: number; halfW: number; halfH: number };

/** Copy every body's pose out of the world. Runs on the UI thread and hands
 *  plain numbers across, so nothing simulation-owned crosses the boundary. */
function snapshotPoses(w: World): Pose[] {
  'worklet';
  const out: Pose[] = [];
  for (let i = 0; i < w.bodies.length; i++) {
    const b = w.bodies[i];
    out.push({ x: b.x, y: b.y, angle: b.angle, halfW: b.halfW, halfH: b.halfH });
  }
  return out;
}

/** The poses a fresh shelf is built with — same expression the world is
 *  seeded from, so the mirror is never empty even before the first frame. */
function seedPoses(books: BookSummary[]): Pose[] {
  return books.map((b, i) => {
    const halfW = spineWidthFromId(b.id) / 2;
    const halfH = spineHeightFromId(b.id) / 2;
    return {
      x: WALL_WIDTH + halfW + i * (SPINE_WIDTH + SPINE_GAP),
      y: halfH,
      angle: 0,
      halfW,
      halfH,
    };
  });
}

/** How often the simulation posts poses out to the JS thread while it's
 *  moving. Six frames is a tenth of a second — far more than accurate enough
 *  for the one thing that reads it, and cheap enough to ignore. */
const POSE_PUBLISH_FRAMES = 6;

/** A book that has just been un-favorited, frozen at wherever the simulation
 *  had it, so it can come apart on its way out. */
type Departing = {
  key: string;
  id: string;
  /** Body state at the moment it left the shelf. */
  x: number;
  y: number;
  angle: number;
  width: number;
  height: number;
};

// 45 fragments, at roughly 10x13px each on a typical spine. Fine enough that
// the book comes apart into debris rather than into tiles.
const CRUMBLE_COLS = 5;
const CRUMBLE_ROWS = 9;
// The debris has its own gravity rather than borrowing the shelf's, because
// it isn't in the simulation — 45 boxes colliding with each other would cost
// more per frame than the whole shelf does, to decide where some rubble lands.
const DEBRIS_G = 1500; // px/s²
const DEBRIS_RESTITUTION = 0.3;
const DEBRIS_SCATTER = 34; // px/s sideways, while airborne
/** How long the pieces lie on the shelf before the shelf lets go of them. */
const DEBRIS_HOLD_S = 2.2;
/** They don't all go at once — each piece leaves at its own moment inside
 *  this window, which is what makes it read as rain rather than a dump. */
const DEBRIS_RAIN_SPREAD_S = 2.2;
/** Long enough for the last piece to be well past the bottom of any phone. */
const DEBRIS_RAIN_FALL_S = 1.3;
const CRUMBLE_S = DEBRIS_HOLD_S + DEBRIS_RAIN_SPREAD_S + DEBRIS_RAIN_FALL_S;

/** One piece of a broken book. Everything about its flight is fixed the
 *  moment the book breaks, so the whole thing is a closed-form function of
 *  elapsed time — no integration, no state. */
type Debris = {
  key: string;
  /** Laid out in shelf-area coordinates, already where the intact spine was. */
  left: number;
  top: number;
  w: number;
  h: number;
  color: string;
  /** The book's own angle, in degrees, so the pieces start as the book. */
  rot0: number;
  /** Distance to the shelf below it, and the ballistics of getting there. */
  drop: number;
  tLand: number;
  tRest: number;
  vBounce: number;
  vx: number;
  spinFall: number;
  /** When the shelf lets go of this piece, and how it turns on the way down. */
  tRain: number;
  spinRain: number;
};

/** One piece, in flight. All 45 read the same clock, so a book breaking up is
 *  one animation driving 45 styles rather than 45 animations to keep in step.
 *
 *  Two acts. It falls to the shelf, bounces once and lies there — that's why
 *  the bottom of the book barely moves while the top comes down, which is
 *  what a thing collapsing looks like. Then, a couple of seconds later, the
 *  shelf lets go of it and it drops off the bottom of the screen. */
function DebrisPiece({ clock, d }: { clock: SharedValue<number>; d: Debris }) {
  const style = useAnimatedStyle(() => {
    const t = clock.value;
    let down: number;
    if (t < d.tLand) down = 0.5 * DEBRIS_G * t * t;
    else if (t < d.tRest) {
      const u = t - d.tLand;
      down = d.drop - (d.vBounce * u - 0.5 * DEBRIS_G * u * u);
    } else down = d.drop;
    // Scatter and tumble only while it's off the ground; once it's down it's
    // down, the same way a fallen book stays fallen.
    const air = t < d.tRest ? t : d.tRest;
    let rot = d.rot0 + d.spinFall * air;
    if (t > d.tRain) {
      const u = t - d.tRain;
      down += 0.5 * DEBRIS_G * u * u;
      rot += d.spinRain * u;
    }
    return {
      transform: [{ translateX: d.vx * air }, { translateY: down }, { rotate: `${rot}deg` }],
    };
  });

  return (
    <Animated.View
      style={[
        { position: 'absolute', left: d.left, top: d.top, width: d.w, height: d.h, backgroundColor: d.color },
        style,
      ]}
    />
  );
}

/** An un-favorited book leaving the shelf. Taking a star off is the one shelf
 *  action with no physical counterpart — the book doesn't go anywhere, it
 *  simply stops being a shelf book — so rather than blink out, it collapses
 *  where it stood, lies there in pieces, and then the shelf lets the pieces
 *  go one at a time until there's nothing left.
 *
 *  The pieces are flat chips of the spine's own material, not a jigsaw of the
 *  rendered spine: they tumble and are gone within seconds, so copying the
 *  title into each of 45 of them would cost 45 laid-out text nodes to show
 *  something nobody can read. Each one does carry its share of the spine's
 *  shading (see shadeSpine), which is what stops the book going visibly flat
 *  in the instant before it comes apart. */
function CrumblingSpine({ item, onDone }: { item: Departing; onDone: (key: string) => void }) {
  const clock = useSharedValue(0);

  const pieces = useMemo(() => {
    const look = spineLook(item.id);
    const w = item.width / CRUMBLE_COLS;
    const h = item.height / CRUMBLE_ROWS;
    // The book's pose, in the shelf area's own coordinates. A spine hangs off
    // `bottom: 8`, so its centre sits that far above the shelf line plus the
    // body's own height off the shelf.
    const phi = -item.angle; // screen rotation: clockwise-positive, y down
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const bookCentreFromBottom = 8 + item.y;

    const out: Debris[] = [];
    for (let row = 0; row < CRUMBLE_ROWS; row++) {
      for (let col = 0; col < CRUMBLE_COLS; col++) {
        const seed = hashId(`debris:${item.id}:${col}:${row}`);
        // Cell centre relative to the book's centre, then turned with the
        // book — so a book that was leaning breaks up leaning.
        const lx = (col + 0.5) * w - item.width / 2;
        const ly = (row + 0.5) * h - item.height / 2; // screen-down
        const cx = item.x + (lx * cos - ly * sin);
        const cyFromBottom = bookCentreFromBottom - (lx * sin + ly * cos);

        // Where it comes to rest: on the shelf, in a slightly uneven pile.
        const pile = (seed >>> 3) % 6;
        const drop = Math.max(0, cyFromBottom - (8 + h / 2 + pile));
        const tLand = Math.sqrt((2 * drop) / DEBRIS_G);
        const vBounce = DEBRIS_G * tLand * DEBRIS_RESTITUTION;
        out.push({
          key: `${col}:${row}`,
          left: cx - w / 2,
          top: SHELF_HEIGHT - cyFromBottom - h / 2,
          // Half a pixel of overlap, so the seams don't shimmer while intact.
          w: w + 0.5,
          h: h + 0.5,
          color: shadeSpine(look, col, row),
          rot0: (phi * 180) / Math.PI,
          drop,
          tLand,
          tRest: tLand + (2 * vBounce) / DEBRIS_G,
          vBounce,
          vx: (((seed >>> 7) % 200) / 100 - 1) * DEBRIS_SCATTER,
          spinFall: (((seed >>> 11) % 200) / 100 - 1) * 150,
          tRain: DEBRIS_HOLD_S + (((seed >>> 15) % 1000) / 1000) * DEBRIS_RAIN_SPREAD_S,
          spinRain: (((seed >>> 21) % 200) / 100 - 1) * 260,
        });
      }
    }
    return out;
  }, [item]);

  useEffect(() => {
    // Linear, because the clock IS elapsed seconds — every piece does its own
    // easing by falling. Cleanup is a plain timer rather than the animation's
    // completion callback: a callback that hops back to the JS thread has to
    // survive this component being unmounted mid-flight (deleting the book
    // outright does exactly that), and a timer just gets cleared.
    clock.value = withTiming(CRUMBLE_S, { duration: CRUMBLE_S * 1000, easing: Easing.linear });
    const timer = setTimeout(() => onDone(item.key), CRUMBLE_S * 1000 + 80);
    return () => clearTimeout(timer);
  }, [clock, onDone, item.key]);

  return (
    <View pointerEvents="none" style={styles.debrisLayer}>
      {pieces.map((d) => (
        <DebrisPiece key={d.key} clock={clock} d={d} />
      ))}
    </View>
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
  // ONE simulation for the whole shelf, replacing the old parallel arrays
  // (xs/vxs/rotations/rotationVs/liftYs/liftVYs/order/fallenDir). A book is
  // now a rigid box that owns its own position, angle and momentum, so
  // "leaning", "fallen" and "stacked" are places it can be rather than flags
  // maintained beside it.
  const world = useSharedValue<World>({
    bodies: books.map((b, i) => {
      const halfW = spineWidthFromId(b.id) / 2;
      const halfH = spineHeightFromId(b.id) / 2;
      // Seeded left-to-right at their resting height, so nothing drops into
      // place on mount. books arrives pre-sorted by shelf position.
      return makeBody(WALL_WIDTH + halfW + i * (SPINE_WIDTH + SPINE_GAP), halfH, halfW, halfH);
    }),
    leftWall: WALL_WIDTH,
    rightWall: Math.max(WALL_WIDTH + 1, containerWidth - WALL_WIDTH),
    gx: 0,
    gy: -GRAVITY_STRENGTH,
  });
  const draggingIndex = useSharedValue(-1);
  const tiltX = useSharedValue(0);
  // Which spines one swipe pass has already hit, so brushing across the
  // shelf kicks each book once rather than once per frame under the finger.
  const swipedIndices = useSharedValue<number[]>([]);

  // Bodies are indexed by POSITION in the `books` array, but the parent
  // re-sorts that array every time a reorder is persisted — so a book's
  // array position can change on the very next render after its own drag
  // ends. Without remapping, whichever book lands at a given position
  // inherits the PHYSICAL STATE (place, angle, momentum) of whoever was
  // there before, which reads as two spines instantly swapping. Remap
  // whenever the id SEQUENCE changes but the SET doesn't — a changed set
  // already remounts the whole component via the parent's key.
  const prevIds = useRef<string[]>(books.map((b) => b.id));
  // Books that have left the shelf but are still coming apart on screen. Keyed
  // separately from the book id because the same book can be favorited again
  // while its own pieces are still blowing away.
  const [departing, setDeparting] = useState<Departing[]>([]);
  const departSeq = useRef(0);
  const dropDeparted = useCallback((key: string) => {
    setDeparting((prev) => prev.filter((d) => d.key !== key));
  }, []);

  // A JS-thread mirror of where the books physically are, refreshed by the
  // frame loop. Nothing needs the live pose per frame — this exists so that
  // the ONE thing that does, un-favoriting a book, can read a real pose
  // synchronously instead of asking the UI thread and waiting a frame for the
  // answer. Seeded to the same rest positions the world is, so it's never
  // empty; the shelf publishes again as soon as anything moves and once more
  // on the frame it settles, so a stationary shelf's mirror is exact.
  const posesRef = useRef<Pose[]>(seedPoses(books));
  const publishPoses = useCallback((p: Pose[]) => {
    posesRef.current = p;
  }, []);
  const posesStale = useSharedValue(true);
  const poseTick = useSharedValue(0);

  // Rebuild the body list to match the book list — ON THE UI THREAD. This is
  // not a style choice. A shared value holding objects keeps a separate copy
  // per thread: the simulation runs on the UI thread and mutates its copy
  // every frame, so `world.value` read from JS is whatever was last ASSIGNED
  // there, not where the books actually are. Assigning bodies back from JS
  // therefore both discarded the live simulation and re-registered objects
  // the UI thread already owned, which is what was aborting the app inside
  // Reanimated's shareable conversion. Everything that touches a body now
  // happens where the bodies live.
  const applySlots = useCallback(
    (slots: { from: number; x: number; halfW: number; halfH: number }[]) => {
      runOnUI((s: { from: number; x: number; halfW: number; halfH: number }[]) => {
        'worklet';
        const w = world.value;
        const bodies: Body[] = [];
        for (let i = 0; i < s.length; i++) {
          // Keep the body every surviving book already has — its place, angle
          // and momentum are its identity, and a favorite added elsewhere on
          // the shelf must not disturb them.
          const kept = s[i].from >= 0 ? w.bodies[s[i].from] : undefined;
          if (kept) {
            bodies.push(kept);
            continue;
          }
          // A book that wasn't here before: give it a body ABOVE the shelf and
          // let it fall into place, rather than materialising already seated.
          const halfW = s[i].halfW;
          const halfH = s[i].halfH;
          const x = Math.min(Math.max(s[i].x, w.leftWall + halfW), w.rightWall - halfW);
          bodies.push(makeBody(x, halfH * SPAWN_DROP_HEIGHT, halfW, halfH));
        }
        // Anything already settled has to wake, or a new book would land on a
        // sleeping row and be absorbed without it reacting.
        for (let i = 0; i < bodies.length; i++) wake(bodies[i]);
        w.bodies = bodies;
      })(slots);
    },
    [world],
  );

  // A layout effect, not an ordinary one: the pieces of a book that's leaving
  // have to be on screen in the SAME commit that takes its spine away, or it
  // visibly blinks out and then reappears already in fragments.
  useLayoutEffect(() => {
    const newIds = books.map((b) => b.id);
    const oldIds = prevIds.current;
    let changed = newIds.length !== oldIds.length;
    if (!changed) {
      for (let i = 0; i < newIds.length; i++) {
        if (newIds[i] !== oldIds[i]) { changed = true; break; }
      }
    }
    if (!changed) return;
    prevIds.current = newIds;

    // Anything that was here and isn't any more was un-favorited. Its pose
    // comes off the mirror the frame loop publishes (see publishPoses) — the
    // real one, wherever the simulation had it: leaning, toppled, stacked.
    const poses = posesRef.current;
    const stillHere = new Set(newIds);
    const leaving: Departing[] = [];
    for (let i = 0; i < oldIds.length; i++) {
      if (stillHere.has(oldIds[i])) continue;
      const p = poses[i];
      if (!p) continue;
      departSeq.current += 1;
      leaving.push({
        key: `${oldIds[i]}#${departSeq.current}`,
        id: oldIds[i],
        x: p.x,
        y: p.y,
        angle: p.angle,
        width: p.halfW * 2,
        height: p.halfH * 2,
      });
    }
    // setState in an effect, which react-hooks/set-state-in-effect flags.
    // Deliberate: a book leaving is exactly the external change this effect
    // exists to react to, and it happens once per favorite toggle.
    if (leaving.length > 0) setDeparting((prev) => [...prev, ...leaving]);

    const oldIndexOf = new Map(oldIds.map((id, i) => [id, i]));
    applySlots(
      newIds.map((id, i) => {
        const from = oldIndexOf.get(id);
        const halfW = spineWidthFromId(id) / 2;
        const halfH = spineHeightFromId(id) / 2;
        return {
          from: from === undefined ? -1 : from,
          x: WALL_WIDTH + halfW + i * (SPINE_WIDTH + SPINE_GAP),
          halfW,
          halfH,
        };
      }),
    );
  }, [books, applySlots]);

  /** A drag settled: turn the body order the simulation ended up in back
   *  into book ids. Order is an OUTCOME of where books physically are now,
   *  not a list maintained in parallel with them. */
  function handleRanked(ranked: number[]) {
    onReorder(ranked.map((i) => books[i]?.id).filter((id): id is string => !!id));
  }

  // Whole-shelf vertical hop from a fast phone movement — see the jerk/bounce
  // note above the constants and the frame loop below. Deliberately NOT part
  // of the simulation: it moves the shelf, not the books on it.
  const jerkY = useSharedValue(0);
  const bounceY = useSharedValue(0);
  const bounceVY = useSharedValue(0);

  // The shelf can be re-measured (rotation, split screen) and the walls move
  // with it. On the UI thread, for the reason given above applySlots.
  useEffect(() => {
    const right = Math.max(WALL_WIDTH + 1, containerWidth - WALL_WIDTH);
    runOnUI((r: number) => {
      'worklet';
      world.value.rightWall = r;
    })(right);
  }, [containerWidth, world]);

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
    // On the UI thread — this used to mutate the JS thread's copy of the
    // bodies, which the simulation never sees, so shaking did nothing.
    runOnUI(() => {
      'worklet';
      const w = world.value;
      if (w.bodies.length < 2) return;
      // Stand everything back up and kick it sideways; the solver sorts out
      // where they actually end up, which is the point of shaking a shelf.
      for (let i = 0; i < w.bodies.length; i++) {
        const b = w.bodies[i];
        b.angle = 0;
        b.omega = 0;
        b.y = b.halfH;
        b.vy = 0;
        b.vx = (Math.random() - 0.5) * 2 * SHAKE_KICK;
        wake(b);
      }
    })();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
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
    const w = world.value;
    if (w.bodies.length === 0) return;

    // Whole-shelf vertical hop — its own tiny mass-spring-damper, driven by
    // the sensed jerk. Always integrated (it's O(1)) so a jerk registers
    // even with the shelf otherwise fully asleep.
    const bounceSpring = -bounceY.value * BOUNCE_STIFFNESS;
    const bounceDamping = -bounceVY.value * BOUNCE_DAMPING;
    bounceVY.value += (bounceSpring + bounceDamping + jerkY.value * BOUNCE_STRENGTH) * dt;
    bounceY.value = Math.min(BOUNCE_MAX, Math.max(-BOUNCE_MAX, bounceY.value + bounceVY.value * dt));

    // Gravity follows the phone. Past the deadzone the shelf's "down" tips
    // sideways, and everything on it responds through the same contacts
    // that hold it up — books lean on each other, slide, and if it gets
    // steep enough, go over. Nothing here special-cases toppling; a book
    // falls because gravity took its centre of mass past its own edge.
    const tilt = Math.abs(tiltX.value) > TILT_DEADZONE ? tiltX.value : 0;
    const gx = tilt * GRAVITY_STRENGTH * TILT_GRAVITY_SCALE;
    if (gx !== w.gx) {
      w.gx = gx;
      // A change in gravity has to wake the shelf, or a settled row would
      // sit through being tipped.
      for (let i = 0; i < w.bodies.length; i++) wake(w.bodies[i]);
    }

    // Cheap early-out once everything has come to rest and nothing is being
    // dragged. This callback lives as long as the component (including while
    // the user is on another screen, since Expo Router keeps it mounted), so
    // not burning a frame on a settled shelf matters.
    if (draggingIndex.value === -1 && isAsleep(w)
      && Math.abs(bounceY.value) < 0.1 && Math.abs(bounceVY.value) < 0.1) {
      // One last mirror on the way to sleep, so a settled shelf's poses are
      // exact rather than however stale the throttle left them.
      if (posesStale.value) {
        posesStale.value = false;
        runOnJS(publishPoses)(snapshotPoses(w));
      }
      return;
    }

    step(w, dt);

    posesStale.value = true;
    poseTick.value += 1;
    if (poseTick.value % POSE_PUBLISH_FRAMES === 0) runOnJS(publishPoses)(snapshotPoses(w));
  });

  // Brush a finger across the shelf and books scatter out of the way. With
  // real bodies this is just an impulse — the solver carries it through the
  // row, so a shove can genuinely knock a leaning book over.
  const shelfSwipeGesture = Gesture.Pan()
    .minDistance(12)
    .onBegin(() => {
      swipedIndices.value = [];
    })
    .onUpdate((e) => {
      const w = world.value;
      if (draggingIndex.value !== -1) return;
      for (let i = 0; i < w.bodies.length; i++) {
        if (swipedIndices.value.indexOf(i) !== -1) continue;
        const b = w.bodies[i];
        const ext = horizontalExtent(b);
        if (e.x < b.x - ext || e.x > b.x + ext) continue;
        const dir = e.velocityX >= 0 ? 1 : -1;
        b.vx += dir * SWIPE_IMPULSE;
        b.omega += dir * SWIPE_WIGGLE * (Math.PI / 180);
        wake(b);
        swipedIndices.value = [...swipedIndices.value, i];
        runOnJS(hapticSwipe)();
      }
    });

  // Still render an empty shelf while something is blowing away on it —
  // otherwise removing the second-to-last book on a page cuts its own exit off.
  if (books.length === 0 && departing.length === 0) return null;

  return (
    <GestureDetector gesture={shelfSwipeGesture}>
      <View style={[styles.shelfArea, { height: SHELF_HEIGHT }]}>
        {/* Solid bookend walls at the shelf's own physical boundary — the
            same edges the physics already pins spines against, just made
            visible instead of an invisible wall. Rendered behind the
            spines (default z-index), so a pinned book naturally covers it. */}
        <View style={styles.shelfBack} pointerEvents="none">
          <View style={[styles.shelfBackShade, styles.shelfBackTop]} />
          <View style={[styles.shelfBackShade, styles.shelfBackFloor]} />
        </View>
        <View style={[styles.shelfWall, styles.shelfWallLeft]}>
          <WoodGrain vertical />
        </View>
        <View style={[styles.shelfWall, styles.shelfWallRight]}>
          <WoodGrain vertical />
        </View>
        {departing.map((d) => (
          <CrumblingSpine key={d.key} item={d} onDone={dropDeparted} />
        ))}
        {books.map((book, index) => (
          <Spine
            key={book.id}
            book={book}
            index={index}
            world={world}
            draggingIndex={draggingIndex}
            bounceY={bounceY}
            shelfSwipeGesture={shelfSwipeGesture}
            onOpen={onOpen}
            onReordered={handleRanked}
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
  // Inactive pills previously had no explicit text/background color, which
  // defaulted to a near-black-on-near-black look in dark mode — every pill
  // past the active one was effectively invisible ("just a black zone").
  const isDark = useColorScheme() === 'dark';
  const indices: number[] = [];
  for (let i = 0; i < count; i++) indices.push(i);
  return (
    <View style={styles.shelfSwitcher}>
      {indices.map((i) => (
        <Pressable
          key={i}
          onPress={() => onSelect(i)}
          hitSlop={4}
          style={[
            styles.shelfDot,
            { backgroundColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)' },
            i === current && styles.shelfDotActive,
          ]}
        >
          <Text
            style={[
              styles.shelfDotText,
              { color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)' },
              i === current && styles.shelfDotTextActive,
            ]}
          >
            {i + 1}
          </Text>
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
  const locale = useLocaleStore((s) => s.locale);
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
      <Text style={styles.label}>{t('library.bookshelfLabel', locale)}</Text>
      {containerWidth > 0 && (
        <ShelfPage
          key={currentShelf}
          books={pageBooks}
          containerWidth={containerWidth}
          onOpen={onOpen}
          onReorder={handlePageReorder}
        />
      )}
      <View style={styles.shelfLip}>
        <View style={styles.shelfLipEdge} />
        <WoodGrain />
      </View>
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
  },
  shelfDotActive: { backgroundColor: '#8a5a34' },
  shelfDotText: { fontSize: 12, fontWeight: '700' },
  shelfDotTextActive: { color: '#fff' },
  shelfWall: {
    position: 'absolute',
    top: 0,
    bottom: 8, // matches `spine`'s own bottom inset — sits on the same shelf line
    width: 6,
    overflow: 'hidden', // keeps the grain inside the wall's rounded corners
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
    // No `top`: each spine sets its own height (spineHeightFromId) and hangs
    // off `bottom`, so books of different heights all rest on the shelf.
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
  // Rounded-spine shading. Stacked flat overlays rather than a gradient —
  // there's no expo-linear-gradient or SVG in this project, and at 40-66px
  // wide three hard-edged bands are indistinguishable from a real ramp.
  spineEdge: { position: 'absolute', top: 0, bottom: 0, backgroundColor: '#000' },
  spineEdgeLeft: { left: 0, width: 3, opacity: 0.22 },
  spineEdgeRight: { right: 0, width: 4, opacity: 0.3 },
  spineSheen: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 6,
    width: 4,
    backgroundColor: '#fff',
    opacity: 0.09,
  },
  /** The head of the book, catching the light from above. */
  spineHead: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#fff',
    opacity: 0.14,
  },
  /** Debris sits above the books it fell off, and must not overflow-clip:
   *  the pieces have to be able to leave the shelf entirely on their way
   *  down the screen. */
  debrisLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5 },
  contactShadow: {
    position: 'absolute',
    left: 0,
    bottom: 4,
    width: CONTACT_SHADOW_WIDTH,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#000',
    zIndex: 0,
  },
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
  shelfLip: {
    height: 14,
    marginTop: -1,
    backgroundColor: '#8a5a34',
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 4,
  },
  /** The lit front edge of the shelf board, where it faces the room. */
  shelfLipEdge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#fff',
    opacity: 0.16,
  },
  /** The recess the books stand in. Without it they float on the page
   *  background; with it the walls and lip read as one piece of furniture. */
  shelfBack: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 8,
    backgroundColor: '#3b2717',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  /** Ambient occlusion: the recess is darkest where it meets the top and the
   *  shelf board, which is what stops the flat panel reading as a flat panel. */
  shelfBackShade: { position: 'absolute', left: 0, right: 0, backgroundColor: '#000' },
  shelfBackTop: { top: 0, height: 16, opacity: 0.3 },
  shelfBackFloor: { bottom: 0, height: 8, opacity: 0.22 },
});

/** Wood is not a flat fill. Three streaks at irregular offsets and opacities
 *  is enough grain to read at this size, and it's the same trick along a wall
 *  (vertical) as along the shelf board (horizontal). */
function WoodGrain({ vertical }: { vertical?: boolean }) {
  // offset = distance across the grain (x on a wall, y on the board),
  // thickness = how heavy that streak is.
  const streaks: { offset: number; thickness: number; opacity: number; dark: boolean }[] = vertical
    ? [
        { offset: 1, thickness: 1, opacity: 0.16, dark: true },
        { offset: 3, thickness: 1, opacity: 0.1, dark: false },
        { offset: 4, thickness: 1.5, opacity: 0.13, dark: true },
      ]
    : [
        { offset: 4, thickness: 1, opacity: 0.12, dark: true },
        { offset: 7, thickness: 1.5, opacity: 0.09, dark: false },
        { offset: 11, thickness: 1, opacity: 0.14, dark: true },
      ];
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {streaks.map((s, i) => (
        <View
          key={i}
          style={[
            { position: 'absolute', backgroundColor: s.dark ? '#000' : '#fff', opacity: s.opacity },
            vertical
              ? { top: 0, bottom: 0, left: s.offset, width: s.thickness }
              : { left: 0, right: 0, top: s.offset, height: s.thickness },
          ]}
        />
      ))}
    </View>
  );
}
