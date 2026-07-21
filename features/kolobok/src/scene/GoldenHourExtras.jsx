import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, ConeGeometry, Object3D,
} from 'three';
import { atmosphereLive } from '../state/sceneStore';
import { currentPhase } from '../config/atmosphere';
import { wind } from './wind';
import { polish } from '../config/devFlags';
import { makeRng } from './prng';
import { mergeColoredParts } from './builders/mergeColoredParts';

const dummy = new Object3D();
const rad = (deg) => (deg * Math.PI) / 180;

const POLLEN_COUNT = 20;
const BIRD_INTERVAL_MIN_S = 20;
const BIRD_INTERVAL_MAX_S = 45;
const BIRD_DURATION_S = 12;
const BIRD_RADIUS = 17;
const BIRD_HEIGHT = 9;

/** Elevation-based when location is available (a wider band than the
 *  twilight blend itself, since "golden" reads for a few minutes either
 *  side of the exact horizon crossing); the phase-name fallback otherwise. */
function isGoldenBand() {
  if (atmosphereLive.sunElevation !== null) {
    return atmosphereLive.sunElevation > -4 && atmosphereLive.sunElevation < 10;
  }
  const phase = currentPhase();
  return phase === 'sunrise' || phase === 'sunset';
}
function isDay() {
  if (atmosphereLive.sunElevation !== null) return atmosphereLive.sunElevation > 10;
  return currentPhase() === 'day';
}

/** POLISH_SPEC §5 "never a static frame" extras: golden-hour pollen,
 *  distant birds (day only), and god rays (golden bands only) -- each with
 *  its own `polish.*` kill switch for the ship-readiness audit. */
export function GoldenHourExtras() {
  const pollenRef = useRef();
  const birdRef = useRef();
  const rayRefs = useRef([]);

  const pollenGeometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(POLLEN_COUNT * 3), 3));
    return geo;
  }, []);
  const pollenState = useRef((() => {
    const rng = makeRng(250);
    return new Array(POLLEN_COUNT).fill(0).map(() => ({
      x: (rng() * 2 - 1) * 8, z: (rng() * 2 - 1) * 8, y: 0.3 + rng() * 1.2, phase: rng() * Math.PI * 2,
    }));
  })());

  // A "V" of 4 dark triangle sprites, cheap flat wings via ConeGeometry(3
  // segments) scaled thin -- ~2 tris each, ~8 total, well under the "~30
  // tris of pure life" budget.
  const birdGeometry = useMemo(() => mergeColoredParts([
    { geometry: new ConeGeometry(0.12, 0.3, 3), color: '#2e2e33', position: [0, 0, 0], rotation: [Math.PI / 2, 0, 0] },
    { geometry: new ConeGeometry(0.1, 0.24, 3), color: '#2e2e33', position: [-0.3, 0, -0.15], rotation: [Math.PI / 2, 0, 0.3] },
    { geometry: new ConeGeometry(0.1, 0.24, 3), color: '#2e2e33', position: [0.3, 0, -0.15], rotation: [Math.PI / 2, 0, -0.3] },
    { geometry: new ConeGeometry(0.08, 0.2, 3), color: '#2e2e33', position: [-0.55, 0, -0.32], rotation: [Math.PI / 2, 0, 0.3] },
  ]), []);
  const birdState = useRef({ nextIn: BIRD_INTERVAL_MIN_S, t: -1, startAngle: 0 });

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const clock = Date.now() / 1000;

    // --- Golden-hour pollen ---
    if (pollenRef.current) {
      const on = polish.pollen && isGoldenBand();
      pollenRef.current.visible = on;
      if (on) {
        const positions = pollenGeometry.attributes.position;
        pollenState.current.forEach((p, i) => {
          p.phase += dt * 0.15;
          const driftX = wind.direction[0] * wind.strength * 0.1;
          const driftZ = wind.direction[2] * wind.strength * 0.1;
          p.x += driftX * dt;
          p.z += driftZ * dt;
          if (p.x > 9) p.x = -9; if (p.x < -9) p.x = 9;
          if (p.z > 9) p.z = -9; if (p.z < -9) p.z = 9;
          positions.setXYZ(i, p.x, p.y + Math.sin(p.phase) * 0.08, p.z);
        });
        positions.needsUpdate = true;
        pollenGeometry.computeBoundingSphere();
      }
    }

    // --- Distant birds (day only) ---
    if (birdRef.current) {
      const bs = birdState.current;
      if (bs.t < 0) {
        if (!polish.birds || !isDay()) { birdRef.current.visible = false; }
        else {
          bs.nextIn -= dt;
          if (bs.nextIn <= 0) {
            bs.t = 0;
            bs.startAngle = Math.random() * Math.PI * 2;
            bs.nextIn = BIRD_INTERVAL_MIN_S + Math.random() * (BIRD_INTERVAL_MAX_S - BIRD_INTERVAL_MIN_S);
          }
        }
      }
      if (bs.t >= 0) {
        bs.t += dt;
        if (bs.t > BIRD_DURATION_S || !isDay()) { bs.t = -1; birdRef.current.visible = false; } else {
          const t = bs.t / BIRD_DURATION_S;
          const angle = bs.startAngle + t * Math.PI * 0.6;
          const flap = 1 + Math.sin(clock * Math.PI * 2 * 2) * 0.3;
          dummy.position.set(Math.sin(angle) * BIRD_RADIUS, BIRD_HEIGHT, Math.cos(angle) * BIRD_RADIUS);
          dummy.rotation.set(0, angle, 0);
          dummy.scale.set(1, flap, 1);
          dummy.updateMatrix();
          birdRef.current.matrix.copy(dummy.matrix);
          birdRef.current.matrixAutoUpdate = false;
          birdRef.current.visible = true;
        }
      }
    }

    // --- God rays (golden bands only) ---
    const raysOn = polish.godRays && isGoldenBand();
    const az = atmosphereLive.sunAzimuth !== null ? (atmosphereLive.sunAzimuth * Math.PI) / 180 : 0;
    rayRefs.current.forEach((mesh, i) => {
      if (!mesh) return;
      mesh.visible = raysOn;
      if (!raysOn) return;
      const spread = (i - 1) * rad(6);
      mesh.rotation.y = az + Math.PI + spread;
      mesh.material.opacity = 0.04 + Math.sin(clock * 0.3 + i) * 0.02;
    });
  });

  return (
    <>
      <points ref={pollenRef} geometry={pollenGeometry} visible={false}>
        <pointsMaterial color="#ffe9b0" size={0.05} transparent opacity={0.3} depthWrite={false} />
      </points>

      <mesh ref={birdRef} geometry={birdGeometry} visible={false}>
        <meshBasicMaterial vertexColors />
      </mesh>

      {[0, 1, 2].map((i) => (
        <mesh
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          ref={(m) => { rayRefs.current[i] = m; }}
          position={[0, 3, 0]}
          rotation={[0, 0, 0]}
          visible={false}
        >
          <planeGeometry args={[4, 0.5]} />
          <meshBasicMaterial
            color="#ffdf9e"
            transparent
            opacity={0.06}
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ))}
    </>
  );
}
