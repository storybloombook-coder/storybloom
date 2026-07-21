import { useMemo } from 'react';
import { BufferAttribute, CircleGeometry, CylinderGeometry, Object3D } from 'three';
import {
  ISLAND_RADIUS, PATH_RADIUS, ZONES, rad, angleDelta, POND_ANGLE_DEG,
} from '../config/zones';
import { makeRng } from './prng';
import { makeSpeckle } from './textures/proceduralTextures';
import { jitterVertices } from './builders/vertexJitter';

const BASE_GRASS = [0x7a / 255, 0xa8 / 255, 0x5c / 255];

// The dirt path ring stops short on either side of Grandpa's pond -- the
// new wooden bridge (PondAndGrandpa.jsx, spanning local Z=1.0, i.e. world
// radius ~= POND radius(5.6) - 1.0 = PATH_RADIUS) picks up the crossing
// instead, so the path reads as going OVER the water, not through it.
// RingGeometry's own theta angle is offset -90deg from this project's
// zone-angle convention (`pointOnCircle`'s sin/cos), verified against a
// couple of known points (0deg -> world +Z, 90deg -> world +X) before
// picking this formula -- get the -90 backwards and the gap lands 90deg
// away from the pond instead of centered on it.
const BRIDGE_GAP_HALF_DEG = 20; // bridge itself spans ~34deg at PATH_RADIUS
const PATH_GAP_THETA_START = rad(POND_ANGLE_DEG - 90 + BRIDGE_GAP_HALF_DEG);
const PATH_GAP_THETA_LENGTH = rad(360 - BRIDGE_GAP_HALF_DEG * 2);

function hexToUnit(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Vertex-colored ground disc (ART_SPEC §6): base grass everywhere, blended
 *  toward each zone's tint within its 36° arc (smoothstep over angular
 *  distance), plus a little per-vertex value noise for a hand-painted feel. */
// VISUAL_QUALITY_SPEC §5 ground blending: a handful of fixed random-phase
// sine pairs, summed, give smooth spatial "clumps" (soft blobs roughly
// 1.5-2.5 units across) without a real Perlin implementation. Computed once
// at module scope with its own PRNG stream so it's stable across reloads.
const CLUMP_WAVES = (() => {
  const rng = makeRng(61);
  return [0, 1, 2].map(() => ({
    freq: 1 / (1.5 + rng() * 1.0),
    phaseX: rng() * Math.PI * 2,
    phaseZ: rng() * Math.PI * 2,
  }));
})();
function clumpNoise01(x, z) {
  let sum = 0;
  for (const w of CLUMP_WAVES) sum += Math.sin(x * w.freq + w.phaseX) * Math.sin(z * w.freq + w.phaseZ);
  return 0.5 + 0.5 * (sum / CLUMP_WAVES.length);
}

