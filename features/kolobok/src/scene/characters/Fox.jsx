import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import { CapsuleGeometry, SphereGeometry } from 'three';
import { mergeColoredParts } from '../builders/mergeColoredParts';
import { encounterMotion } from '../../state/sceneStore';

const FUR = '#d9722f';
const CREAM = '#f2e8d8';
const DARK = '#5c3317';

/** Fox (ART_SPEC §3, height 1.3): body+legs+eyes+ears merge into one static
 *  mesh; head gets its own transform for the occasional tilt; the tail is
 *  her signature (ANIMATION_SPEC §3: "always moving"), built as two
 *  capsule segments (base + tip) so the tip can lag 200ms behind the base
 *  for the S-curve sway. 4 draw calls total. */
export function Fox({ mode, isActiveZone }) {
  const rootRef = useRef();
  const headGroupRef = useRef();
  const tailBaseRef = useRef();
  const tailTipRef = useRef();

  const bodyGeometry = useMemo(() => mergeColoredParts([
    { geometry: new CapsuleGeometry(0.16, 0.4, 3, 8), color: FUR, position: [0, 0.42, 0], rotation: [Math.PI / 2 - 0.1, 0, 0] },
    { geometry: new SphereGeometry(0.13, 8, 6), color: CREAM, position: [0, 0.38, 0.12], scale: [0.75, 0.85, 0.5] },
    ...[[0.09, 0.12], [-0.09, 0.12], [0.09, -0.14], [-0.09, -0.14]].map(([x, z]) => ({
      geometry: new CapsuleGeometry(0.04, 0.22, 2, 6), color: FUR, position: [x, 0.14, z],
    })),
    ...[[0.09, 0.12], [-0.09, 0.12]].map(([x, z]) => ({
      geometry: new SphereGeometry(0.045, 6, 6), color: DARK, position: [x, 0.02, z],
    })),
  ]), []);

  // Half-lidded "sly" eyes: flattened almond shapes rather than an
  // animated eyelid shell, so the resting expression reads sly for free
  // without a second animated part (budget-conscious simplification).
  const headGeometry = useMemo(() => mergeColoredParts([
    { geometry: new SphereGeometry(0.13, 10, 8), color: FUR, position: [0, 0, 0] },
    { geometry: new SphereGeometry(0.08, 8, 6), color: FUR, position: [0, -0.03, 0.16], scale: [0.7, 0.55, 1.4] },
    { geometry: new SphereGeometry(0.018, 6, 4), color: '#2a1a10', position: [0.065, 0.03, 0.1], scale: [1.3, 0.55, 0.8] },
    { geometry: new SphereGeometry(0.018, 6, 4), color: '#2a1a10', position: [-0.065, 0.03, 0.1], scale: [1.3, 0.55, 0.8] },
    { geometry: new SphereGeometry(0.06, 8, 6), color: FUR, position: [0.09, 0.15, -0.02], scale: [0.8, 1, 0.6] },
    { geometry: new SphereGeometry(0.025, 6, 6), color: DARK, position: [0.1, 0.19, -0.02] },
    { geometry: new SphereGeometry(0.06, 8, 6), color: FUR, position: [-0.09, 0.15, -0.02], scale: [0.8, 1, 0.6] },
    { geometry: new SphereGeometry(0.025, 6, 6), color: DARK, position: [-0.1, 0.19, -0.02] },
  ]), []);

  const state = useRef({
    swayPhase: 0,
    baseAngle: 0,
    tipAngle: 0,
    nextTiltIn: 6 + Math.random() * 4,
    tilting: false,
    tiltT: 0,
    approachZ: 0,
  });

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const s = state.current;
    const activeMult = isActiveZone ? 1.3 : 1;

    const isMine = encounterMotion.zoneId === 'fox';
    const inEncounter = isMine && (mode === 'encounter' || mode === 'retreat');

    // --- Tail: base +-14deg at 0.4Hz always; tip lags 200ms behind the
    // base. Driven as an exponential lag (time-constant 200ms) rather than
    // a fixed-frame-count delay buffer: a frame-count buffer's actual delay
    // scales with whatever the current frame rate happens to be, which
    // silently drifts wrong under ANIMATION_SPEC §6's sleep-mode frame
    // skipping (~15fps) -- this stays correct at any frame rate. Encounter
    // sway x1.6. ---
    s.swayPhase += dt * Math.PI * 2 * 0.4;
    const amp = inEncounter ? (14 * Math.PI) / 180 * 1.6 : (14 * Math.PI) / 180;
    s.baseAngle = Math.sin(s.swayPhase) * amp;
    s.tipAngle += (s.baseAngle - s.tipAngle) * (1 - Math.exp(-dt / 0.2));
    const tipAngle = s.tipAngle;

    // --- Every ~8s: head tilt 12deg (+ half-lid blink, approximated by
    // the head's static half-lidded eyes -- see headGeometry) ---
    if (mode === 'idle' || mode === 'retreat') {
      if (!s.tilting) {
        s.nextTiltIn -= dt * activeMult;
        if (s.nextTiltIn <= 0) { s.tilting = true; s.tiltT = 0; s.nextTiltIn = 8; }
      } else {
        s.tiltT += dt / 1.2;
        if (s.tiltT >= 1) { s.tilting = false; s.tiltT = 0; }
      }
    }
    const headTilt = s.tilting ? Math.sin(Math.min(s.tiltT, 1) * Math.PI) * ((12 * Math.PI) / 180) : 0;

    // --- Encounter (ANIMATION_SPEC §5): glide 0.5 toward path, no hop ---
    if (isMine && mode === 'encounter') {
      s.approachZ = 0.5 * encounterMotion.phaseT;
    } else if (isMine && mode === 'retreat') {
      s.approachZ = 0.5 * (1 - encounterMotion.phaseT);
    } else if (!isMine) {
      s.approachZ = 0;
    }
    // Lean 8deg toward Kolobok then spring back (encounterMotion.leanSpringT
    // eases 0->1 via easeOutBack, so reading it directly as a lean-then-
    // overshoot-back curve matches the "leans... then springs back" beat).
    const lean = isMine && encounterMotion.leanSpringT > 0
      ? (1 - encounterMotion.leanSpringT) * ((8 * Math.PI) / 180)
      : 0;

    const pulse = isActiveZone && mode === 'idle' ? 1 + Math.sin(Date.now() / 500) * 0.025 : 1;

    if (rootRef.current) {
      rootRef.current.position.z = s.approachZ;
      rootRef.current.scale.setScalar(pulse);
    }
    if (headGroupRef.current) headGroupRef.current.rotation.z = headTilt + lean;
    // Yaw (Y), not pitch (X): the tail mesh is aligned along local Z (see
    // its own Math.PI/2 X-rotation below), so a Y-axis rotation sweeps its
    // far end left-right -- a natural sway. An X-axis rotation would flop
    // it up and down instead.
    if (tailBaseRef.current) tailBaseRef.current.rotation.y = s.baseAngle;
    if (tailTipRef.current) tailTipRef.current.rotation.y = tipAngle - s.baseAngle;
  });

  return (
    <group ref={rootRef}>
      <mesh geometry={bodyGeometry}>
        <meshStandardMaterial vertexColors roughness={0.8} />
      </mesh>
      <group ref={headGroupRef} position={[0, 0.62, 0.15]}>
        <mesh geometry={headGeometry}>
          <meshStandardMaterial vertexColors roughness={0.75} />
        </mesh>
      </group>
      <group ref={tailBaseRef} position={[0, 0.4, -0.16]}>
        <mesh position={[0, 0, -0.14]} rotation={[Math.PI / 2, 0, 0]}>
          <capsuleGeometry args={[0.09, 0.16, 2, 6]} />
          <meshStandardMaterial color={FUR} roughness={0.85} />
        </mesh>
        <group ref={tailTipRef} position={[0, 0, -0.3]}>
          <mesh position={[0, 0, -0.12]} rotation={[Math.PI / 2, 0, 0]}>
            <capsuleGeometry args={[0.065, 0.14, 2, 6]} />
            <meshStandardMaterial color={CREAM} roughness={0.85} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
