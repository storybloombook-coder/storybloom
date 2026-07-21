// wind.js — POLISH_SPEC §3: one global transient value every swaying object
// reads. A dedicated ticker (tickWind, called once from AtmosphereDirector's
// shared frame hub, same pattern as eggManager.tick) updates it each frame;
// everything else just reads `wind.strength`/`wind.direction` and computes
// its own phase offset -- no per-consumer frame loop needed for the wind
// value itself.

const GUST_PERIOD_S = 1 / 0.15; // value-noise(t * 0.15): one gust cycle ~6.7s
const DIRECTION_ROTATE_PERIOD_S = 10 * 60; // 90 deg over 10 min

const BASE_BY_WEATHER = {
  clear: 0.35, partly: 0.35, overcast: 0.35,
  fog: 0.15, rain: 0.6, snow: 0.45, storm: 0.9,
};

export const wind = {
  strength: 0.35,
  direction: [0.8, 0, 0.6], // fixed unit vector, slowly rotated
};

const state = { t: 0, dirAngle: Math.atan2(0.6, 0.8) };

/** Cheap smooth pseudo-value-noise: a couple of incommensurate sine waves
 *  summed and normalized to 0..1 -- not real Perlin, but gusts that swell
 *  and fade over several seconds rather than jittering every frame is all
 *  the spec asks for. */
function valueNoise01(t) {
  const a = Math.sin(t * 1.0);
  const b = Math.sin(t * 0.37 + 1.7);
  const c = Math.sin(t * 0.71 + 4.2);
  return 0.5 + 0.5 * ((a + b + c) / 3);
}

/** Call once per frame (AtmosphereDirector's shared hub) with the current
 *  weather state key and dt. */
export function tickWind(weatherState, dt) {
  state.t += dt;

  const base = BASE_BY_WEATHER[weatherState] ?? 0.35;
  const gust = valueNoise01(state.t * GUST_PERIOD_S * 0.15) * 0.65;
  wind.strength = base + gust * (base / 0.35) * 0.4 + gust * 0.35;
  // (base scales the gust a little too, so storms don't just add a flat
  // 0.65 on top of their already-high 0.9 base and blow the budget past 1.5)

  state.dirAngle += (Math.PI / 2 / DIRECTION_ROTATE_PERIOD_S) * dt;
  wind.direction[0] = Math.cos(state.dirAngle);
  wind.direction[2] = Math.sin(state.dirAngle);
}

/** POLISH_SPEC §3 "phase-offset rule": every swaying object's sway phase,
 *  from its world position and the current time -- this is what makes a
 *  gust visibly ROLL across the island (nearby objects share phase, distant
 *  ones lag) rather than everything swaying in lockstep. */
export function windPhase(x, z, t) {
  return (x * wind.direction[0] + z * wind.direction[2]) * 0.9 + t * 2.2;
}

export function windSway(x, z, t, amplitude) {
  return Math.sin(windPhase(x, z, t)) * amplitude * wind.strength;
}
