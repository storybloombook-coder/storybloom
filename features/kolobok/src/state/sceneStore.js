import { create } from 'zustand';
import { detectLocale, t } from '../config/strings';

// Transient, per-frame state. Deliberately OUTSIDE the store:
// gestures write here, useFrame reads here — zero re-renders.
export const orbit = {
  angle: 0,        // current camera angle (radians)
  velocity: 0,     // radians / frame impulse from gestures
  snapTarget: null // set to an angle to make the camera ease there (nav buttons)
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
}));
