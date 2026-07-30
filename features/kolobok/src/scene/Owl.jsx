import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber/native';
import * as Haptics from 'expo-haptics';
import { ConeGeometry, Object3D, SphereGeometry } from 'three';
import { atmosphereLive } from '../state/sceneStore';
import { mergeColoredParts } from './builders/mergeColoredParts';
import { makeToonMaterial } from './materials/toonMaterial';
import { eggMotion } from './easterEggs';
import { SPRUCE_TOP_MATRICES } from './Vegetation';

const dummy = new Object3D();

// ART_SPEC §14 owl: body sphere r=0.11 scaled (1, 1.25, 0.9) `#8a7154`,
// belly patch `#c4ad8c`, two ear tufts (tiny cones), eyes: white spheres
// r=0.038 + pupils, beak cone `#d9a441`. Head is a SEPARATE sphere r=0.085
// stacked on the body. Spawns from spruce canopy tops.
//
// Live feedback: two-stage interaction -- pop out and look around (restored
// from the original design) until TAPPED, which triggers the wing flap,
// then it ducks away and disappears, same ending as before. This component
// now owns the ENTIRE phase progression itself (eggMotion.owlPhase/
// owlPhaseT), since a tap-triggered interrupt mid-lookaround doesn't fit a
// fixed linear timeline -- easterEggs.js's runOwl only ever sets the INITIAL
// 'popping' phase; every transition after that happens here.
const FLAP_HZ = 4.5;
const FLAP_MAX = (55 * Math.PI) / 180;
// Live feedback: "appear smoothly" -- was a raw linear ramp over 250ms,
// which read as an abrupt snap; eased + a touch longer now.
const POP_S = 0.4;
const FLAP_S = 1.4; // "an animation for 1-2 seconds"
// Live feedback: two DIFFERENT endings now -- if never tapped, it visibly
// flies back off into the canopy (FLYAWAY_*); if tapped, it flaps then
// FADES (opacity, not scale) away in place (FADEOUT_S).
const FLYAWAY_S = 1.2;
const FLYAWAY_RISE = 0.55; // peak extra height above its perch mid-flight
const FLYAWAY_DRIFT = 0.3; // peak sideways drift mid-flight
const FADEOUT_S = 0.4;
const LOOKAROUND_MAX_S = 3; // auto-flies-away if never tapped, same as the original design
const LOOKAROUND_SWIVEL_HZ = 0.35;
const LOOKAROUND_SWIVEL_MAX = (35 * Math.PI) / 180;
const OWL_HIT_R = 0.22; // generous invisible tap target (mobile)
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
// Live feedback: "the owl appears with its wings spread, and nothing
// happens... it should appear without wings" -- rotation.z=0 (the flap's
// own rest/center value) is the wing geometry's OWN "spread out to the
// side" pose (see wingGeometry's own comment), so sitting at flap=0 through
// the whole look-around read as wings permanently out. Folded now tucks
// each wing down against the body except during the 'flapping' phase.
const WING_FOLD_Z = (65 * Math.PI) / 180;

/** Owl (EASTER_EGGS.md §2 owl): hidden until a spruce is triple-tapped,
 *  then pops from that tree's canopy top (SPRUCE_TOP_MATRICES anchor) and
 *  looks around until TAPPED (on the owl itself), which triggers the wing
 *  flap, then it ducks back down. eggMotion.owlTreeIdx/owlPhase/owlPhaseT
 *  are the entire interface -- Vegetation.jsx's onTreeGrab drives the
 *  INITIAL trigger via eggManager.tapSpruce() (easterEggs.js's runOwl seeds
 *  owlPhase='popping'), but every phase transition after that (including the
 *  tap-to-flap below) is owned entirely by this component. */
