import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import {
  CapsuleGeometry, Euler, Object3D, SphereGeometry, Vector3,
} from 'three';
import { mergeColoredParts } from '../builders/mergeColoredParts';
import { encounterMotion } from '../../state/sceneStore';
import { makeToonMaterial } from '../materials/toonMaterial';
import { BlobShadow } from '../BlobShadow';
import { initWetShakeState, tickWetShake } from '../wetShake';
import { initGreetWaveState, tickGreetWave } from '../greetWave';

const FUR = '#8a6444';
const MUZZLE = '#b08a62';
const INNER_EAR = '#6b4c33';

const dummy = new Object3D();
const armPivotOffset = new Vector3();
const armPivotEuler = new Euler();

// Arms rotate from the SHOULDER, not their own geometric center: the capsule
// (radius 0.09, length 0.4) is authored hanging straight down, so half its
// total length is the offset from the shoulder point to the capsule's own
// center at rest. Rotating that offset vector by the same (armX, 0, armZ)
// used for the mesh's own rotation, then re-adding it to the fixed shoulder
// position, keeps the TOP of the arm pinned at the shoulder while the rest
// swings -- previously the rotation was applied directly to the capsule's
// center, so the whole arm spun in place like a windmill blade.
const ARM_HALF_LEN = 0.2 + 0.09; // capsuleGeometry(radius, length)/2 + radius
const SHOULDER_Y = 0.85 + ARM_HALF_LEN;

/** Bear (ART_SPEC §3, height 2.0, bulkiest silhouette -- body radius x1.5
 *  the wolf's): body+head+ears+muzzle merge into one mesh, since the "weight
 *  shift" idle rolls the whole animal as one rigid unit (ANIMATION_SPEC
 *  §3); arms get their own instancedMesh since one arm independently
 *  "scratches" against the nearest spruce. 2 draw calls total. */
