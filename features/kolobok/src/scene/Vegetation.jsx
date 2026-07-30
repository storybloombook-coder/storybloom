import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import * as Haptics from 'expo-haptics';
import {
  BufferAttribute, BufferGeometry, Color, DataTexture, DoubleSide, LinearFilter, Object3D,
  PlaneGeometry, Quaternion, RGBAFormat, UnsignedByteType, Vector3,
} from 'three';
import {
  ISLAND_RADIUS, rad, pointOnCircle, PATH_RADIUS, PATH_HALF_WIDTH,
} from '../config/zones';
import { scatterAngles, scatterNonOverlappingTrees } from './builders/placement';
import { makeRng } from './prng';
import { makeStripes, makeNoiseGrain, makeSpeckle, makeRadialAlphaTexture } from './textures/proceduralTextures';
import { storyMotion, useSceneStore, atmosphereLive } from '../state/sceneStore';
import { windSway, wind } from './wind';
import { polish } from '../config/devFlags';
import { getSharedTexture } from './BlobShadow';
import { eggManager } from './easterEggs';
// Live feedback #1: ground-hugging props (grass/flowers/mushrooms) need the
// SAME terrain height Island.jsx's own ground mesh uses at each (x,z), so
// they sit ON the hills/in the pits instead of floating/sinking at flat
// Y=0. Only ever called from inside Vegetation()'s own render (useMemo/
// useFrame), never at this module's own top level, so the mutual import
// (Island.jsx already imports SPRUCE_OCCUPIED from this file) settles
// safely by the time either side actually runs.
import { groundHeightAt } from './Island';

const dummy = new Object3D();
const tiltAxisTmp = new Vector3();
const tiltQuatTmp = new Quaternion();
const offsetTmp = new Vector3();
const grassColorTmp = new Color();

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
// Live feedback: the reaction read as too harsh/intense -- push+tilt both
// scaled down, and a squash-and-stretch (STRETCH_Y/STRETCH_XZ below) added
// for a snappier, more organic "boing" instead of a rigid slide-and-tilt.
const PUSH_MAX = 0.22;       // sideways slide distance at peak, world units
const PUSH_RISE_S = 0.12;    // seconds to reach peak push
const BEND_MAX_TILT = rad(9); // tied to the same spring value as the push
const BEND_DECAY = 6;
const BEND_FREQ = 2.5;
const BEND_DURATION = 1.1; // seconds until the spring is fully settled
const STRETCH_Y = 0.16;   // +16% taller at peak spring intensity
const STRETCH_XZ = 0.08;  // -8% thinner at peak, so volume feels conserved

// Live feedback: "have the birch leaves fall with the first tap" (was a
// 5-tap-within-a-window threshold) -- every tap fires a fresh batch
// immediately, no counting, no cooldown, matching the willow's own
// one-shot-per-tap reaction. "3x as many leaves" -- was 14; "dark green" --
// was #5d8a3f.
const LEAF_FALL_BATCH = 42;
// Generous shared pool (4 batches' worth) so several birches can be
// mid-fall at once without one tree's leaves stealing another's slots.
const LEAF_POOL_SIZE = LEAF_FALL_BATCH * 4;
const LEAF_CANOPY_Y = 1.7; // matches birchCanopyAM's own local Y offset below
const LEAF_COLOR = '#2e4a1e';

// Live feedback #7: 12 mushrooms scattered randomly across the WHOLE island
// (no home-zone bias), never too close to each other/trees/the path/the
// pond/landmarks -- scatterNonOverlappingTrees already enforces all of that
// once given an occupied list. "Random size range per mushroom" clarified as
// a per-mushroom roll between -10% and +20% of the old baseline size.
const MUSHROOM_COUNT = 12;
const MUSHROOM_CANOPY_R = 0.12; // small footprint -- just needs "not touching"
// Live feedback #8: 5 more, specifically scattered in the perimeter band
// between the road and the island's edge (outside PATH_RADIUS, short of the
// outer skirt) -- on top of the 12 general ones above, sharing the same
// hedgehog/respawn mechanic.
const PERIMETER_MUSHROOM_COUNT = 5;
const PERIMETER_BAND_MIN_R = PATH_RADIUS + PATH_HALF_WIDTH + 0.5;
const PERIMETER_BAND_MAX_R = ISLAND_RADIUS * 0.95;
// "Mushrooms respawn every 10 seconds" -- was 20000ms under the old single-
// mushroom design.
const MUSHROOM_POP_MS = 300;
const MUSHROOM_HIDE_MS = 10000;
// "There can be any number of hedgehogs" -- a pool of independent journeys
// instead of one shared slot, generous enough that several taps in quick
// succession all get one.
const HEDGEHOG_POOL_SIZE = 8;
const HEDGEHOG_APPROACH_S = 4; // center -> mushroom, along the S-path
const HEDGEHOG_SNIFF_S = 1.6;  // "1-2 second" sniffing animation
const HEDGEHOG_RETURN_S = 4;   // same path, reversed

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
 *  `intensity` (0..1, how "deep" into the spring this frame is) drives a
 *  squash-and-stretch on top of the slide+tilt -- taller/thinner at peak,
 *  back to normal at rest -- for a snappier, less rigid-feeling bend.
 *  Writes straight into `mesh` at `index` rather than returning a matrix,
 *  since this runs every frame for whichever trees are mid-spring. */
function applyCollisionMatrix(mesh, index, plant, localOffset, localScale, pushDist, tiltAngle, dirX, dirZ, intensity = 0) {
  const [baseX, , baseZ] = pointOnCircle(plant.radius, plant.angle);

  dummy.rotation.set(0, plant.yaw, 0); // auto-syncs dummy.quaternion
  if (tiltAngle) {
    // Perpendicular to the push direction, in the XZ plane -- rotating a
    // vertical offset around THIS axis tips its top toward (dirX,dirZ).
    tiltAxisTmp.set(dirZ, 0, -dirX).normalize();
    tiltQuatTmp.setFromAxisAngle(tiltAxisTmp, tiltAngle);
    dummy.quaternion.premultiply(tiltQuatTmp);
  }
  const stretchY = 1 + intensity * STRETCH_Y;
  const stretchXZ = 1 - intensity * STRETCH_XZ;
  offsetTmp.set(
    localOffset[0] * plant.scale,
    localOffset[1] * plant.scale * stretchY,
    localOffset[2] * plant.scale,
  );
  offsetTmp.applyQuaternion(dummy.quaternion);

  dummy.position.set(
    baseX + dirX * pushDist + offsetTmp.x,
    offsetTmp.y,
    baseZ + dirZ * pushDist + offsetTmp.z,
  );
  dummy.scale.set(
    plant.scale * localScale[0] * stretchXZ,
    plant.scale * localScale[1] * stretchY,
    plant.scale * localScale[2] * stretchXZ,
  );
  dummy.updateMatrix();
  mesh.setMatrixAt(index, dummy.matrix);
}

