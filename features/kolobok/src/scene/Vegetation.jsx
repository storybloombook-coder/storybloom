import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import {
  Color, ConeGeometry, Object3D, Quaternion, Vector3,
} from 'three';
import { ISLAND_RADIUS, rad, pointOnCircle } from '../config/zones';
import { scatterAngles, scatterNonOverlappingTrees } from './builders/placement';
import { makeRng } from './prng';
import { makeStripes, makeNoiseGrain, makeSpeckle } from './textures/proceduralTextures';
import { storyMotion } from '../state/sceneStore';
import { mergeColoredParts } from './builders/mergeColoredParts';
import { windSway, wind } from './wind';

const dummy = new Object3D();
const tiltAxisTmp = new Vector3();
const tiltQuatTmp = new Quaternion();
const offsetTmp = new Vector3();

// Kolobok<->tree collision (live feedback, revised after first pass: trees
// should slide to the SIDE to make room, not just lean in place, and the
// whole tree -- trunk + canopy -- must pivot/slide as one rigid unit
// hinged at its GROUND point, not each part swinging from its own
// mid-height position (which was the first version's bug: it looked like
// the trunk floated at an angle instead of leaning from its root). A
// second real bug from that version: the tilt axis was set to the push
// DIRECTION itself instead of perpendicular to it, which tips a vertical
// offset 90deg off from the intended lean -- fixed below (axis = (dirZ, 0,
// -dirX), not (dirX, 0, dirZ)).
const TREE_HIT_RADIUS = 0.55;
const PUSH_MAX = 0.35;       // sideways slide distance at peak, world units
const PUSH_RISE_S = 0.12;    // seconds to reach peak push
const BEND_MAX_TILT = rad(14); // tied to the same spring value as the push
const BEND_DECAY = 6;
const BEND_FREQ = 2.5;
const BEND_DURATION = 1.1; // seconds until the spring is fully settled

/** 0..1 envelope: quick linear rise to 1 over PUSH_RISE_S, then a decaying
 *  cosine clipped at 0 (never swings past center back toward Kolobok --
 *  only forward-and-settle, not a full pendulum). Drives BOTH the sideways
 *  push distance and the tilt angle, so they stay in lockstep as one spring
 *  rather than two independently-tuned curves that could drift apart. */
function springEnvelope(t) {
  if (t < PUSH_RISE_S) return t / PUSH_RISE_S;
  const tt = t - PUSH_RISE_S;
  return Math.max(0, Math.exp(-tt * BEND_DECAY) * Math.cos(tt * BEND_FREQ * Math.PI * 2));
}

/** Same placement as matrixAt, plus a rigid-body slide+tilt pivoting from
 *  the tree's GROUND point (not each part's own offset position): the
 *  local offset (trunk mid-height, canopy height) is rotated by the SAME
 *  combined orientation (yaw + tilt) that becomes the part's own rotation,
 *  which is what makes trunk and canopy swing together as one hinged
 *  plant instead of each independently floating at a repositioned point.
 *  Writes straight into `mesh` at `index` rather than returning a matrix,
 *  since this runs every frame for whichever trees are mid-spring. */
function applyCollisionMatrix(mesh, index, plant, localOffset, localScale, pushDist, tiltAngle, dirX, dirZ) {
  const [baseX, , baseZ] = pointOnCircle(plant.radius, plant.angle);

  dummy.rotation.set(0, plant.yaw, 0); // auto-syncs dummy.quaternion
  if (tiltAngle) {
    // Perpendicular to the push direction, in the XZ plane -- rotating a
    // vertical offset around THIS axis tips its top toward (dirX,dirZ).
    tiltAxisTmp.set(dirZ, 0, -dirX).normalize();
    tiltQuatTmp.setFromAxisAngle(tiltAxisTmp, tiltAngle);
    dummy.quaternion.premultiply(tiltQuatTmp);
  }
  offsetTmp.set(localOffset[0] * plant.scale, localOffset[1] * plant.scale, localOffset[2] * plant.scale);
  offsetTmp.applyQuaternion(dummy.quaternion);

  dummy.position.set(
    baseX + dirX * pushDist + offsetTmp.x,
    offsetTmp.y,
    baseZ + dirZ * pushDist + offsetTmp.z,
  );
  dummy.scale.set(
    plant.scale * localScale[0],
    plant.scale * localScale[1],
    plant.scale * localScale[2],
  );
  dummy.updateMatrix();
  mesh.setMatrixAt(index, dummy.matrix);
}

