import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import * as Haptics from 'expo-haptics';
import {
  BufferAttribute, BufferGeometry, Color, Object3D, SphereGeometry, TorusGeometry,
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
const PLAQUE_HEIGHTS = [1.22, 0.72, 0.22];
const PLAQUE_HEIGHT_SIZE = 0.39; // was 0.26 (+50%)
const PLAQUE_HITBOX_SCALE = 1.6;
const PLAQUE_ARC_LENGTH = 0.87; // was 0.58 (+50%)

// The boulder's own mesh transform, pulled out to module constants so both
// the geometry shaper below AND the per-plaque radius calculator can share
// the exact same taper math -- if they drifted independently, the "carved
// groove" and the boulder's own dip at that same spot could disagree.
const BOULDER_RADIUS = 0.85;
const BOULDER_Y = 0.72;
const BOULDER_Y_SCALE = 0.85; // squat, not tall -- was 1.6
const BOULDER_XZ_SCALE = 1.0; // ~2x the old 0.68, per live feedback "twice wider"
// Live feedback round 4: base should be wider than the MIDDLE (not just
// wider than the top) -- a plain widen-multiplier on the sphere's own
// natural radius can't do that, since the sphere's natural radius is
// ALREADY largest at the equator (topT=0.5) and shrinks toward both
// poles, so even a strong multiplier at the very bottom pole (where the
// natural radius is shrinking toward 0) can't out-grow the untouched
// equator. Instead: define the actual TARGET world radius directly at a
// few control heights (a real lathe-style profile -- wide bulge low down,
// narrower waist at the middle, narrower still near the top, pinching to
// 0 at the poles like any closed rounded shape), then derive whatever
// per-vertex widen multiplier reproduces that against the sphere's own
// natural (pre-widen) radius at each height.
const RADIUS_PROFILE = [
  { topT: 0, radius: 0 }, // bottom pole
  { topT: 0.16, radius: 1.05 }, // just above the base -- the bulge, wider than the waist below
  { topT: 0.5, radius: 0.78 }, // waist/middle -- narrower than the base bulge
  { topT: 0.86, radius: 0.55 }, // near the top -- narrower still
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
const GROOVE_HALF_WIDTH_LOCAL = 0.2; // in the sphere's own local Y units -- wide enough for the taller (+50%) plaques

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

// Each plaque's own orbit radius: the rock's natural radius at that height,
// recessed by the same GROOVE_DEPTH_FRAC the geometry dip carves in below
// -- so the curved button sits flush with the channel floor, not floating
// in front of or clipping into the surrounding stone.
const PLAQUE_RADII = PLAQUE_HEIGHTS.map((h) => naturalRadiusAtWorldY(h) * (1 - GROOVE_DEPTH_FRAC));

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

/** One plaque: a self-contained mesh+material (own emissiveMap, so it can't
 *  be instanced with its siblings -- see Sky/Vegetation for where instancing
 *  *does* apply). Owns its own tap-beat timeline (ANIMATION_SPEC-style:
 *  press-in, emissive pulse, haptic, navigate) rather than sharing one
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
    <group position={[0, PLAQUE_HEIGHTS[index], 0]} rotation={[0, 0, tilt]}>
      <mesh ref={meshRef} onClick={onTap}>
        {/* thetaStart centers the arc on the group's local +Z (theta=0,
            same sin/cos convention as pointOnCircle everywhere else in
            this scene), matching where the flat plaque used to sit. */}
        <cylinderGeometry args={[radius, radius, PLAQUE_HEIGHT_SIZE, 14, 1, true, -thetaLength / 2, thetaLength]} />
        <meshStandardMaterial
          ref={materialRef}
          color="#7a7a72"
          roughness={0.85}
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
    () => jitterVertices(shapeBoulderGeometry(new SphereGeometry(BOULDER_RADIUS, 12, 20)), BOULDER_RADIUS, 110),
    [],
  );

  const tilts = useMemo(() => {
    const rng = makeRng(100);
    return MENU.map(() => (rng() * 2 - 1) * ((4 * Math.PI) / 180));
  }, []);

  const mossMatrices = useMemo(() => {
    const rng = makeRng(101);
    const spots = [
      { angleDeg: 20, y: 0.1 }, { angleDeg: 150, y: 0.05 }, { angleDeg: 260, y: 0.15 }, // base ring
      { angleDeg: 0, y: 1.32 }, // crown -- boulder is now squat, was 2.05
    ];
    return spots.map((spot) => {
      const a = (spot.angleDeg * Math.PI) / 180;
      const r = spot.y > 1.1 ? 0.15 : 0.75;
      dummy.position.set(Math.sin(a) * r, spot.y, Math.cos(a) * r);
      dummy.rotation.set(rng() * Math.PI, rng() * Math.PI, 0);
      dummy.scale.set(1, 0.6, 1);
      dummy.updateMatrix();
      return dummy.matrix.clone();
    });
  }, []);

  const dustGeometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(DUST_COUNT * 3), 3));
    return geo;
  }, []);

  const spawnDust = (index) => {
    const rng = makeRng(Date.now() % 1000);
    const positions = dustGeometry.attributes.position;
    for (let i = 0; i < DUST_COUNT; i++) {
      positions.setXYZ(
        i,
        (rng() - 0.5) * 0.5,
        PLAQUE_HEIGHTS[index] + (rng() - 0.5) * 0.15,
        PLAQUE_RADII[index] + 0.05,
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
      t: AMBIENT_DUST_LIFE + 1, x: 0, y: 0, r: 0.4,
    })),
    nextIn: 0,
  });

  useFrame(({ camera }, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;

    let angularSpeed = 0;
    if (plaqueGroupRef.current) {
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
          positions.setXYZ(i, p.x, p.y - f * 0.12, p.r + 0.05 + f * 0.15);
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

      {/* BACKLOG.md #9: a dark accent ring sitting just BEHIND each groove's
          recessed floor (a bit smaller than PLAQUE_RADII[i], not the same
          radius -- live feedback: at the same radius it z-fought/overlapped
          the button itself instead of reading as a shadow line peeking out
          from behind it). Each height has its own radius now (the bulge
          profile means they're no longer all the same), so these are three
          individual meshes rather than one shared instancedMesh (which
          can't vary radius per instance). */}
      {PLAQUE_HEIGHTS.map((height, i) => (
        <mesh
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          position={[0, height, 0]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <torusGeometry args={[PLAQUE_RADII[i] - 0.035, 0.02, 6, 24]} />
          <meshStandardMaterial color="#403c36" roughness={1} />
        </mesh>
      ))}

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

        <points ref={dustRef} geometry={dustGeometry} visible={false}>
          <pointsMaterial color={DUST_COLOR} size={0.05} transparent opacity={0} depthWrite={false} />
        </points>
        <points ref={ambientDustRef} geometry={ambientDustGeometry} visible={false}>
          <pointsMaterial color={DUST_COLOR} size={0.04} transparent opacity={0.6} depthWrite={false} />
        </points>
      </group>
    </group>
  );
}
