import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, DoubleSide,
  Object3D, Vector3,
} from 'three';
import * as Haptics from 'expo-haptics';
import { ZONES, ZONE_RADIUS, rad } from '../config/zones';
import { atmosphereLive, storyMotion, useSceneStore } from '../state/sceneStore';
import { eggManager, eggMotion } from './easterEggs';
import { makeToonMaterial } from './materials/toonMaterial';
import { makeNoiseGrain } from './textures/proceduralTextures';
import { mergeColoredParts } from './builders/mergeColoredParts';
import { makeRng } from './prng';
import { BlobShadow, getSharedTexture } from './BlobShadow';
import { Hare } from './characters/Hare';
import { Wolf } from './characters/Wolf';
import { Bear } from './characters/Bear';
import { Fox } from './characters/Fox';
import {
  IzbaAmbience, HareAmbience, WolfAmbience, BearAmbience, FoxAmbience,
} from './ZoneAmbience';

const CHARACTERS = { hare: Hare, wolf: Wolf, bear: Bear, fox: Fox };
const AMBIENCE = {
  izba: IzbaAmbience, hare: HareAmbience, wolf: WolfAmbience, bear: BearAmbience, fox: FoxAmbience,
};

// The chimney's own local position/hit radius, shared between the visual
// pipe below and the Landmark's own onTap discrimination (see CHIMNEY_LOCAL
// use there for why the hitbox can't live nested on this component anymore).
const CHIMNEY_LOCAL = [0.55, 1.5, 0.15];
const CHIMNEY_HIT_R = 0.3;

// Live feedback: "build the walls of the izba out of logs... make the roof
// look like it's made of 3D tile elements... small pieces of moss that look
// like tiny mushrooms, with grass hanging down, along the roof's
// perimeter." ART_SPEC §4 already speced a log-cabin version of this house
// (5-6 stacked r=0.11 cylinders per wall, corners protruding) that was never
// built ("izba keeps its greybox house shape" per this file's own Landmark
// comment) -- used as the basis here, sized to fit the EXISTING wall
// footprint (1.7 wide x 1.1 tall x 1.3 deep) so door/window/chimney/roof/
// blob-shadow positions (all tuned to that footprint already) don't need to
// change at all.
const LOG_R = 0.11;
const LOG_ROWS = 5; // 5 * 2*LOG_R = 1.10 exactly fills the wall height
const WALL_W = 1.7; // matches the old flat box's own width
const WALL_D = 1.3; // matches the old flat box's own depth
// Each log's own axis is pulled IN from the wall footprint's face by LOG_R,
// so its outer bulge reaches back OUT to exactly where the old flat wall
// used to be -- door/window (still at their old +/-0.66) therefore sit
// flush against the logs instead of sinking into them.
const FRONT_BACK_LOG_LEN = WALL_W + LOG_R * 2 * 1.1; // "corners protrude" past the side walls
const SIDE_LOG_LEN = WALL_D + LOG_R * 2 * 1.1;
// Live feedback: "make the logs a couple of shades lighter" -- lightened
// from ART_SPEC §4's original #b3844f (mixed ~25% toward white).
const LOG_COLOR = '#c29d72';

// Live feedback: "make the roof out of two sides that converge at the top,
// like a traditional log cabin" -- a true gable (A-frame) roof, replacing
// the old 4-sided cone/pyramid. Live feedback (round 2): "the roof is
// oriented incorrectly, rotate 90 degrees" -- the ridge now runs along
// local Z (parallel to the SHORTER side walls), so the two slopes face
// +/-X (over the side walls, where the tools hang well below the roof
// line -- no conflict) and the gable (triangular) ends cap the door/window
// walls instead. All Y values below are absolute in this group's own local
// frame (not relative to a separate roof-group offset), matching how
// door/window/chimney already place themselves directly.
const WALL_TOP_Y = LOG_ROWS * LOG_R * 2; // exact top of the log stack (1.10)
const ROOF_EAVE_Y = 1.15; // small soffit gap above the wall top
const ROOF_RIDGE_Y = 1.75; // peak height
const ROOF_HALF_SPAN_X = WALL_W / 2 + 0.12; // eave overhang past the side walls
const ROOF_RIDGE_HALF_LEN = WALL_D / 2 + 0.1; // rake overhang past the gable ends
const ROOF_SLAB_THICK = 0.035;
const ROOF_PITCH = Math.atan2(ROOF_RIDGE_Y - ROOF_EAVE_Y, ROOF_HALF_SPAN_X);
const ROOF_SLOPE_LEN = Math.hypot(ROOF_HALF_SPAN_X, ROOF_RIDGE_Y - ROOF_EAVE_Y);
const GABLE_WIDTH = WALL_W; // triangular end wall, flush with the front/back wall's own width
const GABLE_Z = WALL_D / 2; // flush with the door/window wall's own outer face
const ROOF_BASE_COLOR = '#a5602f';
// Live feedback: "two empty triangles... must be filled with logs of the
// appropriate size" -- GABLE_LOG_ROWS*2*GABLE_LOG_R exactly fills the
// wall-top-to-ridge height, so the stacked log courses below (see
// IzbaLogWalls) reach the apex with no leftover gap.
const GABLE_LOG_ROWS = 4;
const GABLE_LOG_R = (ROOF_RIDGE_Y - WALL_TOP_Y) / (GABLE_LOG_ROWS * 2);
// Live feedback: "put those [gable panels] behind the triangle logs /
// inside the house, now logs are not visible" -- the flat backing panel
// used to sit AT the same z the logs' own outer surface reaches (GABLE_Z),
// coincident with it, so the two flat/round surfaces z-fought and the
// panel (drawn as its own separate mesh) won, hiding the logs entirely.
// Recessed well past the logs' own INNER surface (GABLE_Z - 2*GABLE_LOG_R)
// so it's unambiguously behind them.
const GABLE_PANEL_INSET = GABLE_LOG_R * 2.5;
// Small ridge log covering the seam where the two slabs/tile courses meet.
const ROOF_RIDGE_CAP_R = 0.08;
const ROOF_RIDGE_CAP_LEN = ROOF_RIDGE_HALF_LEN * 2 + 0.1; // small butt-end overhang past the rake ends
const ROOF_RIDGE_CAP_COLOR = '#8f4f26';

