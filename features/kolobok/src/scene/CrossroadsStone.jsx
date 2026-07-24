import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import * as Haptics from 'expo-haptics';
import {
  BufferAttribute, BufferGeometry, Color, Object3D, SphereGeometry,
} from 'three';
import { angleDelta } from '../config/zones';
import { orbit, useSceneStore } from '../state/sceneStore';
import { MENU } from '../config/menu';
import { t } from '../config/strings';
import { createTimeline } from './timeline';
import { makeRng } from './prng';
import { makeNoiseGrain } from './textures/proceduralTextures';
import { makeLabelTexture } from './textures/bitmapFont';
import { makeToonMaterial } from './materials/toonMaterial';
import { jitterVertices } from './builders/vertexJitter';

const dummy = new Object3D();
const FACE_LERP_RATE = 2.5; // rad/s the plaque column yaws to catch up with the camera azimuth

// BACKLOG.md #9 (live feedback round 3, reference photo): a real boulder
// like the one shown -- big, squat, roughly as wide as tall, chunky and
// irregular, NOT a tall spire/cone. Reworked proportions below (radius up,
// height scale down, ~2x the old width) plus buttons 50% bigger.
const PLAQUE_HEIGHTS = [2.05, 1.35, 0.7];
const PLAQUE_HEIGHT_SIZE = 0.49; // was 0.39, +25% with the whole-stone upscale
const PLAQUE_HITBOX_SCALE = 1.6;
const PLAQUE_ARC_LENGTH = 1.09; // was 0.87, +25% with the whole-stone upscale

// The boulder's own mesh transform, pulled out to module constants so both
// the geometry shaper below AND the per-plaque radius calculator can share
// the exact same taper math -- if they drifted independently, the "carved
// groove" and the boulder's own dip at that same spot could disagree.
const BOULDER_RADIUS = 1.06;
const BOULDER_Y = 0.9;
const BOULDER_Y_SCALE = 1.45; // taller upright boulder, room between buttons (was 1.2)
const BOULDER_XZ_SCALE = 1.0; // ~2x the old 0.68, per live feedback "twice wider"
// Sink the whole assembly a little so the base tucks INTO the ground, and
// raise the plaque heights (below) so the lowest button rides up on the body
// rather than at the base. A ring of moss/grass around the sunken base (see
// baseSkirtMatrices) then nestles the stone into the terrain.
const BASE_LIFT = -0.2;
// Live feedback round 4: base should be wider than the MIDDLE (not just
// wider than the top) -- a plain widen-multiplier on the sphere's own
// natural radius can't do that, since the sphere's natural radius is
// ALREADY largest at the equator (topT=0.5) and shrinks toward both
// poles, so even a strong multiplier at the very bottom pole (where the
// natural radius is shrinking toward 0) can't out-grow the untouched
// equator. Instead: define the actual TARGET world radius directly at a
// few control heights (a real lathe-style profile), then derive whatever
// per-vertex widen multiplier reproduces that against the sphere's own
// natural (pre-widen) radius at each height. Round 5 fix: the profile is
// now already broad at the lowest control row (topT=0.06) and narrows
// monotonically upward, so the stone seats nearly FLAT on the ground
// instead of pinching to a point at the base -- the earlier profile put
// its widest bulge above a pinched base, which read as the boulder
// balancing on a tip / floating.
const RADIUS_PROFILE = [
  { topT: 0, radius: 0 }, // bottom pole
  { topT: 0.08, radius: 0.92 }, // very low -- already broad, eases in (no cliff), so the stone seats nearly flat on the ground
  { topT: 0.24, radius: 1.15 }, // widest bulge, kept low down
  { topT: 0.55, radius: 1.02 }, // waist/middle -- narrower than the base bulge
  { topT: 0.83, radius: 0.72 }, // upper body -- narrower still
  { topT: 1, radius: 0 }, // top pole
];
function targetRadiusAt(topT) {
  for (let i = 1; i < RADIUS_PROFILE.length; i += 1) {
    const a = RADIUS_PROFILE[i - 1];
    const b = RADIUS_PROFILE[i];
    if (topT <= b.topT) {
      const t = (topT - a.topT) / (b.topT - a.topT);
      return a.radius + (b.radius - a.radius) * t;
    }
  }
  return RADIUS_PROFILE[RADIUS_PROFILE.length - 1].radius;
}
function boulderWidenAt(topT, naturalR) {
  if (naturalR < 1e-4) return 1; // exactly at a pole -- degenerate vertex, widen is moot
  return targetRadiusAt(topT) / naturalR;
}
const worldYToLocalY = (worldY) => (worldY - BOULDER_Y) / BOULDER_Y_SCALE;

