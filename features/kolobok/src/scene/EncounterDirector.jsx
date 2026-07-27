import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import * as Haptics from 'expo-haptics';
import {
  orbit, story, encounterMotion, useSceneStore,
} from '../state/sceneStore';
import { angleDelta } from '../config/zones';
import {
  buildSharedBeat, buildFoxBeat, buildIzbaBeat, resetEncounterMotion,
  currentApproachFraction, buildForcedRetreat,
} from './encounterBeats';

// Inverse of Scene3D's SWIPE_SENSITIVITY (px -> radians), so orbit.angle's
// own frame-to-frame delta can be read back out as an approximate pixel
// distance. Reading orbit.angle itself (rather than orbit.velocity, which
// is only set on gesture release for fling momentum) catches a plain drag
// that never turns into a fling too.
const PX_PER_RADIAN = 1 / 0.005;

const BEAT_BUILDERS = {
  izba: buildIzbaBeat,
  hare: buildSharedBeat,
  wolf: buildSharedBeat,
  bear: buildSharedBeat,
  fox: buildFoxBeat,
};

const LINE_KEY = {
  izba: { grandma: 'line.grandma.tap' },
  hare: { eat: 'line.eat.hare', song: 'song.full' },
  wolf: { eat: 'line.eat.wolf', song: 'song.full' },
  bear: { eat: 'line.eat.bear', song: 'song.full' },
  fox: { flatter: 'line.fox.flatter', song: 'song.full' },
};

/** Owns every INTERACTIVE zone-tap encounter beat (ANIMATION_SPEC §4/§5/§9):
 *  sequences the timeline, writes continuous values into the transient
 *  `encounterMotion` object every frame (read by Kolobok + the tapped
 *  animal in their own useFrame), and fires the small set of discrete store
 *  updates (phase, line) the timeline calls for. Story-driven encounters
 *  (`encounter.story === true`, STORY_SPEC §1) are ignored here entirely --
 *  StoryDirector's chapter timelines sequence those through the same shared
 *  beat builders. Interruptible: starting a different encounter, clearing
 *  the current one, or a > 40px swipe all cancel -- but ease the animal
 *  back to rest over FORCED_RETREAT_MS (see encounterBeats.js) rather than
 *  snapping it there, live feedback: "the characters should return to
 *  their original positions smoothly." Also: while the autoplaying tale is
 *  running, an interactive tap plays its full approach/react/retreat
 *  animation as always but never sets encounter.line -- narration owns the
 *  bubble slot during story mode, live feedback: "tapping ... should
 *  trigger only an animation, without a dialogue pop-up." */
