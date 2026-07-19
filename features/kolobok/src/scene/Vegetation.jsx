import { useMemo } from 'react';
import { Color, Object3D } from 'three';
import { ISLAND_RADIUS, rad, pointOnCircle } from '../config/zones';
import { scatterAngles } from './builders/placement';
import { makeRng } from './prng';
import { makeStripes, makeNoiseGrain, makeSpeckle } from './textures/proceduralTextures';

const dummy = new Object3D();

/** One transform per plant: angle (deg), radius, uniform-ish scale, and a
 *  random yaw so a stand of identical trees doesn't look copy-pasted. */
function makePlants(rng, count, homeZoneIds, opts) {
  const angles = scatterAngles(rng, count, homeZoneIds, opts);
  return angles.map((deg) => ({
    angle: rad(deg),
    radius: opts.radiusMin + rng() * (opts.radiusMax - opts.radiusMin),
    scale: opts.scaleMin + rng() * (opts.scaleMax - opts.scaleMin),
    yaw: rng() * Math.PI * 2,
  }));
}

function matrixAt(plant, localOffset = [0, 0, 0], localScale = [1, 1, 1]) {
  const [x, , z] = pointOnCircle(plant.radius, plant.angle);
  dummy.position.set(
    x + localOffset[0] * plant.scale,
    localOffset[1] * plant.scale,
    z + localOffset[2] * plant.scale,
  );
  dummy.rotation.set(0, plant.yaw, 0);
  dummy.scale.set(
    plant.scale * localScale[0],
    plant.scale * localScale[1],
    plant.scale * localScale[2],
  );
  dummy.updateMatrix();
  return dummy.matrix.clone();
}

// Spruce transforms live at module scope (pure + deterministic via the
// seeded PRNG) so WeatherSystems' snow caps can reuse the exact top-tier
// matrices without recomputing placement (WEATHER_SPEC §4 "instanced,
// matching tree matrices").
const SPRUCE_PLANTS = (() => {
  const rng = makeRng(20);
  return makePlants(rng, 14, ['wolf', 'bear'], {
    radiusMin: ISLAND_RADIUS * 0.35, radiusMax: ISLAND_RADIUS * 0.88, scaleMin: 0.75, scaleMax: 1.15,
  });
})();
export const SPRUCE_TOP_MATRICES = SPRUCE_PLANTS.map((p) => matrixAt(p, [0, 1.32, 0], [0.2, 0.1, 0.2]));

