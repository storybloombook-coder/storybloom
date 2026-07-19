import { useMemo, useRef } from 'react';
import { Color, Object3D } from 'three';
import { makeRng } from './prng';

const dummy = new Object3D();

const RING_A = { count: 40, radiusMin: 19, radiusMax: 24, color: '#3a5238' };
const RING_B = { count: 20, radiusMin: 26, radiusMax: 30, color: '#2e4230' };
const TREE_TOTAL = RING_A.count + RING_B.count;

const HILLS = [
  { angleDeg: 30, radius: 26, r: 7 },
  { angleDeg: 160, radius: 26, r: 9 },
  { angleDeg: 260, radius: 26, r: 6 },
];

/** Distant treeline + hill backdrop (ART_SPEC §13) so the island reads as
 *  floating in a world, not a void. Static, unlit (fog alone handles the
 *  depth fade), and does not rotate/track anything -- world scenery like the
 *  sky dome. Two rings of instanced spruce silhouettes at different radii
 *  and tints merge into ONE instancedMesh via per-instance color, keeping
 *  this whole backdrop to 2 draw calls (spec budgets ~4 for a naive 1
 *  instancedMesh + 3 separate hill meshes; hills are instanced here too). */
export function BackgroundForest() {
  const treeMeshRef = useRef();
  const hillMeshRef = useRef();

  const trees = useMemo(() => {
    const rng = makeRng(90);
    const out = [];
    for (const ring of [RING_A, RING_B]) {
      for (let i = 0; i < ring.count; i++) {
        const angle = rng() * Math.PI * 2;
        const radius = ring.radiusMin + rng() * (ring.radiusMax - ring.radiusMin);
        const scale = 1.8 + rng() * 1.4;
        const y = -1 + rng(); // sinks 0..-1, "beyond the horizon"
        out.push({
          x: Math.sin(angle) * radius,
          z: Math.cos(angle) * radius,
          y,
          scale,
          yaw: rng() * Math.PI * 2,
          color: new Color(ring.color),
        });
      }
    }
    return out;
  }, []);

  const setTreeMesh = (mesh) => {
    treeMeshRef.current = mesh;
    if (!mesh) return;
    trees.forEach((t, i) => {
      dummy.position.set(t.x, t.y, t.z);
      dummy.rotation.set(0, t.yaw, 0);
      dummy.scale.set(t.scale, t.scale, t.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, t.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  const setHillMesh = (mesh) => {
    hillMeshRef.current = mesh;
    if (!mesh) return;
    HILLS.forEach((h, i) => {
      const a = (h.angleDeg * Math.PI) / 180;
      // The hill is a sphere flattened to (h.r, h.r*0.22, h.r), so its
      // half-height above its own center is h.r*0.22. Sink the center to
      // -h.r*0.12 so most of the mound sits below y=0 (a mound, not a
      // floating ball) while its crown still crests to +h.r*0.1 -- a
      // fixed -h.r*0.9 (tried first) buried the whole hill below ground,
      // since 0.9 > 0.22 leaves the peak still deep underground.
      dummy.position.set(Math.sin(a) * h.radius, -h.r * 0.12, Math.cos(a) * h.radius);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(h.r, h.r * 0.22, h.r);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };

  return (
    <group>
      <instancedMesh ref={setTreeMesh} args={[undefined, undefined, TREE_TOTAL]}>
        <coneGeometry args={[0.5, 1.6, 6]} />
        {/* No base `color` here on purpose: white is the multiplicative
            identity, so `instanceColor` alone (set per-tree below) comes
            through undistorted. Their pale look at the horizon in-game is
            correct fog atmospheric-perspective (ART_SPEC §13), not this
            material rendering wrong -- confirmed by toggling <Sky/> off and
            seeing the same pale shape unchanged. */}
        <meshBasicMaterial fog />
      </instancedMesh>
      <instancedMesh ref={setHillMesh} args={[undefined, undefined, HILLS.length]}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshBasicMaterial color="#46603f" fog />
      </instancedMesh>
    </group>
  );
}
