import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Object3D, Quaternion, Vector3,
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

// BACKLOG.md #5 fox-catch VFX: rays of light radiating out from Kolobok's
// center, plus a smoke puff, both triggered once via storyMotion.catchBurstId
// (same burst-counter convention as notes/dust above) right at the gulp.
// Live feedback: rays now radiate in EVERY direction (the old version only
// ever rotated around Y, so every ray sat flat in the horizontal plane --
// never up or down), exactly 40 of them, evenly distributed so none of them
// bunch up near each other. Length was 135% of Kolobok's own diameter,
// shortened 20% per live feedback (135% * 0.8 = 108%).
const RAY_COUNT = 40;
const RAY_CAPACITY = RAY_COUNT;
const RAY_LENGTH = KOLOBOK_RADIUS * 2 * 1.08; // "exceeds kolobok's length by 8%" (was 35%, -20%)
const RAY_GROW_S = 0.15;
const RAY_LIFE = 0.5;
const CATCH_SMOKE_COUNT = 16;
const CATCH_SMOKE_LIFE = 2.6;

const dummy = new Object3D();
const X_AXIS = new Vector3(1, 0, 0);
const rayQuatTmp = new Quaternion();
const burstAxisTmp = new Vector3();
const burstQuatTmp = new Quaternion();

/** Fibonacci lattice: the standard even-point-on-a-sphere distribution --
 *  consecutive points are always exactly the golden angle apart, which is
 *  what keeps them spread out with no clustering no matter how many points
 *  (unlike a naive lat/long grid, which bunches up at the poles). Pure/
 *  count-only, so this is computed ONCE at module scope, not re-rolled --
 *  each burst instead applies a fresh random overall rotation on top (see
 *  the catchBurstId handler below) so consecutive explosions don't look
 *  identical, without disturbing the even spacing itself. */
function fibonacciSphere(n) {
  const pts = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i += 1) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * i;
    pts.push(new Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r));
  }
  return pts;
}
const RAY_BASE_DIRECTIONS = fibonacciSphere(RAY_COUNT);

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
    // Live feedback: "an explosion as Kolobok disappears" on returning to the
    // 3D scene -- storyMotion.*BurstId are module-level and outlive this
    // component's own mount/unmount (leaving the pond, coming back), but
    // hardcoding these trackers to 0 meant a fresh mount always saw a leftover
    // nonzero counter from a PRIOR session as "a brand new burst just
    // happened" and replayed it immediately. Seeding each tracker from the
    // counter's CURRENT value at mount time instead means only a genuinely
    // NEW increment after that point ever fires.
    noteBurstWas: storyMotion.noteBurstId,
    burstQueue: 0,
    dust: new Array(DUST_COUNT).fill(0).map(() => ({ t: 2, dx: 0, dz: 0 })),
    dustBurstWas: storyMotion.dustBurstId,
    catchBurstWas: storyMotion.catchBurstId,
    rayT: RAY_LIFE + 1,
    rayOrigin: [0, 0, 0],
    // Rotated copies of RAY_BASE_DIRECTIONS, refreshed each burst (see
    // catchBurstId handler below) -- keeps the even golden-angle spacing
    // while still varying which way the whole lattice faces each time.
    rayDirections: RAY_BASE_DIRECTIONS.map((v) => v.clone()),
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
      // Fresh random overall rotation of the whole Fibonacci lattice this
      // burst (see RAY_BASE_DIRECTIONS' own comment) -- varies which way the
      // 40 rays face without disturbing their even spacing.
      burstAxisTmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      burstQuatTmp.setFromAxisAngle(burstAxisTmp, Math.random() * Math.PI * 2);
      RAY_BASE_DIRECTIONS.forEach((base, i) => {
        s.rayDirections[i].copy(base).applyQuaternion(burstQuatTmp);
      });
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
          // Full 3D direction (not just a Y-axis angle) -- setFromUnitVectors
          // finds the quaternion that rotates the plane's local +X (its long
          // axis) to point exactly along this ray's own direction, whichever
          // way that is (up, down, sideways, anything between).
          const dir = s.rayDirections[i];
          rayQuatTmp.setFromUnitVectors(X_AXIS, dir);
          dummy.position.set(
            s.rayOrigin[0] + dir.x * (len / 2),
            s.rayOrigin[1] + dir.y * (len / 2),
            s.rayOrigin[2] + dir.z * (len / 2),
          );
          dummy.quaternion.copy(rayQuatTmp);
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
