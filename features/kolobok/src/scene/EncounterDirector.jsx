import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import * as Haptics from 'expo-haptics';
import { orbit, encounterMotion, useSceneStore } from '../state/sceneStore';
import { angleDelta } from '../config/zones';
import {
  buildSharedBeat, buildFoxBeat, buildIzbaBeat, resetEncounterMotion,
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
 *  the current one, or a > 40px swipe all cancel and snap back to idle. */
export function EncounterDirector() {
  const encounter = useSceneStore((s) => s.encounter);
  const setEncounterPhase = useSceneStore((s) => s.setEncounterPhase);
  const setEncounterLine = useSceneStore((s) => s.setEncounterLine);
  const clearEncounter = useSceneStore((s) => s.clearEncounter);

  const timelineRef = useRef(null);
  const swipeDistanceRef = useRef(0);
  const lastAngleRef = useRef(orbit.angle);

  useEffect(() => {
    const zoneId = encounter?.id;
    // Kolobok's own solo tap-to-sing ('kolobok') isn't a zone beat, and
    // story-driven encounters belong to StoryDirector.
    const isZoneBeat = zoneId && zoneId !== 'kolobok' && !encounter?.story && BEAT_BUILDERS[zoneId];

    if (!isZoneBeat) {
      if (timelineRef.current) {
        timelineRef.current.cancel();
        timelineRef.current = null;
        // Only reset the shared motion if the story isn't the one now
        // driving it (a story encounter replacing an interactive one).
        if (!encounter?.story) resetEncounterMotion();
      }
      return undefined;
    }

    // A tap on a different zone mid-beat starts a new one -- explicitly
    // cancel whatever was running first rather than just overwriting the
    // ref (functionally near-identical since an orphaned timeline stops
    // being ticked either way, but explicit beats implicit).
    if (timelineRef.current) timelineRef.current.cancel();
    encounterMotion.zoneId = zoneId;
    encounterMotion.phase = 'approach';
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const lineKeys = LINE_KEY[zoneId];
    const setLine = (name) => setEncounterLine(lineKeys[name]);
    timelineRef.current = BEAT_BUILDERS[zoneId]({ setPhase: setEncounterPhase, setLine });

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
        resetEncounterMotion();
        clearEncounter();
      }
    }

    // Interruption: a swipe past 40px total cancels the running beat
    // (ANIMATION_SPEC §4 "Interruption"). Track orbit.angle's own
    // frame-to-frame delta (not orbit.velocity, which is only nonzero
    // after a fling release) so a plain drag that's never released as a
    // fling still counts.
    const angleStep = Math.abs(angleDelta(lastAngleRef.current, orbit.angle));
    lastAngleRef.current = orbit.angle;
    if (timelineRef.current) {
      swipeDistanceRef.current += angleStep * PX_PER_RADIAN;
      if (swipeDistanceRef.current > 40) {
        timelineRef.current.cancel();
        timelineRef.current = null;
        resetEncounterMotion();
        clearEncounter();
      }
    } else {
      swipeDistanceRef.current = 0;
    }
  });

  return null;
}