// Live feedback: "no gaps between the roof tiles... tiles should not
// overlap each other... shouldn't extend beyond the edges of the roof" --
// an EXACT abutting grid rather than a spaced-out shingle course: tile
// width/height are DERIVED from the roof's own true dimensions divided by a
// fixed tile count (see makeIzbaRoofTiles), so every tile touches its
// neighbors with zero gap/overlap and the outermost tiles land exactly on
// the roof's own true edges instead of past them.
const ROOF_TILE_COLS = 6; // across the ridge-direction width
const ROOF_TILE_ROWS = 6; // up the slope, eave to ridge
// Live feedback: "try using hay bales instead of roof tiles... same number
// of them... three-dimensional... orientation slightly random, 0-10deg."
const HAY_BALE_COLOR_A = '#d4b06a';
const HAY_BALE_COLOR_B = '#c19a4f';
const HAY_JITTER_MAX_DEG = 10;
const HAY_BALE_SINK_FRAC = 0.1; // "sink them 10% into the roof"

/** ART_SPEC §4's own log-wall design: 4 walls x 5 stacked cylinders, all one
 *  instancedMesh (one draw call) since every log shares the same radius --
 *  only position/rotation/length (via Y-scale on a unit-length cylinder)
 *  differ per instance. */
const izbaLogColorTmp = new Color();

function IzbaLogWalls({ material }) {
  const built = useMemo(() => {
    const list = [];
    const tints = [];
    const d = new Object3D();
    // Live feedback: "make each log vary by 3-5% in length and slightly in
    // texture" -- seeded so placement stays stable across reloads (matches
    // this codebase's own convention for anything randomized).
    const rng = makeRng(777);
    // Live feedback: "there shouldn't be any logs in the window area -- you
    // need to be able to see inside the house" -- only the window's OWN
    // wall (z=WALL_D/2-LOG_R, the same one IzbaWindow sits on) gets a
    // hasWindow flag; the door's wall is unaffected.
    const walls = [
      { runAlong: 'x', len: FRONT_BACK_LOG_LEN, x: 0, z: WALL_D / 2 - LOG_R, hasWindow: true },
      { runAlong: 'x', len: FRONT_BACK_LOG_LEN, x: 0, z: -(WALL_D / 2 - LOG_R) },
      { runAlong: 'z', len: SIDE_LOG_LEN, x: WALL_W / 2 - LOG_R, z: 0 },
      { runAlong: 'z', len: SIDE_LOG_LEN, x: -(WALL_W / 2 - LOG_R), z: 0 },
    ];
    const windowMinY = WINDOW_Y - WINDOW_H / 2;
    const windowMaxY = WINDOW_Y + WINDOW_H / 2;
    const pushLog = (x, y, z, runAlong, len) => {
      const lenVariance = 1 + (rng() * 2 - 1) * 0.04; // +/-4%, within the asked 3-5%
      d.position.set(x, y, z);
      // A cylinder's own length runs along local Y by default -- rotate
      // 90deg around Z to lie along world X, or around X to lie along Z.
      if (runAlong === 'x') d.rotation.set(0, 0, Math.PI / 2);
      else d.rotation.set(Math.PI / 2, 0, 0);
      d.scale.set(1, len * lenVariance, 1);
      d.updateMatrix();
      list.push(d.matrix.clone());
      // "Slightly in texture" -- a small per-log brightness multiplier
      // (not a hue shift) riding on top of the shared bark texture/map,
      // reading as natural per-log tone variation.
      tints.push(0.92 + rng() * 0.16);
    };
    walls.forEach((w) => {
      for (let i = 0; i < LOG_ROWS; i += 1) {
        const y = LOG_R + i * LOG_R * 2;
        const rowMinY = y - LOG_R;
        const rowMaxY = y + LOG_R;
        if (w.hasWindow && rowMaxY > windowMinY && rowMinY < windowMaxY) {
          // This row crosses the window -- split into a left and right
          // segment, skipping the window's own width in the middle
          // (WINDOW_OPENING_MIN/MAX_Y quantize this same gap vertically,
          // to whole rows, for the frame/shutters below).
          const halfGap = WINDOW_W / 2;
          const segLen = w.len / 2 - halfGap;
          [-1, 1].forEach((segSide) => {
            pushLog(segSide * (halfGap + segLen / 2), y, w.z, w.runAlong, segLen);
          });
        } else {
          pushLog(w.x, y, w.z, w.runAlong, w.len);
        }
      }
    });
    // Live feedback: "two empty triangles... must be filled with logs of
    // the appropriate size" -- the gable ends (above the front/back walls,
    // see makeIzbaRoofBase) were a single flat painted panel. Stacked here
    // with progressively shorter courses (radius picked so GABLE_LOG_ROWS
    // exactly fills the gable's own height, see GABLE_LOG_R's own comment),
    // continuing the same log wall upward and flush with the SAME z plane
    // the wall logs already sit at (mirrors FRONT_BACK_LOG_LEN's own
    // "pulled in by radius so the outer bulge reaches back out to the
    // original flat face" convention). Reuses this instancedMesh's shared
    // unit-radius geometry via a non-uniform scale (x/z shrink the radius,
    // y is still the length axis) rather than a second draw call. The flat
    // panel stays underneath as a sealed backing, same role the roof's own
    // backing slab plays for its tile overlay.
    [1, -1].forEach((side) => {
      for (let i = 0; i < GABLE_LOG_ROWS; i += 1) {
        const tCenter = (i + 0.5) / GABLE_LOG_ROWS;
        const y = WALL_TOP_Y + i * GABLE_LOG_R * 2 + GABLE_LOG_R;
        const rowLen = GABLE_WIDTH * (1 - tCenter);
        const lenVariance = 1 + (rng() * 2 - 1) * 0.04;
        const radiusScale = GABLE_LOG_R / LOG_R;
        d.position.set(0, y, side * (GABLE_Z - GABLE_LOG_R));
        d.rotation.set(0, 0, Math.PI / 2); // gables sit above the front/back walls, which run along X
        d.scale.set(radiusScale, rowLen * lenVariance, radiusScale);
        d.updateMatrix();
        list.push(d.matrix.clone());
        tints.push(0.92 + rng() * 0.16);
      }
    });
    return { matrices: list, tints };
  }, []);

  return (
    <instancedMesh
      args={[undefined, undefined, built.matrices.length]}
      material={material}
      ref={(mesh) => {
        if (!mesh) return;
        built.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
        mesh.instanceMatrix.needsUpdate = true;
        built.tints.forEach((b, i) => mesh.setColorAt(i, izbaLogColorTmp.setScalar(b)));
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }}
    >
      <cylinderGeometry args={[LOG_R, LOG_R, 1, 8]} />
    </instancedMesh>
  );
}