export function EncounterDirector() {
  const encounter = useSceneStore((s) => s.encounter);
  const setEncounterPhase = useSceneStore((s) => s.setEncounterPhase);
  const setEncounterLine = useSceneStore((s) => s.setEncounterLine);
  const clearEncounter = useSceneStore((s) => s.clearEncounter);

  const timelineRef = useRef(null);
  // True while timelineRef holds a forced-retreat (not a real beat) --
  // distinguishes "beat finished/was cancelled, now easing out" from "beat
  // still actually running" for both the effect and the frame loop below.
  const retreatingRef = useRef(false);
  // A zone whose beat should start the instant the current forced retreat
  // finishes (rapid zone-switch: ease the OLD one back first, never cut
  // straight to the new one).
  const pendingZoneRef = useRef(null);
  const swipeDistanceRef = useRef(0);
  const lastAngleRef = useRef(orbit.angle);

  const startZoneBeat = (zoneId) => {
    encounterMotion.zoneId = zoneId;
    encounterMotion.phase = 'approach';
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const lineKeys = LINE_KEY[zoneId];
    // Story mode: this exact tap-triggered beat still plays in full, but
    // narration (not encounter.line) owns the bubble while the tale is
    // playing -- so this simply never publishes a line in that case.
    const setLine = (name) => {
      if (story.mode !== 'playing') setEncounterLine(lineKeys[name]);
    };
    return BEAT_BUILDERS[zoneId]({ setPhase: setEncounterPhase, setLine });
  };

  useEffect(() => {
    const zoneId = encounter?.id;
    // Kolobok's own solo tap-to-sing ('kolobok') isn't a zone beat, and
    // story-driven encounters belong to StoryDirector.
    const isZoneBeat = zoneId && zoneId !== 'kolobok' && !encounter?.story && BEAT_BUILDERS[zoneId];

    if (encounter?.story) {
      // The story owns the shared encounterMotion fields now -- never
      // contest it (BACKLOG.md #10). Whatever we had queued no longer
      // applies once the story's own beat takes over.
      timelineRef.current?.cancel();
      timelineRef.current = null;
      retreatingRef.current = false;
      pendingZoneRef.current = null;
      return undefined;
    }

    if (retreatingRef.current) {
      // Already easing a previous beat back to rest -- just update what
      // (if anything) should start once that finishes; don't restart or
      // abandon the retreat already in flight.
      pendingZoneRef.current = isZoneBeat ? zoneId : null;
      return undefined;
    }

    if (!isZoneBeat) {
      if (timelineRef.current) {
        timelineRef.current.cancel();
        const fraction = currentApproachFraction();
        const retreat = buildForcedRetreat(fraction, setEncounterPhase);
        if (retreat) {
          timelineRef.current = retreat;
          retreatingRef.current = true;
        } else {
          timelineRef.current = null;
          resetEncounterMotion();
        }
      }
      pendingZoneRef.current = null;
      return undefined;
    }

    if (encounterMotion.zoneId && encounterMotion.zoneId !== zoneId) {
      // A different zone was actively animating -- ease IT back first;
      // this new tap's beat starts the instant that finishes (frame loop).
      timelineRef.current?.cancel();
      timelineRef.current = buildForcedRetreat(currentApproachFraction(), setEncounterPhase);
      retreatingRef.current = true;
      pendingZoneRef.current = zoneId;
      return undefined;
    }

    timelineRef.current?.cancel();
    timelineRef.current = startZoneBeat(zoneId);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encounter?.id, encounter?.story]);

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const tl = timelineRef.current;
    if (tl) {
      tl.tick(dt);
      if (tl.done) {
        timelineRef.current = null;
        if (retreatingRef.current) {
          retreatingRef.current = false;
          resetEncounterMotion();
          if (pendingZoneRef.current) {
            const zoneId = pendingZoneRef.current;
            pendingZoneRef.current = null;
            timelineRef.current = startZoneBeat(zoneId);
          } else {
            clearEncounter();
          }
        } else {
          resetEncounterMotion();
          clearEncounter();
        }
      }
    }

    // Interruption: a swipe past 40px total cancels the running beat
    // (ANIMATION_SPEC §4 "Interruption"). Track orbit.angle's own
    // frame-to-frame delta (not orbit.velocity, which is only nonzero
    // after a fling release) so a plain drag that's never released as a
    // fling still counts. Eases back to rest (see above) rather than
    // snapping, same as any other interruption.
    const angleStep = Math.abs(angleDelta(lastAngleRef.current, orbit.angle));
    lastAngleRef.current = orbit.angle;
    if (timelineRef.current && !retreatingRef.current) {
      swipeDistanceRef.current += angleStep * PX_PER_RADIAN;
      if (swipeDistanceRef.current > 40) {
        timelineRef.current.cancel();
        const fraction = currentApproachFraction();
        const retreat = buildForcedRetreat(fraction, setEncounterPhase);
        pendingZoneRef.current = null;
        if (retreat) {
          timelineRef.current = retreat;
          retreatingRef.current = true;
        } else {
          timelineRef.current = null;
          resetEncounterMotion();
          clearEncounter();
        }
      }
    } else if (!timelineRef.current) {
      swipeDistanceRef.current = 0;
    }
  });

  return null;
}
