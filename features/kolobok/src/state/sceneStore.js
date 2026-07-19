import { create } from 'zustand';
import { detectLocale, t } from '../config/strings';

// Transient, per-frame state. Deliberately OUTSIDE the store:
// gestures write here, useFrame reads here — zero re-renders.
export const orbit = {
  angle: 0,        // current camera angle (radians)
  velocity: 0,     // radians / frame impulse from gestures
  snapTarget: null // set to an angle to make the camera ease there (nav buttons)
};

// zone id -> docs/STRINGS.md key for its encounter line. Lives here (not
// zones.js) because zones.js is pure layout/geometry data; this is a copy
// concern, same as everything else routed through t().
const ZONE_LINE_KEY = {
  izba: 'line.grandma.tap',
  hare: 'line.eat.hare',
  wolf: 'line.eat.wolf',
  bear: 'line.eat.bear',
  fox: 'line.fox.flatter',
};

// Discrete events only. Anything that changes 60x/second stays in `orbit`.
export const useSceneStore = create((set, get) => ({
  activeZone: 'izba',          // zone the camera currently faces
  encounter: null,             // { id, line, route|null } — route null = song only
  pendingNavigation: null,     // RN layer consumes this and routes
  locale: detectLocale(),      // 'en' | 'ru' — resolved once at store creation

  setActiveZone: (id) => set({ activeZone: id }),

  // Dev override for the detected locale (docs/STRINGS.md) — every t() call
  // site reads this reactively via useSceneStore, so flipping it re-renders
  // the whole UI in the other language immediately.
  setLocale: (locale) => set({ locale }),

  // Zones never navigate (SPEC.md "Navigation" -- only the crossroads stone
  // does); `route` rides along on the encounter purely as leftover data, not
  // consumed by anything since the Phase 3 navigation restructure.
  startEncounter: (zone) =>
    set({ encounter: { id: zone.id, line: t(ZONE_LINE_KEY[zone.id], get().locale), route: zone.route } }),

  sing: () =>
    set({ encounter: { id: 'kolobok', line: t('song.full', get().locale), route: null } }),

  clearEncounter: () => set({ encounter: null }),

  requestNavigation: (route) => set({ pendingNavigation: route, encounter: null }),

  consumeNavigation: () => set({ pendingNavigation: null }),
}));