/** A flat isoceles-triangle panel in the local XY plane (base centered on
 *  the X axis at y=0, apex on the Y axis at (0,height)). Both winding orders
 *  are included so the panel reads from either viewing direction without
 *  depending on the shared material's own `side` setting (mergeColoredParts
 *  has no per-part side override). Used for the gable end walls below;
 *  oriented by the caller's own rotation param if its wall doesn't already
 *  face +/-Z.
 *
 *  Needs a `uv` attribute AND an index (even a trivial pass-through one)
 *  because mergeColoredParts' mergeGeometries requires every part to share
 *  the exact same attribute set and be either all-indexed or all
 *  non-indexed -- BoxGeometry/CylinderGeometry (the other parts merged
 *  alongside this one) are both, and a plain non-indexed geometry here
 *  broke that merge at runtime (only caught on-device, since a bundle
 *  export never actually executes the Three.js scene graph). The index is
 *  a 1:1 identity over the 6 vertices (not a shared/deduplicated index) so
 *  computeVertexNormals still gives each triangle its own independent
 *  normal, exactly as the non-indexed version did. */
function makeTriangleGeometry(width, height) {
  const hw = width / 2;
  const positions = new Float32Array([
    -hw, 0, 0, hw, 0, 0, 0, height, 0,
    -hw, 0, 0, 0, height, 0, hw, 0, 0,
  ]);
  const uvs = new Float32Array([
    0, 0, 1, 0, 0.5, 1,
    0, 0, 0.5, 1, 1, 0,
  ]);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setAttribute('uv', new BufferAttribute(uvs, 2));
  geo.setIndex([0, 1, 2, 3, 4, 5]);
  geo.computeVertexNormals();
  return geo;
}

/** The gable roof's own backing structure: two flat sloped slabs (boxes,
 *  tilted around local Z by +/-ROOF_PITCH -- the ridge runs along Z here,
 *  so a slab's own Z extent, the ridge-length direction, stays untouched by
 *  the tilt) meeting at the ridge, plus a flat triangular gable-end wall
 *  filling the wall-top-to-ridge gap above each of the two door/window
 *  walls (already flat in the XY plane facing +/-Z, so no rotation needed
 *  there). Kept underneath the tile overlay so no gaps between individual
 *  tiles show through to empty space. Also includes the ridge cap log
 *  (live feedback: "the top joint where the roof halves meet must be
 *  covered with a cap") -- a log straddling the peak along the SAME Z axis
 *  the ridge itself runs along, covering the seam where the two tile
 *  courses meet. One draw call via mergeColoredParts. */
function makeIzbaRoofBase() {
  const parts = [];
  [1, -1].forEach((side) => {
    parts.push({
      geometry: new BoxGeometry(ROOF_SLOPE_LEN, ROOF_SLAB_THICK, ROOF_RIDGE_HALF_LEN * 2),
      color: ROOF_BASE_COLOR,
      position: [(side * ROOF_HALF_SPAN_X) / 2, (ROOF_RIDGE_Y + ROOF_EAVE_Y) / 2, 0],
      rotation: [0, 0, -side * ROOF_PITCH],
    });
  });
  [1, -1].forEach((side) => {
    parts.push({
      geometry: makeTriangleGeometry(GABLE_WIDTH, ROOF_RIDGE_Y - WALL_TOP_Y),
      color: ROOF_BASE_COLOR,
      position: [0, WALL_TOP_Y, side * (GABLE_Z - GABLE_PANEL_INSET)],
    });
  });
  parts.push({
    // A cylinder's own length runs along local Y by default -- rotate
    // 90deg around X to lie along Z, matching the ridge's own direction
    // (same idiom IzbaLogWalls uses for its own runAlong='z' walls).
    geometry: new CylinderGeometry(ROOF_RIDGE_CAP_R, ROOF_RIDGE_CAP_R, ROOF_RIDGE_CAP_LEN, 8),
    color: ROOF_RIDGE_CAP_COLOR,
    position: [0, ROOF_RIDGE_Y + ROOF_RIDGE_CAP_R * 0.5, 0],
    rotation: [Math.PI / 2, 0, 0],
  });
  return mergeColoredParts(parts);
}

