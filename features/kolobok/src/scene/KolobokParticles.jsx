import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Object3D,
} from 'three';
import { storyMotion } from '../state/sceneStore';
import { KOLOBOK_RADIUS } from '../config/zones';

// Song notes (ART_SPEC §9): 6 points above Kolobok while singing, rising
// and fading over 1.2s, white. Also serves the road chapters' hum bursts
// (STORY_SPEC §2: every ~2s spawn 3 notes), triggered via
// storyMotion.noteBurstId. Dust (STORY_SPEC §3 birth landing): 6 gray
// particles puffing outward once per dustBurstId bump. One Points draw
// each; both pools spawn at storyMotion.kolobokWorldPos so they follow him
// wherever a story beat has placed him.
const NOTE_COUNT = 6;
const NOTE_LIFE = 1.2;
const DUST_COUNT = 6;
const DUST_LIFE = 0.5;

// BACKLOG.md #5 fox-catch VFX: rays of light radiating out to 4 Kolobok-
// radii, plus a smoke puff, both triggered once via storyMotion.catchBurstId
// (same burst-counter convention as notes/dust above) right at the gulp.
// Ray count and direction are re-rolled per burst (8-10 rays, random angles)
// so the burst doesn't read as a mechanical evenly-spaced starburst.
const RAY_COUNT_MIN = 8;
const RAY_COUNT_MAX = 10;
const RAY_CAPACITY = RAY_COUNT_MAX;
const RAY_LENGTH = KOLOBOK_RADIUS * 4;
const RAY_GROW_S = 0.15;
const RAY_LIFE = 0.5;
const CATCH_SMOKE_COUNT = 16;
const CATCH_SMOKE_LIFE = 2.6;

const dummy = new Object3D();

