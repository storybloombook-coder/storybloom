import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import { BackSide, Color, Object3D } from 'three';
import { atmosphereLive, orbit } from '../state/sceneStore';
import { makeRadialGradientData } from './textures/proceduralTextures';
import { makeRng } from './prng';

const SKY_RADIUS = 28;
const SUN_MOON_RADIUS = 24;

const dummy = new Object3D();
const CLOUD_MAX = 8; // WEATHER_SPEC §2 tops out at 8 clusters
const CELESTIAL_COUNT = 5; // sun, moon, crater x3
const SUN_COLOR = new Color('#ffe9a8');
const MOON_COLOR = new Color('#e8ecf4');
const CRATER_COLOR = new Color('#c8cedd');
const CRATER_OFFSETS = [[0.25, 0.2], [-0.2, -0.1], [0.05, -0.3]];

const to255 = (c) => `#${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;

/** Device-hour fallback arc (used only when there's no location for the
 *  real solar position): sun overhead at 13:00, moon at 01:00. Returns
 *  {x,y,z,visible}. */
function fallbackCelestial(hourOffset) {
  const hour = new Date().getHours() + new Date().getMinutes() / 60;
  const angle = ((hour - hourOffset) / 24) * Math.PI * 2;
  const height = Math.cos(angle) * 10;
  return {
    x: Math.sin(angle) * SUN_MOON_RADIUS,
    y: height,
    z: Math.cos(angle) * SUN_MOON_RADIUS * 0.4,
    visible: height > -1.5,
  };
}

/** Real solar placement (WEATHER_SPEC §1): azimuth/elevation degrees onto
 *  the dome. Azimuth is world-fixed (the sky does not rotate with the
 *  turntable). */
function solarToWorld(azimuthDeg, elevationDeg) {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const r = SUN_MOON_RADIUS;
  return {
    x: Math.sin(az) * Math.cos(el) * r,
    y: Math.sin(el) * r,
    z: Math.cos(az) * Math.cos(el) * r,
    visible: elevationDeg > -6,
  };
}

export function Sky() {
  const domeRef = useRef();
  const celestialRef = useRef();
  const cloudMeshRef = useRef();
  const cloudMatRef = useRef();

  const cloudState = useRef((() => {
    const rng = makeRng(80);
    return new Array(CLOUD_MAX).fill(0).map(() => ({
      angle: rng() * Math.PI * 2,
      radius: 16 + rng() * 4,
      height: 9 + rng() * 3,
      speed: 0.004 + rng() * 0.005,
      bobPhase: rng() * Math.PI * 2,
      puffs: new Array(3).fill(0).map((_, i) => ({
        dx: (rng() - 0.5) * 0.9,
        dz: (rng() - 0.5) * 0.5,
        scale: 0.7 + rng() * 0.5 + (i === 0 ? 0.2 : 0),
      })),
    }));
  })());

  const skyTexRef = useRef({ tex: null, lastKey: '', lastAt: 0 });
  const initialTexture = useMemo(() => makeRadialGradientData('#cfe8f2', '#8ec4e0', 64, 1), []);

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const L = atmosphereLive;
    const now = Date.now();
    const st = skyTexRef.current;

    // --- Sky gradient: regenerate at most every 2s, only when the blended
    // colors have actually drifted (cheap 64x1 DataTexture rebuild) ---
    if (domeRef.current && now - st.lastAt > 2000) {
      const key = `${to255(L.horizon)}${to255(L.zenith)}${L.flash > 0.3 ? 'F' : ''}`;
      if (key !== st.lastKey) {
        st.lastKey = key;
        st.lastAt = now;
        const flashUp = (c) => (L.flash > 0.3 ? c.map((v) => Math.min(1, v + 0.4)) : c);
        const next = makeRadialGradientData(to255(flashUp(L.horizon)), to255(flashUp(L.zenith)), 64, 1);
        const old = domeRef.current.material.map;
        domeRef.current.material.map = next;
        domeRef.current.material.needsUpdate = true;
        if (old && old !== initialTexture) old.dispose();
      }
    }

    // --- Sun/moon placement (throttled to ~1s; sleep mode skips) ---
    if (celestialRef.current && (!orbit.frameParity || orbit.powerState !== 'sleep')) {
      const mesh = celestialRef.current;
      const hasSun = L.sunAzimuth !== null && L.sunElevation !== null;
      const sun = hasSun ? solarToWorld(L.sunAzimuth, L.sunElevation) : fallbackCelestial(13);
      const moon = hasSun
        ? solarToWorld((L.sunAzimuth + 180) % 360, Math.max(8, -L.sunElevation))
        : fallbackCelestial(1);
      const moonVisible = hasSun ? L.sunElevation < 0 : moon.visible;

      dummy.rotation.set(0, 0, 0);
      const sunScale = sun.visible ? 1.2 : 0;
      dummy.position.set(sun.x, sun.y, sun.z);
      dummy.scale.setScalar(sunScale);
      dummy.updateMatrix();
      mesh.setMatrixAt(0, dummy.matrix);
      mesh.setColorAt(0, SUN_COLOR);

      const moonScale = moonVisible ? 0.9 : 0;
      dummy.position.set(moon.x, moon.y, moon.z);
      dummy.scale.setScalar(moonScale);
      dummy.updateMatrix();
      mesh.setMatrixAt(1, dummy.matrix);
      mesh.setColorAt(1, MOON_COLOR);

      const md = Math.hypot(moon.x, moon.y, moon.z) || 1;
      const fx = -moon.x / md;
      const fy = -moon.y / md;
      const fz = -moon.z / md;
      CRATER_OFFSETS.forEach(([cx, cy], i) => {
        const craterScale = moonVisible ? 0.13 : 0;
        dummy.position.set(
          moon.x + cx * moonScale + fx * 0.85 * moonScale,
          moon.y + cy * moonScale + fy * 0.85 * moonScale,
          moon.z + fz * 0.85 * moonScale,
        );
        dummy.scale.setScalar(craterScale);
        dummy.updateMatrix();
        mesh.setMatrixAt(2 + i, dummy.matrix);
        mesh.setColorAt(2 + i, CRATER_COLOR);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // --- Clouds: drift (paused in sleep), count/opacity/color from the
    // weather blend; clusters beyond cloudCount scale to 0 ---
    const mesh = cloudMeshRef.current;
    if (mesh) {
      const visibleClusters = L.cloudCount;
      const drift = orbit.powerState === 'sleep' ? 0 : dt;
      let idx = 0;
      cloudState.current.forEach((c, ci) => {
        c.angle += c.speed * drift;
        // Fractional edge cluster eases in/out for the 4s ramps.
        const clusterVis = Math.min(1, Math.max(0, visibleClusters - ci));
        const cx = Math.sin(c.angle) * c.radius;
        const cz = Math.cos(c.angle) * c.radius;
        const bob = Math.sin(now / 1000 + c.bobPhase) * 0.1;
        for (const p of c.puffs) {
          dummy.position.set(cx + p.dx, c.height + bob, cz + p.dz);
          dummy.rotation.set(0, 0, 0);
          const sc = p.scale * clusterVis;
          dummy.scale.set(sc, sc * 0.45, sc);
          dummy.updateMatrix();
          mesh.setMatrixAt(idx, dummy.matrix);
          idx += 1;
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (cloudMatRef.current) {
      const flashLift = L.flash * 0.5;
      cloudMatRef.current.color.setRGB(
        Math.min(1, L.cloudColor[0] + flashLift),
        Math.min(1, L.cloudColor[1] + flashLift),
        Math.min(1, L.cloudColor[2] + flashLift),
      );
      cloudMatRef.current.opacity = L.cloudOpacity;
    }
  });

  return (
    <group>
      <mesh ref={domeRef}>
        <sphereGeometry args={[SKY_RADIUS, 24, 16]} />
        <meshBasicMaterial map={initialTexture} side={BackSide} fog={false} />
      </mesh>

      <instancedMesh ref={celestialRef} args={[undefined, undefined, CELESTIAL_COUNT]}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshBasicMaterial fog={false} />
      </instancedMesh>

      <instancedMesh ref={cloudMeshRef} args={[undefined, undefined, CLOUD_MAX * 3]}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial ref={cloudMatRef} color="#ffffff" transparent opacity={0.85} fog={false} />
      </instancedMesh>
    </group>
  );
}