/** "Try using hay bales instead of roof tiles -- same number of them, three-
 *  dimensional, orientation slightly random (0-10deg)" -- same exact grid
 *  the tiles used (COLS*ROWS*2, positions/cell-size derived from the roof's
 *  own true dimensions), but each cell now gets a round hay-bale cylinder
 *  instead of a flat box.
 *
 *  Live feedback (round 3): "the hay bales are facing the wrong way -- lying
 *  crosswise, should be lengthwise" -- length now runs UP THE SLOPE
 *  (rowHeight) instead of parallel to the ridge (colWidth), with the radius
 *  fit to the ridge-direction cell (colWidth/2) instead. A cylinder's own
 *  length runs along local Y by default; geometry.rotateZ(-PI/2) BAKES the
 *  pre-alignment onto the geometry itself (Y -> X, the up-slope direction)
 *  instead of using the rotation.x Euler slot the ridge cap uses for its own
 *  Y->Z pre-align -- because THIS bale still needs its remaining 2 Euler
 *  slots (y, z) for the diagonal-tilt + slope-tilt below, and baking the
 *  pre-align into the geometry avoids a 3rd rotation fighting Three's fixed
 *  x-then-y-then-z composition order (rotation.x=PI/2 would apply LAST in
 *  that order applied to what's already been diagonal+slope-tilted --
 *  wrong -- rather than first, which only the geometry-level bake
 *  guarantees).
 *
 *  Live feedback (round 2): "position them so the [bale] is at a 45deg
 *  angle counterclockwise on one half of the roof and clockwise on the
 *  other, and sink them 10% into the roof." The rotation.y (middle Euler)
 *  slot is a rotation around the ORIGINAL fixed Y axis, which swings the
 *  bale's OWN axis sideways WITHIN the flat, untilted ground plane --
 *  exactly "diagonally across the slope" rather than "tipped up/down,"
 *  regardless of whether that axis starts at X or Z. `side * rad(45)` gives
 *  the two slopes mirrored diagonals; the small per-bale jitter still rides
 *  on top for a less mechanical look. Sinking 10% just shortens the outward
 *  lift by 10% of the bale's own diameter. */
function makeIzbaRoofTiles() {
  const parts = [];
  const colWidth = (ROOF_RIDGE_HALF_LEN * 2) / ROOF_TILE_COLS;
  const rowHeight = ROOF_SLOPE_LEN / ROOF_TILE_ROWS;
  const baleR = colWidth / 2;
  const rng = makeRng(913);
  for (let row = 0; row < ROOF_TILE_ROWS; row += 1) {
    // t=0 at the eave, t=1 at the ridge -- this row's own center, exactly.
    const t = (row + 0.5) / ROOF_TILE_ROWS;
    const y = ROOF_EAVE_Y + (ROOF_RIDGE_Y - ROOF_EAVE_Y) * t;
    const xMag = ROOF_HALF_SPAN_X * (1 - t); // distance from the ridge (x=0) toward the eave
    [1, -1].forEach((side) => {
      // Outward normal of this slab, used to lift bales just proud of the
      // backing slab's own surface -- shortened by HAY_BALE_SINK_FRAC of
      // the bale's own diameter so it embeds 10% into the slab instead of
      // sitting fully on top of it.
      const liftDist = ROOF_SLAB_THICK / 2 + baleR - HAY_BALE_SINK_FRAC * (2 * baleR);
      const liftX = side * Math.sin(ROOF_PITCH) * liftDist;
      const liftY = Math.cos(ROOF_PITCH) * liftDist;
      const x = side * xMag + liftX;
      for (let col = 0; col < ROOF_TILE_COLS; col += 1) {
        const z = -ROOF_RIDGE_HALF_LEN + (col + 0.5) * colWidth;
        const jitter = (rng() * 2 - 1) * rad(HAY_JITTER_MAX_DEG);
        const geo = new CylinderGeometry(baleR, baleR, rowHeight, 8);
        geo.rotateZ(-Math.PI / 2);
        parts.push({
          geometry: geo,
          color: (row + col) % 2 === 0 ? HAY_BALE_COLOR_A : HAY_BALE_COLOR_B,
          position: [x, y + liftY, z],
          rotation: [0, side * rad(45) + jitter, -side * ROOF_PITCH],
        });
      }
    });
  }
  return mergeColoredParts(parts);
}

// Live feedback: "hang a rake and a shovel on the wall facing the lake" --
// derived the same way zones.js itself lays zones out: izba sits at angle 0
// (pos [0,0,ZONE_RADIUS]), the pond sits at POND_ANGLE_DEG (324deg) at
// POND_RADIUS -- the world vector from izba toward the pond, rotated into
// this group's own local frame (rotation.y = a+PI = PI here, so local =
// (-worldX, -worldZ)), comes out dominant on LOCAL +X. That's the SIDE wall
// (the one running along Z, logs centered at x=+/-(WALL_W/2-LOG_R)) -- its
// outer face sits flush at x=WALL_W/2 (see IzbaLogWalls' own comment), so
// the tools mount just proud of that.
const TOOLS_WALL_X = WALL_W / 2 + 0.03;
const TOOL_HANDLE_COLOR = '#8a6a42';
const TOOL_METAL_COLOR = '#8b8f94';

/** Rake + shovel, hung flat against the lake-facing wall. Static, one
 *  draw call via mergeColoredParts. */
