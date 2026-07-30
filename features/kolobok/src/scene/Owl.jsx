import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber/native';
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
// Live feedback: the interaction is now a single beat -- pop out, flap its
// (hand-designed) wings for the ~1.7s it's up, duck back down and
// disappear (easterEggs.js's runOwl owns that timing; this component just
// flaps continuously, scaled by owlPopT, so the flap naturally fades in
// and out with the pop instead of needing its own separate on/off signal).
const FLAP_HZ = 4.5;
const FLAP_MAX = (55 * Math.PI) / 180;

/** Owl (EASTER_EGGS.md §2 owl): hidden until a spruce is triple-tapped,
 *  then pops from that tree's canopy top (SPRUCE_TOP_MATRICES anchor) and
 *  flaps its wings until it ducks back down. eggMotion.owlTreeIdx/owlPopT
 *  are the entire interface -- Vegetation.jsx's onTreeGrab drives them via
 *  eggManager.tapSpruce(), the registry (easterEggs.js runOwl) owns the
 *  timeline, this component only ever READS them. */
export function Owl() {
  const rootRef = useRef();
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

  const materials = useMemo(() => ({
    body: makeToonMaterial({ vertexColors: true, color: '#8a7154', rimStrength: 0.35 }),
    head: makeToonMaterial({ vertexColors: true, color: '#8a7154', rimStrength: 0.35 }),
    eyes: makeToonMaterial({ vertexColors: true, color: '#f4f0e6', rimStrength: 0 }),
    wing: makeToonMaterial({ color: '#6b5540', rimStrength: 0.35 }),
  }), []);

  const flapPhase = useRef(0);
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

    // "It should look in the camera" -- face is on local +Z (see
    // eyeGeometry/beak's own +Z offsets above), so yaw the whole owl
    // toward wherever the camera currently is.
    const dx = camera.position.x - rootRef.current.position.x;
    const dz = camera.position.z - rootRef.current.position.z;
    rootRef.current.rotation.y = Math.atan2(dx, dz);

    // Wing flap: continuous while popped, amplitude scaled by popT so it
    // fades in/out with the pop instead of snapping on/off.
    flapPhase.current += dt * FLAP_HZ * Math.PI * 2;
    const flap = Math.sin(flapPhase.current) * FLAP_MAX * popT;
    if (leftWingRef.current) leftWingRef.current.rotation.z = flap;
    if (rightWingRef.current) rightWingRef.current.rotation.z = -flap;

    const isNight = atmosphereLive.windowGlow > 0.5;
    materials.eyes.emissive.set(isNight ? '#ffd27a' : '#000000');
  });

  return (
    <group ref={rootRef} visible={false}>
      <mesh geometry={bodyGeometry} material={materials.body} />
      <group position={[0, 0.16, 0.02]}>
        <mesh geometry={headGeometry} material={materials.head} />
        <mesh geometry={eyeGeometry} material={materials.eyes} />
      </group>
      <group ref={leftWingRef} position={[-0.095, 0.02, -0.01]}>
        <mesh geometry={wingGeometry} material={materials.wing} scale={[-1, 1, 1]} />
      </group>
      <group ref={rightWingRef} position={[0.095, 0.02, -0.01]}>
        <mesh geometry={wingGeometry} material={materials.wing} />
      </group>
    </group>
  );
}