// POLISH_SPEC §4 grass tufts + bend-away (also applies to flowers).
// BACKLOG.md #13 / live feedback "grass with flowers a little thicker":
// was 80, then 112. Live feedback: "+50%, distributed randomly and evenly"
// -- 112*1.5=168, and the hare-arc bias below is dropped entirely (see the
// scatterAngles call).
// Live feedback: "+30%" -- was 168.
const GRASS_COUNT = 218;
// Live feedback: grass now avoids trees/mushrooms/landmarks/the path/the
// pond (previously only checked the 16deg landmark keep-clear, via
// scatterAngles -- nothing stopped it landing ON the road or IN the pond,
// or overlapping a tree/mushroom). Small footprint since blades are thin.
const GRASS_CANOPY_R = 0.06;
// GRASS_BEND_MAX_TILT/DECAY/FREQ/DURATION are still used by the flower
// bend-away reaction below (they share this spring shape) even though
// grass's OWN bend-away is gone -- "the grass animation is simple, it just
// sways in the wind" removed the bend-away-from-Kolobok reaction from grass
// specifically, not from flowers.
const GRASS_BEND_MAX_TILT = rad(28);
const GRASS_BEND_DECAY = 9;
const GRASS_BEND_FREQ = 3.2; // gives the "slight overshoot" on the spring back
const GRASS_BEND_DURATION = 0.4; // 400ms, per spec
const GRASS_SWAY_AMPLITUDE = rad(14);
// Live feedback: "the wind should gently rustle the trees" -- trees are
// heavy/rooted, so a MUCH smaller amplitude than grass's, riding the same
// windSway() phase-offset rule (POLISH_SPEC §3) so a gust visibly rolls
// across the whole stand rather than every tree swaying in lockstep.
const TREE_SWAY_AMPLITUDE = rad(2.2);
const FLOWER_BEND_RADIUS = 0.55; // flowers share the same reaction as grass

