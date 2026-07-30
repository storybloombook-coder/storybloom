import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import { ConeGeometry, Object3D, SphereGeometry } from 'three';
import { mergeColoredParts } from './builders/mergeColoredParts';
import { makeToonMaterial } from './materials/toonMaterial';
import { makeSpeckle } from './textures/proceduralTextures';
import { hedgehogPool } from './Vegetation';

const dummy = new Object3D();

// "The center of the scene" (SPEC's own island-radius convention -- see
// zones.js) is simply the world origin.
const CENTER_X = 0;
const CENTER_Z = 0;

/** A gentle S-curve from (startX,startZ) to (endX,endZ): linear XZ
 *  interpolation plus a perpendicular sine-wave lateral offset that tapers
 *  to exactly zero at both ends (sin(t*PI)), so it lands EXACTLY on the
 *  target at t=1 ("the mushroom should be waiting for the hedgehog") while
 *  still reading as a natural S in between. `seed` (0..1, rolled once per
 *  journey in Vegetation.jsx's spawnHedgehog) picks which side the S bulges
 *  toward and how wide, so different hedgehogs don't all trace the
 *  identical curve. The return trip reuses this SAME function with t
 *  reversed (1-t) rather than swapping start/end, so it retraces the exact
 *  same physical path -- see HedgehogInstance's own sT computation. */
function sPathPoint(t, startX, startZ, endX, endZ, seed) {
  const dx = endX - startX;
  const dz = endZ - startZ;
  const len = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
  const px = -dz / len;
  const pz = dx / len;
  const side = seed < 0.5 ? 1 : -1;
  const amp = len * (0.12 + seed * 0.16) * side;
  const wobble = Math.sin(t * Math.PI) * amp;
  return [startX + dx * t + px * wobble, startZ + dz * t + pz * wobble];
}

// ART_SPEC §14: body half-sphere r=0.1 `#6b5a48`; spines: 24 tiny cones
// h=0.05 instanced over the back `#4a4038`; snout cone `#8a7862` with a dot
// nose; carries one mushroom (lying flat on its back) on the way home.
const SPINE_COUNT = 24;
const SNIFF_BOB_HZ = 3;

/** Hedgehog (live feedback #7 rework): a POOL of independent hedgehogs, not
 *  a single shared instance -- "there can be any number of hedgehogs."
 *  hedgehogPool (Vegetation.jsx) is the entire interface: each slot's
 *  {active, mushroomIdx, phase, t, endX/endZ, seed} drives one instance of
 *  this rig, walking a random S-path from the center of the scene out to its
 *  tapped mushroom, sniffing it for a beat, then carrying it back along the
 *  SAME path in reverse. */
export function Hedgehog() {
  return hedgehogPool.map((_, i) => <HedgehogInstance key={i} slotIndex={i} />);
}

function HedgehogInstance({ slotIndex }) {
  const rootRef = useRef();
  const spinesRef = useRef();
  const mushroomRef = useRef();

  // Live feedback: the body read as hollow -- a partial-theta SphereGeometry
  // is an open shell with no bottom cap, so the inside was visible from any
  // angle looking up into it. A full closed sphere (flattened in Y to keep
  // the same low, rounded silhouette the half-dome was going for) fixes
  // that while looking effectively identical from above/the side.
  const bodyGeometry = useMemo(() => mergeColoredParts([
    { geometry: new SphereGeometry(0.1, 10, 8), color: '#6b5a48', scale: [1, 0.65, 1], position: [0, 0.1, 0] },
    { geometry: new ConeGeometry(0.045, 0.09, 8), color: '#8a7862', position: [0, 0.06, 0.12], rotation: [Math.PI / 2, 0, 0] },
    { geometry: new SphereGeometry(0.015, 6, 6), color: '#2a2016', position: [0, 0.06, 0.19] },
  ]), []);

  // "Lie horizontally, rotated so stem and cap touch the quills but do not
  // sink into" -- built upright like the ground mushrooms, then the whole
  // mesh is rotated 90deg (JSX below) so it lies flat along the back,
  // positioned above the highest spine tip (~0.18 at their anchor points).
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

  const bobPhase = useRef(0);

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const h = hedgehogPool[slotIndex];
    if (!rootRef.current) return;

    rootRef.current.visible = h.active;
    if (!h.active) return;

    // sT: 0..1 progress along the PHYSICAL center->mushroom curve, regardless
    // of phase -- sniff holds it at 1 (parked at the mushroom); return counts
    // it back down from 1 to 0 (h.t itself counts 0..1 through the return
    // phase, so 1-h.t retraces the approach curve in reverse).
    let sT;
    if (h.phase === 'approach') sT = h.t;
    else if (h.phase === 'sniff') sT = 1;
    else sT = 1 - h.t; // return

    const [x, z] = sPathPoint(sT, CENTER_X, CENTER_Z, h.endX, h.endZ, h.seed);
    rootRef.current.position.x = x;
    rootRef.current.position.z = z;
    // Live feedback #5: "if a mushroom is on a hill... the hedgehog must
    // move up the hill" -- plain linear climb from the center (Y=0) to the
    // mushroom's own ground height (h.endY, set in Vegetation.jsx's
    // spawnHedgehog from that mushroom's own groundHeightAt), riding
    // alongside the SAME sT the horizontal S-path already uses.
    const groundY = h.endY * sT;

    if (h.phase === 'sniff') {
      // "Sniffing" -- a gentle nose-down/up nod in place, facing the mushroom.
      rootRef.current.rotation.y = Math.atan2(h.endX - x, h.endZ - z);
      bobPhase.current += dt * SNIFF_BOB_HZ * Math.PI * 2;
      const bob = Math.sin(bobPhase.current) * 0.06;
      rootRef.current.rotation.x = bob;
      rootRef.current.position.y = groundY + Math.abs(bob) * 0.02;
    } else {
      const dirSign = h.phase === 'approach' ? 1 : -1;
      const aheadT = Math.min(1, Math.max(0, sT + dirSign * 0.02));
      const [nx, nz] = sPathPoint(aheadT, CENTER_X, CENTER_Z, h.endX, h.endZ, h.seed);
      rootRef.current.rotation.y = Math.atan2(nx - x, nz - z);
      rootRef.current.rotation.x = 0;
      rootRef.current.position.y = groundY;
    }

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

    // The mushroom "jumps onto his quills" once the sniff completes
    // (Vegetation.jsx starts that mushroom's own hide clock at the same
    // moment) and rides along for the whole return trip.
    if (mushroomRef.current) mushroomRef.current.visible = h.phase === 'return';
  });

  return (
    <group ref={rootRef} visible={false}>
      <mesh geometry={bodyGeometry} material={materials.body} />
      <instancedMesh ref={spinesRef} args={[undefined, undefined, SPINE_COUNT]} material={materials.spines}>
        <coneGeometry args={[0.014, 0.05, 5]} />
      </instancedMesh>
      <mesh
        ref={mushroomRef}
        geometry={mushroomGeometry}
        material={materials.mushroom}
        position={[0, 0.24, -0.02]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={0.85}
        visible={false}
      />
    </group>
  );
}
