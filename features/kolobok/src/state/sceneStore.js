import { create } from 'zustand';
import { detectLocale, t } from '../config/strings';

// Transient, per-frame state. Deliberately OUTSIDE the store:
// gestures write here, useFrame reads here — zero re-renders.
export const orbit = {
  angle: 0,        // current camera angle (radians)
  velocity: 0,     // radians / frame impulse from gestures
  snapTarget: null, // set to an angle to make the camera ease there (nav buttons)
  // STORY_SPEC §1 control inversion: 'user' = gestures drive orbit.angle and
  // Kolobok chases the camera; 'story' = StoryDirector drives Kolobok's
  // angle (storyMotion.kolobokAngle) and the CAMERA chases him instead.
  // CameraRig keeps writing its story-driven azimuth back into orbit.angle
  // every frame, so flipping back to 'user' mid-story hands control over
  // with zero camera jump.
  mode: 'user',
};

// STORY_SPEC §1: the story state machine's own transient (chapter index,
// play state, timers). StoryDirector owns every field; Scene3D's gesture
// handlers write interruptRequest/lastInputAt.
export const story = {
  mode: 'idle',          // 'idle' | 'playing' | 'paused' | 'off'
  chapter: 0,
  idleClock: 0,
  loopCount: 0,          // finales completed; every 4th loop replays the full birth
  playRequest: false,    // ▶ pressed (consumed by StoryDirector)
  pauseRequest: false,   // ❚❚ pressed (consumed by StoryDirector)
  interruptRequest: false, // pan > 12px during story (set by Scene3D)
  lastInputAt: 0,        // ms epoch of the last user gesture/tap
};

// Continuous per-frame values the story timelines write and Kolobok /
// CameraRig / Fox / the izba window read. Null/zero everything = "story has
// no override, behave normally".
export const storyMotion = {
  kolobokAngle: 0,       // scripted path angle ('story' drive target)
  posOverride: null,     // [x,y,z] world pos while off the path (sill, snout, arcs)
  scale: 1,              // 0 -> 1 birth pop, 1 -> 0 gulp
  faceYaw: 0,            // look-around offset on the face group
  bodyTilt: 0,           // windowsill wobble / snout balance (root z-tilt)
  spinT: 0,              // 0..1, proud/defiant 360 spin progress
  squash: 0,             // one-shot landing squash amount
  blinkBurst: 0,         // increment to request a blink (edge-detected)
  expression: null,      // 'sly'|'happy'|'startled'|'neutral'|null (edge-detected)
  noteBurstId: 0,        // increment to request 3 hum notes (road chapters)
  dustBurstId: 0,        // increment to request a 6-particle dust puff
  windowGlow: 0,         // izba window emissive boost (birth/rebirth beats)
  smokeBoost: 1,         // chimney smoke rate multiplier
  foxHeadPitch: 0,       // finale toss: fox head tilts back
  framing: null,         // {radius,height,lookAtY} per-chapter camera framing
  kolobokWorldPos: [0, 0, 0], // written by Kolobok each frame; particles spawn here
  kolobokSinging: false, // mirrored out by Kolobok so the note pool can see it
  teleportAngle: null,   // consume-once hard reset of Kolobok's path angle (finale black)
};

// Transient, per-frame encounter motion (ANIMATION_SPEC §4-5): written every
// frame by EncounterDirector's timeline, read every frame by whichever
// animal/Kolobok/CameraRig cares -- same "outside the store" reasoning as
// `orbit` (ANIMATION_SPEC.md header: "the zustand store only receives
// discrete events [...] anything that changes 60x/second stays" transient).
// `phase` here mirrors (and is authoritative moment-to-moment for) the
// store's `encounter.phase`, since the timeline updates both together.
export const encounterMotion = {
  zoneId: null,    // which zone's beat is animating right now, or null
  phase: null,     // 'approach' | 'react' | 'retreat' | null
  phaseT: 0,       // 0..1 eased progress WITHIN the current phase
  cameraPushT: 0,  // 0..1, camera orbit-radius nudge-in amount
};

// Discrete events only. Anything that changes 60x/second stays in `orbit` /
// `encounterMotion`.
export const useSceneStore = create((set, get) => ({
  activeZone: 'izba',          // zone the camera currently faces
  // encounter: { id, line, phase } | null. `phase` ('approach'|'react'|
  // 'retreat') drives each animal's `{ zone, mode }` prop per CLAUDE.md's
  // shared animal interface: mode = id!==zone.id ? 'idle' : phase==='retreat'
  // ? 'retreat' : 'encounter'.
  encounter: null,
  pendingNavigation: null,     // RN layer consumes this and routes
  locale: detectLocale(),      // 'en' | 'ru' — resolved once at store creation
  narration: null,             // story-mode narrator/dialogue line (STORY_SPEC §1)
  storyPlaying: false,         // UI reacts: pills dim to 60%, ▶ becomes ❚❚
  fadeBlack: false,            // finale gulp: RN overlay fades to black (out 300ms/in 900ms)

  setActiveZone: (id) => set({ activeZone: id }),

  // Dev override for the detected locale (docs/STRINGS.md) — every t() call
  // site reads this reactively via useSceneStore, so flipping it re-renders
  // the whole UI in the other language immediately.
  setLocale: (locale) => set({ locale }),

  // Zones never navigate (SPEC.md "Navigation" -- only the crossroads stone
  // does). No `line` here on purpose -- the bubble is timed to appear
  // partway through the beat (ANIMATION_SPEC §4: "at 400 -- Speech bubble
  // line 1"), not at the instant of the tap. EncounterDirector's timeline
  // calls setEncounterLine when the spec says the bubble should actually
  // show; this action only fires the opening beat (phase + which zone).
  startEncounter: (zone) =>
    set({ encounter: { id: zone.id, line: null, phase: 'approach' } }),

  setEncounterPhase: (phase) =>
    set((s) => (s.encounter ? { encounter: { ...s.encounter, phase } } : {})),

  setEncounterLine: (lineKey) =>
    set((s) => (s.encounter ? { encounter: { ...s.encounter, line: t(lineKey, get().locale) } } : {})),

  sing: () =>
    set({ encounter: { id: 'kolobok', line: t('song.full', get().locale), phase: null } }),

  clearEncounter: () => set({ encounter: null }),

  requestNavigation: (route) => set({ pendingNavigation: route, encounter: null }),

  consumeNavigation: () => set({ pendingNavigation: null }),

  // ----- Story mode (STORY_SPEC §1) -----
  // Story-driven encounters carry `story: true`: the animals react to them
  // identically (same mode prop), but EncounterDirector ignores them -- the
  // StoryDirector's chapter timeline is what sequences them instead. Lines
  // go through `narration`, never `encounter.line`.
  setStoryEncounter: (zoneId) =>
    set({ encounter: zoneId ? { id: zoneId, line: null, phase: 'approach', story: true } : null }),

  setStoryEncounterPhase: (phase) =>
    set((s) => (s.encounter?.story ? { encounter: { ...s.encounter, phase } } : {})),

  setNarration: (lineKey) =>
    set({ narration: lineKey ? t(lineKey, get().locale) : null }),

  setStoryPlaying: (storyPlaying) => set({ storyPlaying }),

  setFadeBlack: (fadeBlack) => set({ fadeBlack }),
}));
