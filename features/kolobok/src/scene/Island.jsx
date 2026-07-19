import { useMemo } from 'react';
import { BufferAttribute, CircleGeometry, Object3D } from 'three';
import {
  ISLAND_RADIUS, PATH_RADIUS, ZONES, rad, angleDelta,
} from '../config/zones';
import { makeRng } from './prng';
import { makeSpeckle } from './textures/proceduralTextures';

const BASE_GRASS = [0x7a / 255, 0xa8 / 255, 0x5c / 255];

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
      for (const t of tints) {
        const angularDist = Math.abs(angleDelta(angle, t.angle));
        const withinArc = 1 - smoothstep(0, rad(36), angularDist);
        if (withinArc > 0) {
          r = r + (t.rgb[0] - r) * withinArc;
          g = g + (t.rgb[1] - g) * withinArc;
          b = b + (t.rgb[2] - b) * withinArc;
        }
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

  return (
    <group>
      {/* Earth skirt (sides only -- the underside is never seen) */}
      <mesh position={[0, -0.3, 0]}>
        <cylinderGeometry args={[ISLAND_RADIUS, ISLAND_RADIUS * 0.82, 0.6, 48, 1, true]} />
        <meshStandardMaterial color="#7a5c3e" roughness={1} />
      </mesh>

      {/* Vertex-tinted grass top */}
      <mesh geometry={groundGeo} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <meshStandardMaterial vertexColors roughness={1} />
      </mesh>

      {/* Kolobok's dirt path ring, speckled, with scattered pebbles */}
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[PATH_RADIUS - 0.35, PATH_RADIUS + 0.35, 64]} />
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
