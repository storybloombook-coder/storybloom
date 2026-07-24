import { useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import {
  KOLOBOK_LEAD, KOLOBOK_FOLLOW_LAG, nearestZone, angleDelta,
} from '../config/zones';
import {
  orbit, encounterMotion, storyMotion, story, useSceneStore,
} from '../state/sceneStore';
import { createTimeline } from './timeline';
import { polish } from '../config/devFlags';

// After the user stops steering the camera, how long before it counts as
// "idle" again and eases back to auto-following Kolobok + dialogues (smoothly
// re-converging via KOLOBOK_FOLLOW_LAG, not snapping). Tunable.
const IDLE_RESUME_MS = 10000;

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
const SNAP_SPEED = 3.2;       // how eagerly we ease toward an explicit snap target
const FRAMING_EASE_MS = 800;  // ART_SPEC §10: per-zone camera framing transition

// User free-orbit framing. A swipe orbits a PIVOT and never moves Kolobok:
//   eye ON  -> orbit Kolobok's live world position up close (inspect him)
//   eye OFF -> orbit the stone / island center, pulled back to survey it all
// Only applies while the user has the camera (orbit.mode !== 'story'); the
// autoplaying tale keeps its own scripted per-chapter framing.
const USER_KOLOBOK_ORBIT = { radius: 5.5, height: 3.2, lookAtY: 0.8 };
const USER_STONE_ORBIT = { radius: 13, height: 6, lookAtY: 1.4 };

// Free-look vertical drag: pitchOffset scales into a height nudge (bigger)
// and an opposite lookAt-Y nudge (smaller), which is what makes it read as
// "tilting the view" rather than just "elevator up/down" -- the camera
// still ends up looking roughly at the same island-center pillar, just from
// a higher/lower, more/less steep angle. Snaps back to 0 at PITCH_SNAP_RATE
// (1/s) the instant the drag ends (orbit.freeLookActive goes false).
const PITCH_HEIGHT_SCALE = 1.5;
const PITCH_LOOKAT_SCALE = 0.5;
const PITCH_SNAP_RATE = 3.0;

// Live feedback (matched against an on-device screenshot the user liked):
// on scene mount, hold a static establishing shot on the crossroads stone
// with the izba roof in the foreground below it -- the SAME framing/lookAt
// storyChapters.js's birth chapter already uses (FRAMING.birth there), so
// there's no jump at all once the tale's own later beats take over.
const STONE_INTRO_FRAMING = {
  radius: 12, height: 5.2, lookAtY: 1.6, lookAt: [0, 1.2, 4.2],
};
// Live feedback: hold this exact shot for a full 7s no matter what --
// NOT just until story.mode leaves 'idle'. It used to be gated on that,
// but story.mode (and orbit.mode) flip to 'story' the instant the tale
// autoplays (~1.5s in, see StoryDirector's LAUNCH_IDLE_MS), which let this
// file's own OTHER branch below start easing orbit.angle toward Kolobok's
// birth-stage angle immediately -- the shot visibly started swinging away
// after ~1.5s instead of holding. A direct drag/nav-tap still cuts the
// hold short (see kolobokStarted below), since the user is now actively
// steering and shouldn't be locked out.
const INTRO_HOLD_MS = 12000;
// Live feedback: "move it slowly to the kolobok when it starts moving" --
// longer than the usual snappy 800/900ms zone/story ease, since this one
// pan is the whole point of the intro rather than an incidental cut.
const INTRO_HANDOFF_MS = 3000;

export function CameraRig() {
  // null (not 'izba') until the intro hand-off sets it explicitly (see
  // below), so step 4 doesn't see a "zone changed" edge of its own during
  // the hold and fire a second, faster retarget on top of the intro's.
  const lastActive = useRef(null);
  const introActive = useRef(true);
  const introMountedAt = useRef(Date.now());
  const setActiveZone = useSceneStore((s) => s.setActiveZone);

  // Live camera framing (radius/height/lookAtY), eased toward whichever
  // zone is active (ART_SPEC §10: 800ms easeInOutSine per transition) --
  // or, in story mode, toward the chapter's own framing (STORY_SPEC §2's
  // per-chapter radii; the same easing does the §1 "camera glides to the
  // chapter's start framing" resume beat for free). Pre-seeded at the
  // stone-intro framing so mounting doesn't pop in from zero.
  const framing = useRef({
    radius: STONE_INTRO_FRAMING.radius,
    height: STONE_INTRO_FRAMING.height,
    lookAtX: STONE_INTRO_FRAMING.lookAt[0],
    lookAtY: STONE_INTRO_FRAMING.lookAt[1],
    lookAtZ: STONE_INTRO_FRAMING.lookAt[2],
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

    // Stone-intro hold: keep the camera static on STONE_INTRO_FRAMING for a
    // full INTRO_HOLD_MS, regardless of the autoplaying tale's own timing --
    // only a direct drag/nav-tap (the user actively steering) cuts it short.
    if (introActive.current) {
      const holdDone = Date.now() - introMountedAt.current >= INTRO_HOLD_MS;
      const userInteracted = orbit.freeLookActive || orbit.velocity !== 0 || orbit.snapTarget !== null;
      const kolobokStarted = holdDone || userInteracted;
      if (!kolobokStarted) {
        camera.position.set(
          Math.sin(orbit.angle) * framing.current.radius,
          framing.current.height,
          Math.cos(orbit.angle) * framing.current.radius,
        );
        camera.lookAt(framing.current.lookAtX, framing.current.lookAtY, framing.current.lookAtZ);
        return;
      }
      introActive.current = false;
      // Hand off explicitly here, at INTRO_HANDOFF_MS, rather than letting
      // step 4 below do its usual fast 800/900ms zone/story ease -- this one
      // pan should read as deliberate, not a snappy cut. Marking lastActive/
      // storyKey already-in-sync stops step 4 from ALSO retargeting (at the
      // normal fast speed) on this same frame. If the tale just started,
      // storyMotion.framing is already FRAMING.birth -- identical to
      // STONE_INTRO_FRAMING -- so this is a no-op non-transition until the
      // birth chapter's own later beats change the framing, as scripted.
      const zoneNow = nearestZone(orbit.angle);
      const target = storyMotion.framing || zoneNow.framing;
      retargetFraming(framing.current, target, INTRO_HANDOFF_MS);
      lastActive.current = zoneNow.id;
      framing.current.storyKey = storyMotion.framing || null;
    }

    // Is the user actively steering the camera right now? (finger down, or
    // within IDLE_RESUME_MS of the last drag input.) This -- NOT story vs
    // user mode -- selects the camera's behavior for both the angle update
    // here and the placement in step 5:
    //   steering -> orbit a fixed pivot per the eye toggle (Kolobok / stone),
    //               ignoring dialogues.
    //   idle     -> auto-follow Kolobok AND focus dialogues.
    // Deliberately orbit.lastDragAt (real drags only), NOT story.lastInputAt
    // -- that field is ALSO bumped by story-driven encounter beats (see
    // StoryDirector's `[encounter]` effect), which used to masquerade as
    // "user is steering" and snap the camera into the tight Kolobok orbit
    // every time a dialogue started.
    const steering = orbit.freeLookActive
      || Date.now() - orbit.lastDragAt < IDLE_RESUME_MS;

    if (orbit.snapTarget !== null) {
      // Explicit snap request (nav button) always wins.
      const d = angleDelta(orbit.angle, orbit.snapTarget);
      orbit.angle += d * Math.min(1, SNAP_SPEED * dt * 1.6);
      orbit.velocity = 0;
      if (Math.abs(d) < 0.005) orbit.snapTarget = null;
    } else if (steering) {
      // User owns the azimuth: the drag already wrote orbit.angle; here we
      // just coast the release fling to rest.
      orbit.angle += orbit.velocity;
      orbit.velocity *= FRICTION;
    } else {
      // Idle: auto-follow Kolobok. Ease orbit.angle so he stays framed
      // (kolobokAngle - LEAD). Uses the SCRIPTED storyMotion.kolobokAngle,
      // not his raw world-position angle -- during posOverride beats (sill,
      // snout) his true XZ position deliberately points a different
      // direction than his staged angle (birth stages him at izba +
      // BIRTH_STAGE specifically so the camera views the sill from an angle
      // clear of the roofline; his real position is dead-on at izba, 0deg).
      // Using the raw position would visibly drag the camera toward that
      // unstaged angle the moment idle-follow took over mid-story.
      const camTarget = storyMotion.kolobokAngle - KOLOBOK_LEAD;
      const d = angleDelta(orbit.angle, camTarget);
      orbit.angle += d * Math.min(1, KOLOBOK_FOLLOW_LAG * dt);
      orbit.velocity = 0;
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

    // 5. Place the camera.
    const breathOn = polish.cameraBreath && orbit.mode !== 'story' && Date.now() - story.lastInputAt > BREATH_SUSPEND_MS;
    const breathClock = Date.now() / 1000;
    const angleBreath = breathOn ? Math.sin((breathClock * Math.PI * 2) / BREATH_ANGLE_PERIOD_S) * BREATH_ANGLE : 0;
    const heightBreath = breathOn ? Math.sin((breathClock * Math.PI * 2) / BREATH_HEIGHT_PERIOD_S) * BREATH_HEIGHT : 0;
    const pitchH = orbit.pitchOffset * PITCH_HEIGHT_SCALE;
    const pitchLook = orbit.pitchOffset * PITCH_LOOKAT_SCALE;

    if (steering) {
      // Actively steering: orbit a FIXED pivot per the eye toggle, and
      // deliberately ignore dialogue framing/push-in (dialogues are followed
      // ONLY when idle, per the camera spec).
      //   eye ON  -> pivot on Kolobok's LIVE world position (circle him)
      //   eye OFF -> pivot on the stone / island center, pulled back to survey
      const o = orbit.cameraFollow ? USER_KOLOBOK_ORBIT : USER_STONE_ORBIT;
      const pivotX = orbit.cameraFollow ? storyMotion.kolobokWorldPos[0] : 0;
      const pivotZ = orbit.cameraFollow ? storyMotion.kolobokWorldPos[2] : 0;
      camera.position.set(
        pivotX + Math.sin(orbit.angle + angleBreath) * o.radius,
        o.height + pitchH + heightBreath,
        pivotZ + Math.cos(orbit.angle + angleBreath) * o.radius,
      );
      camera.lookAt(pivotX, o.lookAtY - pitchLook, pivotZ);
    } else {
      // Idle: follow Kolobok + dialogues. The framing (f) already tracks the
      // active zone / story chapter (step 4); the encounter push-in (a 4%
      // radius nudge during a beat) rides on top, so dialogue beats pull the
      // camera in -- only here, never while steering.
      const pushedRadius = f.radius * (1 - ENCOUNTER_PUSH_IN * encounterMotion.cameraPushT);
      camera.position.set(
        Math.sin(orbit.angle + angleBreath) * pushedRadius,
        f.height + pitchH + heightBreath,
        Math.cos(orbit.angle + angleBreath) * pushedRadius,
      );
      camera.lookAt(f.lookAtX, f.lookAtY - pitchLook, f.lookAtZ);
    }
  });

  return null;
}