// Live feedback: "make the grass using the same principle as the tree
// background -- overlay two 2D texture sprites, the grass is barely
// visible" -- was 3 crossed thin cone silhouettes; now a procedurally-
// generated alpha-cutout blade-cluster texture (BackgroundForest.jsx's own
// makeTreeSpriteTexture technique) on a cross of two flat planes per tuft,
// same "whichever plane is more edge-on still shows a full silhouette from
// the other one" reasoning. White base color: instanceColor (set per-frame
// below, now with the SAME day/night brightness multiply BackgroundForest.jsx
// uses, since an unlit sprite -- unlike the old lit cone geometry -- never
// dims with the scene's own lighting otherwise) is the only tint.
const GRASS_SPRITE_W = 16;
const GRASS_SPRITE_H = 24;
const GRASS_BLADE_COUNT = 5;
function makeGrassSpriteTexture() {
  const rng = makeRng(96);
  const blades = new Array(GRASS_BLADE_COUNT).fill(0).map((_, i) => ({
    baseU: -0.75 + (i / (GRASS_BLADE_COUNT - 1)) * 1.5 + (rng() - 0.5) * 0.2,
    bend: (rng() - 0.5) * 0.6,
    height: 0.7 + rng() * 0.3,
    width: 0.09 + rng() * 0.05,
  }));
  const data = new Uint8Array(GRASS_SPRITE_W * GRASS_SPRITE_H * 4);
  for (let y = 0; y < GRASS_SPRITE_H; y++) {
    const v = y / (GRASS_SPRITE_H - 1); // 0 = bottom (root), 1 = top
    for (let x = 0; x < GRASS_SPRITE_W; x++) {
      const u = (x / (GRASS_SPRITE_W - 1)) * 2 - 1; // -1..1
      let inside = false;
      for (const b of blades) {
        if (v > b.height) continue;
        const bv = v / b.height;
        const center = b.baseU + Math.sin(bv * Math.PI * 0.5) * b.bend;
        const width = b.width * (1 - bv * 0.85); // tapers toward the tip
        if (Math.abs(u - center) < width) { inside = true; break; }
      }
      const o = (y * GRASS_SPRITE_W + x) * 4;
      data[o] = 0xff;
      data[o + 1] = 0xff;
      data[o + 2] = 0xff;
      data[o + 3] = inside ? 255 : 0;
    }
  }
  const texture = new DataTexture(data, GRASS_SPRITE_W, GRASS_SPRITE_H, RGBAFormat, UnsignedByteType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
// Plane is 0.22 wide x 0.2 tall, translated up by half its height so the
// geometry's own local origin (0,0,0) sits at the BOTTOM edge (the root) --
// matching how the old merged-cone tuft's cones were already offset from
// y=0, so bend-away/wind-sway tilts (applied to the whole instance
// transform) correctly hinge from the ground point, not the blade's middle.
const GRASS_SPRITE_W_WORLD = 0.22;
const GRASS_SPRITE_H_WORLD = 0.2;
function makeGrassSpriteGeometry() {
  const geo = new PlaneGeometry(GRASS_SPRITE_W_WORLD, GRASS_SPRITE_H_WORLD);
  geo.translate(0, GRASS_SPRITE_H_WORLD / 2, 0);
  return geo;
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

// `groundY` (live feedback #1): the terrain height under this plant's own
// (x,z) -- see Island.jsx's groundHeightAt, sampled once by the caller and
// passed in here rather than recomputed per-part, since several parts
// (stem/cap, trunk/canopy) share the same base point. Defaults to 0 (flat)
// for plants that don't need it (birch/spruce trunks are tall enough that
// the hill/pothole bumps under them are imperceptible).
function matrixAt(plant, localOffset = [0, 0, 0], localScale = [1, 1, 1], groundY = 0) {
  const [x, , z] = pointOnCircle(plant.radius, plant.angle);
  dummy.position.set(
    x + localOffset[0] * plant.scale,
    groundY + localOffset[1] * plant.scale,
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

// BACKLOG.md #15: flat blob shadows under the foreground trees (Kolobok/
// animals/landmarks already have them via BlobShadow.jsx -- trees didn't).
// Radii are smaller than the canopy footprint itself (TREE_CANOPY_R above),
// since a shadow reads better hugging the trunk base than matching the full
// leaf-spread. Ground-anchored and static: the collision lean/tilt pivots
// from the tree's own ground point (see applyCollisionMatrix), so the shadow
// underneath it never needs to move even while the tree is mid-spring.
const BIRCH_SHADOW_R = 0.3;
const SPRUCE_SHADOW_R = 0.42;
// Live feedback #3: mushrooms get the same flat blob shadow treatment.
// Small, roughly matching the cap's own footprint (see mushroomCapM's own
// r=0.08 sphere below).
const MUSHROOM_SHADOW_R = 0.1;

// `groundY` (live feedback #1): same terrain-height offset matrixAt itself
// takes, so a shadow under a mushroom sitting on a hill/in a pit is
// ground-anchored there too, not floating/sinking at flat Y=0.02.
function shadowMatrixAt(x, z, radius, groundY = 0) {
  dummy.position.set(x, groundY + 0.02, z);
  dummy.rotation.set(-Math.PI / 2, 0, 0);
  dummy.scale.set(radius * 2, radius * 2, 1);
  dummy.updateMatrix();
  return dummy.matrix.clone();
}

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
  const scattered = scatterNonOverlappingTrees(rng, 14, ['wolf', 'bear'], {
    radiusMin: ISLAND_RADIUS * 0.35, radiusMax: ISLAND_RADIUS * 0.88, scaleMin: 0.75, scaleMax: 1.15,
  }, TREE_CANOPY_R.spruce, occupied);
  // Live feedback: a couple of hand-placed spruces ("Christmas trees"),
  // different sizes, deliberately overlapping the path by ~20% of
  // TREE_HIT_RADIUS so Kolobok reliably brushes and pushes them as he
  // rolls past -- the opposite of the keep-clear rule scatterNonOverlapping
  // Trees enforces for the rest of the forest, so these bypass it
  // entirely and are placed directly. Angles sit mid-arc between zones
  // (clear of both the 16deg landmark keep-clear and the pond at 324deg).
  // Live feedback: moved 15% further from the road (offset from PATH_RADIUS
  // scaled by 1.15 -- was 0.28/0.3) -- still comfortably under
  // TREE_HIT_RADIUS(0.55) so Kolobok still brushes/pushes them, just a
  // little less deep into the road itself.
  const roadside = [
    { angle: rad(36), radius: PATH_RADIUS - 0.28 * 1.15, scale: 0.85, yaw: rng() * Math.PI * 2 },
    { angle: rad(108), radius: PATH_RADIUS + 0.3 * 1.15, scale: 1.2, yaw: rng() * Math.PI * 2 },
  ];
  // Live feedback: a spruce near the pond's willow, just off the water's
  // edge (not overlapping it) -- also a hand-placed exception to the
  // pond keep-clear rule, same reasoning as the roadside pair above.
  // Willow sits at local [1.9,0,0.75] inside the pond group (position
  // POND_POS, rotation POND_ANGLE+PI) -- worked out as world radius ~5.2,
  // angle ~303deg from island center; this sits a little further out/
  // around from it at radius 5.4, angle 306deg.
  const pondside = [
    { angle: rad(306), radius: 5.4, scale: 1.0, yaw: rng() * Math.PI * 2 },
  ];
  return [...scattered, ...roadside, ...pondside];
})();
export const SPRUCE_TOP_MATRICES = SPRUCE_PLANTS.map((p) => matrixAt(p, [0, 1.32, 0], [0.2, 0.1, 0.2]));

// Spruce's footprint, so birch (below, generated per-component-mount) never
// lands where a spruce already claimed the ground. Also exported so
// Island.jsx's pothole placement (BACKLOG.md #16) can steer clear of trees.
export const SPRUCE_OCCUPIED = SPRUCE_PLANTS.map((p) => {
  const [x, , z] = pointOnCircle(p.radius, p.angle);
  return { x, z, r: TREE_CANOPY_R.spruce * p.scale };
});

// hedgehog (live feedback #7 rework): a pool of independent journeys, not a
// single shared slot -- "there can be any number of hedgehogs." Module-level
// (like easterEggs.js's own eggMotion) so Hedgehog.jsx can read it directly
// without a store round-trip; this file (spawnHedgehog, below, and its own
// useFrame) is the only writer.
export const hedgehogPool = new Array(HEDGEHOG_POOL_SIZE).fill(0).map(() => ({
  active: false,
  mushroomIdx: -1,
  phase: 'approach', // 'approach' | 'sniff' | 'return'
  t: 0, // 0..1 progress within the current phase
  endX: 0,
  endY: 0, // live feedback #5: the mushroom's own ground height, so a hedgehog visiting one on a hill actually climbs to it
  endZ: 0,
  seed: 0, // randomizes each journey's S-curve so they don't all look identical
}));

function InstancedPart({
  count, matrices, colors, children, onMesh, onPointerDown, onPointerUp, onPointerLeave,
}) {
  return (
    <instancedMesh
      args={[undefined, undefined, count]}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
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
  // Live feedback #7: scattered randomly across the whole island (no home
  // zone -- scatterChance:1 with homeZoneIds=[] means every candidate rolls
  // a fully free angle), avoiding trees/path/pond/landmarks AND each other.
  // occupied seeds from spruce's own exported footprint plus a freshly
  // derived birch footprint (birch's own local `occupied` var is discarded
  // once its useMemo returns, so it's rebuilt here from its final placements).
  const mushroom = useMemo(() => {
    const rng = makeRng(40);
    const occupied = [...SPRUCE_OCCUPIED, ...birch.map((p) => {
      const [x, , z] = pointOnCircle(p.radius, p.angle);
      return { x, z, r: TREE_CANOPY_R.birch * p.scale };
    })];
    const general = scatterNonOverlappingTrees(rng, MUSHROOM_COUNT, [], {
      scatterChance: 1,
      radiusMin: ISLAND_RADIUS * 0.22,
      radiusMax: ISLAND_RADIUS * 0.92,
      scaleMin: 0.9,
      scaleMax: 1.2,
      touchFactor: 1.6, // extra spacing beyond bare-touching, so mushrooms visibly don't crowd
    }, MUSHROOM_CANOPY_R, occupied);
    // Live feedback #8: 5 more, confined to the perimeter band -- occupied
    // already carries every general mushroom placed just above, so these
    // keep clear of them too.
    const perimeter = scatterNonOverlappingTrees(rng, PERIMETER_MUSHROOM_COUNT, [], {
      scatterChance: 1,
      radiusMin: PERIMETER_BAND_MIN_R,
      radiusMax: PERIMETER_BAND_MAX_R,
      scaleMin: 0.9,
      scaleMax: 1.2,
      touchFactor: 1.6,
    }, MUSHROOM_CANOPY_R, occupied);
    return [...general, ...perimeter];
  }, [birch]);
  const mushroomWorldXZ = useMemo(
    () => mushroom.map((p) => { const [x, , z] = pointOnCircle(p.radius, p.angle); return [x, z]; }),
    [mushroom],
  );
  // Live feedback #1: sample the same terrain height Island.jsx's ground
  // mesh uses at each mushroom's own (x,z), so it sits on a hill's slope or
  // a pit's floor instead of floating/sinking at flat Y=0.
  const mushroomGroundY = useMemo(
    () => mushroomWorldXZ.map(([x, z]) => groundHeightAt(x, z)),
    [mushroomWorldXZ],
  );

  // hedgehog (live feedback #7 rework): refs to the mushroom instancedMeshes
  // so ANY subset of them can have their own matrix re-driven per frame (pop
  // out of the ground, hide, respawn) without touching the others, whose
  // static matrices (mushroomStemM/mushroomCapM below) never change.
  // mushroomGround tracks EVERY mushroom's own hide/respawn clock now
  // (matching birchBend/spruceBend's own per-plant useRef(...map(...)))
  // instead of a single shared slot, since "there can be any number of
  // hedgehogs" means several could be taken/hiding/respawning at once.
  const mushroomStemRef = useRef();
  const mushroomCapRef = useRef();
  const mushroomShadowRef = useRef();
  const mushroomGround = useRef(mushroom.map(() => ({ reserved: false, hiddenMs: -1 })));
  const mushroomStemM = useMemo(
    () => mushroom.map((p, i) => matrixAt(p, [0, 0.05, 0], [1, 1, 1], mushroomGroundY[i])),
    [mushroom, mushroomGroundY],
  );
  const mushroomCapM = useMemo(
    () => mushroom.map((p, i) => matrixAt(p, [0, 0.11, 0], [1, 0.55, 1], mushroomGroundY[i])),
    [mushroom, mushroomGroundY],
  );
  // Live feedback #3/#4: declared here (alongside stem/cap, not down with
  // birch/spruce's own static shadows further below) since the pop-out
  // useFrame block above needs to read it too, and referencing a later
  // declaration from an earlier closure is exactly the "accessed before
  // declared" pattern already flagged elsewhere in this file (e.g.
  // flowerColors) -- cheap to just avoid it here instead.
  const mushroomShadowM = useMemo(
    () => mushroom.map((p, i) => shadowMatrixAt(
      mushroomWorldXZ[i][0],
      mushroomWorldXZ[i][1],
      MUSHROOM_SHADOW_R * p.scale,
      mushroomGroundY[i],
    )),
    [mushroom, mushroomWorldXZ, mushroomGroundY],
  );

  /** Live feedback #7: tapping a mushroom sends the next free hedgehog-pool
   *  slot on a round trip from the center of the scene to that mushroom (see
   *  Hedgehog.jsx for the actual S-path -- this only owns phase/t bookkeeping
   *  and the mushroom's own hide/respawn clock, started at the sniff->return
   *  transition in the useFrame below). Ignored if this mushroom already has
   *  a journey in flight (or is still hidden/respawning), or if every pool
   *  slot is already busy. */
  const spawnHedgehog = (idx) => {
    const g = mushroomGround.current[idx];
    if (g.reserved) return;
    const slot = hedgehogPool.find((h) => !h.active);
    if (!slot) return;
    g.reserved = true;
    const [ex, ez] = mushroomWorldXZ[idx];
    slot.active = true;
    slot.mushroomIdx = idx;
    slot.phase = 'approach';
    slot.t = 0;
    slot.endX = ex;
    slot.endY = mushroomGroundY[idx]; // live feedback #5: climb to the mushroom's own elevation
    slot.endZ = ez;
    slot.seed = Math.random();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    useSceneStore.getState().recordEggFound('hedgehog');
  };

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
  const birchBend = useRef(birch.map(() => ({
    t: -1, ax: 0, az: 0, held: false, releaseAmp: 1,
  })));
  const spruceBend = useRef(spruce.map(() => ({
    t: -1, ax: 0, az: 0, held: false, releaseAmp: 1,
  })));

  // Birch leaf-fall (live feedback #10, simplified: fires on the very FIRST
  // tap now, no tap-counting): independent of the grab/bend physics above
  // and of easterEggs.js's suppression/cooldown -- this is a no-cooldown
  // ambient interaction, not a registry egg. leafPool is a SHARED,
  // generously-sized pool (several batches' worth) so multiple birches can
  // be mid-fall at once.
  const leafPool = useRef(new Array(LEAF_POOL_SIZE).fill(0).map(() => ({
    t: 1, x: 0, y: 0, z: 0, driftX: 0, driftZ: 0, fallDur: 1, spinPhase: 0,
  })));
  const leafSlot = useRef(0); // round-robins which pool slot the next spawn lands in
  const leafGeometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(LEAF_POOL_SIZE * 3), 3));
    return geo;
  }, []);
  const leafTexture = useMemo(() => makeRadialAlphaTexture(16), []);
  const leafRef = useRef();

  /** Spawns one batch of LEAF_FALL_BATCH leaves at birch[idx]'s canopy,
   *  each with its own random horizontal drift and fall duration (a few
   *  seconds -- "not quickly") so the batch reads as a scatter, not a
   *  single falling clump. */
  const spawnLeafFall = (idx) => {
    const [wx, wz] = birchWorldXZ[idx];
    const canopyY = LEAF_CANOPY_Y * birch[idx].scale;
    for (let i = 0; i < LEAF_FALL_BATCH; i++) {
      const slot = leafSlot.current % LEAF_POOL_SIZE;
      leafSlot.current += 1;
      const p = leafPool.current[slot];
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.35;
      p.x = wx + Math.cos(a) * r;
      p.z = wz + Math.sin(a) * r;
      p.y = canopyY + (Math.random() - 0.5) * 0.3;
      p.driftX = (Math.random() - 0.5) * 0.5;
      p.driftZ = (Math.random() - 0.5) * 0.5;
      p.spinPhase = Math.random() * Math.PI * 2;
      p.fallDur = 3 + Math.random() * 2; // 3-5s, gentle drift down
      p.t = 0;
    }
  };

  // BACKLOG.md #2: grab a tree directly (independent of Kolobok) and it
  // springs back on release. React Native's pointer-event model can't
  // reliably track a drag once the finger moves off a small instanced-mesh
  // hitbox (no pointer-capture guarantee like the web), so this is
  // press-pulls-in-that-direction / release-springs-back rather than a
  // continuous live-follow drag -- reuses the exact same spring math as
  // the Kolobok collision below (`springEnvelope`), just entered at
  // `t = PUSH_RISE_S` to skip straight to the decay phase (the tree is
  // already at peak pull the instant you grab it, no rise-in needed).
  const grabbedRef = useRef(null); // { type: 'birch'|'spruce', idx }
  const onTreeGrab = (type) => (e) => {
    e.stopPropagation();
    const count = type === 'birch' ? birch.length : spruce.length;
    const idx = e.instanceId % count;
    // owl (EASTER_EGGS.md Â§2): every press here is also a "tap" for the
    // triple-tap-a-spruce trigger -- doesn't gate/skip the grab-and-bend
    // reaction below, matching the doc's "taps still give their normal
    // reactions" even while an egg is running.
    if (type === 'spruce') eggManager.tapSpruce(idx);
    if (type === 'birch') spawnLeafFall(idx);
    const bendArr = type === 'birch' ? birchBend.current : spruceBend.current;
    const worldXZArr = type === 'birch' ? birchWorldXZ : spruceWorldXZ;
    const b = bendArr[idx];
    const dx = e.point.x - worldXZArr[idx][0];
    const dz = e.point.z - worldXZArr[idx][1];
    const len = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
    b.held = true;
    b.ax = dx / len;
    b.az = dz / len;
    b.t = -1;
    grabbedRef.current = { type, idx };
  };
  const onTreeRelease = () => {
    const g = grabbedRef.current;
    if (!g) return;
    const bendArr = g.type === 'birch' ? birchBend.current : spruceBend.current;
    const b = bendArr[g.idx];
    if (b) {
      b.held = false;
      b.releaseAmp = 1;
      b.t = PUSH_RISE_S;
    }
    grabbedRef.current = null;
  };

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const clock = Date.now() / 1000;
    const kx = storyMotion.kolobokWorldPos[0];
    const kz = storyMotion.kolobokWorldPos[2];

    let birchTouched = false;
    birch.forEach((plant, i) => {
      const b = birchBend.current[i];
      const [x, z] = birchWorldXZ[i];
      let pushDist = 0;
      let tiltAngle = 0;
      let active = false;
      if (b.held) {
        pushDist = PUSH_MAX * 1.15;
        tiltAngle = BEND_MAX_TILT * 1.15;
        active = true;
      } else {
        // Direction FROM Kolobok THROUGH the tree, continuing outward --
        // "push away from Kolobok", i.e. the direction that opens space
        // for him to keep rolling through.
        const dx = x - kx;
        const dz = z - kz;
        const overlapping = dx * dx + dz * dz < TREE_HIT_RADIUS * TREE_HIT_RADIUS;
        if (overlapping) {
          // BACKLOG.md #8: hold at full push for as long as they're still
          // intersecting, instead of firing a fixed-duration spring that
          // could settle back to zero (tree passing back through Kolobok)
          // while still overlapping. Direction is re-tracked every frame
          // so the lean follows him if he moves while still touching.
          // `t` only rises up to PUSH_RISE_S here and is clamped there --
          // springEnvelope(PUSH_RISE_S) is a steady 1 (full push), and it
          // only continues past that (into the decay curve) once he's
          // actually clear, below.
          const len = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
          b.ax = dx / len; b.az = dz / len;
          b.t = Math.min(PUSH_RISE_S, (b.t < 0 ? 0 : b.t) + dt);
          const spring = springEnvelope(b.t);
          pushDist = PUSH_MAX * spring;
          tiltAngle = BEND_MAX_TILT * spring;
          active = true;
        } else if (b.t >= 0) {
          b.t += dt;
          const settled = b.t >= BEND_DURATION;
          const spring = settled ? 0 : springEnvelope(b.t);
          pushDist = PUSH_MAX * spring;
          tiltAngle = BEND_MAX_TILT * spring;
          active = true;
          if (settled) b.t = -1;
        }
      }
      // Live feedback: "the wind should gently rustle the trees" -- when
      // not actively being pushed by Kolobok, sway ambiently with the wind
      // instead of sitting frozen (same windSway phase-offset rule as the
      // grass below, just a much smaller amplitude -- see TREE_SWAY_AMPLITUDE).
      let dirX = b.ax;
      let dirZ = b.az;
      if (!active) {
        tiltAngle = windSway(x, z, clock, TREE_SWAY_AMPLITUDE);
        dirX = wind.direction[0];
        dirZ = wind.direction[2];
      }
      const intensity = pushDist / PUSH_MAX;
      if (birchTrunkRef.current) {
        applyCollisionMatrix(birchTrunkRef.current, i, plant, [0, 0.8, 0], [1, 1, 1], pushDist, tiltAngle, dirX, dirZ, intensity);
      }
      if (birchCanopyRef.current) {
        applyCollisionMatrix(birchCanopyRef.current, i, plant, [0.05, 1.7, 0], [1, 0.8, 1], pushDist, tiltAngle, dirX, dirZ, intensity);
        applyCollisionMatrix(birchCanopyRef.current, i + birch.length, plant, [-0.1, 1.85, 0.08], [0.7, 0.6125, 0.7], pushDist, tiltAngle, dirX, dirZ, intensity);
      }
      birchTouched = true;
    });
    if (birchTouched) {
      if (birchTrunkRef.current) birchTrunkRef.current.instanceMatrix.needsUpdate = true;
      if (birchCanopyRef.current) birchCanopyRef.current.instanceMatrix.needsUpdate = true;
    }

    let spruceTouched = false;
    spruce.forEach((plant, i) => {
      const b = spruceBend.current[i];
      const [x, z] = spruceWorldXZ[i];
      let pushDist = 0;
      let tiltAngle = 0;
      let active = false;
      if (b.held) {
        pushDist = PUSH_MAX * 1.15;
        tiltAngle = BEND_MAX_TILT * 1.15;
        active = true;
      } else {
        // BACKLOG.md #8: see the matching birch block above for why this
        // holds at full push while overlapping instead of a fixed spring.
        const dx = x - kx;
        const dz = z - kz;
        const overlapping = dx * dx + dz * dz < TREE_HIT_RADIUS * TREE_HIT_RADIUS;
        if (overlapping) {
          const len = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
          b.ax = dx / len; b.az = dz / len;
          b.t = Math.min(PUSH_RISE_S, (b.t < 0 ? 0 : b.t) + dt);
          const spring = springEnvelope(b.t);
          pushDist = PUSH_MAX * spring;
          tiltAngle = BEND_MAX_TILT * spring;
          active = true;
        } else if (b.t >= 0) {
          b.t += dt;
          const settled = b.t >= BEND_DURATION;
          const spring = settled ? 0 : springEnvelope(b.t);
          pushDist = PUSH_MAX * spring;
          tiltAngle = BEND_MAX_TILT * spring;
          active = true;
          if (settled) b.t = -1;
        }
      }
      // Ambient wind sway when not being pushed (see the birch block above).
      let dirX = b.ax;
      let dirZ = b.az;
      if (!active) {
        tiltAngle = windSway(x, z, clock, TREE_SWAY_AMPLITUDE);
        dirX = wind.direction[0];
        dirZ = wind.direction[2];
      }
      const intensity = pushDist / PUSH_MAX;
      if (spruceRef.current) {
        applyCollisionMatrix(spruceRef.current, i, plant, [0, 0.35, 0], [0.55, 0.7, 0.55], pushDist, tiltAngle, dirX, dirZ, intensity);
        applyCollisionMatrix(spruceRef.current, i + spruce.length, plant, [0, 0.72, 0], [0.4, 0.6, 0.4], pushDist, tiltAngle, dirX, dirZ, intensity);
        applyCollisionMatrix(spruceRef.current, i + spruce.length * 2, plant, [0, 1.05, 0], [0.26, 0.5, 0.26], pushDist, tiltAngle, dirX, dirZ, intensity);
      }
      spruceTouched = true;
    });
    if (spruceTouched && spruceRef.current) spruceRef.current.instanceMatrix.needsUpdate = true;

    // Birch leaf-fall: advance every active pool particle (t 0..1 over its
    // own fallDur), gentle horizontal drift via a slow sine wobble on top of
    // its fixed per-leaf drift direction (reads as tumbling, not a straight
    // drop), parked out of view once it lands.
    if (leafRef.current) {
      const positions = leafGeometry.attributes.position;
      leafPool.current.forEach((p, i) => {
        if (p.t < 1) {
          p.t += dt / p.fallDur;
          if (p.t > 1) p.t = 1;
        }
        const fallT = Math.min(p.t, 1);
        const wobble = Math.sin(fallT * Math.PI * 3 + p.spinPhase) * 0.15;
        const x = p.x + p.driftX * fallT + wobble * 0.1;
        const y = p.t >= 1 ? -5 : p.y * (1 - fallT); // parked below ground once landed
        const z = p.z + p.driftZ * fallT + wobble * 0.1;
        positions.setXYZ(i, x, y, z);
      });
      positions.needsUpdate = true;
      leafGeometry.computeBoundingSphere();
    }

    // hedgehog pool (live feedback #7): advance each active journey's
    // phase/t. The actual on-screen position is computed by Hedgehog.jsx
    // (reads this same pool + its own S-path helper) -- this only drives the
    // state machine, and at the sniff->return transition kicks off THIS
    // mushroom's own pop-out/hide/respawn clock (the mushroom "jumps onto
    // his quills" the instant the sniff completes).
    hedgehogPool.forEach((h) => {
      if (!h.active) return;
      if (h.phase === 'approach') {
        h.t += dt / HEDGEHOG_APPROACH_S;
        if (h.t >= 1) { h.t = 0; h.phase = 'sniff'; }
      } else if (h.phase === 'sniff') {
        h.t += dt / HEDGEHOG_SNIFF_S;
        if (h.t >= 1) {
          h.t = 0;
          h.phase = 'return';
          mushroomGround.current[h.mushroomIdx].hiddenMs = 0;
        }
      } else if (h.phase === 'return') {
        h.t += dt / HEDGEHOG_RETURN_S;
        if (h.t >= 1) {
          h.active = false;
          h.mushroomIdx = -1;
        }
      }
    });

    // Per-mushroom pop-out/hide/respawn (live feedback #7: "any number of
    // hedgehogs" means several mushrooms could be mid-hide/respawn at once,
    // so every mushroom tracks its OWN clock now instead of one shared slot).
    mushroomGround.current.forEach((g, idx) => {
      if (g.hiddenMs < 0) return;
      g.hiddenMs += dt * 1000;
      let popScale;
      if (g.hiddenMs < MUSHROOM_POP_MS) {
        popScale = 1 - g.hiddenMs / MUSHROOM_POP_MS;
      } else if (g.hiddenMs < MUSHROOM_HIDE_MS) {
        popScale = 0;
      } else if (g.hiddenMs < MUSHROOM_HIDE_MS + MUSHROOM_POP_MS) {
        popScale = (g.hiddenMs - MUSHROOM_HIDE_MS) / MUSHROOM_POP_MS;
      } else {
        popScale = 1;
      }
      if (mushroomStemRef.current) {
        dummy.matrix.copy(mushroomStemM[idx]);
        dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
        dummy.scale.multiplyScalar(popScale);
        dummy.updateMatrix();
        mushroomStemRef.current.setMatrixAt(idx, dummy.matrix);
        mushroomStemRef.current.instanceMatrix.needsUpdate = true;
      }
      if (mushroomCapRef.current) {
        dummy.matrix.copy(mushroomCapM[idx]);
        dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
        dummy.scale.multiplyScalar(popScale);
        dummy.updateMatrix();
        mushroomCapRef.current.setMatrixAt(idx, dummy.matrix);
        mushroomCapRef.current.instanceMatrix.needsUpdate = true;
      }
      // Live feedback #4: the shadow disappears/reappears WITH the mushroom
      // now (was static -- matching birch/spruce's own shadows, which never
      // needed this since trees never hide -- but a taken/respawning
      // mushroom leaving its shadow behind read as a shadow with no object).
      if (mushroomShadowRef.current) {
        dummy.matrix.copy(mushroomShadowM[idx]);
        dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
        dummy.scale.multiplyScalar(popScale);
        dummy.updateMatrix();
        mushroomShadowRef.current.setMatrixAt(idx, dummy.matrix);
        mushroomShadowRef.current.instanceMatrix.needsUpdate = true;
      }
      if (g.hiddenMs >= MUSHROOM_HIDE_MS + MUSHROOM_POP_MS) {
        g.hiddenMs = -1;
        g.reserved = false;
      }
    });
  });

  const bush = useMemo(() => {
    const rng = makeRng(30);
    // No home arc specified for bushes (ART_SPEC §5) -- scattered freely.
    return makePlants(rng, 10, [], {
      scatterChance: 1, radiusMin: ISLAND_RADIUS * 0.3, radiusMax: ISLAND_RADIUS * 0.9, scaleMin: 0.85, scaleMax: 1.2,
    });
  }, []);
  const flower = useMemo(() => {
    const rng = makeRng(50);
    // "grass with flowers a little thicker" -- was 16.
    return makePlants(rng, 23, ['hare'], {
      radiusMin: ISLAND_RADIUS * 0.4, radiusMax: ISLAND_RADIUS * 0.8, scaleMin: 0.8, scaleMax: 1.3,
    });
  }, []);

  // Grass tufts: live feedback -- "spread across the stage surface, inside
  // the pits, and on the hills, without falling into objects. There
  // shouldn't be any grass in the lake or road." scatterAngles only ever
  // checked the 16deg landmark keep-clear -- nothing stopped a tuft landing
  // ON the path, IN the pond, or overlapping a tree/mushroom, since it
  // rolled its own radius independently with no collision check at all.
  // Switched to scatterNonOverlappingTrees (already handles path/pond/
  // landmark keep-clear AND an arbitrary occupied-list check) with the
  // SAME radius band as before -- hills/potholes aren't excluded by
  // anything here, matching mushrooms' own placement, so grass can still
  // land on them (and groundHeightAt below then sits it at the right
  // height there).
  const grass = useMemo(() => {
    const rng = makeRng(61);
    const occupied = [
      ...SPRUCE_OCCUPIED,
      ...birch.map((p) => {
        const [x, , z] = pointOnCircle(p.radius, p.angle);
        return { x, z, r: TREE_CANOPY_R.birch * p.scale };
      }),
      ...mushroom.map((p) => {
        const [x, , z] = pointOnCircle(p.radius, p.angle);
        return { x, z, r: MUSHROOM_CANOPY_R * p.scale };
      }),
    ];
    const plants = scatterNonOverlappingTrees(rng, GRASS_COUNT, [], {
      scatterChance: 1,
      keepClearDeg: 16,
      radiusMin: ISLAND_RADIUS * 0.3,
      radiusMax: ISLAND_RADIUS * 0.9,
      scaleMin: 1,
      scaleMax: 1,
    }, GRASS_CANOPY_R, occupied);
    return plants.map((p) => {
      const [x, , z] = pointOnCircle(p.radius, p.angle);
      // Live feedback #1: rest on the actual terrain height under each tuft
      // (hills/pits), not flat Y=0. crossAngle: this tuft's own second-plane
      // offset (BackgroundForest.jsx's own "varied per-tree, not a fixed
      // 90deg" reasoning -- a fixed cross reads as identical rows of tufts
      // from a fixed camera angle).
      return {
        x, z, yaw: p.yaw, y: groundHeightAt(x, z), crossAngle: rad(70) + rng() * rad(40),
      };
    });
  }, [birch, mushroom]);
  const grassColors = useMemo(() => {
    const rng = makeRng(63);
    const c1 = new Color('#6f9b52');
    const c2 = new Color('#86b25f');
    return grass.map(() => c1.clone().lerp(c2, rng()));
  }, [grass]);
  const grassTexture = useMemo(() => makeGrassSpriteTexture(), []);
  const grassGeometry = useMemo(() => makeGrassSpriteGeometry(), []);
  const grassRef = useRef();
  const flowerWorldXZ = useMemo(
    () => flower.map((p) => { const [x, , z] = pointOnCircle(p.radius, p.angle); return [x, z]; }),
    [flower],
  );
  // Live feedback #1: same terrain-height grounding as grass/mushrooms.
  const flowerGroundY = useMemo(
    () => flowerWorldXZ.map(([x, z]) => groundHeightAt(x, z)),
    [flowerWorldXZ],
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
      // Live feedback: unlit sprite material (needed for the alpha-cutout
      // texture) doesn't dim with the scene's own lighting like the old lit
      // cone geometry did -- reuse BackgroundForest.jsx's own dirInt-based
      // brightness multiplier so grass still darkens at night.
      const brightness = Math.min(1, atmosphereLive.dirInt);
      grass.forEach((g, i) => {
        // Live feedback: "the grass animation is simple -- it just sways in
        // the wind" -- the bend-away-from-Kolobok reaction is gone; wind
        // sway is the only motion now.
        const swayAngle = windSway(g.x, g.z, clock, GRASS_SWAY_AMPLITUDE);

        // Two cross-planes per tuft (BackgroundForest.jsx's own technique)
        // -- same position/tilt, only the base yaw differs between them.
        [0, g.crossAngle].forEach((extraYaw, k) => {
          dummy.position.set(g.x, g.y, g.z);
          dummy.rotation.set(0, g.yaw + extraYaw, 0);
          if (swayAngle) {
            tiltAxisTmp.set(wind.direction[2], 0, -wind.direction[0]).normalize();
            tiltQuatTmp.setFromAxisAngle(tiltAxisTmp, swayAngle);
            dummy.quaternion.premultiply(tiltQuatTmp);
          }
          dummy.updateMatrix();
          mesh.setMatrixAt(i * 2 + k, dummy.matrix);
        });
        grassColorTmp.copy(grassColors[i]).multiplyScalar(brightness);
        mesh.setColorAt(i * 2, grassColorTmp);
        mesh.setColorAt(i * 2 + 1, grassColorTmp);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
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
        dummy.position.set(x, flowerGroundY[i] + 0.13 * p.scale, z);
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

  const shadowTexture = useMemo(() => getSharedTexture(), []);
  // Live feedback: "blob shadows from birch trees should be visible on
  // hills if applicable" -- these were still flat Y=0.02 (unlike the
  // mushroom/flower/grass fix earlier), so a tree's shadow sitting on a
  // hill would clip below the hill's own raised surface instead of resting
  // on it. Same groundHeightAt fix applied to spruce's shadow too, same bug.
  const birchShadowM = useMemo(
    () => birch.map((p, i) => shadowMatrixAt(
      birchWorldXZ[i][0],
      birchWorldXZ[i][1],
      BIRCH_SHADOW_R * p.scale,
      groundHeightAt(birchWorldXZ[i][0], birchWorldXZ[i][1]),
    )),
    [birch, birchWorldXZ],
  );
  const spruceShadowM = useMemo(
    () => spruce.map((p, i) => shadowMatrixAt(
      spruceWorldXZ[i][0],
      spruceWorldXZ[i][1],
      SPRUCE_SHADOW_R * p.scale,
      groundHeightAt(spruceWorldXZ[i][0], spruceWorldXZ[i][1]),
    )),
    [spruce, spruceWorldXZ],
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

  const flowerStemM = useMemo(
    () => flower.map((p, i) => matrixAt(p, [0, 0.06, 0], [1, 1, 1], flowerGroundY[i])),
    [flower, flowerGroundY],
  );
  const flowerHeadM = useMemo(
    () => flower.map((p, i) => matrixAt(p, [0, 0.13, 0], [1, 1, 1], flowerGroundY[i])),
    [flower, flowerGroundY],
  );
  const flowerColors = useMemo(() => {
    const palette = ['#e8e26e', '#e0e9f2', '#e8a8c8'];
    const rng = makeRng(51);
    return flower.map(() => new Color(palette[Math.floor(rng() * palette.length)]));
  }, [flower]);

  return (
    <group>
      {/* BACKLOG.md #15: flat blob shadows under birch/spruce, same shared
          radial-alpha texture + look as BlobShadow.jsx's other users
          (Kolobok/animals/landmarks), just instanced since there are dozens
          of trees -- one draw call per tree type instead of one per tree.
          Static matrices (ground-anchored, computed once above), so no
          per-frame update is needed even while a tree is mid-collision-lean. */}
      {polish.shadows && (
        <>
          <instancedMesh
            args={[undefined, undefined, birchShadowM.length]}
            renderOrder={1}
            ref={(mesh) => {
              if (!mesh) return;
              birchShadowM.forEach((m, i) => mesh.setMatrixAt(i, m));
              mesh.instanceMatrix.needsUpdate = true;
            }}
          >
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial map={shadowTexture} color="#1e1a14" transparent opacity={0.276} depthWrite={false} />
          </instancedMesh>
          <instancedMesh
            args={[undefined, undefined, spruceShadowM.length]}
            renderOrder={1}
            ref={(mesh) => {
              if (!mesh) return;
              spruceShadowM.forEach((m, i) => mesh.setMatrixAt(i, m));
              mesh.instanceMatrix.needsUpdate = true;
            }}
          >
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial map={shadowTexture} color="#1e1a14" transparent opacity={0.276} depthWrite={false} />
          </instancedMesh>
          {/* Live feedback #3/#4: mushrooms get the same shadow treatment as
              birch/spruce, but re-driven per-frame (see the pop-out/hide/
              respawn useFrame block above) so it disappears/reappears WITH
              the mushroom instead of staying static underneath a hidden one. */}
          <instancedMesh
            args={[undefined, undefined, mushroomShadowM.length]}
            renderOrder={1}
            ref={(mesh) => {
              if (!mesh) return;
              mushroomShadowRef.current = mesh;
              mushroomShadowM.forEach((m, i) => mesh.setMatrixAt(i, m));
              mesh.instanceMatrix.needsUpdate = true;
            }}
          >
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial map={shadowTexture} color="#1e1a14" transparent opacity={0.276} depthWrite={false} />
          </instancedMesh>
        </>
      )}

      {/* Birch: trunk (own draw, different geometry) + both canopy blobs
          merged into one instancedMesh since they share a geometry.
          BACKLOG.md #2: grabbable on either mesh (trunk or canopy) --
          instanceId is per-mesh, so onTreeGrab('birch') maps it back to the
          logical tree index (mod birch.length) inside the handler. */}
      <InstancedPart
        count={birch.length}
        matrices={birchTrunkM}
        onMesh={(m) => { birchTrunkRef.current = m; }}
        onPointerDown={onTreeGrab('birch')}
        onPointerUp={onTreeRelease}
        onPointerLeave={onTreeRelease}
      >
        <cylinderGeometry args={[0.07, 0.08, 1.6, 7]} />
        <meshStandardMaterial map={birchTexture} roughness={0.9} />
      </InstancedPart>
      <InstancedPart
        count={birchCanopyM.length}
        matrices={birchCanopyM}
        onMesh={(m) => { birchCanopyRef.current = m; }}
        onPointerDown={onTreeGrab('birch')}
        onPointerUp={onTreeRelease}
        onPointerLeave={onTreeRelease}
      >
        <sphereGeometry args={[0.4, 8, 8]} />
        <meshStandardMaterial map={birchCanopyTexture} roughness={0.9} />
      </InstancedPart>

      {/* Birch leaf-fall: shared pool, parked far below ground (invisible)
          when idle -- see spawnLeafFall/the useFrame block above. */}
      <points ref={leafRef} geometry={leafGeometry}>
        <pointsMaterial map={leafTexture} color={LEAF_COLOR} size={0.09} transparent opacity={0.9} depthWrite={false} />
      </points>

      {/* Spruce: all 3 cone tiers of all trees in one merged instancedMesh */}
      <InstancedPart
        count={spruceAllM.length}
        matrices={spruceAllM}
        colors={spruceAllColors}
        onMesh={(m) => { spruceRef.current = m; }}
        onPointerDown={onTreeGrab('spruce')}
        onPointerUp={onTreeRelease}
        onPointerLeave={onTreeRelease}
      >
        <coneGeometry args={[1, 1, 8]} />
        <meshStandardMaterial roughness={0.9} />
      </InstancedPart>

      {/* Bush: 3 clustered spheres per bush, one shared InstancedMesh */}
      <InstancedPart count={bushPositions.length} matrices={bushPositions}>
        <sphereGeometry args={[0.2, 8, 8]} />
        <meshStandardMaterial color="#6f9b52" roughness={0.9} />
      </InstancedPart>

      {/* Mushroom (scattered across the island): stem + speckled cap.
          hedgehog (live feedback #7): tappable on either part -- e.instanceId
          is already this InstancedPart's own 0..mushroom.length-1 space, no
          mod needed. */}
      <InstancedPart
        count={mushroom.length}
        matrices={mushroomStemM}
        onMesh={(m) => { mushroomStemRef.current = m; }}
        onPointerDown={(e) => { e.stopPropagation(); spawnHedgehog(e.instanceId); }}
      >
        <cylinderGeometry args={[0.03, 0.03, 0.1, 6]} />
        <meshStandardMaterial color="#efeeea" roughness={0.9} />
      </InstancedPart>
      <InstancedPart
        count={mushroom.length}
        matrices={mushroomCapM}
        onMesh={(m) => { mushroomCapRef.current = m; }}
        onPointerDown={(e) => { e.stopPropagation(); spawnHedgehog(e.instanceId); }}
      >
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

      {/* Grass tufts: alpha-cutout sprite cross (2 planes/tuft, live
          feedback -- "same principle as the tree background"), wind sway
          (only -- no bend-away reaction, live feedback: "it just sways in
          the wind") + the day/night brightness tint all applied per-frame
          above -- no static initial matrices/colors needed since the
          useFrame writes every instance every frame from mount. */}
      <instancedMesh
        ref={(mesh) => { grassRef.current = mesh; }}
        args={[grassGeometry, undefined, GRASS_COUNT * 2]}
      >
        <meshBasicMaterial map={grassTexture} vertexColors transparent alphaTest={0.4} side={DoubleSide} />
      </instancedMesh>
    </group>
  );
}
