import { useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import {
  ZONES, KOLOBOK_LEAD, KOLOBOK_FOLLOW_LAG, nearestZone, rad, angleDelta,
} from '../config/zones';
import {
  orbit, encounterMotion, storyMotion, useSceneStore,
} from '../state/sceneStore';
import { createTimeline } from './timeline';

// ART_SPEC §10 / ANIMATION_SPEC §4: encounter push-ins multiply ON TOP of
// the (possibly still-easing) zone framing radius, restoring in reverse
// order automatically since this just reads encounterMotion.cameraPushT
// fresh every frame -- no separate "restore" step needed, it falls back to
// 1.0 the instant the beat's own retreat phase eases cameraPushT to 0.
const ENCOUNTER_PUSH_IN = 0.04;

const FRICTION = 0.94;        // per-frame velocity decay
const SNAP_SPEED = 3.2;       // how eagerly we ease toward a zone
const SNAP_THRESHOLD = 0.012; // below this |velocity|, soft snap kicks in
const FRAMING_EASE_MS = 800;  // ART_SPEC §10: per-zone camera framing transition

const IZBA_FRAMING = ZONES.find((z) => z.id === 'izba').framing;

export function CameraRig() {
  const lastActive = useRef('izba');
  const setActiveZone = useSceneStore((s) => s.setActiveZone);

  // Live camera framing (radius/height/lookAtY), eased toward whichever
  // zone is active (ART_SPEC §10: 800ms easeInOutSine per transition) --
  // or, in story mode, toward the chapter's own framing (STORY_SPEC §2's
  // per-chapter radii; the same easing does the §1 "camera glides to the
  // chapter's start framing" resume beat for free). Pre-seeded at izba's
  // framing so mounting doesn't pop in from zero.
  const framing = useRef({
    radius: IZBA_FRAMING.radius,
    height: IZBA_FRAMING.height,
    lookAtX: 0,
    lookAtY: IZBA_FRAMING.lookAtY,
    lookAtZ: 0,
    from: null,
    to: null,
    timeline: null,
    storyKey: null, // identity of the storyMotion.framing object last targeted
  });

  // `to.lookAt` ([x,y,z], story encounter chapters) aims the camera at a
  // world point off the island center; without it, the target stays the
  // center at to.lookAtY (zone framings, roads).
  const retargetFraming = (f, to, durMs = FRAMING_EASE_MS) => {
    f.from = {
      radius: f.radius, height: f.height, lookAtX: f.lookAtX, lookAtY: f.lookAtY, lookAtZ: f.lookAtZ,
    };
    f.to = {
      radius: to.radius,
      height: to.height,
      lookAtX: to.lookAt ? to.lookAt[0] : 0,
      lookAtY: to.lookAt ? to.lookAt[1] : to.lookAtY,
      lookAtZ: to.lookAt ? to.lookAt[2] : 0,
    };
    f.timeline = createTimeline([
      {
        at: 0,
        dur: durMs,
        ease: 'easeInOutSine',
        update: (t) => {
          f.radius = f.from.radius + (f.to.radius - f.from.radius) * t;
          f.height = f.from.height + (f.to.height - f.from.height) * t;
          f.lookAtX = f.from.lookAtX + (f.to.lookAtX - f.from.lookAtX) * t;
          f.lookAtY = f.from.lookAtY + (f.to.lookAtY - f.from.lookAtY) * t;
          f.lookAtZ = f.from.lookAtZ + (f.to.lookAtZ - f.from.lookAtZ) * t;
        },
      },
    ]);
  };

  useFrame(({ camera }, delta) => {
    // Guard against a non-finite delta (possible on an early frame before
    // R3F's clock has a previous timestamp to diff against) -- unguarded,
    // it multiplies into orbit.angle below and corrupts it permanently
    // (NaN + anything stays NaN forever, since orbit.angle is an
    // accumulator).
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;

    if (orbit.mode === 'story') {
      // STORY_SPEC §1 control inversion: the camera chases Kolobok at
      // kolobokAngle - LEAD with the same soft lag -- same math as free
      // mode's Kolobok-chases-camera, inverted leader. Writing the result
      // back INTO orbit.angle means an interrupt hands control to the user
      // exactly where the camera already is: zero jump.
      const camTarget = storyMotion.kolobokAngle - KOLOBOK_LEAD;
      const d = angleDelta(orbit.angle, camTarget);
      orbit.angle += d * Math.min(1, KOLOBOK_FOLLOW_LAG * dt);
      orbit.velocity = 0;
      orbit.snapTarget = null;
    } else {
      // 1. Explicit snap request (nav button pressed)
      if (orbit.snapTarget !== null) {
        const d = angleDelta(orbit.angle, orbit.snapTarget);
        orbit.angle += d * Math.min(1, SNAP_SPEED * dt * 1.6);
        orbit.velocity = 0;
        if (Math.abs(d) < 0.005) orbit.snapTarget = null;
      } else {
        // 2. Gesture inertia
        orbit.angle += orbit.velocity;
        orbit.velocity *= FRICTION;

        // 3. Soft snap: once nearly still, settle onto the nearest zone
        if (Math.abs(orbit.velocity) < SNAP_THRESHOLD) {
          const zone = nearestZone(orbit.angle);
          const d = angleDelta(orbit.angle, rad(zone.angleDeg));
          orbit.angle += d * Math.min(1, SNAP_SPEED * dt);
        }
      }
    }

    // 4. Publish active zone + framing retargets, BEFORE using
    // framing.current below to place the camera. Story framing (when set)
    // takes precedence over zone framing; each new chapter framing object
    // retargets once (tracked by identity), with the longer 900ms glide
    // (STORY_SPEC §1's resume/chapter transition pacing).
    const zone = nearestZone(orbit.angle);
    const f = framing.current;
    if (zone.id !== lastActive.current) {
      lastActive.current = zone.id;
      setActiveZone(zone.id);
      if (!storyMotion.framing) retargetFraming(f, zone.framing);
    }
    if (storyMotion.framing && storyMotion.framing !== f.storyKey) {
      f.storyKey = storyMotion.framing;
      retargetFraming(f, storyMotion.framing, 900);
    } else if (!storyMotion.framing && f.storyKey) {
      // Story released its framing (interrupt/stop): ease back to the
      // active zone's own framing.
      f.storyKey = null;
      retargetFraming(f, zone.framing);
    }
    if (f.timeline) f.timeline.tick(dt);

    // 5. Place camera on its orbit, always looking at the island center.
    // Encounter push-in (a 4% radius nudge while a beat's approach/react
    // is active) multiplies on top of the framing radius here.
    const pushedRadius = f.radius * (1 - ENCOUNTER_PUSH_IN * encounterMotion.cameraPushT);
    camera.position.set(
      Math.sin(orbit.angle) * pushedRadius,
      f.height,
      Math.cos(orbit.angle) * pushedRadius,
    );
    camera.lookAt(f.lookAtX, f.lookAtY, f.lookAtZ);
  });

  return null;
}