function useGroundGeometry() {
  return useMemo(() => {
    const geo = new CircleGeometry(ISLAND_RADIUS, 64);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const rng = makeRng(60);
    const tints = ZONES.map((z) => ({ angle: rad(z.angleDeg), rgb: hexToUnit(z.groundTint) }));
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      // CircleGeometry is built flat in the local XY plane; the mesh below
      // rotates -90° around X to lay it on the ground. That rotation sends
      // local Y to world -Z (world Z = -local Y), not +Z -- get this backwards
      // and the whole tint pattern mirrors relative to where the landmarks
      // actually are (matches pointOnCircle's sin/cos convention everywhere
      // else in the scene once negated).
      const z = -pos.getY(i);
      const angle = Math.atan2(x, z);
      let [r, g, b] = BASE_GRASS;
      let closest = null;
      let secondClosest = null;
      for (const t of tints) {
        const angularDist = Math.abs(angleDelta(angle, t.angle));
        const withinArc = 1 - smoothstep(0, rad(36), angularDist);
        if (withinArc > 0) {
          r = r + (t.rgb[0] - r) * withinArc;
          g = g + (t.rgb[1] - g) * withinArc;
          b = b + (t.rgb[2] - b) * withinArc;
        }
        if (!closest || angularDist < closest.d) { secondClosest = closest; closest = { d: angularDist, rgb: t.rgb }; }
        else if (!secondClosest || angularDist < secondClosest.d) { secondClosest = { d: angularDist, rgb: t.rgb }; }
      }
      // Second, finer noise layer (ART_SPEC's own §6 tint stays the base
      // read): bleed 15% of the angularly-second-nearest zone's tone in
      // soft clumps so grass reads as textured turf, not a flat fill.
      if (secondClosest) {
        const clump = clumpNoise01(x, z) * 0.15;
        r = r + (secondClosest.rgb[0] - r) * clump;
        g = g + (secondClosest.rgb[1] - g) * clump;
        b = b + (secondClosest.rgb[2] - b) * clump;
      }
      const noise = (rng() * 2 - 1) * 0.05;
      colors[i * 3] = Math.min(1, Math.max(0, r + noise));
      colors[i * 3 + 1] = Math.min(1, Math.max(0, g + noise));
      colors[i * 3 + 2] = Math.min(1, Math.max(0, b + noise));
    }
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    return geo;
  }, []);
}

function usePebbleMatrices() {
  return useMemo(() => {
    const rng = makeRng(70);
    const dummy = new Object3D();
    const matrices = [];
    for (let i = 0; i < 10; i++) {
      const angle = rng() * Math.PI * 2;
      const r = PATH_RADIUS + (rng() * 2 - 1) * 0.3;
      dummy.position.set(Math.sin(angle) * r, 0.02, Math.cos(angle) * r);
      dummy.rotation.set(0, rng() * Math.PI, 0);
      const s = 0.7 + rng() * 0.6;
      dummy.scale.set(s, s * 0.6, s);
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());
    }
    return matrices;
  }, []);
}

export function Island() {
  const groundGeo = useGroundGeometry();
  const pathTexture = useMemo(() => makeSpeckle('#c2a06b', '#a5825a', 128, 0.08), []);
  const pebbleMatrices = usePebbleMatrices();
  // VISUAL_QUALITY_SPEC §5: jitter the skirt so its rim doesn't read as a
  // perfect lathed cylinder edge.
  const skirtGeo = useMemo(
    () => jitterVertices(new CylinderGeometry(ISLAND_RADIUS, ISLAND_RADIUS * 0.82, 0.6, 48, 1, true), ISLAND_RADIUS, 62),
    [],
  );

  return (
    <group>
      {/* Earth skirt (sides only -- the underside is never seen) */}
      <mesh position={[0, -0.3, 0]} geometry={skirtGeo}>
        <meshStandardMaterial color="#7a5c3e" roughness={1} />
      </mesh>

      {/* Vertex-tinted grass top */}
      <mesh geometry={groundGeo} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <meshStandardMaterial vertexColors roughness={1} />
      </mesh>

      {/* Kolobok's dirt path ring, speckled, with scattered pebbles -- gapped
          where the bridge crosses Grandpa's pond (see PATH_GAP_ constants). */}
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[PATH_RADIUS - 0.35, PATH_RADIUS + 0.35, 64, 1, PATH_GAP_THETA_START, PATH_GAP_THETA_LENGTH]} />
        <meshStandardMaterial map={pathTexture} roughness={1} />
      </mesh>
      <instancedMesh
        args={[undefined, undefined, pebbleMatrices.length]}
        ref={(mesh) => {
          if (!mesh) return;
          pebbleMatrices.forEach((m, i) => mesh.setMatrixAt(i, m));
          mesh.instanceMatrix.needsUpdate = true;
        }}
      >
        <sphereGeometry args={[0.05, 6, 6]} />
        <meshStandardMaterial color="#9c9c94" roughness={0.9} />
      </instancedMesh>
    </group>
  );
}
