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

// POLISH_SPEC §5 "never a static frame": idle camera breath, free mode
// only -- suspended instantly on any input, resumes the instant it's been
// quiet again. A view-only offset (added at the placement step below, never
// written into orbit.angle itself) so it can't interfere with nearest-zone
// logic upstream.
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
// STORY MODE ONLY -- free mode's fixed-pivot orbit (below) has no framing
// to push in on.
const ENCOUNTER_PUSH_IN = 0.04;

const FRICTION = 0.94;        // per-frame velocity decay
const FRAMING_EASE_MS = 800;  // ART_SPEC §10: per-zone camera framing transition (story mode)

// How long orbit.lookingAway (story mode, set on drag -- see Scene3D) holds
// the camera under manual control before auto-follow resumes on its own.
// Live feedback: this reset went missing in an earlier rewrite this
// session, leaving lookingAway stuck true forever after the first drag.
const LOOK_AWAY_TIMEOUT_MS = 15000;

// The eye toggle's two framings, blended via pivotBlend below rather than
// snapped -- works in BOTH modes now (live feedback: "let me switch the
// focus on kolobok when the story is in the process"):
//   free mode:  eye OFF (default) -> WIDE_ORBIT, pulled back, pivot at the
//               island center, whole scene visible. eye ON -> KOLOBOK_ORBIT,
//               close in, pivot on Kolobok's LIVE world position. A drag
//               always rotates orbit.angle around whichever is active.
//   story mode: eye OFF (default) -> the chapter's own scripted framing,
//               unchanged. eye ON -> blends toward KOLOBOK_ORBIT instead,
//               orbiting/looking at Kolobok directly -- narration and his
//               own scripted movement keep going regardless.
const WIDE_ORBIT = { radius: 13, height: 6, lookAtY: 1.4 };
const KOLOBOK_ORBIT = { radius: 5.5, height: 3.2, lookAtY: 0.8 };
const PIVOT_BLEND_EASE_MS = 900;

