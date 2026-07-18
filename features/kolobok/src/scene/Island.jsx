import { useMemo } from 'react';
import { Object3D } from 'three';
import {
  ISLAND_RADIUS, PATH_RADIUS, ZONES, rad, angleDelta,
} from '../config/zones';

const TREE_COUNT = 22;
const KEEP_CLEAR = rad(16); // no trees within this arc of a zone landmark

function useTreeMatrices() {
  return useMemo(() => {
    const dummy = new Object3D();
    const matrices = [];
    let attempts = 0;
    while (matrices.length < TREE_COUNT && attempts < 400) {
      attempts += 1;
      const a = Math.random() * Math.PI * 2;
      const tooClose = ZONES.some(
        (z) => Math.abs(angleDelta(a, rad(z.angleDeg))) < KEEP_CLEAR,
      );
      if (tooClose) continue;
      const r = 6.6 + Math.random() * 1.1; // outer rim band
      const s = 0.7 + Math.random() * 0.7;
      dummy.position.set(Math.sin(a) * r, 0.9 * s, Math.cos(a) * r);
      dummy.scale.set(s, s, s);
      dummy.rotation.y = Math.random() * Math.PI;
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());
    }
    return matrices;
  }, []);
}

export function Island() {
  const trees = useTreeMatrices();

  return (
    <group>
      {/* Island body */}
      <mesh position={[0, -0.3, 0]}>
        <cylinderGeometry args={[ISLAND_RADIUS, ISLAND_RADIUS * 0.82, 0.6, 48]} />
        <meshStandardMaterial color="#7aa85c" roughness={1} />
      </mesh>

      {/* Kolobok's dirt path ring */}
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[PATH_RADIUS - 0.35, PATH_RADIUS + 0.35, 64]} />
        <meshStandardMaterial color="#c2a06b" roughness={1} />
      </mesh>

      {/* Greybox trees: cone canopies, instanced in one draw call */}
      <instancedMesh
        args={[undefined, undefined, trees.length]}
        ref={(mesh) => {
          if (!mesh) return;
          trees.forEach((m, i) => mesh.setMatrixAt(i, m));
          mesh.instanceMatrix.needsUpdate = true;
        }}
      >
        <coneGeometry args={[0.55, 1.8, 7]} />
        <meshStandardMaterial color="#4f7d45" roughness={1} />
      </instancedMesh>
    </group>
  );
}