export function Owl() {
  const rootRef = useRef();
  const headRef = useRef();
  const leftWingRef = useRef();
  const rightWingRef = useRef();

  const bodyGeometry = useMemo(() => mergeColoredParts([
    { geometry: new SphereGeometry(0.11, 10, 8), color: '#8a7154', scale: [1, 1.25, 0.9], position: [0, 0, 0] },
    { geometry: new SphereGeometry(0.08, 8, 6), color: '#c4ad8c', scale: [0.8, 1, 0.5], position: [0, -0.02, 0.08] },
  ]), []);

  const headGeometry = useMemo(() => mergeColoredParts([
    { geometry: new SphereGeometry(0.085, 10, 8), color: '#8a7154', position: [0, 0, 0] },
    { geometry: new ConeGeometry(0.014, 0.05, 6), color: '#8a7154', position: [0.03, 0.075, 0], rotation: [0, 0, -0.35] },
    { geometry: new ConeGeometry(0.014, 0.05, 6), color: '#8a7154', position: [-0.03, 0.075, 0], rotation: [0, 0, 0.35] },
    { geometry: new ConeGeometry(0.018, 0.045, 6), color: '#d9a441', position: [0, -0.02, 0.08], rotation: [Math.PI / 2, 0, 0] },
  ]), []);

  const eyeGeometry = useMemo(() => mergeColoredParts([
    { geometry: new SphereGeometry(0.038, 8, 6), color: '#f4f0e6', position: [0.032, 0.01, 0.06] },
    { geometry: new SphereGeometry(0.038, 8, 6), color: '#f4f0e6', position: [-0.032, 0.01, 0.06] },
  ]), []);

  // A single flattened, elongated sphere per wing -- simple silhouette in
  // keeping with the rest of the owl's plain-primitive construction. Offset
  // outward from its own group's pivot (the "shoulder"), so rotating the
  // GROUP around Z swings the wingtip up and down like a real flap.
  const wingGeometry = useMemo(() => {
    const geo = new SphereGeometry(0.095, 8, 6);
    geo.scale(1.5, 0.16, 0.65);
    geo.translate(0.1, 0, 0);
    return geo;
  }, []);

  // Live feedback: the tap ending "fades away smoothly" -- needs every
  // owl material transparent so opacity can be driven uniformly per-frame
  // below (makeToonMaterial doesn't expose transparent/opacity as
  // constructor params, set directly on each returned material instead).
  const materials = useMemo(() => {
    const m = {
      body: makeToonMaterial({ vertexColors: true, color: '#8a7154', rimStrength: 0.35 }),
      head: makeToonMaterial({ vertexColors: true, color: '#8a7154', rimStrength: 0.35 }),
      eyes: makeToonMaterial({ vertexColors: true, color: '#f4f0e6', rimStrength: 0 }),
      wing: makeToonMaterial({ color: '#6b5540', rimStrength: 0.35 }),
    };
    Object.values(m).forEach((mat) => { mat.transparent = true; });
    return m;
  }, []);

  const flapPhase = useRef(0);
  const { camera } = useThree();

  const onOwlTap = (e) => {
    e.stopPropagation();
    if (eggMotion.owlPhase !== 'lookaround') return; // already flapping/ducking, or not out yet
    eggMotion.owlPhase = 'flapping';
    eggMotion.owlPhaseT = 0;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const active = eggMotion.owlTreeIdx >= 0;
    if (!rootRef.current) return;

    rootRef.current.visible = active;
    if (!active) return;

    const anchor = SPRUCE_TOP_MATRICES[eggMotion.owlTreeIdx];
    if (anchor) {
      dummy.matrix.copy(anchor);
      dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
      rootRef.current.position.copy(dummy.position);
    }

    // Phase progression is entirely local to this component (see
    // eggMotion.owlPhase's own comment) -- popping (pop in) -> lookaround
    // (head swivels, tappable) -> EITHER flyaway (never tapped: visibly
    // flies back off into the canopy) OR flapping -> fadeout (tapped: flaps,
    // then opacity-fades away in place). Live feedback bug fix: this used to
    // destructure `const { phase } = eggMotion`, but the field is actually
    // named `owlPhase` -- `phase` was always undefined, so NONE of these
    // branches ever ran (owl snapped to full size instantly, never swiveled,
    // and taps did nothing since owlPhase never actually reached
    // 'lookaround' either). Reading eggMotion.owlPhase directly instead.
    eggMotion.owlPhaseT += dt;
    const phase = eggMotion.owlPhase;
    let popT = 1;
    let headYaw = 0;
    let flapAmp = 0;
    let flyOffsetX = 0;
    let flyOffsetY = 0;
    let opacity = 1;

    if (phase === 'popping') {
      popT = easeOutCubic(Math.min(1, eggMotion.owlPhaseT / POP_S));
      if (eggMotion.owlPhaseT >= POP_S) { eggMotion.owlPhase = 'lookaround'; eggMotion.owlPhaseT = 0; }
    } else if (phase === 'lookaround') {
      headYaw = Math.sin(eggMotion.owlPhaseT * LOOKAROUND_SWIVEL_HZ * Math.PI * 2) * LOOKAROUND_SWIVEL_MAX;
      if (eggMotion.owlPhaseT >= LOOKAROUND_MAX_S) { eggMotion.owlPhase = 'flyaway'; eggMotion.owlPhaseT = 0; }
    } else if (phase === 'flapping') {
      flapAmp = 1;
      if (eggMotion.owlPhaseT >= FLAP_S) { eggMotion.owlPhase = 'fadeout'; eggMotion.owlPhaseT = 0; }
    } else if (phase === 'flyaway') {
      // Never tapped: it visibly flies off (rises + drifts sideways,
      // flapping the whole time) then arcs back down and shrinks away into
      // the canopy, rather than just shrinking in place.
      const ft = Math.min(1, eggMotion.owlPhaseT / FLYAWAY_S);
      const arc = Math.sin(ft * Math.PI); // 0 -> 1 -> 0: away, then back down
      flyOffsetY = arc * FLYAWAY_RISE;
      flyOffsetX = arc * FLYAWAY_DRIFT;
      flapAmp = 1;
      popT = ft < 0.8 ? 1 : Math.max(0.001, 1 - (ft - 0.8) / 0.2);
      if (eggMotion.owlPhaseT >= FLYAWAY_S) { eggMotion.owlPhase = 'idle'; eggMotion.owlTreeIdx = -1; }
    } else if (phase === 'fadeout') {
      // Tapped: stays put, wings settle, opacity fades to nothing.
      opacity = Math.max(0, 1 - eggMotion.owlPhaseT / FADEOUT_S);
      if (eggMotion.owlPhaseT >= FADEOUT_S) { eggMotion.owlPhase = 'idle'; eggMotion.owlTreeIdx = -1; }
    }

    // Pops UP out of the canopy as popT climbs (starts a touch lower/
    // smaller, inside the foliage, rises to its perched scale/height);
    // flyOffsetX/Y add the flyaway phase's own rise-and-drift on top.
    rootRef.current.scale.setScalar(Math.max(0.001, popT));
    rootRef.current.position.y += 0.05 + popT * 0.1 + flyOffsetY;
    rootRef.current.position.x += flyOffsetX;

    // "It should look in the camera" -- face is on local +Z (see
    // eyeGeometry/beak's own +Z offsets above), so yaw the whole owl
    // toward wherever the camera currently is; the head group swivels an
    // EXTRA look-around wobble on top of that base orientation.
    const dx = camera.position.x - rootRef.current.position.x;
    const dz = camera.position.z - rootRef.current.position.z;
    rootRef.current.rotation.y = Math.atan2(dx, dz);
    if (headRef.current) headRef.current.rotation.y = headYaw;

    // Wing flap: folded through the look-around, extended+flapping during
    // the tap-triggered flap AND the whole flyaway (a bird flying away
    // should be flapping).
    flapPhase.current += dt * FLAP_HZ * Math.PI * 2;
    const wingBase = flapAmp > 0 ? 0 : WING_FOLD_Z;
    const flap = Math.sin(flapPhase.current) * FLAP_MAX * flapAmp;
    if (leftWingRef.current) leftWingRef.current.rotation.z = wingBase + flap;
    if (rightWingRef.current) rightWingRef.current.rotation.z = -wingBase - flap;

    materials.body.opacity = opacity;
    materials.head.opacity = opacity;
    materials.eyes.opacity = opacity;
    materials.wing.opacity = opacity;

    const isNight = atmosphereLive.windowGlow > 0.5;
    materials.eyes.emissive.set(isNight ? '#ffd27a' : '#000000');
  });

  return (
    <group ref={rootRef} visible={false}>
      <mesh geometry={bodyGeometry} material={materials.body} />
      <group ref={headRef} position={[0, 0.16, 0.02]}>
        <mesh geometry={headGeometry} material={materials.head} />
        <mesh geometry={eyeGeometry} material={materials.eyes} />
      </group>
      <group ref={leftWingRef} position={[-0.095, 0.02, -0.01]}>
        <mesh geometry={wingGeometry} material={materials.wing} scale={[-1, 1, 1]} />
      </group>
      <group ref={rightWingRef} position={[0.095, 0.02, -0.01]}>
        <mesh geometry={wingGeometry} material={materials.wing} />
      </group>
      {/* Generous invisible hitbox -- live feedback: "the wing animation
          should trigger when the owl is tapped again after it appears". */}
      <mesh position={[0, 0.1, 0]} visible={false} onPointerDown={onOwlTap}>
        <sphereGeometry args={[OWL_HIT_R, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}