// POLISH_SPEC §4 grass tufts + bend-away (also applies to flowers).
const GRASS_COUNT = 80;
const GRASS_BEND_RADIUS = 0.55;
const GRASS_BEND_MAX_TILT = rad(28);
const GRASS_BEND_DECAY = 9;
const GRASS_BEND_FREQ = 3.2; // gives the "slight overshoot" on the spring back
const GRASS_BEND_DURATION = 0.4; // 400ms, per spec
const GRASS_SWAY_AMPLITUDE = rad(14);
const FLOWER_BEND_RADIUS = 0.55; // flowers share the same reaction as grass

/** 3 crossed thin cones -- a cheap "tuft" silhouette that reads from any
 *  angle without a billboard. White base color: instanceColor (set per-
 *  instance below) is the only tint, so it comes through unmodified. */
function makeGrassTuftGeometry() {
  return mergeColoredParts([0, 60, 120].map((deg) => ({
    geometry: new ConeGeometry(0.015, 0.18, 4),
    color: '#ffffff',
    position: [0, 0.09, 0],
    rotation: [0, rad(deg), 0],
  })));
}

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

// Base (scale=1) canopy radii, used only as collision footprints below --
// birch's widest canopy blob is r=0.4 (see birchCanopyAM), spruce's widest
// tier is its low cone at r=0.55 (see spruceLowM) -- both nudged up
// slightly since two touching canopies still read as "the same tree".
const TREE_CANOPY_R = { birch: 0.42, spruce: 0.58 };

// Spruce transforms live at module scope (pure + deterministic via the
// seeded PRNG) so WeatherSystems' snow caps can reuse the exact top-tier
// matrices without recomputing placement (WEATHER_SPEC §4 "instanced,
// matching tree matrices"). Placed via scatterNonOverlappingTrees (not the
// old angle-only scatterAngles) so no two spruces' canopies intersect --
// angle spacing alone said nothing about radius, so two trees at similar
// radii but different angles (or vice versa) could still land overlapping.
const SPRUCE_PLANTS = (() => {
  const rng = makeRng(20);
  const occupied = [];
  return scatterNonOverlappingTrees(rng, 14, ['wolf', 'bear'], {
    radiusMin: ISLAND_RADIUS * 0.35, radiusMax: ISLAND_RADIUS * 0.88, scaleMin: 0.75, scaleMax: 1.15,
  }, TREE_CANOPY_R.spruce, occupied);
})();
export const SPRUCE_TOP_MATRICES = SPRUCE_PLANTS.map((p) => matrixAt(p, [0, 1.32, 0], [0.2, 0.1, 0.2]));

// Spruce's footprint, so birch (below, generated per-component-mount) never
// lands where a spruce already claimed the ground.
const SPRUCE_OCCUPIED = SPRUCE_PLANTS.map((p) => {
  const [x, , z] = pointOnCircle(p.radius, p.angle);
  return { x, z, r: TREE_CANOPY_R.spruce * p.scale };
});

