import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import {
  CapsuleGeometry, Object3D, SphereGeometry,
} from 'three';
import { mergeColoredParts } from '../builders/mergeColoredParts';
import { encounterMotion } from '../../state/sceneStore';
import { makeToonMaterial } from '../materials/toonMaterial';
import { BlobShadow } from '../BlobShadow';

const FUR = '#d8d8d2';
const BELLY = '#efeeea';

const dummy = new Object3D();

/** Hare (ART_SPEC §3, height 0.9): body/head/eyes/tail/belly merge into one
 *  static mesh (they all move together, riding the whole-animal hop); ears
 *  get their own instancedMesh since they twitch independently
 *  (ANIMATION_SPEC §3); nose gets its own tiny mesh for the sniff scale
 *  pulse. 3 draw calls total. `{ zone, mode }` per CLAUDE.md's shared
 *  animal interface (mode: 'idle' | 'encounter' | 'retreat'). */
export function Hare({ mode, isActiveZone }) {
  const rootRef = useRef();
  const bodyRef = useRef();
  const earsRef = useRef();
  const noseRef = useRef();

  const bodyGeometry = useMemo(() => mergeColoredParts([
    // Body, reclined onto its haunches (tilt back ~20°).
    { geometry: new CapsuleGeometry(0.16, 0.2, 3, 8), color: FUR, position: [0, 0.32, -0.02], rotation: [-0.35, 0, 0] },
    // Belly patch, a flattened blob on the reclined body's forward face.
    { geometry: new SphereGeometry(0.13, 8, 6), color: BELLY, position: [0, 0.28, 0.1], scale: [0.8, 0.9, 0.55] },
    // Head.
    { geometry: new SphereGeometry(0.14, 10, 8), color: FUR, position: [0, 0.5, 0.08] },
    // Eyes.
    { geometry: new SphereGeometry(0.02, 6, 6), color: '#3a2c1a', position: [0.09, 0.52, 0.17] },
    { geometry: new SphereGeometry(0.02, 6, 6), color: '#3a2c1a', position: [-0.09, 0.52, 0.17] },
    // Tail.
    { geometry: new SphereGeometry(0.07, 8, 6), color: BELLY, position: [0, 0.24, -0.19] },
  ]), []);

  const materials = useMemo(() => ({
    body: makeToonMaterial({ vertexColors: true, color: FUR, rimStrength: 0.35 }),
    ears: makeToonMaterial({ color: FUR, rimStrength: 0.35 }),
    nose: makeToonMaterial({ color: FUR, rimStrength: 0 }),
  }), []);

  const state = useRef({
    hopPhase: 0, nextHopIn: 2.5 + Math.random() * 1.5, hopT: 1, hopDone: true,
    earTwitch: [0, 0], nextEarTwitchIn: [1 + Math.random() * 2, 1 + Math.random() * 2], earTwitchT: [1, 1],
    sniffPhase: Math.random() * Math.PI * 2,
    approachZ: 0, reactT: 0, retreatZ: 0,
  });

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const s = state.current;
    const activeMult = isActiveZone ? 1.3 : 1;

    // --- In-place hop, every 2.5-4s (ANIMATION_SPEC §3) ---
    if (mode === 'idle') {
      if (s.hopDone) {
        s.nextHopIn -= dt * activeMult;
        if (s.nextHopIn <= 0) {
          s.hopDone = false;
          s.hopT = 0;
          s.nextHopIn = 2.5 + Math.random() * 1.5;
        }
      } else {
        s.hopT += dt / 0.3;
        if (s.hopT >= 1) { s.hopT = 1; s.hopDone = true; }
      }
    }
    const hopY = s.hopDone ? 0 : Math.sin(Math.min(s.hopT, 1) * Math.PI) * 0.12;

    // --- Ears twitch independently, ±8° over 150ms, random 1-3s interval ---
    for (let i = 0; i < 2; i++) {
      if (s.earTwitchT[i] >= 1) {
        s.nextEarTwitchIn[i] -= dt * activeMult;
        if (s.nextEarTwitchIn[i] <= 0) {
          s.earTwitchT[i] = 0;
          s.nextEarTwitchIn[i] = 1 + Math.random() * 2;
        }
      } else {
        s.earTwitchT[i] += dt / 0.15;
      }
      const t = Math.min(s.earTwitchT[i], 1);
      s.earTwitch[i] = t < 1 ? Math.sin(t * Math.PI) * ((8 * Math.PI) / 180) : 0;
    }

    // --- Sniff: nose scales 1.02 at 4Hz ---
    s.sniffPhase += dt * Math.PI * 2 * 4;
    const sniffScale = 1 + Math.max(0, Math.sin(s.sniffPhase)) * 0.02;

    // --- Encounter beat (ANIMATION_SPEC §4): approach 0.6, react = a
    // startled ARC jump (forward burst + vertical hop together, not just
    // straight up), retreat back to spot ---
    const isMine = encounterMotion.zoneId === 'hare';
    if (isMine && mode === 'encounter') {
      s.approachZ = 0.6 * encounterMotion.phaseT;
      s.reactT = encounterMotion.phase === 'react' ? encounterMotion.phaseT : 0;
    } else if (isMine && mode === 'retreat') {
      s.approachZ = 0.6 * (1 - encounterMotion.phaseT);
      s.reactT = 0;
    } else if (!isMine) {
      s.approachZ = 0;
      s.reactT = 0;
    }
    const reactPhase = Math.min(s.reactT, 1);
    const reactHop = Math.sin(reactPhase * Math.PI) * 0.32;
    const reactZ = Math.sin(reactPhase * Math.PI) * 0.22;

    const pulse = isActiveZone && mode === 'idle' ? 1 + Math.sin(Date.now() / 500) * 0.025 : 1;

    if (rootRef.current) {
      rootRef.current.position.z = s.approachZ + reactZ;
      rootRef.current.scale.setScalar(pulse);
    }
    if (bodyRef.current) bodyRef.current.position.y = hopY + reactHop;

    if (earsRef.current) {
      const mesh = earsRef.current;
      [1, -1].forEach((side, i) => {
        dummy.position.set(0.06 * side, 0.7, 0.02);
        dummy.rotation.set(-0.26 + s.earTwitch[i], 0, side * 0.05);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (noseRef.current) noseRef.current.scale.setScalar(sniffScale);
  });

  return (
    <group ref={rootRef}>
      <BlobShadow radiusX={0.45} radiusZ={0.45} />
      <mesh ref={bodyRef} geometry={bodyGeometry} material={materials.body} />
      <instancedMesh ref={earsRef} args={[undefined, undefined, 2]} material={materials.ears}>
        <capsuleGeometry args={[0.05, 0.24, 2, 6]} />
      </instancedMesh>
      <mesh ref={noseRef} position={[0, 0.49, 0.21]} material={materials.nose}>
        <sphereGeometry args={[0.03, 6, 6]} />
      </mesh>
    </group>
  );
}
