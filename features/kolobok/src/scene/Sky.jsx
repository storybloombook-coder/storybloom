import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import { BackSide, Color, Object3D } from 'three';
import { currentPhase, PALETTES } from '../config/atmosphere';
import { makeRadialGradientData } from './textures/proceduralTextures';
import { makeRng } from './prng';

const SKY_RADIUS = 28;
const SUN_MOON_RADIUS = 24; // distance from origin the sun/moon arc sits at

const dummy = new Object3D();
const CLOUD_COUNT = 5;
const CLOUD_DAY = { color: new Color('#ffffff'), opacity: 0.85 };
const CLOUD_NIGHT = { color: new Color('#a8b0c8'), opacity: 0.5 };

// Sun + moon + 3 crater dots, all in ONE instancedMesh (ART_SPEC §7 specifies
// flat circles, but MeshBasicMaterial is unlit -- a sphere renders as the
// exact same flat colored disc from every angle, with none of a flat
// circle's billboarding problem as the camera orbits the island. Same
// pixels, one draw call instead of five.)
const CELESTIAL_COUNT = 5; // sun, moon, crater x3
const SUN_COLOR = new Color('#ffe9a8');
const MOON_COLOR = new Color('#e8ecf4');
const CRATER_COLOR = new Color('#c8cedd');
const CRATER_OFFSETS = [[0.25, 0.2], [-0.2, -0.1], [0.05, -0.3]];

/** Device-hour fallback for sun/moon placement (WEATHER_SPEC's real solar
 *  position supersedes this in Phase 6): sun overhead at 13:00, moon at
 *  01:00 (ANIMATION_SPEC §6), swinging across the sky on a simple arc. */
function celestialPosition(hourOffset) {
  const hour = new Date().getHours() + new Date().getMinutes() / 60;
  const angle = ((hour - hourOffset) / 24) * Math.PI * 2;
  const height = Math.cos(angle) * 10;
  return {
    x: Math.sin(angle) * SUN_MOON_RADIUS,
    y: height,
    z: Math.cos(angle) * SUN_MOON_RADIUS * 0.4,
    aboveHorizon: height > -1.5,
  };
}

export function Sky() {
  const phase = currentPhase();
  const palette = PALETTES[phase];

  const skyTexture = useMemo(
    () => makeRadialGradientData(palette.horizon, palette.zenith, 64, 1),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phase],
  );

  const celestialMeshRef = useRef();
  const isNight = phase === 'night';

  const cloudGroups = useMemo(() => {
    const rng = makeRng(80);
    return new Array(CLOUD_COUNT).fill(0).map(() => ({
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
  }, []);

  const cloudMeshRef = useRef();
  const cloudState = useRef(cloudGroups.map((c) => ({ ...c })));

  // Sun/moon barely move frame to frame (device-hour granularity), so their
  // instance matrices only need to be set once the mesh mounts -- unlike
  // clouds, they don't need a per-frame update.
  const setCelestialMesh = (mesh) => {
    celestialMeshRef.current = mesh;
    if (!mesh) return;
    const sun = celestialPosition(13);
    const moon = celestialPosition(1);

    dummy.position.set(sun.x, sun.y, sun.z);
    dummy.rotation.set(0, 0, 0);
    const sunScale = sun.aboveHorizon ? 1.2 : 0;
    dummy.scale.set(sunScale, sunScale, sunScale);
    dummy.updateMatrix();
    mesh.setMatrixAt(0, dummy.matrix);
    mesh.setColorAt(0, SUN_COLOR);

    const moonScale = moon.aboveHorizon ? 0.9 : 0;
    dummy.position.set(moon.x, moon.y, moon.z);
    dummy.scale.set(moonScale, moonScale, moonScale);
    dummy.updateMatrix();
    mesh.setMatrixAt(1, dummy.matrix);
    mesh.setColorAt(1, MOON_COLOR);

    // Craters ride on the moon's surface, pushed toward the origin (not a
    // fixed +Z) so they land on whichever hemisphere actually faces the
    // island -- the moon's own position swings all over the sky across the
    // day (see celestialPosition), so a fixed-axis push would put them on
    // the far, permanently-occluded side most of the time.
    const moonDist = Math.hypot(moon.x, moon.y, moon.z) || 1;
    const faceX = -moon.x / moonDist;
    const faceY = -moon.y / moonDist;
    const faceZ = -moon.z / moonDist;
    CRATER_OFFSETS.forEach(([cx, cy], i) => {
      const craterScale = moon.aboveHorizon ? 0.13 : 0;
      dummy.position.set(
        moon.x + cx * moonScale + faceX * 0.85 * moonScale,
        moon.y + cy * moonScale + faceY * 0.85 * moonScale,
        moon.z + faceZ * 0.85 * moonScale,
      );
      dummy.scale.set(craterScale, craterScale, craterScale);
      dummy.updateMatrix();
      mesh.setMatrixAt(2 + i, dummy.matrix);
      mesh.setColorAt(2 + i, CRATER_COLOR);
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const mesh = cloudMeshRef.current;
    if (!mesh) return;
    let idx = 0;
    for (const c of cloudState.current) {
      c.angle += c.speed * dt;
      const cx = Math.sin(c.angle) * c.radius;
      const cz = Math.cos(c.angle) * c.radius;
      const bob = Math.sin(Date.now() / 1000 + c.bobPhase) * 0.1;
      for (const p of c.puffs) {
        dummy.position.set(cx + p.dx, c.height + bob, cz + p.dz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(p.scale, p.scale * 0.45, p.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(idx, dummy.matrix);
        idx += 1;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  const cloudColor = isNight ? CLOUD_NIGHT : CLOUD_DAY;
  const totalPuffs = CLOUD_COUNT * 3;

  return (
    <group>
      <mesh>
        <sphereGeometry args={[SKY_RADIUS, 24, 16]} />
        <meshBasicMaterial map={skyTexture} side={BackSide} fog={false} />
      </mesh>

      <instancedMesh ref={setCelestialMesh} args={[undefined, undefined, CELESTIAL_COUNT]}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshBasicMaterial fog={false} />
      </instancedMesh>

      <instancedMesh ref={cloudMeshRef} args={[undefined, undefined, totalPuffs]}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial color={cloudColor.color} transparent opacity={cloudColor.opacity} fog={false} />
      </instancedMesh>
    </group>
  );
}