function InstancedPart({
  count, matrices, colors, children, onMesh,
}) {
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
        if (onMesh) onMesh(mesh);
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
    // Starts from a COPY of spruce's footprint (not the shared array
    // itself) so this stays a pure, reload-stable computation.
    const occupied = [...SPRUCE_OCCUPIED];
    return scatterNonOverlappingTrees(rng, 12, ['hare', 'fox'], {
      radiusMin: ISLAND_RADIUS * 0.4, radiusMax: ISLAND_RADIUS * 0.85, scaleMin: 0.8, scaleMax: 1.2,
    }, TREE_CANOPY_R.birch, occupied);
  }, []);
  const spruce = SPRUCE_PLANTS;

  // Kolobok<->tree collision bookkeeping: world XZ per tree (for distance
  // checks) and a per-tree spring state, both keyed by index into
  // birch/spruce. Refs to the instancedMeshes themselves come from
  // InstancedPart's onMesh below.
  const birchTrunkRef = useRef();
  const birchCanopyRef = useRef();
  const spruceRef = useRef();
  const birchWorldXZ = useMemo(
    () => birch.map((p) => { const [x, , z] = pointOnCircle(p.radius, p.angle); return [x, z]; }),
    [birch],
  );
  const spruceWorldXZ = useMemo(
    () => spruce.map((p) => { const [x, , z] = pointOnCircle(p.radius, p.angle); return [x, z]; }),
    [spruce],
  );
  const birchBend = useRef(birch.map(() => ({ t: -1, ax: 0, az: 0 })));
  const spruceBend = useRef(spruce.map(() => ({ t: -1, ax: 0, az: 0 })));

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const kx = storyMotion.kolobokWorldPos[0];
    const kz = storyMotion.kolobokWorldPos[2];

    let birchTouched = false;
    birch.forEach((plant, i) => {
      const b = birchBend.current[i];
      const [x, z] = birchWorldXZ[i];
      if (b.t < 0) {
        // Direction FROM Kolobok THROUGH the tree, continuing outward --
        // "push away from Kolobok", i.e. the direction that opens space
        // for him to keep rolling through.
        const dx = x - kx;
        const dz = z - kz;
        if (dx * dx + dz * dz >= TREE_HIT_RADIUS * TREE_HIT_RADIUS) return;
        const len = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
        b.t = 0;
        b.ax = dx / len;
        b.az = dz / len;
      }
      b.t += dt;
      const settled = b.t >= BEND_DURATION;
      const spring = settled ? 0 : springEnvelope(b.t);
      const pushDist = PUSH_MAX * spring;
      const tiltAngle = BEND_MAX_TILT * spring;
      if (birchTrunkRef.current) {
        applyCollisionMatrix(birchTrunkRef.current, i, plant, [0, 0.8, 0], [1, 1, 1], pushDist, tiltAngle, b.ax, b.az);
      }
      if (birchCanopyRef.current) {
        applyCollisionMatrix(birchCanopyRef.current, i, plant, [0.05, 1.7, 0], [1, 0.8, 1], pushDist, tiltAngle, b.ax, b.az);
        applyCollisionMatrix(birchCanopyRef.current, i + birch.length, plant, [-0.1, 1.85, 0.08], [0.7, 0.6125, 0.7], pushDist, tiltAngle, b.ax, b.az);
      }
      birchTouched = true;
      if (settled) b.t = -1;
    });
    if (birchTouched) {
      if (birchTrunkRef.current) birchTrunkRef.current.instanceMatrix.needsUpdate = true;
      if (birchCanopyRef.current) birchCanopyRef.current.instanceMatrix.needsUpdate = true;
    }

    let spruceTouched = false;
    spruce.forEach((plant, i) => {
      const b = spruceBend.current[i];
      const [x, z] = spruceWorldXZ[i];
      if (b.t < 0) {
        const dx = x - kx;
        const dz = z - kz;
        if (dx * dx + dz * dz >= TREE_HIT_RADIUS * TREE_HIT_RADIUS) return;
        const len = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
        b.t = 0;
        b.ax = dx / len;
        b.az = dz / len;
      }
      b.t += dt;
      const settled = b.t >= BEND_DURATION;
      const spring = settled ? 0 : springEnvelope(b.t);
      const pushDist = PUSH_MAX * spring;
      const tiltAngle = BEND_MAX_TILT * spring;
      if (spruceRef.current) {
        applyCollisionMatrix(spruceRef.current, i, plant, [0, 0.35, 0], [0.55, 0.7, 0.55], pushDist, tiltAngle, b.ax, b.az);
        applyCollisionMatrix(spruceRef.current, i + spruce.length, plant, [0, 0.72, 0], [0.4, 0.6, 0.4], pushDist, tiltAngle, b.ax, b.az);
        applyCollisionMatrix(spruceRef.current, i + spruce.length * 2, plant, [0, 1.05, 0], [0.26, 0.5, 0.26], pushDist, tiltAngle, b.ax, b.az);
      }
      spruceTouched = true;
      if (settled) b.t = -1;
    });
    if (spruceTouched && spruceRef.current) spruceRef.current.instanceMatrix.needsUpdate = true;
  });

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

  // Grass tufts: 40% biased to the hare arc (scatterChance 0.6 means 60%
  // scatter freely, 40% land in-arc), scattered the rest of the way,
  // honoring the usual 16deg landmark keep-clear.
  const grass = useMemo(() => {
    const rng = makeRng(61);
    const angles = scatterAngles(rng, GRASS_COUNT, ['hare'], { scatterChance: 0.6, keepClearDeg: 16 });
    return angles.map((deg) => {
      const angleRad = rad(deg);
      const radius = ISLAND_RADIUS * (0.3 + rng() * 0.6);
      const [x, , z] = pointOnCircle(radius, angleRad);
      return { x, z, yaw: rng() * Math.PI * 2 };
    });
  }, []);
  const grassColors = useMemo(() => {
    const rng = makeRng(63);
    const c1 = new Color('#6f9b52');
    const c2 = new Color('#86b25f');
    return grass.map(() => c1.clone().lerp(c2, rng()));
  }, [grass]);
  const grassGeometry = useMemo(() => makeGrassTuftGeometry(), []);
  const grassRef = useRef();
  const grassBend = useRef(grass.map(() => ({ t: -1, ax: 0, az: 0 })));
  const flowerWorldXZ = useMemo(
    () => flower.map((p) => { const [x, , z] = pointOnCircle(p.radius, p.angle); return [x, z]; }),
    [flower],
  );
  const flowerBend = useRef(flower.map(() => ({ t: -1, ax: 0, az: 0 })));
  const flowerHeadRef = useRef();

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const clock = Date.now() / 1000;
    const kx = storyMotion.kolobokWorldPos[0];
    const kz = storyMotion.kolobokWorldPos[2];

    if (grassRef.current) {
      const mesh = grassRef.current;
      grass.forEach((g, i) => {
        const b = grassBend.current[i];
        if (b.t < 0) {
          const dx = g.x - kx;
          const dz = g.z - kz;
          if (dx * dx + dz * dz < GRASS_BEND_RADIUS * GRASS_BEND_RADIUS) {
            const len = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
            b.t = 0; b.ax = dx / len; b.az = dz / len;
          }
        }
        let bendAngle = 0;
        if (b.t >= 0) {
          b.t += dt;
          if (b.t >= GRASS_BEND_DURATION) b.t = -1;
          else bendAngle = GRASS_BEND_MAX_TILT * Math.exp(-b.t * GRASS_BEND_DECAY) * Math.cos(b.t * GRASS_BEND_FREQ * Math.PI * 2);
        }
        const swayAngle = windSway(g.x, g.z, clock, GRASS_SWAY_AMPLITUDE);

        dummy.position.set(g.x, 0, g.z);
        dummy.rotation.set(0, g.yaw, 0);
        if (swayAngle) {
          tiltAxisTmp.set(wind.direction[2], 0, -wind.direction[0]).normalize();
          tiltQuatTmp.setFromAxisAngle(tiltAxisTmp, swayAngle);
          dummy.quaternion.premultiply(tiltQuatTmp);
        }
        if (bendAngle) {
          tiltAxisTmp.set(b.az, 0, -b.ax).normalize();
          tiltQuatTmp.setFromAxisAngle(tiltAxisTmp, bendAngle);
          dummy.quaternion.premultiply(tiltQuatTmp);
        }
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }

    // Flowers share the grass tufts' bend-away reaction (POLISH_SPEC §4);
    // only the head instance visibly tilts (the stem is thin enough that
    // leaving it upright isn't noticeable at this scale).
    if (flowerHeadRef.current) {
      const mesh = flowerHeadRef.current;
      flower.forEach((p, i) => {
        const b = flowerBend.current[i];
        const [x, z] = flowerWorldXZ[i];
        if (b.t < 0) {
          const dx = x - kx;
          const dz = z - kz;
          if (dx * dx + dz * dz < FLOWER_BEND_RADIUS * FLOWER_BEND_RADIUS) {
            const len = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
            b.t = 0; b.ax = dx / len; b.az = dz / len;
          }
        }
        let bendAngle = 0;
        if (b.t >= 0) {
          b.t += dt;
          if (b.t >= GRASS_BEND_DURATION) b.t = -1;
          else bendAngle = GRASS_BEND_MAX_TILT * Math.exp(-b.t * GRASS_BEND_DECAY) * Math.cos(b.t * GRASS_BEND_FREQ * Math.PI * 2);
        }
        dummy.position.set(x, 0.13 * p.scale, z);
        dummy.rotation.set(0, p.yaw, 0);
        if (bendAngle) {
          tiltAxisTmp.set(b.az, 0, -b.ax).normalize();
          tiltQuatTmp.setFromAxisAngle(tiltAxisTmp, bendAngle);
          dummy.quaternion.premultiply(tiltQuatTmp);
        }
        dummy.scale.setScalar(p.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, flowerColors[i]);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });

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
      <InstancedPart count={birch.length} matrices={birchTrunkM} onMesh={(m) => { birchTrunkRef.current = m; }}>
        <cylinderGeometry args={[0.07, 0.08, 1.6, 7]} />
        <meshStandardMaterial map={birchTexture} roughness={0.9} />
      </InstancedPart>
      <InstancedPart count={birchCanopyM.length} matrices={birchCanopyM} onMesh={(m) => { birchCanopyRef.current = m; }}>
        <sphereGeometry args={[0.4, 8, 8]} />
        <meshStandardMaterial map={birchCanopyTexture} roughness={0.9} />
      </InstancedPart>

      {/* Spruce: all 3 cone tiers of all trees in one merged instancedMesh */}
      <InstancedPart count={spruceAllM.length} matrices={spruceAllM} colors={spruceAllColors} onMesh={(m) => { spruceRef.current = m; }}>
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
      <InstancedPart count={flower.length} matrices={flowerHeadM} colors={flowerColors} onMesh={(m) => { flowerHeadRef.current = m; }}>
        <sphereGeometry args={[0.035, 6, 6]} />
        <meshStandardMaterial roughness={0.7} />
      </InstancedPart>

      {/* Grass tufts (POLISH_SPEC §4): wind sway + bend-away from Kolobok,
          both applied per-frame above -- no static initial matrices needed
          since the useFrame writes every instance every frame from mount. */}
      <instancedMesh
        ref={(mesh) => {
          grassRef.current = mesh;
          if (!mesh) return;
          grassColors.forEach((c, i) => mesh.setColorAt(i, c));
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }}
        args={[grassGeometry, undefined, GRASS_COUNT]}
      >
        <meshStandardMaterial vertexColors roughness={0.85} />
      </instancedMesh>
    </group>
  );
}
