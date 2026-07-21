import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import { BufferAttribute, BufferGeometry } from 'three';
import { storyMotion } from '../state/sceneStore';

// POLISH_SPEC §4 dust kick: while Kolobok's roll speed exceeds 0.2, spawn
// 2 puffs/s behind him (derived from his own frame-to-frame position delta
// rather than any internal facing/direction field, so this stays correct
// regardless of which way he's currently rolling), rising 0.15 and fading
// over 600ms.
const PUFF_COUNT = 8;
const SPEED_THRESHOLD = 0.2;
const SPAWN_RATE_HZ = 2;
const RISE = 0.15;
const FADE_S = 0.6;

export function DustTrail() {
  const pointsRef = useRef();
  const matRef = useRef();
  const geometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(PUFF_COUNT * 3), 3));
    return geo;
  }, []);
  const state = useRef({
    puffs: new Array(PUFF_COUNT).fill(0).map(() => ({ t: FADE_S + 1, x: 0, y: -10, z: 0 })),
    nextSlot: 0,
    spawnClock: 0,
    lastPos: null,
  });

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const s = state.current;
    const pos = storyMotion.kolobokWorldPos;

    if (!s.lastPos) s.lastPos = [pos[0], pos[1], pos[2]];
    const dx = pos[0] - s.lastPos[0];
    const dz = pos[2] - s.lastPos[2];
    s.lastPos[0] = pos[0]; s.lastPos[1] = pos[1]; s.lastPos[2] = pos[2];

    if (storyMotion.kolobokSpeed > SPEED_THRESHOLD) {
      s.spawnClock += dt;
      const interval = 1 / SPAWN_RATE_HZ;
      while (s.spawnClock >= interval) {
        s.spawnClock -= interval;
        const moveLen = Math.max(0.0001, Math.sqrt(dx * dx + dz * dz));
        const behindX = pos[0] - (dx / moveLen) * 0.35;
        const behindZ = pos[2] - (dz / moveLen) * 0.35;
        const puff = s.puffs[s.nextSlot];
        s.nextSlot = (s.nextSlot + 1) % PUFF_COUNT;
        puff.t = 0;
        puff.x = behindX + (Math.random() - 0.5) * 0.1;
        puff.y = 0.02;
        puff.z = behindZ + (Math.random() - 0.5) * 0.1;
      }
    }

    const positions = geometry.attributes.position;
    let anyAlive = false;
    s.puffs.forEach((p, i) => {
      if (p.t <= FADE_S) {
        p.t += dt;
        anyAlive = true;
        positions.setXYZ(i, p.x, p.y + (p.t / FADE_S) * RISE, p.z);
      } else {
        positions.setXYZ(i, 0, -10, 0);
      }
    });
    positions.needsUpdate = true;
    if (pointsRef.current) pointsRef.current.visible = anyAlive;
    if (matRef.current) {
      // One shared opacity for the whole pool -- individual per-point fade
      // isn't supported by a plain PointsMaterial, but with only 2 spawns/s
      // and a 600ms fade, at most one or two puffs are ever visible at once,
      // so a pool-wide opacity reads the same as per-puff fading would.
      const newest = s.puffs.reduce((freshest, p) => Math.min(freshest, p.t), Infinity);
      matRef.current.opacity = newest <= FADE_S ? 0.5 * (1 - newest / FADE_S) : 0;
    }
  });

  return (
    <points ref={pointsRef} geometry={geometry} visible={false}>
      <pointsMaterial ref={matRef} color="#c2a06b" size={0.06} transparent opacity={0} depthWrite={false} />
    </points>
  );
}