function makeIzbaWallTools() {
  const parts = [];
  const shovelZ = -0.28;
  const shovelHandleLen = 0.6;
  const toolsTopY = 1.0;
  parts.push({
    geometry: new CylinderGeometry(0.014, 0.014, shovelHandleLen, 6),
    color: TOOL_HANDLE_COLOR,
    position: [TOOLS_WALL_X, toolsTopY - shovelHandleLen / 2, shovelZ],
    rotation: [0, 0, 0.07],
  });
  parts.push({
    geometry: new BoxGeometry(0.03, 0.2, 0.15),
    color: TOOL_METAL_COLOR,
    position: [TOOLS_WALL_X, toolsTopY - shovelHandleLen - 0.08, shovelZ],
  });

  const rakeZ = 0.28;
  const rakeHandleLen = 0.66;
  parts.push({
    geometry: new CylinderGeometry(0.013, 0.013, rakeHandleLen, 6),
    color: TOOL_HANDLE_COLOR,
    position: [TOOLS_WALL_X, toolsTopY - rakeHandleLen / 2, rakeZ],
    rotation: [0, 0, -0.06],
  });
  const rakeHeadY = toolsTopY - rakeHandleLen;
  parts.push({
    geometry: new BoxGeometry(0.02, 0.02, 0.26),
    color: TOOL_METAL_COLOR,
    position: [TOOLS_WALL_X, rakeHeadY, rakeZ],
  });
  const tineCount = 5;
  for (let i = 0; i < tineCount; i += 1) {
    const tz = rakeZ - 0.12 + (i / (tineCount - 1)) * 0.24;
    parts.push({
      geometry: new CylinderGeometry(0.006, 0.006, 0.09, 4),
      color: TOOL_METAL_COLOR,
      position: [TOOLS_WALL_X, rakeHeadY - 0.045, tz],
    });
  }
  return mergeColoredParts(parts);
}

// Live feedback: "place a bench to the left of the door... a blob-shaped
// shadow" -- the door sits at local [0,0.675,-0.66], flush against the
// front wall's own outer face (z=-WALL_D/2=-0.65). "Left" reasoned as
// stage-left when facing the door FROM OUTSIDE the house (looking toward
// +z), i.e. local -X. Positioned as its own offset group in the JSX (not
// baked into the merged geometry) specifically so a BlobShadow -- which
// always renders at ITS OWN parent's local origin, no x/z offset prop --
// can sit right under it.
const BENCH_X = -0.55;
const BENCH_Z = -0.95;
const BENCH_SEAT_Y = 0.26;
const BENCH_COLOR = '#8a6a42';

/** Simple slab-seat-on-four-legs bench. Static, one draw call. */
function makeIzbaBench() {
  const parts = [];
  parts.push({
    geometry: new BoxGeometry(0.5, 0.04, 0.18),
    color: BENCH_COLOR,
    position: [0, BENCH_SEAT_Y, 0],
  });
  const legHeight = BENCH_SEAT_Y - 0.02;
  [-0.21, 0.21].forEach((lx) => {
    [-0.06, 0.06].forEach((lz) => {
      parts.push({
        geometry: new BoxGeometry(0.03, legHeight, 0.03),
        color: BENCH_COLOR,
        position: [lx, legHeight / 2, lz],
      });
    });
  });
  return mergeColoredParts(parts);
}

/** The izba's chimney pipe -- live feedback: "add a pipe so smoke can
 *  escape". ZoneAmbience.jsx's IzbaAmbience already spawns smoke particles
 *  at chimneyPos ([0.55, 1.65, 0.15], its own default) but nothing was ever
 *  there to visibly emit them from. CHIMNEY_LOCAL's XZ (0.55, 0.15) sits on
 *  the gable roof's own +X slab (that slab's surface there works out to
 *  ~1.41 -- see makeIzbaRoofBase/ROOF_RIDGE_Y/EAVE_Y/HALF_SPAN_X), so the
 *  base (1.35) reads as solidly embedded rather than floating above it;
 *  top sits right at the smoke's own spawn Y (1.65) so smoke reads as
 *  coming out of the opening, not out of thin air above it.
 *  Live feedback: "I don't see smoke spheres when tapped" -- root cause was
 *  a nested invisible hitbox sphere HERE that could never actually be
 *  reached: the Landmark's own generous whole-zone hitbox (radius 1.7,
 *  sibling below) fully ENCLOSES this one (chimney sits only ~1 unit from
 *  the zone's own hitbox center), so react-three-fiber's nearest-object-
 *  first dispatch always hit that bigger sphere FIRST and its onTap calls
 *  e.stopPropagation() unconditionally -- this nested handler was
 *  structurally unreachable no matter where you tapped. Fixed by moving the
 *  chimney-vs-zone discrimination into the Landmark's own onTap (see
 *  CHIMNEY_LOCAL/CHIMNEY_HIT_R there) instead of a more-nested hitbox trying
 *  to win a race it never could. */
function IzbaChimney({ material }) {
  return (
    <group position={CHIMNEY_LOCAL}>
      <mesh material={material}>
        <cylinderGeometry args={[0.055, 0.065, 0.3, 8]} />
      </mesh>
    </group>
  );
}

/** The izba's door -- live feedback: "make a door in the wall opposite the
 *  window". Same flat-plane-on-the-surface convention as IzbaWindow, on the
 *  -z wall (mirrors the window's +0.66 face offset) since the group's own
 *  a+PI yaw makes +z the center-facing side and -z the outward-facing back.
 *  Bottom aligned with the wall box's own bottom edge (position.y 0.85,
 *  half-height 0.55 -> bottom at 0.3) rather than world Y=0, so it reads as
 *  sitting on the same base the wall itself already does. */
