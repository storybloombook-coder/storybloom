import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber/native';
import { ConeGeometry, Object3D, SphereGeometry } from 'three';
import { atmosphereLive } from '../state/sceneStore';
import { mergeColoredParts } from './builders/mergeColoredParts';
import { makeToonMaterial } from './materials/toonMaterial';
import { eggMotion } from './easterEggs';
import { SPRUCE_TOP_MATRICES } from './Vegetation';

const dummy = new Object3D();

// ART_SPEC Â§14 owl: body sphere r=0.11 scaled (1, 1.25, 0.9) `#8a7154`,
// belly patch `#c4ad8c`, two ear tufts (tiny cones), eyes: white spheres
// r=0.038 + pupils, beak cone `#d9a441`. Head is a SEPARATE sphere r=0.085
// stacked on the body so it can swivel Â±90Â°. Spawns from spruce canopy tops.
const BLINK_MS = 500; // "one slow blink"

/** Owl (EASTER_EGGS.md Â§2 owl): hidden until a spruce is triple-tapped,
 *  then pops from that tree's canopy top (SPRUCE_TOP_MATRICES anchor),
 *  swivels its head Â±90Â° twice, blinks once, ducks back at 2.8s.
 *  eggMotion.owlTreeIdx/owlPopT/owlSwivel/owlBlinkBurst are the entire
 *  interface -- Vegetation.jsx's onTreeGrab drives them via
 *  eggManager.tapSpruce(), the registry (easterEggs.js runOwl) owns the
 *  timeline, this component only ever READS them. */
export function Owl() {
  const rootRef = useRef();
  const headRef = useRef();
  const eyesRef = useRef();

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

  const materials = useMemo(() => ({
    body: makeToonMaterial({ vertexColors: true, color: '#8a7154', rimStrength: 0.35 }),
    head: makeToonMaterial({ vertexColors: true, color: '#8a7154', rimStrength: 0.35 }),
    eyes: makeToonMaterial({ vertexColors: true, color: '#f4f0e6', rimStrength: 0 }),
  }), []);

  // blinkSeen seeded from the counter's current value, not 0 -- otherwise a
  // fresh mount (leaving/returning to the 3D scene) would misread a leftover
  // nonzero burst from a PRIOR mount as a brand-new trigger and replay it.
  const ui = useRef({ blinkSeen: eggMotion.owlBlinkBurst, blinkMs: -1, pulseMs: -1 });
  const { camera } = useThree();

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
    // Pops UP out of the canopy as owlPopT climbs (starts a touch lower/
    // smaller, inside the foliage, rises to its perched scale/height).
    const popT = eggMotion.owlPopT;
    rootRef.current.scale.setScalar(Math.max(0.001, popT));
    rootRef.current.position.y += 0.05 + popT * 0.1;

    // Live feedback: "it should look in the camera" -- face is on local +Z
    // (see eyeGeometry/beak's own +Z offsets above), so yaw the whole owl
    // toward wherever the camera currently is, then let the head's own
    // swivel ride on top of that base orientation instead of a fixed 0.
    const dx = camera.position.x - rootRef.current.position.x;
    const dz = camera.position.z - rootRef.current.position.z;
    rootRef.current.rotation.y = Math.atan2(dx, dz);

    if (headRef.current) headRef.current.rotation.y = eggMotion.owlSwivel;

    // Blink (edge-detect the burst counter) + the "hoot" body-scale pulses,
    // both riding the same trigger moment (EASTER_EGGS.md Â§2: "does one slow
    // blink ... it hoots -- no audio, so the hoot is two body-scale pulses").
    const ui2 = ui.current;
    if (eggMotion.owlBlinkBurst !== ui2.blinkSeen) {
      ui2.blinkSeen = eggMotion.owlBlinkBurst;
      ui2.blinkMs = 0;
      ui2.pulseMs = 0;
    }
    if (ui2.blinkMs >= 0) {
      ui2.blinkMs += dt * 1000;
      if (ui2.blinkMs > BLINK_MS) ui2.blinkMs = -1;
    }
    const blinkTriangle = ui2.blinkMs < 0 ? 0 : 1 - Math.abs(ui2.blinkMs / BLINK_MS - 0.5) * 2;
    if (eyesRef.current) eyesRef.current.scale.y = Math.max(0.05, 1 - blinkTriangle);

    if (ui2.pulseMs >= 0) {
      ui2.pulseMs += dt * 1000;
      if (ui2.pulseMs > 900) ui2.pulseMs = -1;
    }
    const isNight = atmosphereLive.windowGlow > 0.5;
    const pulse = ui2.pulseMs < 0 ? 1 : 1 + Math.max(0, Math.sin((ui2.pulseMs / 900) * Math.PI * 2)) * 0.08;
    if (headRef.current) headRef.current.scale.setScalar(pulse);
    materials.eyes.emissive.set(isNight ? '#ffd27a' : '#000000');
  });

  return (
    <group ref={rootRef} visible={false}>
      <mesh geometry={bodyGeometry} material={materials.body} />
      <group ref={headRef} position={[0, 0.16, 0.02]}>
        <mesh geometry={headGeometry} material={materials.head} />
        <mesh ref={eyesRef} geometry={eyeGeometry} material={materials.eyes} />
      </group>
    </group>
  );
}
