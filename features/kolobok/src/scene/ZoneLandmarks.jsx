import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import { DoubleSide, Object3D, Vector3 } from 'three';
import * as Haptics from 'expo-haptics';
import { ZONES, ZONE_RADIUS, rad } from '../config/zones';
import { atmosphereLive, storyMotion, useSceneStore } from '../state/sceneStore';
import { eggManager, eggMotion } from './easterEggs';
import { makeToonMaterial } from './materials/toonMaterial';
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
    walls: makeToonMaterial({ color: zone.color, rimStrength: 0.2 }),
    roof: makeToonMaterial({ color: '#a5602f', rimStrength: 0.2 }),
    chimney: makeToonMaterial({ color: '#6b5d52', rimStrength: 0.2 }),
  } : null), [zone.id, zone.color]);

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
          <mesh position={[0, 0.85, 0]} material={izbaMaterials.walls}>
            <boxGeometry args={[1.7, 1.1, 1.3]} />
          </mesh>
          <mesh position={[0, 1.75, 0]} rotation={[0, Math.PI / 4, 0]} material={izbaMaterials.roof}>
            <coneGeometry args={[1.35, 0.9, 4]} />
          </mesh>
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
