import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import {
  BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Object3D, SphereGeometry,
} from 'three';
import { storyMotion } from '../state/sceneStore';
import { mergeColoredParts } from './builders/mergeColoredParts';
import { rad } from '../config/zones';
import { wind } from './wind';

const dummy = new Object3D();

// ============================================================ Izba ========
// ART_SPEC §11 + ANIMATION_SPEC §9. Chimney smoke is always-on (a Points
// pool); grandma's silhouette + the ridge bird are izba's "active" extras.
const SMOKE_COUNT = 24;

export function IzbaAmbience({ isActiveZone, chimneyPos = [0.55, 1.95, 0.15] }) {
  const smokeRef = useRef();
  const grandmaRef = useRef();
  const birdRef = useRef();

  const smokeGeometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(SMOKE_COUNT * 3), 3));
    return geo;
  }, []);
  const smokeState = useRef(
    new Array(SMOKE_COUNT).fill(0).map(() => ({ t: Math.random(), drift: Math.random() * Math.PI * 2 })),
  );

  const grandmaGeometry = useMemo(() => mergeColoredParts([
    { geometry: new SphereGeometry(0.09, 8, 6), color: '#3a3229', position: [0, 0.62, 0] },
    { geometry: new SphereGeometry(0.16, 6, 6), color: '#3a3229', position: [0, 0.32, 0], scale: [0.9, 1.2, 0.5] },
    { geometry: new ConeGeometry(0.1, 0.14, 6), color: '#3a3229', position: [0, 0.66, 0.03], rotation: [0.3, 0, 0] },
  ]), []);

  const birdGeometry = useMemo(() => mergeColoredParts([
    { geometry: new SphereGeometry(0.05, 6, 6), color: '#5a6470', position: [0, 0, 0] },
    { geometry: new SphereGeometry(0.035, 6, 6), color: '#5a6470', position: [0, 0.04, 0.06] },
    { geometry: new ConeGeometry(0.02, 0.05, 4), color: '#d9a441', position: [0, 0.04, 0.1], rotation: [Math.PI / 2, 0, 0] },
  ]), []);

  const state = useRef({
    grandmaNextIn: 20 + Math.random() * 15,
    grandmaT: -1, // -1 idle, 0..1 crossing
    birdNextIn: 10 + Math.random() * 8,
    birdT: -1,
    birdPhase: 'land', // land -> peck -> fly
  });

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const s = state.current;
    const now = Date.now();

    // --- Chimney smoke: always on, +30% spawn rate when active, and the
    // story's birth/rebirth beats double it (storyMotion.smokeBoost) ---
    if (smokeRef.current) {
      const rate = (isActiveZone ? 1.3 : 1) * storyMotion.smokeBoost;
      const positions = smokeGeometry.attributes.position;
      smokeState.current.forEach((p, i) => {
        p.t += dt * rate * 0.4;
        if (p.t > 1) { p.t = 0; p.drift = Math.random() * Math.PI * 2; }
        const rise = p.t * 1.5;
        const sway = Math.sin(p.t * Math.PI * 2 + p.drift) * 0.15;
        // Live feedback: "the wind should gently rustle... the smoke" --
        // same wind.direction-scaled drift convention as GoldenHourExtras'
        // pollen/DustTrail's puffs, growing with rise (t) so the smoke
        // visibly leans further downwind the higher it climbs, same as
        // real chimney smoke, layered on top of the existing flutter sway.
        const windDriftX = wind.direction[0] * wind.strength * p.t * 0.5;
        const windDriftZ = wind.direction[2] * wind.strength * p.t * 0.5;
        positions.setXYZ(
          i,
          chimneyPos[0] + sway + windDriftX,
          chimneyPos[1] + rise,
          chimneyPos[2] + sway * 0.6 + windDriftZ,
        );
      });
      positions.needsUpdate = true;
      smokeGeometry.computeBoundingSphere();
    }

    // --- Birth chapter: kneading/shaping motion takes over the same
    // silhouette instead of the ambient crossing below (STORY_SPEC's birth
    // chapter toggles this while Kolobok is still dough on the sill). ---
    if (storyMotion.grandmaCooking) {
      if (grandmaRef.current) {
        grandmaRef.current.visible = true;
        // Side-to-side kneading sway + a small bob, faster/tighter than the
        // slow window-crossing walk so it reads as "working," not "passing by".
        grandmaRef.current.position.x = Math.sin(now / 260) * 0.1;
        grandmaRef.current.position.y = Math.abs(Math.sin(now / 260)) * 0.03;
        grandmaRef.current.rotation.z = Math.sin(now / 260) * rad(6);
      }
      return;
    }

    // --- Active-only: grandma silhouette crosses the window every 20-35s ---
    if (isActiveZone) {
      if (s.grandmaT < 0) {
        s.grandmaNextIn -= dt;
        if (s.grandmaNextIn <= 0) { s.grandmaT = 0; s.grandmaNextIn = 20 + Math.random() * 15; }
      } else {
        s.grandmaT += dt / 1.8;
        if (s.grandmaT >= 1) s.grandmaT = -1;
      }
    }
    if (grandmaRef.current) {
      grandmaRef.current.visible = s.grandmaT >= 0;
      if (s.grandmaT >= 0) {
        grandmaRef.current.position.x = -0.15 + s.grandmaT * 0.3;
        grandmaRef.current.position.y = 0;
        grandmaRef.current.rotation.z = 0;
      }
    }

    // --- Active-only: ridge bird lands, pecks x3, flies off, every ~15s ---
    if (isActiveZone) {
      if (s.birdT < 0) {
        s.birdNextIn -= dt;
        if (s.birdNextIn <= 0) { s.birdT = 0; s.birdPhase = 'land'; s.birdNextIn = 15; }
      } else {
        s.birdT += dt;
      }
    }
    if (birdRef.current) {
      const visible = isActiveZone && s.birdT >= 0 && s.birdT < 3.2;
      birdRef.current.visible = visible;
      if (visible) {
        const peckCycle = (s.birdT % 0.6) / 0.6;
        const pecking = s.birdT < 2.2;
        birdRef.current.rotation.x = pecking && peckCycle < 0.4 ? -((25 * Math.PI) / 180) * Math.sin(peckCycle * Math.PI * 2.5) : 0;
        birdRef.current.position.x = pecking ? 0 : (s.birdT - 2.2) * 1.5;
        birdRef.current.position.y = pecking ? 0 : (s.birdT - 2.2) * 0.4;
      } else if (s.birdT >= 3.2) {
        s.birdT = -1;
      }
    }
  });

  return (
    <group>
      <points ref={smokeRef} geometry={smokeGeometry}>
        <pointsMaterial color="#c8c4bc" size={0.18} transparent opacity={0.55} depthWrite={false} />
      </points>
      <mesh ref={grandmaRef} geometry={grandmaGeometry} position={[0, 0, 0]} visible={false}>
        <meshBasicMaterial vertexColors />
      </mesh>
      <mesh ref={birdRef} geometry={birdGeometry} position={[0, 1.85, -0.05]} visible={false}>
        <meshStandardMaterial vertexColors roughness={0.8} />
      </mesh>
    </group>
  );
}

