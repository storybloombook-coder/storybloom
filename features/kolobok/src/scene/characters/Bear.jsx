import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import { CapsuleGeometry, Object3D, SphereGeometry } from 'three';
import { mergeColoredParts } from '../builders/mergeColoredParts';
import { encounterMotion } from '../../state/sceneStore';

const FUR = '#8a6444';
const MUZZLE = '#b08a62';
const INNER_EAR = '#6b4c33';

const dummy = new Object3D();

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

  const state = useRef({
    rollPhase: Math.random() * Math.PI * 2,
    nextScratchIn: 5 + Math.random() * 5,
    scratching: false,
    scratchT: 0,
    scratchSide: 1,
    approachZ: 0, swipeT: 0,
  });

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const s = state.current;
    const activeMult = isActiveZone ? 1.3 : 1;

    // --- Weight shift: body roll +-4 deg at 0.25Hz ---
    s.rollPhase += dt * Math.PI * 2 * 0.25;
    const roll = Math.sin(s.rollPhase) * ((4 * Math.PI) / 180);

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

    // --- Encounter: approach 0.6, react = slow heavy swipe (arm 40deg arc
    // over 350ms) that misses ---
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
    const swipeArc = Math.sin(Math.min(s.swipeT, 1) * Math.PI) * ((40 * Math.PI) / 180);

    const pulse = isActiveZone && mode === 'idle' ? 1 + Math.sin(Date.now() / 500) * 0.025 : 1;

    if (rootRef.current) {
      rootRef.current.position.z = s.approachZ;
      rootRef.current.scale.setScalar(pulse);
    }
    if (bodyRef.current) bodyRef.current.rotation.z = roll;

    if (armsRef.current) {
      const mesh = armsRef.current;
      [1, -1].forEach((side, i) => {
        const isScratchArm = s.scratching && s.scratchSide === side;
        const isSwipeArm = s.swipeT > 0 && side === 1;
        const armX = isScratchArm ? scratchWiggle : isSwipeArm ? swipeArc : 0;
        dummy.position.set(0.32 * side, 0.85, 0.05);
        dummy.rotation.set(armX, 0, side * 0.15);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group ref={rootRef}>
      <group ref={bodyRef}>
        <mesh geometry={bodyGeometry}>
          <meshStandardMaterial vertexColors roughness={0.9} />
        </mesh>
      </group>
      <instancedMesh ref={armsRef} args={[undefined, undefined, 2]}>
        <capsuleGeometry args={[0.09, 0.4, 2, 6]} />
        <meshStandardMaterial color={FUR} roughness={0.9} />
      </instancedMesh>
    </group>
  );
}
