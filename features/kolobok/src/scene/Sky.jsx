import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import * as Haptics from 'expo-haptics';
import {
  BackSide, BufferAttribute, BufferGeometry, Color, Object3D, SphereGeometry,
} from 'three';
import { atmosphereLive, orbit, useSceneStore } from '../state/sceneStore';
import { PATH_RADIUS, rad } from '../config/zones';
import { makeRadialGradientData, makeRadialAlphaTexture } from './textures/proceduralTextures';
import { mergeColoredParts } from './builders/mergeColoredParts';
import { makeRng } from './prng';
import { eggManager, eggMotion } from './easterEggs';

const SKY_RADIUS = 28;
const SUN_MOON_RADIUS = 24;

const dummy = new Object3D();
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

// Live feedback: replaces the old weather-driven ambient cloud system
// entirely with 3 fixed, always-present, individually tappable clouds.
// Each is the SAME hand-built 3-sphere shape (medium, then large, then
// small, left to right, each overlapping the next by 15%) rather than a
// randomly-jittered puff cluster. All 3 orbit together, clustered within
// roughly a third of the full circle, at a radius near Kolobok's own path
// (+/-15%) and a height 15% lower than this scene's previous cloud height
// (was 6-8, so ~5.1-6.8 now). Tap one -> it darkens and rains for
// RAIN_DURATION_MS (not tappable meanwhile), then brightens back to white.
const CLOUD_COUNT = 3;
const CLOUD_ARC_DEG = 100; // "scattered across one-third of the scene"
const CLOUD_HEIGHT_MIN = 5.1;
const CLOUD_HEIGHT_MAX = 6.8;
const CLOUD_RADIUS_MIN = PATH_RADIUS * 0.85;
const CLOUD_RADIUS_MAX = PATH_RADIUS * 1.15;
const CLOUD_ORBIT_SPEED = 0.006;
const CLOUD_SHADOW_R = 0.85;
const RAIN_DURATION_MS = 15000;
const RAIN_COUNT_PER_CLOUD = 10;
const RAIN_POOL_SIZE = CLOUD_COUNT * RAIN_COUNT_PER_CLOUD;
const RAIN_FALL_S = 2; // seconds for one drop to cycle top->bottom
const CLOUD_WHITE = new Color('#ffffff');
const CLOUD_RAIN_TINT = new Color('#9aa4b2');

/** The cloud's fixed silhouette: medium sphere, then large, then small,
 *  left to right, each overlapping the previous by 15% (gap between
 *  centers = 85% of the two radii summed). Shared by all CLOUD_COUNT
 *  instances via one instancedMesh -- only position/scale/color differ
 *  per-instance, so this is built once, not per-cloud. */
