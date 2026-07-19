import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import { BufferAttribute, BufferGeometry } from 'three';
import { storyMotion } from '../state/sceneStore';

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

export function KolobokParticles() {
  const notesRef = useRef();
  const dustRef = useRef();

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

  const state = useRef({
    notes: new Array(NOTE_COUNT).fill(0).map(() => ({ t: 2, dx: 0, dz: 0 })), // t > life = dead
    nextNoteIn: 0,
    noteBurstWas: 0,
    burstQueue: 0,
    dust: new Array(DUST_COUNT).fill(0).map(() => ({ t: 2, dx: 0, dz: 0 })),
    dustBurstWas: 0,
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
  });

  return (
    <group>
      <points ref={notesRef} geometry={noteGeometry}>
        <pointsMaterial color="#ffffff" size={0.09} transparent opacity={0} depthWrite={false} />
      </points>
      <points ref={dustRef} geometry={dustGeometry} visible={false}>
        <pointsMaterial color="#c8c4bc" size={0.07} transparent opacity={0.7} depthWrite={false} />
      </points>
    </group>
  );
}