// The groove each plaque rides in is a local dip in the SAME taper curve
// (not a separate floating ring) -- GROOVE_DEPTH_FRAC is how much it
// recesses relative to the surrounding (already-tapered) surface there.
const GROOVE_DEPTH_FRAC = 0.15;
const GROOVE_HALF_WIDTH_LOCAL = 0.25; // in the sphere's own local Y units -- wide enough for the taller plaques (scaled with the whole stone)

/** The rock's own (un-grooved) surface radius at a given world height --
 *  used to size each plaque's curve to match the stone at ITS height,
 *  since the bulge-at-the-base profile means the three plaques sit on
 *  meaningfully different radii, not one shared constant. Directly the
 *  RADIUS_PROFILE's target (that profile IS the final world radius, by
 *  construction -- see boulderWidenAt), just scaled by BOULDER_XZ_SCALE. */
function naturalRadiusAtWorldY(worldY) {
  const y = worldYToLocalY(worldY);
  const topT = Math.max(0, Math.min(1, (y / BOULDER_RADIUS + 1) / 2));
  return targetRadiusAt(topT) * BOULDER_XZ_SCALE;
}

// Each plaque's own orbit radius = the outer (label) face of its solid block.
// Bumped OUTWARD by PLAQUE_BUMP so the face stands proud of the stone
// (nothing occludes it), while each block's INNER face reaches down to the
// groove floor carved at that height (derived per-plaque in the component),
// so the block sits visibly wedged in its channel rather than floating.
const PLAQUE_BUMP = 0.08; // how far the button's face stands out past the stone surface
const PLAQUE_RADII = PLAQUE_HEIGHTS.map((h) => naturalRadiusAtWorldY(h) + PLAQUE_BUMP);

// Angular width (radians) of each plaque's arc, and a slightly wider accent
// arc so the dark shadow line peeks out just past both button edges. Mirrors
// the per-plaque arcLength cap used inside Plaque so the two always agree.
const PLAQUE_THETAS = PLAQUE_RADII.map((r) => Math.min(PLAQUE_ARC_LENGTH, r * 2.2) / r);
const ACCENT_ARC_WIDEN = 1.25;

// Per-button azimuth offset (radians) around the stone's Y axis, relative to
// the group's camera-facing +Z. A small irregular fan so the three buttons
// read as sitting on distinct faces rather than a rigid vertical stack, while
// all staying near the front so they're comfortably readable at once. Safe at
// any azimuth because the buttons are at different HEIGHTS (their full-ring
// grooves are vertically separated), so fanning them never makes their
// channels or bodies collide. The whole set still rides the rotating group,
// so it tracks the camera as before.
const PLAQUE_AZIMUTHS = [
  (18 * Math.PI) / 180, // top -- swung left of center
  (-6 * Math.PI) / 180, // middle -- just right of center
  (14 * Math.PI) / 180, // bottom -- left again, but less than the top
];

const PRESS_DEPTH = 0.02;
const PRESS_MS = 80;
const NAV_AT_MS = 250;
const EMISSIVE_IDLE = 0.35;
const EMISSIVE_PEAK = 1.2;

const DUST_COUNT = 4;
const DUST_COLOR = new Color('#c8c4bc');

// Local (sphere-space) Y for each groove, so the per-vertex loop below
// doesn't recompute the same conversion three times per vertex.
const GROOVE_LOCAL_YS = PLAQUE_HEIGHTS.map(worldYToLocalY);

