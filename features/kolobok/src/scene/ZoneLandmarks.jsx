import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import {
  BoxGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Euler,
  Object3D, Quaternion, SphereGeometry, Vector3,
} from 'three';
import * as Haptics from 'expo-haptics';
import { ZONES, ZONE_RADIUS, rad } from '../config/zones';
import { atmosphereLive, storyMotion, useSceneStore } from '../state/sceneStore';
import { eggManager, eggMotion } from './easterEggs';
import { makeToonMaterial } from './materials/toonMaterial';
import { makeNoiseGrain } from './textures/proceduralTextures';
import { mergeColoredParts } from './builders/mergeColoredParts';
import { makeRng } from './prng';
import { BlobShadow } from './BlobShadow';
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
const CHIMNEY_LOCAL = [0.55, 1.8, 0.15];
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

const ROOF_BASE_R = 1.35; // matches the existing backing cone
const ROOF_HEIGHT = 0.9;
const ROOF_Y = 1.75;
// "3D tile elements": rings of small overlapping tile pieces hugging the
// backing cone's own sloped surface (kept underneath, unlit gaps between
// tiles would otherwise show through to empty space) rather than one smooth
// face. Ring-based (not matched to the cone's exact 4 flat faces) -- much
// simpler than deriving each face's own plane, and at this size/distance
// reads the same either way.
const ROOF_TILE_ROWS = 6;
const ROOF_TILE_MAX_T = 0.82; // stop short of the apex so tiles don't shrink to nothing
const ROOF_TILE_W = 0.24;
const ROOF_TILE_H = 0.2;
const ROOF_TILE_THICK = 0.02;
// approx arc-length between tile centers in a ring -- ART_SPEC §4 caps the
// whole izba at ~4k triangles; 0.22 (~137 tiles, 1.6k+ tris on its own)
// pushed the WHOLE building close to that ceiling once walls/trim/door/
// window/chimney are added in too, so widened to keep the total comfortable.
const ROOF_TILE_SPACING = 0.32;
const ROOF_TILE_COLOR_A = '#a5602f';
const ROOF_TILE_COLOR_B = '#8f4f26';

// Moss-mushroom clusters + hanging grass blades along the roof's eave
// (the backing cone's own base circle, in the SAME local frame as the roof
// group -- Y=-ROOF_HEIGHT/2 is the cone's base since a Three.js cone is
// centered on its own local origin).
const MOSS_COUNT = 9;
const MOSS_RADIUS = ROOF_BASE_R * 0.98;
const MOSS_Y_LOCAL = -ROOF_HEIGHT / 2;
const MOSS_CAP_R = 0.055;
const MOSS_CAP_COLOR = '#5a7a3e';
const MOSS_STEM_COLOR = '#3f5a2c';
const HANGING_GRASS_COLOR = '#3f6b2a';

/** ART_SPEC §4's own log-wall design: 4 walls x 5 stacked cylinders, all one
 *  instancedMesh (one draw call) since every log shares the same radius --
 *  only position/rotation/length (via Y-scale on a unit-length cylinder)
 *  differ per instance. */
function IzbaLogWalls({ material }) {
  const matrices = useMemo(() => {
    const list = [];
    const d = new Object3D();
    const walls = [
      { runAlong: 'x', len: FRONT_BACK_LOG_LEN, x: 0, z: WALL_D / 2 - LOG_R },
      { runAlong: 'x', len: FRONT_BACK_LOG_LEN, x: 0, z: -(WALL_D / 2 - LOG_R) },
      { runAlong: 'z', len: SIDE_LOG_LEN, x: WALL_W / 2 - LOG_R, z: 0 },
      { runAlong: 'z', len: SIDE_LOG_LEN, x: -(WALL_W / 2 - LOG_R), z: 0 },
    ];
    walls.forEach((w) => {
      for (let i = 0; i < LOG_ROWS; i += 1) {
        const y = LOG_R + i * LOG_R * 2;
        d.position.set(w.x, y, w.z);
        // A cylinder's own length runs along local Y by default -- rotate
        // 90deg around Z to lie along world X, or around X to lie along Z.
        if (w.runAlong === 'x') d.rotation.set(0, 0, Math.PI / 2);
        else d.rotation.set(Math.PI / 2, 0, 0);
        d.scale.set(1, w.len, 1);
        d.updateMatrix();
        list.push(d.matrix.clone());
      }
    });
    return list;
  }, []);

  return (
    <instancedMesh
      args={[undefined, undefined, matrices.length]}
      material={material}
      ref={(mesh) => {
        if (!mesh) return;
        matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
        mesh.instanceMatrix.needsUpdate = true;
      }}
    >
      <cylinderGeometry args={[LOG_R, LOG_R, 1, 8]} />
    </instancedMesh>
  );
}

