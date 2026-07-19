import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import * as Haptics from 'expo-haptics';
import { orbit, encounterMotion, useSceneStore } from '../state/sceneStore';
import { angleDelta } from '../config/zones';
import { createTimeline } from './timeline';

// Inverse of Scene3D's SWIPE_SENSITIVITY (px -> radians), so orbit.angle's
// own frame-to-frame delta can be read back out as an approximate pixel
// distance. Reading orbit.angle itself (rather than orbit.velocity, which
// is only set on gesture release for fling momentum) catches a plain drag
// that never turns into a fling too.
const PX_PER_RADIAN = 1 / 0.005;

// ANIMATION_SPEC §4: shared hare/wolf/bear beat structure (ms).
function sharedBeatTimeline({ setPhase, setLine }) {
  return createTimeline([
    { at: 0, dur: 400, ease: 'easeOutCubic', update: (v) => { encounterMotion.phaseT = v; encounterMotion.cameraPushT = v; } },
    { at: 0, call: () => setPhase('approach') },
    { at: 400, call: () => setLine('eat') },
    { at: 1300, dur: 700, ease: 'easeInOutSine', update: (v) => { encounterMotion.spinT = v; } },
    { at: 1300, call: () => { encounterMotion.singing = true; setLine('song'); } },
    { at: 2000, call: () => { encounterMotion.singing = false; } },
    { at: 2600, dur: 400, update: (v) => { encounterMotion.phase = 'react'; encounterMotion.phaseT = v; } },
    { at: 2600, call: () => setPhase('react') },
    { at: 3000, dur: 300, update: (v) => { encounterMotion.phase = 'retreat'; encounterMotion.phaseT = v; encounterMotion.cameraPushT = 1 - v; } },
    { at: 3000, call: () => setPhase('retreat') },
    { at: 3300, call: () => {} },
  ]);
}

// ANIMATION_SPEC §5: fox flatters, never lunges -- distinct structure/timing.
function foxBeatTimeline({ setPhase, setLine }) {
  return createTimeline([
    { at: 0, dur: 500, ease: 'easeInOutSine', update: (v) => { encounterMotion.phaseT = v; encounterMotion.cameraPushT = v * 0.7; } },
    { at: 0, call: () => setPhase('approach') },
    { at: 500, call: () => setLine('flatter') },
    { at: 1500, dur: 600, ease: 'easeOutBack', update: (v) => { encounterMotion.leanSpringT = v; } },
    { at: 2000, dur: 600, ease: 'easeInOutSine', update: (v) => { encounterMotion.spinT = v; } },
    { at: 2400, call: () => setLine('song') },
    { at: 3100, dur: 400, update: (v) => { encounterMotion.phase = 'react'; encounterMotion.phaseT = v; } },
    { at: 3100, call: () => setPhase('react') },
    { at: 3500, call: () => {} },
  ]);
}

// ANIMATION_SPEC §9 "Izba tap beat": a house can't step, so this skips the
// approach/react/retreat structure entirely -- smoke burst, window flash,
// bubble, Kolobok's sly "caught sneaking out" brows, done at 1400ms.
function izbaBeatTimeline({ setPhase, setLine }) {
  return createTimeline([
    { at: 0, call: () => { setPhase('approach'); setLine('grandma'); encounterMotion.smokeBurst = true; encounterMotion.windowFlash = true; } },
    { at: 1400, call: () => {} },
  ]);
}

const BEAT_BUILDERS = {
  izba: izbaBeatTimeline,
  hare: sharedBeatTimeline,
  wolf: sharedBeatTimeline,
  bear: sharedBeatTimeline,
  fox: foxBeatTimeline,
};

const LINE_KEY = {
  izba: { grandma: 'line.grandma.tap' },
  hare: { eat: 'line.eat.hare', song: 'song.full' },
  wolf: { eat: 'line.eat.wolf', song: 'song.full' },
  bear: { eat: 'line.eat.bear', song: 'song.full' },
  fox: { flatter: 'line.fox.flatter', song: 'song.full' },
};

/** Owns every zone-tap encounter beat (ANIMATION_SPEC §4/§5/§9): sequences
 *  the timeline, writes continuous values into the transient
 *  `encounterMotion` object every frame (read by Kolobok + the tapped
 *  animal in their own useFrame), and fires the small set of discrete store
 *  updates (phase, line) the timeline calls for. Interruptible: starting a
 *  different encounter, clearing the current one, or a > 40px swipe all
 *  cancel the running timeline and snap everything back to idle. */
export function EncounterDirector() {
  const encounter = useSceneStore((s) => s.encounter);
  const setEncounterPhase = useSceneStore((s) => s.setEncounterPhase);
  const setEncounterLine = useSceneStore((s) => s.setEncounterLine);
  const clearEncounter = useSceneStore((s) => s.clearEncounter);

  const timelineRef = useRef(null);
  const swipeDistanceRef = useRef(0);
  const lastAngleRef = useRef(orbit.angle);

  const resetMotion = () => {
    encounterMotion.zoneId = null;
    encounterMotion.phase = null;
    encounterMotion.phaseT = 0;
    encounterMotion.cameraPushT = 0;
    encounterMotion.spinT = 0;
    encounterMotion.singing = false;
    encounterMotion.leanSpringT = 0;
    encounterMotion.smokeBurst = false;
    encounterMotion.windowFlash = false;
  };

  useEffect(() => {
    const zoneId = encounter?.id;
    // Kolobok's own solo tap-to-sing ('kolobok') isn't a zone beat.
    const isZoneBeat = zoneId && zoneId !== 'kolobok' && BEAT_BUILDERS[zoneId];

    if (!isZoneBeat) {
      if (timelineRef.current) {
        timelineRef.current.cancel();
        timelineRef.current = null;
        resetMotion();
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
  }, [encounter?.id]);

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const tl = timelineRef.current;
    if (tl) {
      tl.tick(dt);
      if (tl.done) {
        timelineRef.current = null;
        resetMotion();
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
        resetMotion();
        clearEncounter();
      }
    } else {
      swipeDistanceRef.current = 0;
    }
  });

  return null;
}
