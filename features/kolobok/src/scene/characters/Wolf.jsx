import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import { CapsuleGeometry, ConeGeometry, SphereGeometry } from 'three';
import { mergeColoredParts } from '../builders/mergeColoredParts';
import { encounterMotion } from '../../state/sceneStore';
import { makeToonMaterial } from '../materials/toonMaterial';
import { BlobShadow } from '../BlobShadow';
import { initWetShakeState, tickWetShake } from '../wetShake';
import { initGreetWaveState, tickGreetWave } from '../greetWave';

const FUR = '#7d8a96';
const BELLY = '#aab4bd';
const SNOUT_TIP = '#3d444b';

const HOWL_INTERVAL = 12;

/** Wolf (ART_SPEC §3, height 1.5): body/legs/tail merge into one static
 *  mesh (no body-level idle motion beyond a fixed forward-leaning stance);
 *  head/snout/ears/eyes merge into a second mesh riding its own transform
 *  group, since the head sweeps and the muzzle tilts up to howl
 *  (ANIMATION_SPEC §3) as one rigid unit. 2 draw calls total. */
export function Wolf({ mode, isActiveZone }) {
  const rootRef = useRef();
  const headGroupRef = useRef();
  const tailRef = useRef();

  const bodyGeometry = useMemo(() => mergeColoredParts([
    // Torso, forward-leaning.
    { geometry: new CapsuleGeometry(0.24, 0.55, 3, 8), color: FUR, position: [0, 0.5, 0], rotation: [Math.PI / 2 - 0.15, 0, 0] },
    { geometry: new SphereGeometry(0.2, 8, 6), color: BELLY, position: [0, 0.42, 0.16], scale: [0.85, 0.9, 0.6] },
    // Legs (4, simple stubs -- mostly hidden under the body silhouette).
    ...[[0.13, 0.14], [-0.13, 0.14], [0.13, -0.16], [-0.13, -0.16]].map(([x, z]) => ({
      geometry: new CapsuleGeometry(0.06, 0.32, 2, 6), color: FUR, position: [x, 0.2, z],
    })),
    // Tail is NOT merged here -- it gets its own group (see JSX below) so it
    // can wag independently for the tap-greeting wave (live feedback).
  ]), []);

  const headGeometry = useMemo(() => mergeColoredParts([
    { geometry: new SphereGeometry(0.17, 10, 8), color: FUR, position: [0, 0, 0] },
    { geometry: new SphereGeometry(0.09, 8, 6), color: SNOUT_TIP, position: [0, -0.04, 0.19], scale: [0.8, 0.65, 1.3] },
    { geometry: new SphereGeometry(0.022, 6, 6), color: '#1a1a1a', position: [0.075, 0.05, 0.14] },
    { geometry: new SphereGeometry(0.022, 6, 6), color: '#1a1a1a', position: [-0.075, 0.05, 0.14] },
    { geometry: new ConeGeometry(0.07, 0.16, 6), color: FUR, position: [0.1, 0.19, -0.02], rotation: [0, 0, -0.2] },
    { geometry: new ConeGeometry(0.07, 0.16, 6), color: FUR, position: [-0.1, 0.19, -0.02], rotation: [0, 0, 0.2] },
  ]), []);

  const materials = useMemo(() => ({
    body: makeToonMaterial({ vertexColors: true, color: FUR, rimStrength: 0.35 }),
    head: makeToonMaterial({ vertexColors: true, color: FUR, rimStrength: 0.35 }),
    tail: makeToonMaterial({ color: FUR, rimStrength: 0.35 }),
  }), []);

  const state = useRef({
    sweepPhase: Math.random() * Math.PI * 2,
    nextHowlIn: 4 + Math.random() * 4,
    howlTimeline: 0, // -1 idle, 0..1 progress through the 600/900/500 sequence when active
    howling: false,
    shakeT: 1,
    approachZ: 0, snapT: 0,
    wetShake: initWetShakeState(),
    greetWave: initGreetWaveState(),
  });

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const s = state.current;
    const activeMult = isActiveZone ? 1.3 : 1;

    // --- Slow head sweep ±25° over 4s ---
    s.sweepPhase += dt * (Math.PI * 2) / 4;
    const sweepYaw = Math.sin(s.sweepPhase) * ((25 * Math.PI) / 180);

    // --- Wet shake-off (BACKLOG.md #1), idle only ---
    const wetShake = tickWetShake(s.wetShake, dt, mode === 'idle');

    // --- Howl every ~12s: muzzle up 35° over 600ms, hold 900ms, down 500ms ---
    if (mode === 'idle') {
      if (!s.howling) {
        s.nextHowlIn -= dt * activeMult * (isActiveZone ? 2 : 1); // "interval halves" when active (ANIMATION_SPEC §9)
        if (s.nextHowlIn <= 0) {
          s.howling = true;
          s.howlTimeline = 0;
          s.nextHowlIn = HOWL_INTERVAL;
        }
      } else {
        s.howlTimeline += dt * 1000; // ms
        if (s.howlTimeline > 600 + 900 + 500) { s.howling = false; s.howlTimeline = 0; }
      }
    }
    let howlPitch = 0;
    if (s.howling) {
      if (s.howlTimeline < 600) howlPitch = (s.howlTimeline / 600) * ((35 * Math.PI) / 180);
      else if (s.howlTimeline < 1500) howlPitch = (35 * Math.PI) / 180;
      else howlPitch = (1 - (s.howlTimeline - 1500) / 500) * ((35 * Math.PI) / 180);
    }

    // --- Encounter beat: approach 0.6, react = a lunging ARC jump (forward
    // + up + down, not a flat slide) that overshoots and misses, head shake
    // ±10° twice on landing ---
    const isMine = encounterMotion.zoneId === 'wolf';
    if (isMine && mode === 'encounter') {
      // Only ramp during 'approach' -- the shared beat REUSES phaseT for
      // its 'react' step too (resetting 0->1 again), so recomputing
      // approachZ from it unconditionally through the whole 'encounter'
      // mode snapped the wolf back to 0 the instant react began, before
      // the lunge's own arc had ramped up to cover it. Holding steady here
      // (at whatever approach left it, normally 0.6) lets the lunge arc be
      // the only thing that moves on top of it during react.
      if (encounterMotion.phase === 'approach') s.approachZ = 0.6 * encounterMotion.phaseT;
      s.snapT = encounterMotion.phase === 'react' ? encounterMotion.phaseT : 0;
    } else if (isMine && mode === 'retreat') {
      s.approachZ = 0.6 * (1 - encounterMotion.phaseT);
      s.snapT = 0;
    } else if (!isMine) {
      s.approachZ = 0;
      s.snapT = 0;
    }
    const snapPhase = Math.min(s.snapT, 1);
    const snapZ = Math.sin(snapPhase * Math.PI) * 0.28;
    const snapY = Math.sin(snapPhase * Math.PI) * 0.22;

    // --- Tap greeting (live feedback): tail wags side to side for ~2.6s
    // right as the encounter starts -- Wolf/Fox share their tails for this
    // rather than adding a new limb. Own fixed timer, independent of the
    // (much shorter) approach/react phase timing above. ---
    const waveEnv = tickGreetWave(s.greetWave, dt, isMine, mode);
    const tailWag = waveEnv > 0 ? Math.sin(s.greetWave.t * Math.PI * 2 * 2.2) * ((30 * Math.PI) / 180) * waveEnv : 0;
    // Head shake only once he's landed (back half of the arc), not while
    // mid-air -- a wolf mid-leap doesn't shake its head.
    const shakeYaw = snapPhase > 0.6 ? Math.sin((snapPhase - 0.6) / 0.4 * Math.PI * 4) * ((10 * Math.PI) / 180) : 0;

    const pulse = isActiveZone && mode === 'idle' ? 1 + Math.sin(Date.now() / 500) * 0.025 : 1;

    if (rootRef.current) {
      rootRef.current.position.z = s.approachZ + snapZ;
      rootRef.current.position.y = snapY;
      rootRef.current.rotation.z = wetShake;
      rootRef.current.scale.setScalar(pulse);
    }
    if (headGroupRef.current) {
      headGroupRef.current.rotation.x = -howlPitch;
      headGroupRef.current.rotation.y = sweepYaw + shakeYaw;
    }
    if (tailRef.current) tailRef.current.rotation.y = tailWag;
  });

  return (
    <group ref={rootRef}>
      <BlobShadow radiusX={0.75} radiusZ={0.75} />
      <mesh geometry={bodyGeometry} material={materials.body} />
      <group ref={headGroupRef} position={[0, 0.72, 0.22]}>
        <mesh geometry={headGeometry} material={materials.head} />
      </group>
      {/* Tail: own group (not merged into bodyGeometry) so it can wag for
          the tap-greeting wave -- same rest position/tilt as before. */}
      <group ref={tailRef} position={[0, 0.5, -0.42]}>
        <mesh rotation={[(-30 * Math.PI) / 180, 0, 0]} material={materials.tail}>
          <capsuleGeometry args={[0.06, 0.4, 2, 6]} />
        </mesh>
      </group>
    </group>
  );
}