// Free-look vertical drag: pitchOffset scales into a height nudge (bigger)
// and an opposite lookAt-Y nudge (smaller), which is what makes it read as
// "tilting the view" rather than just "elevator up/down" -- the camera
// still ends up looking roughly at the same pivot, just from a higher/
// lower, more/less steep angle. Snaps back to 0 at PITCH_SNAP_RATE (1/s)
// the instant the drag ends (orbit.freeLookActive goes false).
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
// Live feedback: hold this exact shot for a full 12s no matter what -- a
// direct drag/nav-tap still cuts the hold short (see kolobokStarted below),
// since the user is now actively steering and shouldn't be locked out.
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

  // Story-mode camera framing (radius/height/lookAtY), eased toward
  // whichever zone is active (ART_SPEC §10: 800ms easeInOutSine per
  // transition) or the chapter's own framing (STORY_SPEC §2's per-chapter
  // radii; the same easing does the §1 "camera glides to the chapter's
  // start framing" resume beat for free). Pre-seeded at the stone-intro
  // framing so mounting doesn't pop in from zero. Free mode (below) uses
  // its own separate pivotBlend system instead.
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

  // Eye-toggle blend: 0 = the eye-off framing (WIDE_ORBIT in free mode, the
  // chapter's own scripted framing in story mode), 1 = KOLOBOK_ORBIT.
  // Eases whenever orbit.cameraFollow toggles (live feedback: "can the
  // camera change be done in a smooth manner? it's just a snap now")
  // instead of cutting instantly between the two. Shared by both modes.
  const pivotBlend = useRef({
    value: orbit.cameraFollow ? 1 : 0, from: 0, to: 0, timeline: null,
  });
  const lastCameraFollow = useRef(orbit.cameraFollow);

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
      const userInteracted = orbit.freeLookActive || orbit.velocity !== 0;
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
      // (If the user instead interrupted before the tale ever launched,
      // this retargets framing for a target that free mode's placement no
      // longer reads -- harmless, and free mode's own pivotBlend already
      // starts at the matching WIDE_ORBIT-ish state by default.)
      const zoneNow = nearestZone(orbit.angle);
      const target = storyMotion.framing || zoneNow.framing;
      retargetFraming(framing.current, target, INTRO_HANDOFF_MS);
      lastActive.current = zoneNow.id;
      framing.current.storyKey = storyMotion.framing || null;
    }

    if (orbit.mode === 'story') {
      // STORY_SPEC §1 control inversion: the camera chases Kolobok at
      // kolobokAngle - LEAD with the same soft lag -- same math as free
      // mode's Kolobok-chases-camera, inverted leader. Writing the result
      // back INTO orbit.angle means resuming auto-follow (or an old-style
      // interrupt) hands control over exactly where the camera already is:
      // zero jump. Dragging sets orbit.lookingAway (Scene3D) without
      // pausing the tale -- the user gets to look at the scene from any
      // angle (e.g. rotating around the stone) while Kolobok and narration
      // keep going, and -- live feedback -- dialogue focus (the encounter
      // push-in, step 5 below) is suspended too while looking away, since
      // yanking the zoom level for a dialogue the user isn't even looking
      // at reads as wrong. Auto-follow (and push-in) resume once the user
      // has been quiet for LOOK_AWAY_TIMEOUT_MS.
      if (orbit.lookingAway && Date.now() - story.lastInputAt > LOOK_AWAY_TIMEOUT_MS) {
        orbit.lookingAway = false;
      }
      if (!orbit.lookingAway) {
        const camTarget = storyMotion.kolobokAngle - KOLOBOK_LEAD;
        const d = angleDelta(orbit.angle, camTarget);
        orbit.angle += d * Math.min(1, KOLOBOK_FOLLOW_LAG * dt);
      }
      orbit.velocity = 0;
    } else {
      // Free/manual mode: always coast the drag/fling -- the eye toggle
      // (below, step 5) decides WHERE that angle orbits, not whether it
      // updates.
      orbit.angle += orbit.velocity;
      orbit.velocity *= FRICTION;
    }

    // Ease the pivot blend whenever the eye toggle changes, in EITHER mode
    // (live feedback: "let me switch the focus on kolobok when the story is
    // in the process by tapping on the eye button" -- the tale keeps
    // narrating/moving him regardless, only the camera's framing blends).
    if (orbit.cameraFollow !== lastCameraFollow.current) {
      lastCameraFollow.current = orbit.cameraFollow;
      const pb = pivotBlend.current;
      pb.from = pb.value;
      pb.to = orbit.cameraFollow ? 1 : 0;
      pb.timeline = createTimeline([
        {
          at: 0,
          dur: PIVOT_BLEND_EASE_MS,
          ease: 'easeInOutSine',
          update: (t) => { pb.value = pb.from + (pb.to - pb.from) * t; },
        },
      ]);
    }
    if (pivotBlend.current.timeline) pivotBlend.current.timeline.tick(dt);

    // 4. Publish the active zone (UI zone-name card) + story-mode framing
    // retargets. Zone framing/push-in placement below only matters in story
    // mode now -- free mode uses pivotBlend instead -- but the zone-name
    // card is still useful feedback while free-orbiting, so nearestZone
    // keeps tracking orbit.angle in both modes.
    const zone = nearestZone(orbit.angle);
    const f = framing.current;
    if (zone.id !== lastActive.current) {
      lastActive.current = zone.id;
      setActiveZone(zone.id);
      if (orbit.mode === 'story' && !storyMotion.framing) retargetFraming(f, zone.framing);
    }
    if (orbit.mode === 'story') {
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
    }

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

    if (orbit.mode === 'story') {
      // The autoplaying tale keeps its scripted per-chapter framing
      // (radius/height/lookAt), orbiting the island center -- unchanged at
      // pivotBlend 0 (eye off, default), so "if I do nothing" the cinematic
      // plays exactly as before. Encounter push-in (a 4% radius nudge
      // during a beat) rides on top of it. Toggling the eye ON blends this
      // toward a close orbit around Kolobok's live position instead --
      // narration/his own scripted movement keep going regardless, only
      // the camera's framing changes.
      // Live feedback: rotating ALWAYS orbits the stone, regardless of
      // whatever the eye toggle was set to before the drag started -- it
      // immediately reverts to the chapter's own wide framing the instant
      // you rotate, and only resumes wherever the eye toggle actually
      // points (wide or close-Kolobok) once lookingAway itself resets
      // after the idle timeout above.
      const pb = orbit.lookingAway ? 0 : pivotBlend.current.value;
      // Suspended while lookingAway (the user dragged away, e.g. rotating
      // around the stone) -- see the lookingAway block above.
      const pushT = orbit.lookingAway ? 0 : encounterMotion.cameraPushT;
      const pushedRadius = f.radius * (1 - ENCOUNTER_PUSH_IN * pushT);
      const orbitRadius = pushedRadius + (KOLOBOK_ORBIT.radius - pushedRadius) * pb;
      const orbitHeight = f.height + (KOLOBOK_ORBIT.height - f.height) * pb;
      const orbitLookAtY = f.lookAtY + (KOLOBOK_ORBIT.lookAtY - f.lookAtY) * pb;
      // Position orbits the island center at pb=0 (unchanged), blending
      // toward orbiting Kolobok himself as pb -> 1. The lookAt target
      // blends from the chapter's own (possibly off-center, e.g. an
      // encounter's rim point) target toward Kolobok separately, since at
      // pb=0 it must stay EXACTLY the chapter's own lookAt, not the origin.
      const posPivotX = storyMotion.kolobokWorldPos[0] * pb;
      const posPivotZ = storyMotion.kolobokWorldPos[2] * pb;
      const lookPivotX = f.lookAtX + (storyMotion.kolobokWorldPos[0] - f.lookAtX) * pb;
      const lookPivotZ = f.lookAtZ + (storyMotion.kolobokWorldPos[2] - f.lookAtZ) * pb;
      camera.position.set(
        posPivotX + Math.sin(orbit.angle + angleBreath) * orbitRadius,
        orbitHeight + pitchH + heightBreath,
        posPivotZ + Math.cos(orbit.angle + angleBreath) * orbitRadius,
      );
      camera.lookAt(lookPivotX, orbitLookAtY - pitchLook, lookPivotZ);
    } else {
      // Free mode: orbit the eye-selected pivot, blended smoothly between
      // WIDE_ORBIT (pivot at the island center) and KOLOBOK_ORBIT (pivot on
      // Kolobok's live world position) via pivotBlend.
      const pb = pivotBlend.current.value;
      const orbitRadius = WIDE_ORBIT.radius + (KOLOBOK_ORBIT.radius - WIDE_ORBIT.radius) * pb;
      const orbitHeight = WIDE_ORBIT.height + (KOLOBOK_ORBIT.height - WIDE_ORBIT.height) * pb;
      const orbitLookAtY = WIDE_ORBIT.lookAtY + (KOLOBOK_ORBIT.lookAtY - WIDE_ORBIT.lookAtY) * pb;
      const pivotX = storyMotion.kolobokWorldPos[0] * pb;
      const pivotZ = storyMotion.kolobokWorldPos[2] * pb;
      camera.position.set(
        pivotX + Math.sin(orbit.angle + angleBreath) * orbitRadius,
        orbitHeight + pitchH + heightBreath,
        pivotZ + Math.cos(orbit.angle + angleBreath) * orbitRadius,
      );
      camera.lookAt(pivotX, orbitLookAtY - pitchLook, pivotZ);
    }
  });

  return null;
}