export function KolobokParticles() {
  const notesRef = useRef();
  const dustRef = useRef();
  const raysRef = useRef();
  const raysMatRef = useRef();
  const catchSmokeRef = useRef();

  const noteGeometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(NOTE_COUNT * 3), 3));
    return geo;
  }, []);
  const dustGeometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(DUST_COUNT * 3), 3));
    return geo;
  }, []);
  const catchSmokeGeometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(CATCH_SMOKE_COUNT * 3), 3));
    return geo;
  }, []);

  const state = useRef({
    notes: new Array(NOTE_COUNT).fill(0).map(() => ({ t: 2, dx: 0, dz: 0 })), // t > life = dead
    nextNoteIn: 0,
    noteBurstWas: 0,
    burstQueue: 0,
    dust: new Array(DUST_COUNT).fill(0).map(() => ({ t: 2, dx: 0, dz: 0 })),
    dustBurstWas: 0,
    catchBurstWas: 0,
    rayT: RAY_LIFE + 1,
    rayOrigin: [0, 0, 0],
    rayCount: 0,
    rayAngles: new Array(RAY_CAPACITY).fill(0),
    catchSmoke: new Array(CATCH_SMOKE_COUNT).fill(0).map(() => ({ t: CATCH_SMOKE_LIFE + 1, dx: 0, dz: 0 })),
  });

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const s = state.current;
    const [kx, ky, kz] = storyMotion.kolobokWorldPos;

    // --- Notes ---
    if (storyMotion.noteBurstId !== s.noteBurstWas) {
      s.noteBurstWas = storyMotion.noteBurstId;
      s.burstQueue += 3;
    }
    let spawnBudget = s.burstQueue;
    if (storyMotion.kolobokSinging) {
      s.nextNoteIn -= dt;
      if (s.nextNoteIn <= 0) { spawnBudget += 1; s.nextNoteIn = 0.35; }
    }
    s.notes.forEach((n) => {
      if (n.t <= NOTE_LIFE) {
        n.t += dt;
      } else if (spawnBudget > 0) {
        spawnBudget -= 1;
        if (s.burstQueue > 0) s.burstQueue -= 1;
        n.t = 0;
        n.dx = (Math.random() - 0.5) * 0.5;
        n.dz = (Math.random() - 0.5) * 0.5;
      }
    });
    if (notesRef.current) {
      const positions = noteGeometry.attributes.position;
      s.notes.forEach((n, i) => {
        if (n.t <= NOTE_LIFE) {
          positions.setXYZ(i, kx + n.dx, ky + 0.7 + (n.t / NOTE_LIFE) * 0.8, kz + n.dz);
        } else {
          positions.setXYZ(i, 0, -10, 0); // parked
        }
      });
      positions.needsUpdate = true;
      noteGeometry.computeBoundingSphere();
      // Whole-pool fade approximates per-note fade (single material).
      const youngest = Math.min(...s.notes.map((n) => n.t));
      notesRef.current.material.opacity = youngest <= NOTE_LIFE ? 0.9 * (1 - youngest / NOTE_LIFE) : 0;
    }

    // --- Dust ---
    if (storyMotion.dustBurstId !== s.dustBurstWas) {
      s.dustBurstWas = storyMotion.dustBurstId;
      s.dust.forEach((d) => {
        d.t = 0;
        const a = Math.random() * Math.PI * 2;
        d.dx = Math.cos(a) * (0.2 + Math.random() * 0.25);
        d.dz = Math.sin(a) * (0.2 + Math.random() * 0.25);
      });
    }
    if (dustRef.current) {
      const positions = dustGeometry.attributes.position;
      let anyAlive = false;
      s.dust.forEach((d, i) => {
        if (d.t <= DUST_LIFE) {
          anyAlive = true;
          d.t += dt;
          const f = d.t / DUST_LIFE;
          positions.setXYZ(i, kx + d.dx * f, ky - 0.4 + f * 0.15, kz + d.dz * f);
        } else {
          positions.setXYZ(i, 0, -10, 0);
        }
      });
      positions.needsUpdate = true;
      dustGeometry.computeBoundingSphere();
      dustRef.current.visible = anyAlive;
    }

    // --- Fox-catch burst: light rays + smoke (BACKLOG.md #5) ---
    if (storyMotion.catchBurstId !== s.catchBurstWas) {
      s.catchBurstWas = storyMotion.catchBurstId;
      s.rayT = 0;
      s.rayOrigin = [kx, ky, kz];
      s.rayCount = RAY_COUNT_MIN + Math.floor(Math.random() * (RAY_COUNT_MAX - RAY_COUNT_MIN + 1));
      for (let i = 0; i < RAY_CAPACITY; i += 1) {
        s.rayAngles[i] = Math.random() * Math.PI * 2;
      }
      s.catchSmoke.forEach((p) => {
        p.t = 0;
        const a = Math.random() * Math.PI * 2;
        p.dx = Math.cos(a) * (0.05 + Math.random() * 0.15);
        p.dz = Math.sin(a) * (0.05 + Math.random() * 0.15);
      });
    }

    if (raysRef.current) {
      const mesh = raysRef.current;
      const alive = s.rayT <= RAY_LIFE;
      if (alive) {
        s.rayT += dt;
        const growT = Math.min(1, s.rayT / RAY_GROW_S);
        const len = growT * RAY_LENGTH;
        for (let i = 0; i < RAY_CAPACITY; i += 1) {
          if (i >= s.rayCount) {
            // Unused slot this burst: park it with zero scale (invisible).
            dummy.position.set(s.rayOrigin[0], s.rayOrigin[1] - 10, s.rayOrigin[2]);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.set(0.001, 1, 1);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
            continue;
          }
          const rayAngle = s.rayAngles[i];
          const dx = Math.sin(rayAngle);
          const dz = Math.cos(rayAngle);
          dummy.position.set(
            s.rayOrigin[0] + dx * (len / 2),
            s.rayOrigin[1],
            s.rayOrigin[2] + dz * (len / 2),
          );
          dummy.rotation.set(0, rayAngle, 0);
          dummy.scale.set(Math.max(0.001, len), 1, 1);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
      mesh.visible = alive;
      if (raysMatRef.current) raysMatRef.current.opacity = alive ? Math.max(0, 1 - s.rayT / RAY_LIFE) : 0;
    }

    if (catchSmokeRef.current) {
      const positions = catchSmokeGeometry.attributes.position;
      let anyAlive = false;
      s.catchSmoke.forEach((p, i) => {
        if (p.t <= CATCH_SMOKE_LIFE) {
          anyAlive = true;
          p.t += dt;
          const f = p.t / CATCH_SMOKE_LIFE;
          positions.setXYZ(
            i,
            s.rayOrigin[0] + p.dx * (0.3 + f * 0.6),
            s.rayOrigin[1] + f * 0.9,
            s.rayOrigin[2] + p.dz * (0.3 + f * 0.6),
          );
        } else {
          positions.setXYZ(i, 0, -10, 0);
        }
      });
      positions.needsUpdate = true;
      catchSmokeGeometry.computeBoundingSphere();
      catchSmokeRef.current.visible = anyAlive;
      if (anyAlive) {
        const youngest = Math.min(...s.catchSmoke.map((p) => p.t));
        catchSmokeRef.current.material.opacity = 0.5 * Math.max(0, 1 - youngest / CATCH_SMOKE_LIFE);
      }
    }
  });

  return (
    <group>
      <points ref={notesRef} geometry={noteGeometry}>
        <pointsMaterial color="#ffffff" size={0.09} transparent opacity={0} depthWrite={false} />
      </points>
      <points ref={dustRef} geometry={dustGeometry} visible={false}>
        <pointsMaterial color="#c8c4bc" size={0.07} transparent opacity={0.7} depthWrite={false} />
      </points>
      <instancedMesh ref={raysRef} args={[undefined, undefined, RAY_CAPACITY]} visible={false}>
        <planeGeometry args={[1, 0.06]} />
        <meshBasicMaterial
          ref={raysMatRef}
          color="#fff2c4"
          transparent
          opacity={0}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>
      <points ref={catchSmokeRef} geometry={catchSmokeGeometry} visible={false}>
        <pointsMaterial color="#c8c4bc" size={0.18} transparent opacity={0.5} depthWrite={false} />
      </points>
    </group>
  );
}