// ======================================================= Hare meadow ======
export function HareAmbience({ isActiveZone }) {
  const butterfliesRef = useRef();
  const count = 3; // 2 always + 1 active-only (hidden via scale when inactive)

  const wanderState = useRef(
    new Array(count).fill(0).map((_, i) => ({
      angle: (i / count) * Math.PI * 2,
      radius: 0.6 + Math.random() * 0.9,
      heightPhase: Math.random() * Math.PI * 2,
      landedT: -1,
      nextLandIn: 6 + Math.random() * 6,
    })),
  );

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const mesh = butterfliesRef.current;
    if (!mesh) return;
    let idx = 0;
    wanderState.current.forEach((b, i) => {
      const active = i < 2 || isActiveZone;
      if (active && i === 2 && b.landedT < 0) {
        b.nextLandIn -= dt;
        if (b.nextLandIn <= 0) { b.landedT = 0; b.nextLandIn = 9; }
      }
      if (b.landedT >= 0) {
        b.landedT += dt;
        if (b.landedT > 1.2) b.landedT = -1;
      }
      b.angle += dt * 0.3;
      const landed = b.landedT >= 0;
      const height = landed ? 0.35 : 0.3 + Math.sin(b.heightPhase + b.angle * 2) * 0.3 + 0.3;
      const x = Math.sin(b.angle) * b.radius;
      const z = Math.cos(b.angle) * b.radius;
      const flapHz = landed ? 1 : 8;
      const flap = Math.sin(Date.now() / 1000 * Math.PI * 2 * flapHz) * 0.4;

      for (let w = 0; w < 2; w++) {
        const side = w === 0 ? 1 : -1;
        dummy.position.set(x, height, z);
        dummy.rotation.set(0, b.angle, side * (0.5 + flap * 0.5));
        dummy.scale.set(active ? 1 : 0, active ? 1 : 0, active ? 1 : 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(idx, dummy.matrix);
        mesh.setColorAt(idx, BUTTERFLY_COLORS[i % BUTTERFLY_COLORS.length]);
        idx += 1;
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={butterfliesRef} args={[undefined, undefined, count * 2]}>
      <planeGeometry args={[0.06, 0.05]} />
      <meshBasicMaterial side={DoubleSide} transparent opacity={0.9} />
    </instancedMesh>
  );
}
const BUTTERFLY_COLORS = [new Color('#e8a8c8'), new Color('#e8e26e'), new Color('#e0e9f2')];

// ======================================================== Wolf forest =====
export function WolfAmbience({ isActiveZone }) {
  const wispsRef = useRef();
  const wispsMaterialRef = useRef();
  const crowRef = useRef();

  const crowGeometry = useMemo(() => mergeColoredParts([
    { geometry: new SphereGeometry(0.055, 6, 6), color: '#2e2e33', position: [0, 0, 0] },
    { geometry: new SphereGeometry(0.04, 6, 6), color: '#2e2e33', position: [0, 0.045, 0.07] },
  ]), []);

  const state = useRef({ wispPhase: [0, 2, 4].map((v) => v), crowNextIn: 20 + Math.random() * 10, crowT: -1 });

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const s = state.current;

    if (wispsRef.current) {
      const mesh = wispsRef.current;
      s.wispPhase = s.wispPhase.map((p) => p + dt * 0.05);
      s.wispPhase.forEach((p, i) => {
        const r = 1.1 + i * 0.3;
        dummy.position.set(Math.sin(p) * r, 0.08, Math.cos(p) * r);
        dummy.rotation.set(0, p, 0);
        dummy.scale.set(1.4, 0.25, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      // Per-instance opacity isn't supported on a shared-material
      // instancedMesh without a custom shader; approximated as one shared
      // flutter across all three wisps together rather than independently.
      if (wispsMaterialRef.current) {
        wispsMaterialRef.current.opacity = 0.12 + Math.sin(Date.now() / 800) * 0.03;
      }
    }

    if (isActiveZone) {
      if (s.crowT < 0) {
        s.crowNextIn -= dt;
        if (s.crowNextIn <= 0) { s.crowT = 0; s.crowNextIn = 25; }
      } else {
        s.crowT += dt;
        if (s.crowT > 2.5) s.crowT = -1;
      }
    }
    if (crowRef.current) {
      const visible = isActiveZone && s.crowT >= 0;
      crowRef.current.visible = visible;
      if (visible) {
        const t = s.crowT / 2.5;
        crowRef.current.position.set(-1.5 + t * 3, 2.4 + Math.sin(t * Math.PI * 4) * 0.08, 0.4);
        crowRef.current.rotation.z = Math.sin(t * 6) * 0.05;
      }
    }
  });

  return (
    <group>
      <instancedMesh ref={wispsRef} args={[undefined, undefined, 3]}>
        <sphereGeometry args={[0.25, 8, 6]} />
        <meshBasicMaterial ref={wispsMaterialRef} color="#cfd8de" transparent opacity={0.12} depthWrite={false} />
      </instancedMesh>
      <mesh ref={crowRef} geometry={crowGeometry} visible={false}>
        <meshBasicMaterial vertexColors />
      </mesh>
    </group>
  );
}

// ======================================================= Bear thicket =====
export function BearAmbience({ isActiveZone }) {
  const leavesRef = useRef();
  const beesRef = useRef();
  const logRef = useRef();

  const LEAF_COUNT = 2;
  const BEE_MAX = 5;

  const leafGeometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(LEAF_COUNT * 3), 3));
    return geo;
  }, []);
  const leafState = useRef(new Array(LEAF_COUNT).fill(0).map((_, i) => ({ t: i / LEAF_COUNT, angle: Math.random() * Math.PI * 2 })));

  const beeGeometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(BEE_MAX * 3), 3));
    return geo;
  }, []);
  const beeState = useRef(new Array(BEE_MAX).fill(0).map((_, i) => ({ angle: (i / BEE_MAX) * Math.PI * 2, r: 0.2 + Math.random() * 0.1 })));

  const logGeometry = useMemo(() => mergeColoredParts([
    { geometry: new CylinderGeometry(0.12, 0.12, 0.7, 8), color: '#6b4c33', rotation: [0, 0, Math.PI / 2] },
    { geometry: new SphereGeometry(0.08, 6, 6), color: '#e8c04a', position: [0.15, 0.1, 0], scale: [1, 0.4, 1] },
  ]), []);

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;

    if (leavesRef.current) {
      const positions = leafGeometry.attributes.position;
      leafState.current.forEach((l, i) => {
        l.t += dt / 3.5;
        if (l.t > 1) l.t = 0;
        const y = 2.2 - l.t * 2.2;
        const spiral = l.angle + l.t * Math.PI * 2 * 3.5;
        positions.setXYZ(i, Math.sin(spiral) * 0.15, y, Math.cos(spiral) * 0.15);
      });
      positions.needsUpdate = true;
      leafGeometry.computeBoundingSphere();
    }

    if (beesRef.current) {
      const positions = beeGeometry.attributes.position;
      const activeCount = isActiveZone ? BEE_MAX : 3;
      beeState.current.forEach((b, i) => {
        if (i >= activeCount) {
          positions.setXYZ(i, 0, -10, 0); // parked off-screen rather than a variable-length buffer
          return;
        }
        b.angle += dt * 1.2;
        const wobble = Math.sin(Date.now() / 300 + i) * 0.05;
        positions.setXYZ(i, Math.sin(b.angle) * b.r, 0.15 + wobble, Math.cos(b.angle) * b.r);
      });
      positions.needsUpdate = true;
      beeGeometry.computeBoundingSphere();
    }
  });

  return (
    <group>
      <points ref={leavesRef} geometry={leafGeometry}>
        <pointsMaterial color="#c9a24b" size={0.09} depthWrite={false} />
      </points>
      <points ref={beesRef} geometry={beeGeometry}>
        <pointsMaterial color="#e8c04a" size={0.06} depthWrite={false} />
      </points>
      <mesh ref={logRef} geometry={logGeometry} position={[0.5, 0.12, 0.3]}>
        <meshStandardMaterial vertexColors roughness={0.9} />
      </mesh>
    </group>
  );
}

// ======================================================= Fox clearing =====
export function FoxAmbience({ isActiveZone }) {
  const featherRef = useRef();
  const state = useRef({ nextIn: 20, t: -1, driftAngle: 0 });

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const s = state.current;
    if (isActiveZone) {
      if (s.t < 0) {
        s.nextIn -= dt;
        if (s.nextIn <= 0) { s.t = 0; s.nextIn = 20; s.driftAngle = 0; }
      } else {
        s.t += dt / 4;
        if (s.t >= 1) s.t = -1;
      }
    }
    if (featherRef.current) {
      const visible = isActiveZone && s.t >= 0;
      featherRef.current.visible = visible;
      if (visible) {
        s.driftAngle += dt * 0.6 * Math.PI * 2;
        featherRef.current.position.set(Math.sin(s.driftAngle) * 0.2, 1.8 - s.t * 1.8, 0);
        featherRef.current.rotation.z = Math.sin(s.driftAngle) * ((20 * Math.PI) / 180);
      }
    }
  });

  return (
    <mesh ref={featherRef} visible={false}>
      <planeGeometry args={[0.08, 0.03]} />
      <meshBasicMaterial color="#f2e8d8" side={DoubleSide} />
    </mesh>
  );
}
