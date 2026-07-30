import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import {
  BackSide, BufferAttribute, BufferGeometry, Color, Object3D,
} from 'three';
import { atmosphereLive, orbit } from '../state/sceneStore';
import { makeRadialGradientData, makeRadialAlphaTexture } from './textures/proceduralTextures';
import { makeRng } from './prng';
import { eggManager, eggMotion } from './easterEggs';

const SKY_RADIUS = 28;
const SUN_MOON_RADIUS = 24;

const dummy = new Object3D();
const CLOUD_MAX = 8; // WEATHER_SPEC §2 tops out at 8 clusters
const CELESTIAL_COUNT = 5; // sun, moon, crater x3
const SUN_COLOR = new Color('#ffe9a8');
const MOON_COLOR = new Color('#e8ecf4');
const CRATER_COLOR = new Color('#c8cedd');
const CRATER_OFFSETS = [[0.25, 0.2], [-0.2, -0.1], [0.05, -0.3]];

// moon-wink (EASTER_EGGS.md §2): crater 0 (index 2 on the celestial mesh --
// see CELESTIAL_COUNT's own comment for the 0=sun/1=moon/2..4=craters
// layout) scales to a closed-eye line and back over 400ms.
const MOON_WINK_MS = 400;
const STAR_COUNT = 3;
const STAR_COLOR = new Color('#fff6d6');

