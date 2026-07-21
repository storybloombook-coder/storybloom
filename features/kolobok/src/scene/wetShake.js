// wetShake.js — BACKLOG.md #1: animals shake themselves dry while it's
// raining/snowing on them. Shared across Bear/Fox/Hare/Wolf since the
// timer/trigger logic is identical for all four -- only where the result
// gets applied (which rotation field) differs per animal's own rig.

import { atmosphereLive } from '../state/sceneStore';

export const WET_SHAKE_DURATION_MS = 650;
export const WET_SHAKE_HZ = 7;
export const WET_SHAKE_AMPLITUDE = (12 * Math.PI) / 180;

const WET_THRESHOLD = 0.3;

export function isWet() {
  return atmosphereLive.rainT > WET_THRESHOLD || atmosphereLive.snowT > WET_THRESHOLD;
}

/** Fresh per-animal state; stash this in the animal's own `useRef`. Random
 *  initial `nextIn` staggers animals so they don't all shake in lockstep. */
export function initWetShakeState() {
  return { nextIn: 5 + Math.random() * 10, t: -1 };
}

/** Call once per frame (idle only -- a shake mid-encounter would look
 *  wrong). Advances `s` in place and returns the current rotation
 *  contribution (0 when not shaking) to add to whichever axis reads as
 *  "shiver" for that animal's rig. */
export function tickWetShake(s, dt, idle) {
  if (idle && s.t < 0 && isWet()) {
    s.nextIn -= dt;
    if (s.nextIn <= 0) { s.t = 0; s.nextIn = 8 + Math.random() * 7; }
  } else if (s.t >= 0) {
    s.t += dt * 1000;
    if (s.t > WET_SHAKE_DURATION_MS) s.t = -1;
  }
  if (s.t < 0) return 0;
  const decay = 1 - s.t / WET_SHAKE_DURATION_MS;
  return Math.sin((s.t / 1000) * WET_SHAKE_HZ * Math.PI * 2) * WET_SHAKE_AMPLITUDE * decay;
}