function IzbaDoor() {
  return (
    <mesh position={[0, 0.675, -0.66]}>
      <planeGeometry args={[0.4, 0.75]} />
      {/* Live feedback: door wasn't visible at all -- a plane's default
          FrontSide material only renders from whichever direction its
          normal happens to face (backface culling), and this one was never
          rotated to face outward. DoubleSide sidesteps having to get that
          direction right (same class of mistake as the eyelid/eyebrow
          placement bugs earlier), rendering it from either side. */}
      <meshStandardMaterial color="#4a2f1c" roughness={0.75} side={DoubleSide} />
    </mesh>
  );
}

// Live feedback: "make the house window twice bigger and put it in the
// middle of the wall. Make a small windowsill. Let the window be 70 percent
// transparent, and let there be fog inside the house" -- WINDOW_Y centers
// it on the wall's own height range (WALL_TOP_Y=1.10), replacing the old
// near-the-top y=1.0; size doubled from the old 0.34x0.3.
const WINDOW_W = 0.68;
const WINDOW_H = 0.6;
const WINDOW_Y = WALL_TOP_Y / 2;
const WINDOW_Z = 0.66;
const WINDOW_SILL_W = WINDOW_W + 0.1;
const WINDOW_SILL_THICK = 0.05;
const WINDOW_SILL_DEPTH = 0.12;
const WINDOW_SILL_COLOR = '#5a4530';
const WINDOW_FOG_COLOR = '#d9d6cc';

/** The izba's window pane, on the CENTER-facing wall (local +z after the
 *  landmark group's a+PI yaw): the story camera watches the birth/rebirth
 *  beats from KOLOBOK_LEAD around the ring, which sees this side. Emissive
 *  intensity rides storyMotion.windowGlow (birth pulse / rebirth glow,
 *  STORY_SPEC §3); ANIMATION_SPEC §6's time-of-day glow joins in Phase 6.
 *  Now 3 pieces: a soft foggy haze recessed just inside the glass (reusing
 *  BlobShadow's own shared radial-alpha texture as a plain white falloff,
 *  tinted light here instead of shadow-dark), the glass itself (now
 *  transparent), and a small sill box protruding from the wall below it. */
function IzbaWindow() {
  const materialRef = useRef();
  const fogTexture = useMemo(() => getSharedTexture(), []);
  useFrame(() => {
    if (materialRef.current) {
      // Time-of-day glow (ART_SPEC §8 `window` column, blended) with the
      // ±10% firelight breathing at 0.1Hz (ANIMATION_SPEC §9), plus the
      // story's own birth/rebirth pulse -- whichever is brighter wins.
      const breathe = 1 + Math.sin(Date.now() / 1591) * 0.1;
      const daily = atmosphereLive.windowGlow * breathe;
      materialRef.current.emissiveIntensity = Math.max(daily, storyMotion.windowGlow * 1.6);
    }
  });
  return (
    <group>
      <mesh position={[0, WINDOW_Y, WINDOW_Z - 0.16]}>
        <planeGeometry args={[WINDOW_W * 1.1, WINDOW_H * 1.1]} />
        <meshBasicMaterial
          map={fogTexture}
          color={WINDOW_FOG_COLOR}
          transparent
          opacity={0.55}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
      <mesh position={[0, WINDOW_Y, WINDOW_Z]}>
        <planeGeometry args={[WINDOW_W, WINDOW_H]} />
        <meshStandardMaterial
          ref={materialRef}
          color="#3a3229"
          emissive="#ffb84d"
          emissiveIntensity={0}
          roughness={0.6}
          transparent
          opacity={0.3}
        />
      </mesh>
      <mesh position={[0, WINDOW_Y - WINDOW_H / 2 - WINDOW_SILL_THICK / 2, WINDOW_Z + WINDOW_SILL_DEPTH / 2]}>
        <boxGeometry args={[WINDOW_SILL_W, WINDOW_SILL_THICK, WINDOW_SILL_DEPTH]} />
        <meshStandardMaterial color={WINDOW_SILL_COLOR} roughness={0.75} />
      </mesh>
    </group>
  );
}

// Live feedback: "build a frame around the window opening -- no wider than
// the logs, running along the perimeter. Create open shutters on the left
// and right halves, half the window's width, opening 20/25 degrees from
// the wall." The log wall can only be cut at whole row boundaries (see
// IzbaLogWalls), so the true opening is slightly taller than the glass --
// WINDOW_OPENING_MIN/MAX_Y quantize WINDOW_Y+/-WINDOW_H/2 outward to the
// nearest row edge (row height = LOG_R*2) so the frame matches that real
// opening exactly, not just the glass.
const WINDOW_ROW_H = LOG_R * 2;
const WINDOW_OPENING_MIN_Y = Math.floor((WINDOW_Y - WINDOW_H / 2) / WINDOW_ROW_H) * WINDOW_ROW_H;
const WINDOW_OPENING_MAX_Y = Math.ceil((WINDOW_Y + WINDOW_H / 2) / WINDOW_ROW_H) * WINDOW_ROW_H;
const WINDOW_FRAME_THICK = 0.15; // "no wider than the logs" (log diameter = 2*LOG_R = 0.22)
const WINDOW_FRAME_DEPTH = 0.04;
const WINDOW_TRIM_COLOR = '#5a4530';
const SHUTTER_W = WINDOW_W / 2; // "half the width of the window"
const SHUTTER_H = WINDOW_H;
const SHUTTER_THICK = 0.03;
const SHUTTER_LEFT_OPEN_DEG = 20;
const SHUTTER_RIGHT_OPEN_DEG = 25;