// cloud-drizzle (EASTER_EGGS.md §2): tapped cluster darkens+drizzles for 2s.
const CLOUD_DRIZZLE_MS = 2000;
const CLOUD_NORMAL_COLOR = new Color('#ffffff');
const CLOUD_DRIZZLE_COLOR = new Color('#9aa4b2');
const DRIZZLE_COUNT = 12;

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
      // Live feedback: clouds at 9-12 sat above the camera's normal resting
      // view (CAMERA_HEIGHT ~6.5, lookAtY ~1.1-1.4 -- a level-to-downward
      // gaze), so they were invisible without a deliberate look-up drag.
      // Lowered to sit around eye height instead, comfortably in frame.
      height: 6 + rng() * 2,
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
  const starTexture = useMemo(() => makeRadialAlphaTexture(16), []);

  // moon-wink: moonVisibleRef mirrors the per-frame `moonVisible` local
  // (computed inside useFrame) out to the click handler below, which runs
  // outside that closure's scope. eggUi tracks the burst-counter edge-detect
  // (same idiom as PondAndGrandpa's rippleBurst/s.rippleWas) plus each
  // effect's own local elapsed-time-since-triggered clock.
  const moonVisibleRef = useRef(false);
  const starsRef = useRef();
  const starsGeometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(STAR_COUNT * 3), 3));
    return geo;
  }, []);
  const drizzleRef = useRef();
  const drizzleGeometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(DRIZZLE_COUNT * 3), 3));
    return geo;
  }, []);
  // moonWinkSeen/cloudDrizzleSeen seeded from the counters' current values,
  // not 0 -- otherwise a fresh mount (leaving/returning to the 3D scene)
  // would misread a leftover nonzero burst from a PRIOR mount as a
  // brand-new trigger and replay it (same class of bug as the fox-catch
  // "explosion" fixed in KolobokParticles.jsx).
  const eggUi = useRef({
    moonWinkSeen: eggMotion.moonWinkBurst,
    moonWinkMs: -1,
    cloudDrizzleSeen: eggMotion.cloudDrizzleBurst,
    cloudDrizzleMs: -1,
    drizzleState: new Array(DRIZZLE_COUNT).fill(0).map(() => ({ t: Math.random() })),
  });

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
      moonVisibleRef.current = moonVisible;

      // moon-wink: burst counter edge-detect (same idiom as
      // PondAndGrandpa's rippleBurst/s.rippleWas) starts this frame's local
      // 400ms clock; ui.moonWinkMs counts UP from 0, -1 = inactive.
      const ui = eggUi.current;
      if (eggMotion.moonWinkBurst !== ui.moonWinkSeen) {
        ui.moonWinkSeen = eggMotion.moonWinkBurst;
        ui.moonWinkMs = 0;
      } else if (ui.moonWinkMs >= 0) {
        ui.moonWinkMs += dt * 1000;
        if (ui.moonWinkMs > MOON_WINK_MS) ui.moonWinkMs = -1;
      }

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
      // Wink progress: 0 at rest, 1 at mid-blink (fully squished), back to 0
      // -- a triangle wave over the 400ms window, only ever nonzero on
      // crater 0 (i === 0), the "one crater" the doc specifies.
      const winkT = ui.moonWinkMs < 0 ? 0 : 1 - Math.abs(ui.moonWinkMs / MOON_WINK_MS - 0.5) * 2;
      CRATER_OFFSETS.forEach(([cx, cy], i) => {
        const craterScale = moonVisible ? 0.13 : 0;
        dummy.position.set(
          moon.x + cx * moonScale + fx * 0.85 * moonScale,
          moon.y + cy * moonScale + fy * 0.85 * moonScale,
          moon.z + fz * 0.85 * moonScale,
        );
        dummy.rotation.set(0, 0, 0);
        if (i === 0 && winkT > 0) {
          // Closed-eye line: squash vertical scale toward ~0 while width
          // stretches slightly, same silhouette trick as a cartoon wink.
          dummy.scale.set(craterScale * (1 + winkT * 0.6), craterScale * Math.max(0.06, 1 - winkT * 0.94), craterScale);
        } else {
          dummy.scale.setScalar(craterScale);
        }
        dummy.updateMatrix();
        mesh.setMatrixAt(2 + i, dummy.matrix);
        mesh.setColorAt(2 + i, CRATER_COLOR);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

      // 3 tiny star sparkles pop beside the moon for the same window.
      if (starsRef.current) {
        const starPositions = starsGeometry.attributes.position;
        const starVisible = winkT > 0;
        starsRef.current.visible = starVisible;
        if (starVisible) {
          for (let i = 0; i < STAR_COUNT; i++) {
            const a = (i / STAR_COUNT) * Math.PI * 2 + winkT * 0.6;
            const r = 0.55 + winkT * 0.15;
            starPositions.setXYZ(
              i,
              moon.x + Math.cos(a) * r * moonScale,
              moon.y + Math.sin(a) * r * moonScale,
              moon.z + fz * 0.9 * moonScale,
            );
          }
          starPositions.needsUpdate = true;
          starsGeometry.computeBoundingSphere();
          if (starsRef.current.material) starsRef.current.material.opacity = Math.min(1, winkT * 1.4);
        }
      }
    }

    // cloud-drizzle: same burst-counter edge-detect as moon-wink above.
    const ui2 = eggUi.current;
    if (eggMotion.cloudDrizzleBurst !== ui2.cloudDrizzleSeen) {
      ui2.cloudDrizzleSeen = eggMotion.cloudDrizzleBurst;
      ui2.cloudDrizzleMs = 0;
      ui2.drizzleState.forEach((p) => { p.t = Math.random() * 0.3; }); // stagger the first fall
    } else if (ui2.cloudDrizzleMs >= 0) {
      ui2.cloudDrizzleMs += dt * 1000;
      if (ui2.cloudDrizzleMs > CLOUD_DRIZZLE_MS) ui2.cloudDrizzleMs = -1;
    }
    const drizzleCluster = ui2.cloudDrizzleMs >= 0 ? eggMotion.cloudDrizzleCluster : -1;
    // Darken over 300ms, hold, brighten back over the tail 300ms (doc: "over
    // 300ms ... brightens back").
    const drizzleClusterT = drizzleCluster < 0 ? 0
      : Math.min(1, ui2.cloudDrizzleMs / 300) * Math.min(1, (CLOUD_DRIZZLE_MS - ui2.cloudDrizzleMs) / 300);
    let drizzleOriginX = 0;
    let drizzleOriginY = 0;
    let drizzleOriginZ = 0;

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
        const isDrizzling = ci === drizzleCluster;
        if (isDrizzling) {
          drizzleOriginX = cx;
          drizzleOriginY = c.height + bob;
          drizzleOriginZ = cz;
        }
        for (const p of c.puffs) {
          dummy.position.set(cx + p.dx, c.height + bob, cz + p.dz);
          dummy.rotation.set(0, 0, 0);
          const sc = p.scale * clusterVis;
          dummy.scale.set(sc, sc * 0.45, sc);
          dummy.updateMatrix();
          mesh.setMatrixAt(idx, dummy.matrix);
          mesh.setColorAt(idx, isDrizzling
            ? CLOUD_NORMAL_COLOR.clone().lerp(CLOUD_DRIZZLE_COLOR, drizzleClusterT)
            : CLOUD_NORMAL_COLOR);
          idx += 1;
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // Private 12-point drizzle beneath the tapped cluster (EASTER_EGGS.md
    // §2 cloud-drizzle) -- same fixed-pool-with-per-particle-t pattern as
    // ZoneAmbience's chimney smoke, just falling instead of rising.
    if (drizzleRef.current) {
      const visible = drizzleCluster >= 0;
      drizzleRef.current.visible = visible;
      if (visible) {
        const positions = drizzleGeometry.attributes.position;
        ui2.drizzleState.forEach((p, i) => {
          p.t += dt * 1.3;
          if (p.t > 1) p.t = 0;
          const fall = p.t * 1.8;
          const spreadX = (Math.sin(i * 2.1) * 0.4);
          const spreadZ = (Math.cos(i * 1.7) * 0.4);
          positions.setXYZ(i, drizzleOriginX + spreadX, drizzleOriginY - fall, drizzleOriginZ + spreadZ);
        });
        positions.needsUpdate = true;
        drizzleGeometry.computeBoundingSphere();
      }
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

      <instancedMesh
        ref={celestialRef}
        args={[undefined, undefined, CELESTIAL_COUNT]}
        onPointerDown={(e) => {
          if (e.instanceId === 1 && moonVisibleRef.current) {
            e.stopPropagation();
            eggManager.tapMoon();
          }
        }}
      >
        <sphereGeometry args={[1, 12, 12]} />
        <meshBasicMaterial fog={false} />
      </instancedMesh>

      <points ref={starsRef} geometry={starsGeometry} visible={false}>
        <pointsMaterial map={starTexture} color={STAR_COLOR} size={0.22} transparent depthWrite={false} sizeAttenuation fog={false} />
      </points>

      <instancedMesh
        ref={cloudMeshRef}
        args={[undefined, undefined, CLOUD_MAX * 3]}
        onPointerDown={(e) => {
          if (atmosphereLive.rainT > 0 || atmosphereLive.snowT > 0) return;
          e.stopPropagation();
          eggManager.tapCloud(Math.floor(e.instanceId / 3));
        }}
      >
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial ref={cloudMatRef} color="#ffffff" transparent opacity={0.85} fog={false} />
      </instancedMesh>

      <points ref={drizzleRef} geometry={drizzleGeometry} visible={false}>
        <pointsMaterial map={starTexture} color={CLOUD_DRIZZLE_COLOR} size={0.12} transparent depthWrite={false} sizeAttenuation fog={false} opacity={0.8} />
      </points>
    </group>
  );
}