function makeCloudGeometry() {
  const rMed = 0.5;
  const rLarge = 0.65;
  const rSmall = 0.38;
  const xMed = 0;
  const xLarge = xMed + (rMed + rLarge) * 0.85;
  const xSmall = xLarge + (rLarge + rSmall) * 0.85;
  return mergeColoredParts([
    { geometry: new SphereGeometry(rMed, 10, 8), color: '#ffffff', position: [xMed, 0, 0] },
    { geometry: new SphereGeometry(rLarge, 10, 8), color: '#ffffff', position: [xLarge, 0.04, 0.02] },
    { geometry: new SphereGeometry(rSmall, 8, 6), color: '#ffffff', position: [xSmall, -0.03, -0.02] },
  ]);
}

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

  const skyTexRef = useRef({ tex: null, lastKey: '', lastAt: 0 });
  const initialTexture = useMemo(() => makeRadialGradientData('#cfe8f2', '#8ec4e0', 64, 1), []);
  const starTexture = useMemo(() => makeRadialAlphaTexture(16), []);

  // moon-wink: moonVisibleRef mirrors the per-frame `moonVisible` local
  // (computed inside useFrame) out to the click handler below, which runs
  // outside that closure's scope. eggUi tracks the burst-counter edge-detect
  // (same idiom as PondAndGrandpa's rippleBurst/s.rippleWas) plus its own
  // local elapsed-time-since-triggered clock.
  const moonVisibleRef = useRef(false);
  const starsRef = useRef();
  const starsGeometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(STAR_COUNT * 3), 3));
    return geo;
  }, []);
  // moonWinkSeen seeded from the counter's current value, not 0 -- otherwise
  // a fresh mount (leaving/returning to the 3D scene) would misread a
  // leftover nonzero burst from a PRIOR mount as a brand-new trigger and
  // replay it (same class of bug as the fox-catch "explosion" fixed in
  // KolobokParticles.jsx).
  const eggUi = useRef({ moonWinkSeen: eggMotion.moonWinkBurst, moonWinkMs: -1 });

  const cloudGeometry = useMemo(() => makeCloudGeometry(), []);
  const cloudRef = useRef();
  const cloudShadowRef = useRef();
  const shadowTexture = useMemo(() => makeRadialAlphaTexture(32), []);
  const rainRef = useRef();
  const rainGeometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(RAIN_POOL_SIZE * 3), 3));
    return geo;
  }, []);
  const cloudState = useRef((() => {
    const rng = makeRng(44);
    const centerAngle = rng() * Math.PI * 2;
    return new Array(CLOUD_COUNT).fill(0).map((_, i) => ({
      angle: centerAngle + rad((i - (CLOUD_COUNT - 1) / 2) * (CLOUD_ARC_DEG / (CLOUD_COUNT - 1))),
      radius: CLOUD_RADIUS_MIN + rng() * (CLOUD_RADIUS_MAX - CLOUD_RADIUS_MIN),
      scale: 0.85 + rng() * 0.35,
      bobPhase: rng() * Math.PI * 2,
      isRaining: false,
      rainMs: -1,
      worldX: 0, worldY: 0, worldZ: 0, // stashed each frame for the rain pool + shadow below
    }));
  })());
  // Each pool slot permanently belongs to one cloud (10 slots per cloud) --
  // simpler than dynamic allocation since there are only ever CLOUD_COUNT
  // simultaneous rain sources.
  const rainPool = useRef(new Array(RAIN_POOL_SIZE).fill(0).map((_, i) => ({
    t: Math.random(), cloudIdx: Math.floor(i / RAIN_COUNT_PER_CLOUD),
  })));

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

    // --- Clouds: 3 fixed instances, continuously orbiting together; tap ->
    // rain for RAIN_DURATION_MS, not tappable meanwhile, then back to white.
    const cmesh = cloudRef.current;
    const smesh = cloudShadowRef.current;
    if (cmesh) {
      cloudState.current.forEach((c, ci) => {
        c.angle += CLOUD_ORBIT_SPEED * dt;
        if (c.isRaining) {
          c.rainMs += dt * 1000;
          if (c.rainMs > RAIN_DURATION_MS) { c.isRaining = false; c.rainMs = -1; }
        }
        const cx = Math.sin(c.angle) * c.radius;
        const cz = Math.cos(c.angle) * c.radius;
        const bob = Math.sin(now / 1000 + c.bobPhase) * 0.15;
        const heightT = (c.radius - CLOUD_RADIUS_MIN) / Math.max(0.001, CLOUD_RADIUS_MAX - CLOUD_RADIUS_MIN);
        const cy = CLOUD_HEIGHT_MIN + heightT * (CLOUD_HEIGHT_MAX - CLOUD_HEIGHT_MIN) + bob;
        c.worldX = cx;
        c.worldY = cy;
        c.worldZ = cz;

        dummy.position.set(cx, cy, cz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(c.scale);
        dummy.updateMatrix();
        cmesh.setMatrixAt(ci, dummy.matrix);
        // Darken over the first 500ms, hold, brighten back over the tail
        // 500ms -- same envelope shape as the old cloud-drizzle.
        const rainT = c.isRaining
          ? Math.min(1, c.rainMs / 500) * Math.min(1, (RAIN_DURATION_MS - c.rainMs) / 500)
          : 0;
        cmesh.setColorAt(ci, CLOUD_WHITE.clone().lerp(CLOUD_RAIN_TINT, rainT));

        if (smesh) {
          dummy.position.set(cx, 0.02, cz);
          dummy.rotation.set(-Math.PI / 2, 0, 0);
          const sr = CLOUD_SHADOW_R * c.scale * 2;
          dummy.scale.set(sr, sr, 1);
          dummy.updateMatrix();
          smesh.setMatrixAt(ci, dummy.matrix);
        }
      });
      cmesh.instanceMatrix.needsUpdate = true;
      if (cmesh.instanceColor) cmesh.instanceColor.needsUpdate = true;
      if (smesh) smesh.instanceMatrix.needsUpdate = true;
    }

    // Rain: each pool slot is permanently owned by one cloud (see rainPool's
    // own init above) and just parks out of view whenever that cloud isn't
    // currently raining.
    if (rainRef.current) {
      const positions = rainGeometry.attributes.position;
      let anyRaining = false;
      rainPool.current.forEach((p, i) => {
        const c = cloudState.current[p.cloudIdx];
        if (c.isRaining) {
          anyRaining = true;
          p.t += dt / RAIN_FALL_S;
          if (p.t > 1) p.t = 0;
          const spreadX = Math.sin(i * 2.3) * 0.35;
          const spreadZ = Math.cos(i * 1.9) * 0.35;
          const fall = p.t * (c.worldY - 0.1);
          positions.setXYZ(i, c.worldX + spreadX, c.worldY - fall, c.worldZ + spreadZ);
        } else {
          positions.setXYZ(i, 0, -20, 0); // parked well below the scene
        }
      });
      rainRef.current.visible = anyRaining;
      if (anyRaining) {
        positions.needsUpdate = true;
        rainGeometry.computeBoundingSphere();
      }
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
        ref={cloudShadowRef}
        args={[undefined, undefined, CLOUD_COUNT]}
        renderOrder={1}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={shadowTexture} color="#1e1a14" transparent opacity={0.28} depthWrite={false} fog={false} />
      </instancedMesh>

      <instancedMesh
        ref={cloudRef}
        args={[cloudGeometry, undefined, CLOUD_COUNT]}
        onPointerDown={(e) => {
          const c = cloudState.current[e.instanceId];
          if (!c || c.isRaining) return;
          e.stopPropagation();
          c.isRaining = true;
          c.rainMs = 0;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          useSceneStore.getState().recordEggFound('cloud-drizzle');
        }}
      >
        <meshBasicMaterial color="#ffffff" transparent opacity={0.9} fog={false} />
      </instancedMesh>

      <points ref={rainRef} geometry={rainGeometry} visible={false}>
        <pointsMaterial map={starTexture} color={CLOUD_RAIN_TINT} size={0.1} transparent depthWrite={false} sizeAttenuation fog={false} opacity={0.85} />
      </points>
    </group>
  );
}