/** The frame (4 trim pieces along the log-wall opening's true perimeter)
 *  plus the two open shutters. Each shutter's geometry is built HINGE-
 *  RELATIVE -- BoxGeometry.translate() shifts its own vertices so local
 *  x=0 sits at the hinge edge and the panel extends AWAY from it -- since
 *  mergeColoredParts rotates a part around its geometry's own local origin
 *  BEFORE translating by `position`, this makes that rotation pivot
 *  exactly like a real hinge instead of spinning the panel around its own
 *  center. Positive rotation.y swings the LEFT shutter's far edge toward
 *  +Z (outward, this wall's own "outward" direction); the mirrored RIGHT
 *  shutter needs the opposite sign to swing the same way. One draw call. */
function makeIzbaWindowFrame() {
  const parts = [];
  const openingH = WINDOW_OPENING_MAX_Y - WINDOW_OPENING_MIN_Y;
  const frameSpanW = WINDOW_W + WINDOW_FRAME_THICK * 2;
  [WINDOW_OPENING_MAX_Y + WINDOW_FRAME_THICK / 2, WINDOW_OPENING_MIN_Y - WINDOW_FRAME_THICK / 2].forEach((y) => {
    parts.push({
      geometry: new BoxGeometry(frameSpanW, WINDOW_FRAME_THICK, WINDOW_FRAME_DEPTH),
      color: WINDOW_TRIM_COLOR,
      position: [0, y, WINDOW_Z],
    });
  });
  [1, -1].forEach((side) => {
    parts.push({
      geometry: new BoxGeometry(WINDOW_FRAME_THICK, openingH, WINDOW_FRAME_DEPTH),
      color: WINDOW_TRIM_COLOR,
      position: [side * (WINDOW_W / 2 + WINDOW_FRAME_THICK / 2), (WINDOW_OPENING_MIN_Y + WINDOW_OPENING_MAX_Y) / 2, WINDOW_Z],
    });
  });
  [
    { side: -1, hingeX: -(WINDOW_W / 2 + WINDOW_FRAME_THICK), openDeg: SHUTTER_LEFT_OPEN_DEG },
    { side: 1, hingeX: WINDOW_W / 2 + WINDOW_FRAME_THICK, openDeg: -SHUTTER_RIGHT_OPEN_DEG },
  ].forEach(({ side, hingeX, openDeg }) => {
    const geo = new BoxGeometry(SHUTTER_W, SHUTTER_H, SHUTTER_THICK);
    geo.translate((side * SHUTTER_W) / 2, 0, 0);
    parts.push({
      geometry: geo,
      color: WINDOW_TRIM_COLOR,
      position: [hingeX, WINDOW_Y, WINDOW_Z],
      rotation: [0, rad(openDeg), 0],
    });
  });
  return mergeColoredParts(parts);
}

/** One zone: izba keeps its greybox house shape (ART_SPEC §4's full log-
 *  cabin model isn't in any phase's explicit scope yet); hare/wolf/bear/fox
 *  totems are replaced by their real animal (ART_SPEC §3). Every zone gets
 *  its ambient-life layer (ANIMATION_SPEC §9 / ART_SPEC §11). `{ zone, mode
 *  }` is passed straight through to the animal per CLAUDE.md's shared
 *  interface. */