const roofNormalTmp = new Vector3();
const ROOF_UP = new Vector3(0, 1, 0);
const roofQuatTmp = new Quaternion();
const roofEulerTmp = new Euler();

/** "Make the roof look like it's made of 3D tile elements" -- small flat
 *  tiles in shrinking rings from base to apex, each oriented flush against
 *  the roof's own slope via setFromUnitVectors (guarantees correct flush
 *  alignment regardless of the exact pyramid angle, same technique
 *  KolobokParticles.jsx's own ray-direction orientation uses) rather than
 *  hand-derived Euler signs. Alternating rows are angle-offset and
 *  alternating tiles get a slightly darker shade, both just for a less
 *  mechanically regular shingle read. Static -- built once, merged into one
 *  draw call via mergeColoredParts. */
function makeIzbaRoofTiles() {
  const slantLen = Math.sqrt(ROOF_BASE_R ** 2 + ROOF_HEIGHT ** 2);
  const normalR = ROOF_HEIGHT / slantLen;
  const normalY = ROOF_BASE_R / slantLen;
  const parts = [];
  for (let row = 0; row < ROOF_TILE_ROWS; row += 1) {
    const t = (row / (ROOF_TILE_ROWS - 1)) * ROOF_TILE_MAX_T;
    const ringR = ROOF_BASE_R * (1 - t);
    const y = -ROOF_HEIGHT / 2 + t * ROOF_HEIGHT;
    const circumference = 2 * Math.PI * Math.max(0.05, ringR);
    const count = Math.max(4, Math.round(circumference / ROOF_TILE_SPACING));
    const rowOffset = (row % 2) * (Math.PI / count); // stagger alternate rows
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2 + rowOffset;
      const x = Math.sin(angle) * ringR;
      const z = Math.cos(angle) * ringR;
      roofNormalTmp.set(Math.sin(angle) * normalR, normalY, Math.cos(angle) * normalR).normalize();
      roofQuatTmp.setFromUnitVectors(ROOF_UP, roofNormalTmp);
      roofEulerTmp.setFromQuaternion(roofQuatTmp);
      const tileScale = 0.6 + 0.4 * (1 - t); // smaller tiles near the apex
      parts.push({
        geometry: new BoxGeometry(ROOF_TILE_W * tileScale, ROOF_TILE_THICK, ROOF_TILE_H * tileScale),
        color: (row + i) % 2 === 0 ? ROOF_TILE_COLOR_A : ROOF_TILE_COLOR_B,
        position: [x, y, z],
        rotation: [roofEulerTmp.x, roofEulerTmp.y, roofEulerTmp.z],
      });
    }
  }
  return mergeColoredParts(parts);
}

/** "Small pieces of moss that look like tiny mushrooms, with grass hanging
 *  down from them, along the perimeter of the roof" -- a ring of tiny
 *  mushroom-shaped moss clumps (short stem + squashed cap) hugging the
 *  backing cone's own base/eave, each with a couple of thin blades drooping
 *  down (a Y-flipped cone, apex pointing down, reads as a tapering hanging
 *  blade). Static, merged into one draw call. */
function makeIzbaRoofTrim() {
  const rng = makeRng(501);
  const parts = [];
  for (let i = 0; i < MOSS_COUNT; i += 1) {
    const angle = (i / MOSS_COUNT) * Math.PI * 2 + (rng() - 0.5) * 0.3;
    const x = Math.sin(angle) * MOSS_RADIUS;
    const z = Math.cos(angle) * MOSS_RADIUS;
    const s = 0.8 + rng() * 0.5;
    parts.push({
      geometry: new CylinderGeometry(0.015 * s, 0.02 * s, 0.04 * s, 5),
      color: MOSS_STEM_COLOR,
      position: [x, MOSS_Y_LOCAL + 0.02 * s, z],
    });
    parts.push({
      geometry: new SphereGeometry(MOSS_CAP_R * s, 6, 5),
      color: MOSS_CAP_COLOR,
      scale: [1, 0.55, 1],
      position: [x, MOSS_Y_LOCAL + 0.045 * s, z],
    });
    const bladeCount = 2 + Math.floor(rng() * 2);
    for (let b = 0; b < bladeCount; b += 1) {
      const bladeAngle = rng() * Math.PI * 2;
      const bladeLen = 0.08 + rng() * 0.06;
      const bx = x + Math.sin(bladeAngle) * 0.03;
      const bz = z + Math.cos(bladeAngle) * 0.03;
      parts.push({
        // ConeGeometry's apex points local +Y by default -- flipping 180deg
        // around X points the tapering tip DOWN, reading as a hanging blade.
        geometry: new ConeGeometry(0.008, bladeLen, 4),
        color: HANGING_GRASS_COLOR,
        position: [bx, MOSS_Y_LOCAL - bladeLen / 2 + 0.01, bz],
        rotation: [Math.PI, (rng() - 0.5) * 0.4, 0],
      });
    }
  }
  return mergeColoredParts(parts);
}

