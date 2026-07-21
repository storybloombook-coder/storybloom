// atmosphere.js — time-of-day palette tables (ART_SPEC §8 + WEATHER_SPEC §1's
// sunrise/sunset rows). Pure data + tiny pure helpers only: nothing here
// touches the scene yet -- consumers (sky dome, lighting, fog) arrive in
// later phases (ART_SPEC §7, WEATHER_SPEC).
//
// WEATHER_SPEC.md supersedes the fixed hour table below as the actual
// DRIVER once location is available (real solar elevation selects/blends
// these rows instead). The hour table remains the fallback when it isn't.

// POLISH_SPEC §2 per-phase fog near/far (weather states still override on
// top via AtmosphereDirector's ramp blend -- these are the "clear" baseline).
export const PALETTES = {
  morning: {
    zenith: '#a8cfe4', horizon: '#f4dfc0', dirLight: '#fff2dd', dirInt: 1.0, ambient: 0.65, fog: '#e4ded2', window: 0, fogNear: 13, fogFar: 26,
  },
  day: {
    zenith: '#8ec4e0', horizon: '#cfe8f2', dirLight: '#ffffff', dirInt: 1.1, ambient: 0.70, fog: '#bfe3f2', window: 0, fogNear: 17, fogFar: 32,
  },
  evening: {
    zenith: '#7a86b8', horizon: '#f0b57e', dirLight: '#ffcf9e', dirInt: 0.9, ambient: 0.55, fog: '#e0b394', window: 0.8, fogNear: 14, fogFar: 27,
  },
  night: {
    zenith: '#141b33', horizon: '#2c3555', dirLight: '#7d8fc4', dirInt: 0.35, ambient: 0.30, fog: '#1c2440', window: 1.4, fogNear: 12, fogFar: 24,
  },
  // Twilight blend rows (WEATHER_SPEC §1) -- no `window` value specified
  // there; 0 matches their day-adjacent character (glow is a night/evening
  // thing only).
  sunrise: {
    zenith: '#8fa0c8', horizon: '#f2b98a', dirLight: '#ffd9b0', dirInt: 0.7, ambient: 0.45, fog: '#d8b9a0', window: 0, fogNear: 12, fogFar: 24,
  },
  sunset: {
    zenith: '#6f74a8', horizon: '#f09a6a', dirLight: '#ffb886', dirInt: 0.7, ambient: 0.45, fog: '#d09a84', window: 0, fogNear: 12, fogFar: 24,
  },
};

// Device-hour fallback bands (ART_SPEC §8), used until WEATHER_SPEC's solar
// elevation takes over. Ranges are [start, end) in local hour-of-day;
// `night` wraps past midnight.
const HOUR_BANDS = [
  { phase: 'morning', start: 5, end: 10 },
  { phase: 'day', start: 10, end: 17 },
  { phase: 'evening', start: 17, end: 21 },
];

/** Device-hour -> palette phase (fallback driver; see file header). */
export function phaseForHour(hour) {
  const band = HOUR_BANDS.find((b) => hour >= b.start && hour < b.end);
  return band ? band.phase : 'night';
}

// Dev override hook (ART_SPEC §8: "implement that override for testing").
// A transient object in the same spirit as sceneStore's `orbit` -- not
// React state, just a mutable field consumers check first.
export const atmosphere = {
  forcePhase: null, // set to any PALETTES key to pin the phase for testing
};

/** The phase to render right now: forced override, else the hour fallback. */
export function currentPhase(date = new Date()) {
  return atmosphere.forcePhase ?? phaseForHour(date.getHours());
}
