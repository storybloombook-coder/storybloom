import { create } from 'zustand';
import { ENCOUNTER_LINES, SONG } from '../config/zones';
import { detectLocale } from '../config/strings';

// Transient, per-frame state. Deliberately OUTSIDE the store:
// gestures write here, useFrame reads here — zero re-renders.
export const orbit = {
  angle: 0,        // current camera angle (radians)
  velocity: 0,     // radians / frame impulse from gestures
  snapTarget: null // set to an angle to make the camera ease there (nav buttons)
};

// Discrete events only. Anything that changes 60x/second stays in `orbit`.
export const useSceneStore = create((set) => ({
  activeZone: 'izba',          // zone the camera currently faces
  encounter: null,             // { id, line, route|null } — route null = song only
  pendingNavigation: null,     // RN layer consumes this and routes
  locale: detectLocale(),      // 'en' | 'ru' — resolved once at store creation

  setActiveZone: (id) => set({ activeZone: id }),

  // Dev override for the detected locale (docs/STRINGS.md) — every t() call
  // site reads this reactively via useSceneStore, so flipping it re-renders
  // the whole UI in the other language immediately.
  setLocale: (locale) => set({ locale }),

  startEncounter: (zone) =>
    set({ encounter: { id: zone.id, line: ENCOUNTER_LINES[zone.id], route: zone.route } }),

  sing: () =>
    set({ encounter: { id: 'kolobok', line: SONG, route: null } }),

  clearEncounter: () => set({ encounter: null }),

  requestNavigation: (route) => set({ pendingNavigation: route, encounter: null }),

  consumeNavigation: () => set({ pendingNavigation: null }),
}));