/** The izba's chimney pipe -- live feedback: "add a pipe so smoke can
 *  escape". ZoneAmbience.jsx's IzbaAmbience already spawns smoke particles
 *  at chimneyPos ([0.55, 1.95, 0.15], its own default) but nothing was ever
 *  there to visibly emit them from. Base embeds into the roof cone's own
 *  slope at that XZ (roof center [0,1.75,0], radius 1.35, height 0.9 ->
 *  surface height there is ~1.82; base sits a bit lower, at 1.65, so it's
 *  solidly buried rather than floating just above the surface); top sits
 *  right at the smoke's own spawn Y (1.95) so smoke reads as coming out of
 *  the opening, not out of thin air above it or from inside a solid pipe.
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

/** The izba's window pane, on the CENTER-facing wall (local +z after the
 *  landmark group's a+PI yaw): the story camera watches the birth/rebirth
 *  beats from KOLOBOK_LEAD around the ring, which sees this side. Emissive
 *  intensity rides storyMotion.windowGlow (birth pulse / rebirth glow,
 *  STORY_SPEC §3); ANIMATION_SPEC §6's time-of-day glow joins in Phase 6. */
function IzbaWindow() {
  const materialRef = useRef();
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
    <mesh position={[0, 1.0, 0.66]}>
      <planeGeometry args={[0.34, 0.3]} />
      <meshStandardMaterial
        ref={materialRef}
        color="#3a3229"
        emissive="#ffb84d"
        emissiveIntensity={0}
        roughness={0.6}
      />
    </mesh>
  );
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
    // Live feedback: "build the walls out of logs" -- a real bark texture
    // now carries the whole look (ART_SPEC §4's own #b3844f log color), so
    // color is neutral white rather than zone.color (the old flat wall's
    // only source of color) to avoid double-tinting the texture.
    logs: makeToonMaterial({ map: makeNoiseGrain('#b3844f', 0.1), color: '#ffffff', rimStrength: 0.2 }),
    roof: makeToonMaterial({ color: '#a5602f', rimStrength: 0.2 }),
    roofTiles: makeToonMaterial({ vertexColors: true, color: '#a5602f', rimStrength: 0.2 }),
    roofTrim: makeToonMaterial({ vertexColors: true, color: '#5a7a3e', rimStrength: 0.15 }),
    chimney: makeToonMaterial({ color: '#6b5d52', rimStrength: 0.2 }),
  } : null), [zone.id]);

  const roofTileGeometry = useMemo(() => (zone.id === 'izba' ? makeIzbaRoofTiles() : null), [zone.id]);
  const roofTrimGeometry = useMemo(() => (zone.id === 'izba' ? makeIzbaRoofTrim() : null), [zone.id]);

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
          {/* Backing cone (unchanged) stays underneath the tile overlay so
              no gaps between individual tiles show through to empty space. */}
          <mesh position={[0, ROOF_Y, 0]} rotation={[0, Math.PI / 4, 0]} material={izbaMaterials.roof}>
            <coneGeometry args={[ROOF_BASE_R, ROOF_HEIGHT, 4]} />
          </mesh>
          {roofTileGeometry && (
            <mesh position={[0, ROOF_Y, 0]} geometry={roofTileGeometry} material={izbaMaterials.roofTiles} />
          )}
          {roofTrimGeometry && (
            <mesh position={[0, ROOF_Y, 0]} geometry={roofTrimGeometry} material={izbaMaterials.roofTrim} />
          )}
          <IzbaChimney material={izbaMaterials.chimney} />
          <IzbaWindow />
          <IzbaDoor />
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
