import { useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import {
  ZONES, KOLOBOK_LEAD, KOLOBOK_FOLLOW_LAG, nearestZone, rad, angleDelta,
} from '../config/zones';
import {
  orbit, encounterMotion, storyMotion, story, useSceneStore,
} from '../state/sceneStore';
import { createTimeline } from './timeline';
import { polish } from '../config/devFlags';

// How long a story-mode "look away" drag holds the camera off auto-follow
// before it resumes on its own (smoothly re-converging, not snapping).
const LOOK_AWAY_TIMEOUT_MS = 15000;

// POLISH_SPEC §5 "never a static frame": idle camera breath, free mode
// only -- suspended instantly on any input, resumes the instant it's been
// quiet again. A view-only offset (added at the placement step below, never
// written into orbit.angle itself) so it can't interfere with nearest-zone/
// snap-target logic upstream.
const BREATH_ANGLE = 0.007;
const BREATH_ANGLE_PERIOD_S = 8;
const BREATH_HEIGHT = 0.05;
const BREATH_HEIGHT_PERIOD_S = 13;
const BREATH_SUSPEND_MS = 300;

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

// Free-look vertical drag: pitchOffset scales into a height nudge (bigger)
// and an opposite lookAt-Y nudge (smaller), which is what makes it read as
// "tilting the view" rather than just "elevator up/down" -- the camera
// still ends up looking roughly at the same island-center pillar, just from
// a higher/lower, more/less steep angle. Snaps back to 0 at PITCH_SNAP_RATE
// (1/s) the instant the drag ends (orbit.freeLookActive goes false).
const PITCH_HEIGHT_SCALE = 1.5;
const PITCH_LOOKAT_SCALE = 0.5;
const PITCH_SNAP_RATE = 3.0;

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
      // Dragging sets orbit.lookingAway (Scene3D) without pausing the tale --
      // the user gets to look at the scene from any angle while Kolobok and
      // narration keep going. Auto-follow resumes on its own 15s after the
      // last input, easing back in via the same FOLLOW_LAG rate below rather
      // than snapping.
      if (orbit.lookingAway && Date.now() - story.lastInputAt > LOOK_AWAY_TIMEOUT_MS) {
        orbit.lookingAway = false;
      }
      if (!orbit.lookingAway) {
        // STORY_SPEC §1 control inversion: the camera chases Kolobok at
        // kolobokAngle - LEAD with the same soft lag -- same math as free
        // mode's Kolobok-chases-camera, inverted leader. Writing the result
        // back INTO orbit.angle means resuming auto-follow (or an old-style
        // interrupt) hands control over exactly where the camera already
        // is: zero jump.
        const camTarget = storyMotion.kolobokAngle - KOLOBOK_LEAD;
        const d = angleDelta(orbit.angle, camTarget);
        orbit.angle += d * Math.min(1, KOLOBOK_FOLLOW_LAG * dt);
      }
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

    // 4b. Free-look vertical drag eases back to 0 the instant the drag ends
    // -- a temporary override on top of the framing, never a persisted one.
    if (!orbit.freeLookActive && orbit.pitchOffset !== 0) {
      orbit.pitchOffset -= orbit.pitchOffset * Math.min(1, PITCH_SNAP_RATE * dt);
      if (Math.abs(orbit.pitchOffset) < 0.001) orbit.pitchOffset = 0;
    }

    // 5. Place camera on its orbit, always looking at the island center.
    // Encounter push-in (a 4% radius nudge while a beat's approach/react
    // is active) multiplies on top of the framing radius here.
    const breathOn = polish.cameraBreath && orbit.mode !== 'story' && Date.now() - story.lastInputAt > BREATH_SUSPEND_MS;
    const breathClock = Date.now() / 1000;
    const angleBreath = breathOn ? Math.sin((breathClock * Math.PI * 2) / BREATH_ANGLE_PERIOD_S) * BREATH_ANGLE : 0;
    const heightBreath = breathOn ? Math.sin((breathClock * Math.PI * 2) / BREATH_HEIGHT_PERIOD_S) * BREATH_HEIGHT : 0;

    const pushedRadius = f.radius * (1 - ENCOUNTER_PUSH_IN * encounterMotion.cameraPushT);
    camera.position.set(
      Math.sin(orbit.angle + angleBreath) * pushedRadius,
      f.height + orbit.pitchOffset * PITCH_HEIGHT_SCALE + heightBreath,
      Math.cos(orbit.angle + angleBreath) * pushedRadius,
    );
    camera.lookAt(f.lookAtX, f.lookAtY - orbit.pitchOffset * PITCH_LOOKAT_SCALE, f.lookAtZ);
  });

  return null;
}