function Landmark({ zone }) {
  const isActive = useSceneStore((s) => s.activeZone === zone.id);
  const encounter = useSceneStore((s) => s.encounter);
  const startEncounter = useSceneStore((s) => s.startEncounter);

  const a = rad(zone.angleDeg);
  const pos = [Math.sin(a) * ZONE_RADIUS, 0, Math.cos(a) * ZONE_RADIUS];

  // Izba walls/roof are VISUAL_QUALITY_SPEC §1 hero surfaces (0.2 rim
  // strength -- "buildings/stone", not "characters").
  const izbaMaterials = useMemo(() => (zone.id === 'izba' ? {
    // Live feedback: "make sure the logs show light and shadow, just like
    // the characters" -- passing white here (rather than the log's own
    // LOG_COLOR) fed a washed-out white into makeToonMaterial's own
    // toon-ramp seed (it uses `color` to build the light/shadow gradient
    // regardless of vertexColors/map), so the shadow band came out
    // desaturated gray instead of a properly darkened brown.
    // CrossroadsStone.jsx/Hedgehog.jsx/Kolobok.jsx's own map+color materials
    // all pass their texture's matching base color the same way this now
    // does, not white.
    logs: makeToonMaterial({ map: makeNoiseGrain(LOG_COLOR, 0.1), color: LOG_COLOR, rimStrength: 0.2 }),
    roof: makeToonMaterial({ vertexColors: true, color: ROOF_BASE_COLOR, rimStrength: 0.2 }),
    roofTiles: makeToonMaterial({ vertexColors: true, color: '#a5602f', rimStrength: 0.2 }),
    chimney: makeToonMaterial({ color: '#6b5d52', rimStrength: 0.2 }),
    tools: makeToonMaterial({ vertexColors: true, color: TOOL_HANDLE_COLOR, rimStrength: 0.2 }),
    bench: makeToonMaterial({ vertexColors: true, color: BENCH_COLOR, rimStrength: 0.2 }),
    windowFrame: makeToonMaterial({ vertexColors: true, color: WINDOW_TRIM_COLOR, rimStrength: 0.2 }),
  } : null), [zone.id]);

  const roofBaseGeometry = useMemo(() => (zone.id === 'izba' ? makeIzbaRoofBase() : null), [zone.id]);
  const roofTileGeometry = useMemo(() => (zone.id === 'izba' ? makeIzbaRoofTiles() : null), [zone.id]);
  const toolsGeometry = useMemo(() => (zone.id === 'izba' ? makeIzbaWallTools() : null), [zone.id]);
  const benchGeometry = useMemo(() => (zone.id === 'izba' ? makeIzbaBench() : null), [zone.id]);
  const windowFrameGeometry = useMemo(() => (zone.id === 'izba' ? makeIzbaWindowFrame() : null), [zone.id]);

  const mode = encounter?.id === zone.id
    ? (encounter.phase === 'retreat' ? 'retreat' : 'encounter')
    : 'idle';

  // See IzbaChimney's own comment: its nested hitbox could never actually be
  // reached (this Landmark's own generous whole-zone hitbox below always
  // wins the raycast first and stops propagation), so the discrimination
  // happens here instead -- world position of the chimney's known local
  // point, composed through this SAME group's position+rotation via a
  // throwaway Object3D (guarantees it matches the actual rendered transform
  // exactly, rather than hand-deriving the rotation's sign convention).
  const chimneyWorldPos = useMemo(() => {
    if (zone.id !== 'izba') return null;
    const o = new Object3D();
    o.position.set(...pos);
    o.rotation.set(0, a + Math.PI, 0);
    o.updateMatrixWorld(true);
    return new Vector3(...CHIMNEY_LOCAL).applyMatrix4(o.matrixWorld);
  }, [zone.id, pos, a]);

  // Live feedback: the chimney is now a press-and-hold interaction (long
  // press "closes" it -- no smoke -- releasing makes smoke "go out"), not a
  // tap -- see onZonePointerDown/onZoneRelease below. chimneyHeldRef tracks
  // whether THIS press started on the chimney (proximity-gated, same spot
  // the old tap discrimination lived, see IzbaChimney's own comment for why
  // it can't live on a nested hitbox), so release only fires the burst if
  // the hold actually began there.
  const chimneyHeldRef = useRef(false);
  const onZonePointerDown = (e) => {
    if (!chimneyWorldPos || e.point.distanceTo(chimneyWorldPos) >= CHIMNEY_HIT_R) return;
    e.stopPropagation();
    chimneyHeldRef.current = true;
    eggMotion.chimneyHeld = true;
  };
  const onZoneRelease = () => {
    if (!chimneyHeldRef.current) return;
    chimneyHeldRef.current = false;
    eggMotion.chimneyHeld = false;
    eggManager.tapChimney();
  };

  const onTap = (e) => {
    e.stopPropagation();
    // A plain tap landing on the chimney is a no-op now (its own
    // interaction is press-and-hold, above) -- just don't let it fall
    // through to starting the izba "encounter".
    if (chimneyWorldPos && e.point.distanceTo(chimneyWorldPos) < CHIMNEY_HIT_R) return;
    // The egg registry sees the tap first (fox 5-tap catch); if an egg
    // consumed it, the normal encounter is skipped (EASTER_EGGS.md §1).
    if (eggManager.tap(zone.id)) return;
    // BACKLOG.md #10: don't re-trigger/overwrite an encounter already
    // running on this exact zone -- most importantly, if the AUTOPLAYING
    // TALE is the one currently visiting this zone (`encounter.story ===
    // true`), starting a fresh non-story encounter here would overwrite
    // that shared store field and desync EncounterDirector's beat from
    // the story's own composite timeline. Tapping while already
    // mid-dialogue here is still a no-op (never a re-trigger) -- but live
    // feedback: it shouldn't feel like the tap did nothing at all, so a
    // story-driven visit specifically gets a haptic acknowledgment even
    // though nothing about the encounter itself changes.
    if (encounter?.id === zone.id) {
      if (encounter.story) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }
    startEncounter(zone);
  };

  const Character = CHARACTERS[zone.id];
  const Ambience = AMBIENCE[zone.id];

  return (
    <group
      position={pos}
      rotation={[0, a + Math.PI, 0]}
      onClick={onTap}
      onPointerDown={onZonePointerDown}
      onPointerUp={onZoneRelease}
      onPointerLeave={onZoneRelease}
    >
      {zone.id === 'izba' ? (
        <>
          {/* Live feedback: "let there be a blob-like shadow cast by the
              house" -- sized to roughly the wall footprint (1.7x1.3) plus a
              little overhang. */}
          <BlobShadow radiusX={1.05} radiusZ={0.85} />
          {/* Live feedback: "build the walls out of logs" -- see
              IzbaLogWalls' own comment for how this keeps the exact same
              outer footprint the old flat box used. */}
          <IzbaLogWalls material={izbaMaterials.logs} />
          {/* Gable roof backing (two sloped slabs + triangular gable ends)
              stays underneath the tile overlay so no gaps between
              individual tiles show through to empty space. */}
          {roofBaseGeometry && (
            <mesh geometry={roofBaseGeometry} material={izbaMaterials.roof} />
          )}
          {roofTileGeometry && (
            <mesh geometry={roofTileGeometry} material={izbaMaterials.roofTiles} />
          )}
          <IzbaChimney material={izbaMaterials.chimney} />
          <IzbaWindow />
          {windowFrameGeometry && (
            <mesh geometry={windowFrameGeometry} material={izbaMaterials.windowFrame} />
          )}
          <IzbaDoor />
          {toolsGeometry && (
            <mesh geometry={toolsGeometry} material={izbaMaterials.tools} />
          )}
          {benchGeometry && (
            <group position={[BENCH_X, 0, BENCH_Z]}>
              <mesh geometry={benchGeometry} material={izbaMaterials.bench} />
              <BlobShadow radiusX={0.3} radiusZ={0.16} />
            </group>
          )}
        </>
      ) : (
        <Character mode={mode} isActiveZone={isActive} />
      )}
      {Ambience && <Ambience isActiveZone={isActive} />}
      {/* Generous invisible hitbox so taps land easily on mobile */}
      <mesh position={[0, 1, 0]} visible={false}>
        <sphereGeometry args={[1.7, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}

export function ZoneLandmarks() {
  return (
    <>
      {ZONES.map((z) => (
        <Landmark key={z.id} zone={z} />
      ))}
    </>
  );
}
