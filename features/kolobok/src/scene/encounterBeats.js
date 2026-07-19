// encounterBeats.js — the encounter beat structures from ANIMATION_SPEC
// §4/§5/§9, shared between the interactive path (EncounterDirector,
// timeScale 1, lines -> encounter.line) and story mode (StoryDirector's
// chapters 2/4/6/8, timeScale 1.45 per STORY_SPEC §3, lines -> narration).
// Both write the same transient `encounterMotion` fields, so the animals'
// own useFrame reactions are identical in either mode.

import { encounterMotion } from '../state/sceneStore';
import { createTimeline } from './timeline';

/** Shared hare/wolf/bear beat (ANIMATION_SPEC §4). `setLine(name)` receives
 *  'eat' | 'song'; `timeScale` stretches every at/dur (STORY_SPEC §3:
 *  "multiply all at/dur by 1.45 so the beat breathes at cinematic pace"). */
export function buildSharedBeat({ setPhase, setLine, timeScale = 1 }) {
  const s = (ms) => ms * timeScale;
  return createTimeline([
    { at: 0, dur: s(400), ease: 'easeOutCubic', update: (v) => { encounterMotion.phaseT = v; encounterMotion.cameraPushT = v; } },
    { at: 0, call: () => setPhase('approach') },
    { at: s(400), call: () => setLine('eat') },
    { at: s(1300), dur: s(700), ease: 'easeInOutSine', update: (v) => { encounterMotion.spinT = v; } },
    { at: s(1300), call: () => { encounterMotion.singing = true; setLine('song'); } },
    { at: s(2000), call: () => { encounterMotion.singing = false; } },
    { at: s(2600), dur: s(400), update: (v) => { encounterMotion.phase = 'react'; encounterMotion.phaseT = v; } },
    { at: s(2600), call: () => setPhase('react') },
    { at: s(3000), dur: s(300), update: (v) => { encounterMotion.phase = 'retreat'; encounterMotion.phaseT = v; encounterMotion.cameraPushT = 1 - v; } },
    { at: s(3000), call: () => setPhase('retreat') },
    { at: s(3300), call: () => {} },
  ]);
}

/** Fox's interactive beat (ANIMATION_SPEC §5): she flatters, never lunges.
 *  (The story finale is NOT this stretched -- it's its own §3-chapter-8
 *  script in storyChapters.js; this stays interactive-only.) */
export function buildFoxBeat({ setPhase, setLine }) {
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

/** Izba's tap beat (ANIMATION_SPEC §9): a house can't step. */
export function buildIzbaBeat({ setPhase, setLine }) {
  return createTimeline([
    { at: 0, call: () => { setPhase('approach'); setLine('grandma'); encounterMotion.smokeBurst = true; encounterMotion.windowFlash = true; } },
    { at: 1400, call: () => {} },
  ]);
}

/** Resets every encounterMotion field to its idle value. Shared by both
 *  directors' cancel/finish paths. */
export function resetEncounterMotion() {
  encounterMotion.zoneId = null;
  encounterMotion.phase = null;
  encounterMotion.phaseT = 0;
  encounterMotion.cameraPushT = 0;
  encounterMotion.spinT = 0;
  encounterMotion.singing = false;
  encounterMotion.leanSpringT = 0;
  encounterMotion.smokeBurst = false;
  encounterMotion.windowFlash = false;
}