// BACKLOG.md #9 (live feedback round 4): base bulges wider than the
// middle waist, which is wider than the top (a real boulder, not a
// uniform blob), PLUS a groove recessed directly into the same surface at
// each plaque height -- carved INTO the stone, not a separate ring
// floating in front of it. Applied BEFORE jitterVertices so the fine
// surface noise sits on top of both the profile and the grooves rather
// than the other way around.
function shapeBoulderGeometry(geometry) {
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const topT = Math.max(0, Math.min(1, (y / BOULDER_RADIUS + 1) / 2)); // 0 bottom, 1 top
    const naturalR = Math.sqrt(Math.max(0, BOULDER_RADIUS ** 2 - y ** 2));
    let widen = boulderWidenAt(topT, naturalR);
    for (const groundY of GROOVE_LOCAL_YS) {
      const d = Math.abs(y - groundY);
      if (d < GROOVE_HALF_WIDTH_LOCAL) {
        const dip = Math.cos((d / GROOVE_HALF_WIDTH_LOCAL) * (Math.PI / 2)); // 1 at center, 0 at edge
        widen *= 1 - dip * GROOVE_DEPTH_FRAC;
      }
    }
    pos.setX(i, pos.getX(i) * widen);
    pos.setZ(i, pos.getZ(i) * widen);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

// BACKLOG.md #9: ambient dust while the plaque column is actively rotating
// (not just on tap) -- ANIMATION continues for as long as real angular
// motion is happening, settling once the column catches up to the camera.
const AMBIENT_DUST_COUNT = 6;
const AMBIENT_DUST_LIFE = 0.6;
const AMBIENT_DUST_SPAWN_GAP = 0.12; // seconds between puffs while moving
const MOVING_THRESHOLD = 0.02; // rad/s-ish -- below this, treat as settled

// A solid curved "tablet": a ring-sector prism swept from -arc/2..+arc/2
// between an inner and outer radius, extruded over `height`. Unlike a bare
// cylinder-wall slice (which is a zero-thickness sheet -- what read as
// "paper"), this has a real outer face, inner face, two flat end-cap SIDES,
// and top/bottom faces, so the button reads as a chunky stone block wedged
// in its groove, showing depth as it slides along the channel. UVs run 0..1
// across the OUTER face (u along the arc, v along height) so the existing
// label texture maps exactly as it did on the old wall; other faces get
// zeroed UVs (they carry no label, only the plaque color).
function makeArcBlock(rInner, rOuter, height, arc, radialSeg = 16) {
  const geo = new BufferGeometry();
  const pos = [];
  const uv = [];
  const idx = [];
  const hy = height / 2;
  const a0 = -arc / 2;
  const push = (x, y, z, u, v) => { pos.push(x, y, z); uv.push(u, v); };
  // Outer + inner faces as quad strips along the arc.
  for (let s = 0; s < radialSeg; s += 1) {
    const t0 = s / radialSeg;
    const t1 = (s + 1) / radialSeg;
    const ang0 = a0 + arc * t0;
    const ang1 = a0 + arc * t1;
    const s0 = Math.sin(ang0);
    const c0 = Math.cos(ang0);
    const s1 = Math.sin(ang1);
    const c1 = Math.cos(ang1);
    const base = pos.length / 3;
    // Outer face (label): u across arc, v across height.
    push(s0 * rOuter, -hy, c0 * rOuter, t0, 0);
    push(s1 * rOuter, -hy, c1 * rOuter, t1, 0);
    push(s1 * rOuter, hy, c1 * rOuter, t1, 1);
    push(s0 * rOuter, hy, c0 * rOuter, t0, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    // Inner face (reverse winding so it faces inward).
    const bi = pos.length / 3;
    push(s0 * rInner, -hy, c0 * rInner, 0, 0);
    push(s1 * rInner, -hy, c1 * rInner, 0, 0);
    push(s1 * rInner, hy, c1 * rInner, 0, 0);
    push(s0 * rInner, hy, c0 * rInner, 0, 0);
    idx.push(bi, bi + 2, bi + 1, bi, bi + 3, bi + 2);
    // Top and bottom faces (radial quads bridging inner/outer at each step).
    const bt = pos.length / 3;
    push(s0 * rInner, hy, c0 * rInner, 0, 0);
    push(s1 * rInner, hy, c1 * rInner, 0, 0);
    push(s1 * rOuter, hy, c1 * rOuter, 0, 0);
    push(s0 * rOuter, hy, c0 * rOuter, 0, 0);
    idx.push(bt, bt + 2, bt + 1, bt, bt + 3, bt + 2);
    const bb = pos.length / 3;
    push(s0 * rInner, -hy, c0 * rInner, 0, 0);
    push(s1 * rInner, -hy, c1 * rInner, 0, 0);
    push(s1 * rOuter, -hy, c1 * rOuter, 0, 0);
    push(s0 * rOuter, -hy, c0 * rOuter, 0, 0);
    idx.push(bb, bb + 1, bb + 2, bb, bb + 2, bb + 3);
  }
  // Two end-cap SIDES (the faces that make it read as a solid block).
  [[a0, 1], [-a0, -1]].forEach(([ang, winding]) => {
    const sn = Math.sin(ang);
    const cs = Math.cos(ang);
    const b = pos.length / 3;
    push(sn * rInner, -hy, cs * rInner, 0, 0);
    push(sn * rOuter, -hy, cs * rOuter, 0, 0);
    push(sn * rOuter, hy, cs * rOuter, 0, 0);
    push(sn * rInner, hy, cs * rInner, 0, 0);
    if (winding > 0) idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    else idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  });
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** One plaque: a self-contained mesh+material (own emissiveMap, so it can't
 *  be instanced with its siblings). Owns its own tap-beat timeline
 *  (press-in, emissive pulse, haptic, navigate) rather than sharing one
 *  timeline across all three, so tapping one never disturbs the others. */
function Plaque({
  item, index, tilt, onDust,
}) {
  const meshRef = useRef();
  const materialRef = useRef();
  const locale = useSceneStore((s) => s.locale);
  const requestNavigation = useSceneStore((s) => s.requestNavigation);

  const label = t(item.labelKey, locale);
  // Wide enough texture for the longest label ("Create a Story", 14 chars)
  // at the bitmap font's default scale=2 without the center-crop clipping
  // that happens when textWidthPx > the texture's own width (confirmed
  // on-device: "Create a Story" rendered as "EATE A STO").
  const texture = useMemo(() => makeLabelTexture(label, 176, 40), [label]);

  // BACKLOG.md #9 (live feedback round 2): the plaque itself is now a
  // curved panel -- a thin slice of a cylinder wall at this plaque's own
  // radius (PLAQUE_RADII[index], since the stronger top/bottom taper means
  // each height sits at a different rock radius) -- rather than a flat
  // box, so it visibly follows the curve of the groove it rides in.
  const radius = PLAQUE_RADII[index];
  const arcLength = Math.min(PLAQUE_ARC_LENGTH, radius * 2.2); // cap so it can't wrap unreasonably far at small radii
  const thetaLength = arcLength / radius;

  // Solid curved tablet for this plaque. Outer face at `radius` (bumped proud
  // of the stone, carries the label). Inner face reaches down to the groove
  // FLOOR carved into the stone at this height, so the block visibly sits
  // WEDGED in its channel -- its sides disappear into the groove walls -- not
  // floating in front like a sheet. Thickness is derived per-plaque because
  // each height sits at a different rock radius, so the floor is at a
  // different depth for each.
  const grooveFloorR = naturalRadiusAtWorldY(PLAQUE_HEIGHTS[index]) * (1 - GROOVE_DEPTH_FRAC);
  const blockGeo = useMemo(
    () => makeArcBlock(grooveFloorR, radius, PLAQUE_HEIGHT_SIZE, thetaLength),
    [grooveFloorR, radius, thetaLength],
  );

  const state = useRef({ timeline: null, press: 0, emissive: EMISSIVE_IDLE });

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const s = state.current;
    if (s.timeline) s.timeline.tick(dt);
    if (meshRef.current) meshRef.current.position.z = -s.press;
    if (materialRef.current) materialRef.current.emissiveIntensity = s.emissive;
  });

  const onTap = (e) => {
    e.stopPropagation();
    const s = state.current;
    if (s.timeline && !s.timeline.done) return; // already mid-beat
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onDust(index);
    s.timeline = createTimeline([
      { at: 0, dur: PRESS_MS, ease: 'easeOutCubic', update: (v) => { s.press = v * PRESS_DEPTH; } },
      {
        at: PRESS_MS,
        dur: PRESS_MS * 1.5,
        update: (v) => { s.press = PRESS_DEPTH * (1 - v); },
      },
      { at: 0, dur: NAV_AT_MS, update: (v) => { s.emissive = EMISSIVE_IDLE + (EMISSIVE_PEAK - EMISSIVE_IDLE) * Math.sin(v * Math.PI); } },
      { at: NAV_AT_MS, call: () => { requestNavigation(item.route); } },
    ]);
  };

  return (
    <group
      position={[0, PLAQUE_HEIGHTS[index], 0]}
      rotation={[0, PLAQUE_AZIMUTHS[index], tilt]}
    >
      {/* The button is a SOLID curved tablet (makeArcBlock): real outer face
          carrying the label, an inner face, two flat end-cap sides, and
          top/bottom faces -- so it reads as a chunky stone block wedged in
          its groove, showing depth as it slides along the channel, rather
          than a paper-thin sheet. meshRef drives the press-in animation.
          The outer face is bumped OUT past the stone (PLAQUE_RADII adds
          PLAQUE_BUMP) so nothing occludes it; its inner face still tucks
          down into the groove for the wedged-in look. */}
      <mesh ref={meshRef} geometry={blockGeo} onClick={onTap}>
        {/* Light warm-grey stone face, lifted well above the dark boulder so
            the button reads as a distinct raised block; gold emissive is
            masked by the label texture so only the LETTERS glow. The label
            maps on the outer face (UVs 0..1 across arc x height); the side,
            inner, top and bottom faces carry the plaque color only. */}
        <meshStandardMaterial
          ref={materialRef}
          color="#c9bfac"
          roughness={0.7}
          metalness={0.05}
          emissive="#ffd27a"
          emissiveMap={texture}
          emissiveIntensity={EMISSIVE_IDLE}
        />
      </mesh>
      {/* Generous invisible hitbox, ~1.6x the plaque, so mobile taps land easily */}
      <mesh position={[0, 0, radius]} visible={false} onClick={onTap}>
        <boxGeometry args={[arcLength * PLAQUE_HITBOX_SCALE, PLAQUE_HEIGHT_SIZE * PLAQUE_HITBOX_SCALE, 0.3]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}

/** The crossroads stone (ART_SPEC §12): the app's real 3D menu, sunk into
 *  the island center so the camera's permanent lookAt keeps it on screen at
 *  every rotation. Boulder + moss are instanced/shared; each plaque needs
 *  its own draw call because each carries a different baked label texture. */
export function CrossroadsStone() {
  const plaqueGroupRef = useRef();
  const plaqueGroupInitRef = useRef(false);
  const dustRef = useRef();
  const dustState = useRef({ timeline: null, y: 1 });
  const ambientDustRef = useRef();

  const noiseTexture = useMemo(() => makeNoiseGrain('#8d8d85', 0.1), []);
  const boulderMaterial = useMemo(
    () => makeToonMaterial({ map: noiseTexture, color: '#8d8d85', rimStrength: 0.2 }),
    [noiseTexture],
  );
  // VISUAL_QUALITY_SPEC §5: organic shape warmth -- a perfect sphere reads
  // as a placeholder primitive, not a hand-carved boulder. BACKLOG.md #9:
  // squat/wide per the reference photo, with mild base-widen/top-narrow
  // and grooves recessed directly into the surface at each plaque height
  // (see shapeBoulderGeometry + the shared BOULDER_* constants above) --
  // a uniform XZ scale so the plaques, which orbit independently on every
  // side of a STATIC boulder, clear it at every angle.
  // heightSegments bumped from the low-poly-everywhere-else default 6 to 20
  // -- the groove dip is a narrow band (GROOVE_HALF_WIDTH_LOCAL) and needs
  // enough vertex rows to actually land some vertices inside it, otherwise
  // it silently carves nothing (confirmed live: at 9 segments the grooves
  // had zero visible effect and the plaques ended up buried in the
  // un-dented rock instead of sitting in a recessed channel).
  const boulderGeometry = useMemo(
    () => jitterVertices(shapeBoulderGeometry(new SphereGeometry(BOULDER_RADIUS, 48, 40)), BOULDER_RADIUS, 110),
    [],
  );

  const tilts = useMemo(() => {
    const rng = makeRng(100);
    return MENU.map(() => (rng() * 2 - 1) * ((4 * Math.PI) / 180));
  }, []);

  const mossMatrices = useMemo(() => {
    const rng = makeRng(101);
    const spots = [
      { angleDeg: 20, y: 0.55 }, { angleDeg: 150, y: 0.42 }, { angleDeg: 260, y: 0.62 }, // low ring on the body (above the sunk base)
      { angleDeg: 0, y: 2.3 }, // crown -- near the taller stone's top (was 2.0)
    ];
    return spots.map((spot) => {
      const a = (spot.angleDeg * Math.PI) / 180;
      // Hug the actual rock surface at each spot's height (derived, not a
      // hardcoded radius) so moss stays on the stone across profile changes.
      const r = spot.y > 2.0
        ? naturalRadiusAtWorldY(spot.y) * 0.7
        : naturalRadiusAtWorldY(spot.y) * 0.96;
      dummy.position.set(Math.sin(a) * r, spot.y, Math.cos(a) * r);
      dummy.rotation.set(rng() * Math.PI, rng() * Math.PI, 0);
      dummy.scale.set(1, 0.6, 1);
      dummy.updateMatrix();
      return dummy.matrix.clone();
    });
  }, []);

  // Moss + grass skirt: a dense ring of clustered spheres at world ground
  // level (y ~ 0) hugging the base circumference of the now-raised stone, so
  // the boulder reads as settled into the terrain rather than perching on it.
  // Mixed sizes + a mossy-to-grassy color spread, some flattened, jittered in
  // radius and height so the ring looks organic, not a collar.
  const baseSkirtMatrices = useMemo(() => {
    const rng = makeRng(202);
    const matrices = [];
    const CLUMPS = 30;
    const SPHERES_PER = 3;
    // Ring the skirt where the sunk stone crosses the ground plane (y=0):
    // find the rock radius at the local height that maps to world y=0.
    const localAtGround = (0 - BASE_LIFT - BOULDER_Y) / BOULDER_Y_SCALE;
    const groundTopT = Math.max(0, Math.min(1, (localAtGround / BOULDER_RADIUS + 1) / 2));
    const baseR = targetRadiusAt(groundTopT) * BOULDER_XZ_SCALE;
    for (let c = 0; c < CLUMPS; c += 1) {
      const ang = (c / CLUMPS) * Math.PI * 2 + (rng() * 2 - 1) * 0.1;
      const clumpR = baseR * (0.92 + rng() * 0.22); // straddle the base edge
      const cx = Math.sin(ang) * clumpR;
      const cz = Math.cos(ang) * clumpR;
      for (let i = 0; i < SPHERES_PER; i += 1) {
        const jA = rng() * Math.PI * 2;
        const jR = rng() * 0.22;
        const sxz = 0.55 + rng() * 0.6;
        const sy = 0.4 + rng() * 0.35;
        // Sit at ground level, base of the sphere near y=0 (a little sunken).
        dummy.position.set(
          cx + Math.cos(jA) * jR,
          0.02 + sy * 0.22 * 0.11,
          cz + Math.sin(jA) * jR,
        );
        dummy.rotation.set(0, rng() * Math.PI, 0);
        dummy.scale.set(sxz, sy, sxz);
        dummy.updateMatrix();
        matrices.push(dummy.matrix.clone());
      }
    }
    return matrices;
  }, []);
  const baseSkirtColors = useMemo(() => {
    const rng = makeRng(203);
    const moss = new Color('#5f8a3e');
    const grass = new Color('#7ba84f');
    return baseSkirtMatrices.map(() => moss.clone().lerp(grass, rng()));
  }, [baseSkirtMatrices]);

  const dustGeometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(DUST_COUNT * 3), 3));
    return geo;
  }, []);

  const spawnDust = (index) => {
    const rng = makeRng(Date.now() % 1000);
    const positions = dustGeometry.attributes.position;
    // Buttons are fanned in azimuth (PLAQUE_AZIMUTHS), so spawn on +Z then
    // rotate the point around Y to that button's face -- otherwise the puff
    // appears off to the side of the button it belongs to.
    const az = PLAQUE_AZIMUTHS[index];
    const cos = Math.cos(az);
    const sin = Math.sin(az);
    for (let i = 0; i < DUST_COUNT; i++) {
      const lx = (rng() - 0.5) * 0.5;
      const lz = PLAQUE_RADII[index] + 0.05;
      positions.setXYZ(
        i,
        lx * cos + lz * sin,
        PLAQUE_HEIGHTS[index] + (rng() - 0.5) * 0.15,
        -lx * sin + lz * cos,
      );
    }
    positions.needsUpdate = true;
    dustState.current.timeline = createTimeline([
      { at: 0, dur: 350, ease: 'easeOutCubic', update: (v) => { dustState.current.y = 1 - v; } },
    ]);
  };

  // BACKLOG.md #9 ambient dust: small pool that keeps respawning at the
  // groove heights (in the plaque column's own rotating frame, so it rides
  // along with the buttons) for as long as the column is actively turning
  // to catch up with the camera -- same burst-particle-pool convention as
  // KolobokParticles.jsx, just continuous rather than one-shot.
  const ambientDustGeometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(AMBIENT_DUST_COUNT * 3), 3));
    return geo;
  }, []);
  const ambientDustState = useRef({
    particles: new Array(AMBIENT_DUST_COUNT).fill(0).map(() => ({
      t: AMBIENT_DUST_LIFE + 1, x: 0, y: 0, r: 0.4, az: 0,
    })),
    nextIn: 0,
  });

  useFrame(({ camera }, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;

    let angularSpeed = 0;
    if (plaqueGroupRef.current) {
      if (!plaqueGroupInitRef.current) {
        // Snap to orbit.angle on the very first tick instead of easing up
        // from the group's default rotation (0). orbit is a module-level
        // singleton that outlives this component's own mount -- after any
        // earlier camera movement this session, it can already be pointing
        // somewhere other than 0 by the time this remounts, and easing the
        // FRESH group up to match left the buttons' hitboxes visibly out of
        // sync with where they appeared on screen for about a second.
        plaqueGroupRef.current.rotation.y = orbit.angle;
        plaqueGroupInitRef.current = true;
      }
      const d = angleDelta(plaqueGroupRef.current.rotation.y, orbit.angle);
      const step = d * Math.min(1, FACE_LERP_RATE * dt);
      plaqueGroupRef.current.rotation.y += step;
      angularSpeed = Math.abs(step) / Math.max(dt, 0.0001);
    }

    const ds = dustState.current;
    if (ds.timeline) ds.timeline.tick(dt);
    if (dustRef.current) {
      dustRef.current.visible = !!ds.timeline && !ds.timeline.done;
      dustRef.current.material.opacity = Math.max(0, ds.y);
    }

    // Ambient joint dust: spawn while actively moving, let existing puffs
    // finish their fade even after motion stops.
    const ambS = ambientDustState.current;
    if (angularSpeed > MOVING_THRESHOLD) {
      ambS.nextIn -= dt;
      if (ambS.nextIn <= 0) {
        ambS.nextIn = AMBIENT_DUST_SPAWN_GAP;
        const dead = ambS.particles.find((p) => p.t > AMBIENT_DUST_LIFE) ?? ambS.particles[0];
        const pick = Math.floor(Math.random() * PLAQUE_HEIGHTS.length);
        dead.t = 0;
        dead.x = (Math.random() - 0.5) * 0.4;
        dead.y = PLAQUE_HEIGHTS[pick];
        dead.r = PLAQUE_RADII[pick];
        dead.az = PLAQUE_AZIMUTHS[pick];
      }
    }
    if (ambientDustRef.current) {
      const positions = ambientDustGeometry.attributes.position;
      let anyAlive = false;
      ambS.particles.forEach((p, i) => {
        if (p.t <= AMBIENT_DUST_LIFE) {
          anyAlive = true;
          p.t += dt;
          const f = p.t / AMBIENT_DUST_LIFE;
          // Spawn on +Z then rotate to the button's fanned azimuth, matching
          // where its plaque actually sits (see PLAQUE_AZIMUTHS / spawnDust).
          const lx = p.x;
          const lz = p.r + 0.05 + f * 0.15;
          const az = p.az ?? 0;
          positions.setXYZ(
            i,
            lx * Math.cos(az) + lz * Math.sin(az),
            p.y - f * 0.12,
            -lx * Math.sin(az) + lz * Math.cos(az),
          );
        } else {
          positions.setXYZ(i, 0, -10, 0);
        }
      });
      positions.needsUpdate = true;
      ambientDustGeometry.computeBoundingSphere();
      ambientDustRef.current.visible = anyAlive;
    }
  });

  return (
    <group position={[0, 0, 0]}>
      {/* Moss + grass skirt hugging where the (now-raised) stone meets the
          ground, at world ground level -- NOT lifted with the stone, so it
          reads as terrain the boulder is settled into. */}
      <instancedMesh
        args={[undefined, undefined, baseSkirtMatrices.length]}
        ref={(mesh) => {
          if (!mesh) return;
          baseSkirtMatrices.forEach((m, i) => mesh.setMatrixAt(i, m));
          mesh.instanceMatrix.needsUpdate = true;
          baseSkirtColors.forEach((c, i) => mesh.setColorAt(i, c));
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }}
      >
        <sphereGeometry args={[0.22, 8, 6]} />
        <meshStandardMaterial roughness={1} />
      </instancedMesh>

      {/* The stone assembly (boulder + buttons + rock moss + dust), sunk by
          BASE_LIFT (negative) so the base tucks into the ground skirt above
          and the lowest button clears the terrain. Everything inside shares
          this offset, so the groove/plaque math is untouched. */}
      <group position={[0, BASE_LIFT, 0]}>
      {/* Position/scale MUST match BOULDER_Y/BOULDER_Y_SCALE/BOULDER_XZ_SCALE
          above exactly -- those constants drive the groove/plaque-radius
          math, so a hardcoded mismatch here is what caused the plaques to
          end up buried in the rock the first time this was reworked. */}
      <mesh
        position={[0, BOULDER_Y, 0]}
        scale={[BOULDER_XZ_SCALE, BOULDER_Y_SCALE, BOULDER_XZ_SCALE]}
        material={boulderMaterial}
        geometry={boulderGeometry}
      />

      <instancedMesh
        args={[undefined, undefined, mossMatrices.length]}
        ref={(mesh) => {
          if (!mesh) return;
          mossMatrices.forEach((m, i) => mesh.setMatrixAt(i, m));
          mesh.instanceMatrix.needsUpdate = true;
        }}
      >
        <sphereGeometry args={[0.18, 8, 6]} />
        <meshStandardMaterial color="#6f9b52" roughness={0.9} />
      </instancedMesh>

      {/* BACKLOG.md #9: the stone above is static -- only this column
          (the three plaques + their dust) orbits to keep facing the
          camera, riding along the groove rings rather than the whole
          boulder yawing. */}
      <group ref={plaqueGroupRef}>
        {MENU.map((item, i) => (
          <Plaque key={item.id} item={item} index={i} tilt={tilts[i]} onDust={spawnDust} />
        ))}

        {/* Dark accent: a SHORT arc (not a full ring) sitting just behind
            each plaque's recessed groove floor, a hair smaller in radius so
            it reads as a shadow line peeking out past the button edges. Lives
            INSIDE this rotating group so it tracks the buttons as the column
            yaws to face the camera. Each is wrapped in a [0, azimuth, 0]
            group matching its plaque's PLAQUE_AZIMUTHS fan, so the shadow
            stays directly behind its button now that the three are spread
            across distinct faces rather than stacked. The inner mesh's arc
            sweeps from local angle 0, so rotation.z = PI/2 - arc/2 (before
            the PI/2 X-tilt in XYZ order) centers the arc; the outer group's
            Y rotation then swings that centered arc to the button's azimuth.
            Arc is ACCENT_ARC_WIDEN wider than the plaque so it shows on both
            sides. */}
        {PLAQUE_HEIGHTS.map((height, i) => {
          const accentArc = Math.min(Math.PI * 1.9, PLAQUE_THETAS[i] * ACCENT_ARC_WIDEN);
          return (
            // eslint-disable-next-line react/no-array-index-key
            <group key={i} rotation={[0, PLAQUE_AZIMUTHS[i], 0]}>
              <mesh
                position={[0, height, 0]}
                rotation={[Math.PI / 2, 0, Math.PI / 2 - accentArc / 2]}
              >
                <torusGeometry args={[PLAQUE_RADII[i] - 0.035, 0.02, 6, 20, accentArc]} />
                <meshStandardMaterial color="#403c36" roughness={1} />
              </mesh>
            </group>
          );
        })}

        <points ref={dustRef} geometry={dustGeometry} visible={false}>
          <pointsMaterial color={DUST_COLOR} size={0.05} transparent opacity={0} depthWrite={false} />
        </points>
        <points ref={ambientDustRef} geometry={ambientDustGeometry} visible={false}>
          <pointsMaterial color={DUST_COLOR} size={0.04} transparent opacity={0.6} depthWrite={false} />
        </points>
      </group>
      </group>
    </group>
  );
}
