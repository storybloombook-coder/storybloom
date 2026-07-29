import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import {
  ConeGeometry, Object3D, SphereGeometry,
} from 'three';
import { ISLAND_RADIUS, rad, pointOnCircle } from '../config/zones';
import { mergeColoredParts } from './builders/mergeColoredParts';
import { makeToonMaterial } from './materials/toonMaterial';
import { makeSpeckle } from './textures/proceduralTextures';
import { eggMotion } from './easterEggs';

const dummy = new Object3D();

// EASTER_EGGS.md Â§2 hedgehog: "trundles across the bear arc along a gentle
// S over 6s". Bear sits at angleDeg 216 (config/zones.js) -- sweep a fixed
// span either side of it, wobbling the radius twice across the crossing so
// the path reads as an S instead of a straight chord.
const BEAR_ANGLE_DEG = 216;
const ARC_SPAN_DEG = 44;
const BASE_RADIUS = ISLAND_RADIUS * 0.55;
const S_AMPLITUDE = 0.7;

function pathPoint(t) {
  const angle = rad(BEAR_ANGLE_DEG) + (t - 0.5) * rad(ARC_SPAN_DEG);
  const radius = BASE_RADIUS + Math.sin(t * Math.PI * 2) * S_AMPLITUDE;
  return pointOnCircle(radius, angle);
}

// ART_SPEC Â§14: body half-sphere r=0.1 `#6b5a48`; spines: 24 tiny cones
// h=0.05 instanced over the back `#4a4038`; snout cone `#8a7862` with a dot
// nose; carries one mushroom (Vegetation.jsx's own mushroom mesh) on top.
const SPINE_COUNT = 24;

/** Hedgehog (EASTER_EGGS.md Â§2 hedgehog): hidden until 3 distinct mushrooms
 *  are tapped within 4s, then trundles across the bear arc over 6s carrying
 *  the taken mushroom, ducking away at the end. eggMotion.hedgehogT (0..1
 *  progress, -1 hidden) is the entire interface -- Vegetation.jsx's mushroom
 *  taps drive it via eggManager.tapMushroom(), the registry (easterEggs.js
 *  runHedgehog) owns the timeline, this component only ever READS it. */
export function Hedgehog() {
  const rootRef = useRef();
  const spinesRef = useRef();

  const bodyGeometry = useMemo(() => mergeColoredParts([
    { geometry: new SphereGeometry(0.1, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), color: '#6b5a48', rotation: [Math.PI, 0, 0], position: [0, 0.1, 0] },
    { geometry: new ConeGeometry(0.045, 0.09, 8), color: '#8a7862', position: [0, 0.06, 0.12], rotation: [Math.PI / 2, 0, 0] },
    { geometry: new SphereGeometry(0.015, 6, 6), color: '#2a2016', position: [0, 0.06, 0.19] },
  ]), []);

  const mushroomGeometry = useMemo(() => mergeColoredParts([
    { geometry: new SphereGeometry(0.03, 6, 6), color: '#efeeea', scale: [1, 0.6, 1], position: [0, 0.11, -0.02] },
    { geometry: new ConeGeometry(0.03, 0.03, 6), color: '#efeeea', position: [0, 0.075, -0.02] },
    { geometry: new SphereGeometry(0.06, 8, 8), color: '#c0452e', scale: [1, 0.55, 1], position: [0, 0.15, -0.02] },
  ]), []);

  const spineTexture = useMemo(() => makeSpeckle('#4a4038', '#3a3229', 32, 0.2), []);
  const materials = useMemo(() => ({
    body: makeToonMaterial({ vertexColors: true, color: '#6b5a48', rimStrength: 0.35 }),
    spines: makeToonMaterial({ color: '#4a4038', map: spineTexture, rimStrength: 0.35 }),
    mushroom: makeToonMaterial({ vertexColors: true, color: '#c0452e', rimStrength: 0 }),
  }), [spineTexture]);

  const state = useRef({ waddlePhase: 0 });

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const active = eggMotion.hedgehogT >= 0;
    if (!rootRef.current) return;
    rootRef.current.visible = active;
    if (!active) return;

    const t = eggMotion.hedgehogT;
    const [x, , z] = pathPoint(t);
    const [nx, , nz] = pathPoint(Math.min(1, t + 0.01));
    rootRef.current.position.set(x, 0, z);
    rootRef.current.rotation.y = Math.atan2(nx - x, nz - z);

    const s = state.current;
    s.waddlePhase += dt * 3 * Math.PI * 2;
    // "Trundles" -- fades in/out at both ends of the crossing rather than
    // popping, and the roll only really reads once it's moving.
    const edgeFade = Math.min(1, t * 8) * Math.min(1, (1 - t) * 8);
    rootRef.current.rotation.z = Math.sin(s.waddlePhase) * ((6 * Math.PI) / 180) * edgeFade;
    rootRef.current.scale.setScalar(edgeFade);

    if (spinesRef.current) {
      const mesh = spinesRef.current;
      for (let i = 0; i < SPINE_COUNT; i++) {
        const row = Math.floor(i / 6);
        const col = i % 6;
        const backAngle = -0.9 + row * 0.5;
        const side = -0.65 + col * 0.26;
        dummy.position.set(side * 0.09, 0.12 + Math.cos(backAngle) * 0.06, -0.02 + Math.sin(backAngle) * 0.09);
        dummy.rotation.set(backAngle + Math.PI, side * 0.4, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group ref={rootRef} visible={false}>
      <mesh geometry={bodyGeometry} material={materials.body} />
      <instancedMesh ref={spinesRef} args={[undefined, undefined, SPINE_COUNT]} material={materials.spines}>
        <coneGeometry args={[0.014, 0.05, 5]} />
      </instancedMesh>
      <mesh geometry={mushroomGeometry} material={materials.mushroom} />
    </group>
  );
}
