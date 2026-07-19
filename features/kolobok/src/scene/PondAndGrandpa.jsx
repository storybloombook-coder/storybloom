import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import {
  CapsuleGeometry, ConeGeometry, CylinderGeometry, Object3D, SphereGeometry,
} from 'three';
import { rad, pointOnCircle } from '../config/zones';
import { mergeColoredParts } from './builders/mergeColoredParts';
import { eggMotion, eggManager } from './easterEggs';

const dummy = new Object3D();

// ART_SPEC §14: pond at 324 deg, radius 5.6 (the free arc between fox and
// izba, rim side of the path).
const POND_ANGLE = rad(324);
const POND_POS = pointOnCircle(5.6, POND_ANGLE);

const RECAST_INTERVAL = 30;
const RIPPLE_COUNT = 3;

/** The pond + Grandpa fishing (ART_SPEC §14 / EASTER_EGGS.md §2): always-on
 *  ambient (float bob, ~30s recasts with ripples) plus the tap-egg catch
 *  animation driven by eggMotion. 6 draw calls. */
export function PondAndGrandpa() {
  const rodRef = useRef();
  const floatRef = useRef();
  const fishRef = useRef();
  const fishMatRef = useRef();
  const headRef = useRef();
  const ripplesRef = useRef();

  // Water (the one shiny surface) + everything matte merged separately.
  const matteGeometry = useMemo(() => mergeColoredParts([
    // Rim ring approximated as a flattened torus-ish ring of spheres? Keep
    // simple: lighter flat disc slightly larger under the water disc.
    { geometry: new CylinderGeometry(1.62, 1.62, 0.02, 24), color: '#8fc0d8', position: [0, 0.005, 0] },
    // Reeds x2 + lily pad.
    { geometry: new CylinderGeometry(0.02, 0.02, 0.5, 5), color: '#5d8a3f', position: [1.1, 0.25, 0.5] },
    { geometry: new ConeGeometry(0.04, 0.12, 5), color: '#5d8a3f', position: [1.1, 0.56, 0.5] },
    { geometry: new CylinderGeometry(0.02, 0.02, 0.4, 5), color: '#5d8a3f', position: [1.25, 0.2, 0.35] },
    { geometry: new ConeGeometry(0.04, 0.1, 5), color: '#5d8a3f', position: [1.25, 0.45, 0.35] },
    { geometry: new CylinderGeometry(0.09, 0.09, 0.01, 10), color: '#4f7d45', position: [-0.5, 0.03, 0.6] },
    // Stump.
    { geometry: new CylinderGeometry(0.14, 0.16, 0.22, 8), color: '#6b4c33', position: [-1.15, 0.11, -0.6] },
  ]), []);

  const grandpaGeometry = useMemo(() => mergeColoredParts([
    { geometry: new CapsuleGeometry(0.17, 0.24, 3, 8), color: '#8a7862', position: [0, 0.42, 0] }, // kaftan body
    { geometry: new SphereGeometry(0.05, 6, 6), color: '#4a4038', position: [0.08, 0.06, 0.12] },  // boots
    { geometry: new SphereGeometry(0.05, 6, 6), color: '#4a4038', position: [-0.08, 0.06, 0.12] },
  ]), []);

  const headGeometry = useMemo(() => mergeColoredParts([
    { geometry: new SphereGeometry(0.13, 10, 8), color: '#e8c8a8', position: [0, 0, 0] },
    { geometry: new ConeGeometry(0.09, 0.16, 6), color: '#d8d8d2', position: [0, -0.1, 0.09], rotation: [0.5, 0, 0] }, // beard
    { geometry: new CylinderGeometry(0.09, 0.11, 0.06, 8), color: '#8a6444', position: [0, 0.11, 0] }, // cap
    { geometry: new SphereGeometry(0.05, 6, 6), color: '#8a6444', position: [0, 0.15, 0] },
  ]), []);

  const rodGeometry = useMemo(() => mergeColoredParts([
    { geometry: new CylinderGeometry(0.008, 0.012, 0.7, 5), color: '#6b4c33', position: [0, 0.35, 0] },
    // Line: thin cylinder from tip angled down toward the float area.
    { geometry: new CylinderGeometry(0.003, 0.003, 0.55, 3), color: '#e8e4da', position: [0, 0.44, 0.26], rotation: [rad(65), 0, 0] },
  ]), []);

  const fishGeometry = useMemo(() => mergeColoredParts([
    { geometry: new CapsuleGeometry(0.05, 0.1, 2, 6), color: '#b8c4cc', rotation: [0, 0, Math.PI / 2] },
    { geometry: new ConeGeometry(0.04, 0.07, 4), color: '#b8c4cc', position: [0.11, 0, 0], rotation: [0, 0, -Math.PI / 2] },
  ]), []);

  const state = useRef({
    nextRecastIn: 8,
    recastT: -1,
    ripples: new Array(RIPPLE_COUNT).fill(0).map(() => ({ t: 2 })),
    rippleWas: 0,
  });

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const s = state.current;
    const t = Date.now();

    // Idle recast every ~30s (skipped while an egg catch is running).
    if (!eggManager.running) {
      if (s.recastT < 0) {
        s.nextRecastIn -= dt;
        if (s.nextRecastIn <= 0) { s.recastT = 0; s.nextRecastIn = RECAST_INTERVAL * (0.85 + Math.random() * 0.3); }
      } else {
        s.recastT += dt / 0.9;
        if (s.recastT >= 1) { s.recastT = -1; s.rippleWas -= 1; /* force a ripple below */ }
      }
    }
    const recastSweep = s.recastT >= 0 ? Math.sin(s.recastT * Math.PI) * rad(35) : 0;

    if (rodRef.current) rodRef.current.rotation.x = rad(-40) + recastSweep + eggMotion.rodPitch;
    if (headRef.current) headRef.current.rotation.z = eggMotion.headShake;

    // Float: gentle bob, lifted by the yank.
    if (floatRef.current) {
      const bob = Math.sin(t / 1000 * Math.PI * 2 * 0.4) * 0.02;
      floatRef.current.position.y = 0.03 + bob + eggMotion.floatYank * 0.5;
    }

    // Fish/boot: hidden until fishT >= 0. 0..1 = arc from water to hands
    // (with two flips); 1..2 = release arc back to the water.
    if (fishRef.current) {
      const ft = eggMotion.fishT;
      fishRef.current.visible = ft >= 0;
      if (ft >= 0) {
        const phase = Math.min(ft, 1);
        const back = Math.max(0, ft - 1);
        const x = 0.35 - (phase - back) * 0.9;
        const y = 0.15 + Math.sin((phase - back) * Math.PI) * 0.7;
        fishRef.current.position.set(x, Math.max(0.1, y), 0.45);
        fishRef.current.rotation.z = eggMotion.fishKind === 'boot' ? ft * 2 : Math.sin(phase * Math.PI * 2) * Math.PI;
        const isBoot = eggMotion.fishKind === 'boot';
        fishRef.current.scale.set(isBoot ? 0.9 : 1, isBoot ? 1.4 : 1, isBoot ? 0.9 : 1);
        if (fishMatRef.current) {
          fishMatRef.current.color.set(isBoot ? '#4a4038' : '#b8c4cc');
          fishMatRef.current.emissive.set(eggMotion.fishKind === 'gold' ? '#ffd27a' : '#000000');
          fishMatRef.current.emissiveIntensity = eggMotion.fishKind === 'gold' ? 0.6 + Math.sin(t / 150) * 0.3 : 0;
        }
      }
    }

    // Ripples: spawn a 3-ring set whenever rippleBurst bumps (or recast).
    if (eggMotion.rippleBurst !== s.rippleWas) {
      s.rippleWas = eggMotion.rippleBurst;
      s.ripples.forEach((r, i) => { r.t = -i * 0.25; });
    }
    if (ripplesRef.current) {
      const mesh = ripplesRef.current;
      let anyAlive = false;
      s.ripples.forEach((r, i) => {
        r.t += dt;
        const alive = r.t >= 0 && r.t < 1;
        if (alive) anyAlive = true;
        const sc = alive ? 0.1 + r.t * 0.5 : 0.0001;
        dummy.position.set(0.35, 0.03, 0.45); // float's water spot
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(sc, sc, sc);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.visible = anyAlive;
    }
  });

  const onTapGrandpa = (e) => {
    e.stopPropagation();
    eggManager.tap('grandpa');
  };

  return (
    <group position={POND_POS} rotation={[0, POND_ANGLE + Math.PI, 0]}>
      {/* Water: the one shiny surface in the scene */}
      <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.5, 24]} />
        <meshStandardMaterial color="#6fa8c8" roughness={0.25} />
      </mesh>
      <mesh geometry={matteGeometry}>
        <meshStandardMaterial vertexColors roughness={0.9} />
      </mesh>

      {/* Grandpa on his stump, facing the water */}
      <group position={[-1.15, 0.22, -0.6]} rotation={[0, rad(35), 0]} onClick={onTapGrandpa}>
        <mesh geometry={grandpaGeometry}>
          <meshStandardMaterial vertexColors roughness={0.9} />
        </mesh>
        <group ref={headRef} position={[0, 0.72, 0]}>
          <mesh geometry={headGeometry}>
            <meshStandardMaterial vertexColors roughness={0.85} />
          </mesh>
        </group>
        <group ref={rodRef} position={[0.14, 0.45, 0.12]} rotation={[rad(-40), 0, 0]}>
          <mesh geometry={rodGeometry}>
            <meshStandardMaterial vertexColors roughness={0.9} />
          </mesh>
        </group>
        {/* Generous hitbox */}
        <mesh position={[0, 0.4, 0]} visible={false}>
          <sphereGeometry args={[0.8, 6, 6]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
      </group>

      {/* Float on the water in front of him */}
      <mesh ref={floatRef} position={[0.35, 0.03, 0.45]}>
        <sphereGeometry args={[0.03, 8, 6]} />
        <meshStandardMaterial color="#c0452e" roughness={0.6} />
      </mesh>

      {/* Fish / golden fish / boot (kind-swapped via color/scale) */}
      <mesh ref={fishRef} geometry={fishGeometry} visible={false}>
        <meshStandardMaterial ref={fishMatRef} color="#b8c4cc" roughness={0.5} />
      </mesh>

      {/* Expanding ripple rings */}
      <instancedMesh ref={ripplesRef} args={[undefined, undefined, RIPPLE_COUNT]} visible={false}>
        <ringGeometry args={[0.8, 1, 20]} />
        <meshBasicMaterial color="#cfe4f0" transparent opacity={0.4} depthWrite={false} />
      </instancedMesh>
    </group>
  );
}