function InstancedPart({ count, matrices, colors, children }) {
  return (
    <instancedMesh
      args={[undefined, undefined, count]}
      ref={(mesh) => {
        if (!mesh) return;
        matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
        mesh.instanceMatrix.needsUpdate = true;
        if (colors) {
          colors.forEach((c, i) => mesh.setColorAt(i, c));
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
      }}
    >
      {children}
    </instancedMesh>
  );
}

export function Vegetation() {
  const birchTexture = useMemo(() => makeStripes('#e8e4da', '#3f3a33'), []);
  const birchCanopyTexture = useMemo(() => makeNoiseGrain('#9fc46a', 0.1), []);
  const mushroomCapTexture = useMemo(() => makeSpeckle('#c0452e', '#f2f2ea', 128, 0.12), []);

  const birch = useMemo(() => {
    const rng = makeRng(10);
    return makePlants(rng, 12, ['hare', 'fox'], {
      radiusMin: ISLAND_RADIUS * 0.4, radiusMax: ISLAND_RADIUS * 0.85, scaleMin: 0.8, scaleMax: 1.2,
    });
  }, []);
  const spruce = SPRUCE_PLANTS;
  const bush = useMemo(() => {
    const rng = makeRng(30);
    // No home arc specified for bushes (ART_SPEC §5) -- scattered freely.
    return makePlants(rng, 10, [], {
      scatterChance: 1, radiusMin: ISLAND_RADIUS * 0.3, radiusMax: ISLAND_RADIUS * 0.9, scaleMin: 0.85, scaleMax: 1.2,
    });
  }, []);
  const mushroom = useMemo(() => {
    const rng = makeRng(40);
    return makePlants(rng, 8, ['bear'], {
      radiusMin: ISLAND_RADIUS * 0.45, radiusMax: ISLAND_RADIUS * 0.75, scaleMin: 0.8, scaleMax: 1.3,
    });
  }, []);
  const flower = useMemo(() => {
    const rng = makeRng(50);
    return makePlants(rng, 16, ['hare'], {
      radiusMin: ISLAND_RADIUS * 0.4, radiusMax: ISLAND_RADIUS * 0.8, scaleMin: 0.8, scaleMax: 1.3,
    });
  }, []);

  // Per-instance matrices/colors, all derived from the plant lists above.
  // Birch canopy: the two blobs share one geometry, so they merge into a
  // single instancedMesh (2x the instance count) instead of two draws.
  const birchTrunkM = useMemo(() => birch.map((p) => matrixAt(p, [0, 0.8, 0])), [birch]);
  const birchCanopyAM = useMemo(() => birch.map((p) => matrixAt(p, [0.05, 1.7, 0], [1, 0.8, 1])), [birch]);
  // Canopy B was its own r=0.35 geometry (vs A's r=0.4) scaled (0.8, 0.7,
  // 0.8); sharing A's r=0.4 geometry now, so its localScale is rescaled by
  // 0.35/0.4 to land on the identical effective size: xz 0.8*0.875=0.7,
  // y 0.7*0.875=0.6125.
  const birchCanopyBM = useMemo(() => birch.map((p) => matrixAt(p, [-0.1, 1.85, 0.08], [0.7, 0.6125, 0.7])), [birch]);
  const birchCanopyM = useMemo(() => [...birchCanopyAM, ...birchCanopyBM], [birchCanopyAM, birchCanopyBM]);

  // Wolf-arc instances read darker (ART_SPEC §5); reused for all three cone tiers.
  const spruceColors = useMemo(
    () => spruce.map((p) => {
      const deg = (p.angle * 180) / Math.PI;
      const wolfDelta = Math.abs((((deg - 144 + 540) % 360) - 180));
      return new Color(wolfDelta < 40 ? '#3e6338' : '#4f7d45');
    }),
    [spruce],
  );
  // Spruce: 3 stacked cone tiers, all sharing ONE unit cone geometry (radius
  // 1, height 1) -- each tier's real radius/height (ART_SPEC §5: 0.55/0.7,
  // 0.4/0.6, 0.26/0.5) is baked into matrixAt's per-instance `localScale`
  // instead of a distinct geometry, so all three tiers of all 14 trees merge
  // into one instancedMesh (42 instances, one draw call). The thin trunk
  // stub is dropped -- the low tier's base disc already reaches the ground
  // and fully covers where it would have shown.
  const spruceLowM = useMemo(() => spruce.map((p) => matrixAt(p, [0, 0.35, 0], [0.55, 0.7, 0.55])), [spruce]);
  const spruceMidM = useMemo(() => spruce.map((p) => matrixAt(p, [0, 0.72, 0], [0.4, 0.6, 0.4])), [spruce]);
  const spruceTopM = useMemo(() => spruce.map((p) => matrixAt(p, [0, 1.05, 0], [0.26, 0.5, 0.26])), [spruce]);
  const spruceAllM = useMemo(
    () => [...spruceLowM, ...spruceMidM, ...spruceTopM],
    [spruceLowM, spruceMidM, spruceTopM],
  );
  const spruceAllColors = useMemo(
    () => [...spruceColors, ...spruceColors, ...spruceColors],
    [spruceColors],
  );

  const bushPositions = useMemo(() => {
    const rng = makeRng(31);
    const out = [];
    for (const p of bush) {
      for (let i = 0; i < 3; i++) {
        const jitterAngle = rng() * Math.PI * 2;
        const jitterR = rng() * 0.18;
        out.push(matrixAt(p, [Math.cos(jitterAngle) * jitterR, 0.15, Math.sin(jitterAngle) * jitterR], [0.9 + rng() * 0.2, 0.9 + rng() * 0.2, 0.9 + rng() * 0.2]));
      }
    }
    return out;
  }, [bush]);

  const mushroomStemM = useMemo(() => mushroom.map((p) => matrixAt(p, [0, 0.05, 0])), [mushroom]);
  const mushroomCapM = useMemo(() => mushroom.map((p) => matrixAt(p, [0, 0.11, 0], [1, 0.55, 1])), [mushroom]);

  const flowerStemM = useMemo(() => flower.map((p) => matrixAt(p, [0, 0.06, 0])), [flower]);
  const flowerHeadM = useMemo(() => flower.map((p) => matrixAt(p, [0, 0.13, 0])), [flower]);
  const flowerColors = useMemo(() => {
    const palette = ['#e8e26e', '#e0e9f2', '#e8a8c8'];
    const rng = makeRng(51);
    return flower.map(() => new Color(palette[Math.floor(rng() * palette.length)]));
  }, [flower]);

  return (
    <group>
      {/* Birch: trunk (own draw, different geometry) + both canopy blobs
          merged into one instancedMesh since they share a geometry */}
      <InstancedPart count={birch.length} matrices={birchTrunkM}>
        <cylinderGeometry args={[0.07, 0.08, 1.6, 7]} />
        <meshStandardMaterial map={birchTexture} roughness={0.9} />
      </InstancedPart>
      <InstancedPart count={birchCanopyM.length} matrices={birchCanopyM}>
        <sphereGeometry args={[0.4, 8, 8]} />
        <meshStandardMaterial map={birchCanopyTexture} roughness={0.9} />
      </InstancedPart>

      {/* Spruce: all 3 cone tiers of all trees in one merged instancedMesh */}
      <InstancedPart count={spruceAllM.length} matrices={spruceAllM} colors={spruceAllColors}>
        <coneGeometry args={[1, 1, 8]} />
        <meshStandardMaterial roughness={0.9} />
      </InstancedPart>

      {/* Bush: 3 clustered spheres per bush, one shared InstancedMesh */}
      <InstancedPart count={bushPositions.length} matrices={bushPositions}>
        <sphereGeometry args={[0.2, 8, 8]} />
        <meshStandardMaterial color="#6f9b52" roughness={0.9} />
      </InstancedPart>

      {/* Mushroom (bear arc): stem + speckled cap */}
      <InstancedPart count={mushroom.length} matrices={mushroomStemM}>
        <cylinderGeometry args={[0.03, 0.03, 0.1, 6]} />
        <meshStandardMaterial color="#efeeea" roughness={0.9} />
      </InstancedPart>
      <InstancedPart count={mushroom.length} matrices={mushroomCapM}>
        <sphereGeometry args={[0.08, 8, 8]} />
        <meshStandardMaterial map={mushroomCapTexture} roughness={0.8} />
      </InstancedPart>

      {/* Flowers (hare arc): stem + color-alternating head */}
      <InstancedPart count={flower.length} matrices={flowerStemM}>
        <cylinderGeometry args={[0.008, 0.008, 0.12, 5]} />
        <meshStandardMaterial color="#5d8a3f" roughness={0.9} />
      </InstancedPart>
      <InstancedPart count={flower.length} matrices={flowerHeadM} colors={flowerColors}>
        <sphereGeometry args={[0.035, 6, 6]} />
        <meshStandardMaterial roughness={0.7} />
      </InstancedPart>
    </group>
  );
}