export function Bear({ mode, isActiveZone }) {
  const rootRef = useRef();
  const bodyRef = useRef();
  const armsRef = useRef();

  const bodyGeometry = useMemo(() => mergeColoredParts([
    { geometry: new CapsuleGeometry(0.36, 0.55, 3, 8), color: FUR, position: [0, 0.62, 0] },
    { geometry: new SphereGeometry(0.24, 10, 8), color: FUR, position: [0, 1.28, 0.1] },
    { geometry: new SphereGeometry(0.13, 8, 6), color: MUZZLE, position: [0, 1.2, 0.32], scale: [0.9, 0.75, 1.1] },
    { geometry: new SphereGeometry(0.02, 6, 6), color: '#1a1a1a', position: [0.11, 1.32, 0.28] },
    { geometry: new SphereGeometry(0.02, 6, 6), color: '#1a1a1a', position: [-0.11, 1.32, 0.28] },
    { geometry: new SphereGeometry(0.1, 8, 6), color: FUR, position: [0.19, 1.46, 0.06] },
    { geometry: new SphereGeometry(0.06, 6, 6), color: INNER_EAR, position: [0.19, 1.46, 0.11] },
    { geometry: new SphereGeometry(0.1, 8, 6), color: FUR, position: [-0.19, 1.46, 0.06] },
    { geometry: new SphereGeometry(0.06, 6, 6), color: INNER_EAR, position: [-0.19, 1.46, 0.11] },
  ]), []);

  const materials = useMemo(() => ({
    body: makeToonMaterial({ vertexColors: true, color: FUR, rimStrength: 0.35 }),
    arms: makeToonMaterial({ color: FUR, rimStrength: 0.35 }),
  }), []);

  const state = useRef({
    rollPhase: Math.random() * Math.PI * 2,
    nextScratchIn: 5 + Math.random() * 5,
    scratching: false,
    scratchT: 0,
    scratchSide: 1,
    approachZ: 0, swipeT: 0,
    wetShake: initWetShakeState(),
    greetWave: initGreetWaveState(),
  });

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const s = state.current;
    const activeMult = isActiveZone ? 1.3 : 1;

    // --- Weight shift: body roll +-4 deg at 0.25Hz ---
    s.rollPhase += dt * Math.PI * 2 * 0.25;
    const roll = Math.sin(s.rollPhase) * ((4 * Math.PI) / 180);

    // --- Wet shake-off (BACKLOG.md #1), idle only ---
    const wetShake = tickWetShake(s.wetShake, dt, mode === 'idle');

    // --- Every ~10s, raise one arm and scratch: +-12deg at 6Hz for 900ms ---
    if (mode === 'idle') {
      if (!s.scratching) {
        s.nextScratchIn -= dt * activeMult;
        if (s.nextScratchIn <= 0) {
          s.scratching = true;
          s.scratchT = 0;
          s.scratchSide = Math.random() < 0.5 ? 1 : -1;
          s.nextScratchIn = 10;
        }
      } else {
        s.scratchT += dt * 1000;
        if (s.scratchT > 900) { s.scratching = false; s.scratchT = 0; }
      }
    }
    const scratchWiggle = s.scratching ? Math.sin((s.scratchT / 1000) * Math.PI * 2 * 6) * ((12 * Math.PI) / 180) : 0;

    // --- Encounter: approach 0.6, react = both arms reach forward and close
    // inward together, like a two-handed grab, that closes on empty air ---
    const isMine = encounterMotion.zoneId === 'bear';
    if (isMine && mode === 'encounter') {
      s.approachZ = 0.6 * encounterMotion.phaseT;
      s.swipeT = encounterMotion.phase === 'react' ? encounterMotion.phaseT : 0;
    } else if (isMine && mode === 'retreat') {
      s.approachZ = 0.6 * (1 - encounterMotion.phaseT);
      s.swipeT = 0;
    } else if (!isMine) {
      s.approachZ = 0;
      s.swipeT = 0;
    }
    const grabT = Math.min(s.swipeT, 1);
    const grabReach = Math.sin(grabT * Math.PI) * ((45 * Math.PI) / 180); // both arms swing forward together
    const grabClose = Math.sin(grabT * Math.PI) * 0.12; // and inward, as if closing on something

    // --- Tap greeting (live feedback): right arm raises + waves hello for
    // ~2.6s right as the encounter starts -- Bear stands upright enough
    // that this reads as a person-like wave, well past horizontal. Plays
    // out on its own fixed timer, independent of the (much shorter)
    // approach/react phase timing below, so it doesn't get cut short. ---
    const waveEnv = tickGreetWave(s.greetWave, dt, isMine, mode);
    const waveRaise = waveEnv * ((100 * Math.PI) / 180);
    // Scaled by waveEnv (not just gated on it being >0): without this, the
    // wiggle held its full amplitude right up to the last frame, then
    // snapped to 0 the instant the gesture's timer ran out -- a visible
    // teleport back to rest instead of easing out with the rest of the wave.
    const waveWiggle = waveEnv > 0
      ? Math.sin(s.greetWave.t * Math.PI * 2 * 2.5) * ((14 * Math.PI) / 180) * waveEnv
      : 0;

    const pulse = isActiveZone && mode === 'idle' ? 1 + Math.sin(Date.now() / 500) * 0.025 : 1;

    if (rootRef.current) {
      rootRef.current.position.z = s.approachZ;
      rootRef.current.rotation.z = wetShake;
      rootRef.current.scale.setScalar(pulse);
    }
    if (bodyRef.current) bodyRef.current.rotation.z = roll;

    if (armsRef.current) {
      const mesh = armsRef.current;
      [1, -1].forEach((side, i) => {
        const isWaveArm = side === 1 && waveEnv > 0; // right arm only
        const isScratchArm = !isWaveArm && s.scratching && s.scratchSide === side;
        let armX;
        let armZ;
        if (isWaveArm) {
          armX = waveRaise;
          armZ = side * 0.15 + waveWiggle;
        } else if (isScratchArm) {
          armX = scratchWiggle;
          armZ = side * 0.15;
        } else {
          armX = grabReach;
          armZ = side * Math.max(0, 0.15 - grabClose);
        }
        // Pivot from the shoulder (see ARM_HALF_LEN/SHOULDER_Y above): rotate
        // the "hanging straight down" offset by the same (armX, 0, armZ),
        // then place the capsule's center at shoulder + that rotated
        // offset, so the top of the arm stays pinned while it swings.
        armPivotEuler.set(armX, 0, armZ);
        armPivotOffset.set(0, -ARM_HALF_LEN, 0).applyEuler(armPivotEuler);
        dummy.position.set(0.32 * side + armPivotOffset.x, SHOULDER_Y + armPivotOffset.y, 0.05 + armPivotOffset.z);
        dummy.rotation.set(armX, 0, armZ);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group ref={rootRef}>
      <BlobShadow radiusX={1.0} radiusZ={1.0} />
      <group ref={bodyRef}>
        <mesh geometry={bodyGeometry} material={materials.body} />
      </group>
      <instancedMesh ref={armsRef} args={[undefined, undefined, 2]} material={materials.arms}>
        <capsuleGeometry args={[0.09, 0.4, 2, 6]} />
      </instancedMesh>
    </group>
  );
}
