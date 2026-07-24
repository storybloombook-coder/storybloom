// greetWave.js — live feedback: tapping an animal makes it wave hello
// (Bear: arm, Hare: ears, Wolf/Fox: tail). Shared across all four exactly
// like wetShake.js -- the timer/trigger logic is identical, only which rig
// part it drives (and that part's own amplitude/Hz) differs per animal.

export const GREET_WAVE_DURATION = 2.6; // seconds ("2-3 seconds", live feedback)

/** Fresh per-animal state; stash in the animal's own useRef. */
export function initGreetWaveState() {
  return { waved: false, t: -1 };
}

/** Call once per frame with this animal's own isMine/mode (the same values
 *  already computed for the approach/react motion). Triggers once per
 *  encounter -- the instant it becomes this animal's turn -- and runs for a
 *  fixed GREET_WAVE_DURATION regardless of how fast the shared beat's own
 *  approach/react phases proceed underneath (that beat's phases are much
 *  shorter than "2-3 seconds"). Returns a 0..1 rise-and-fall envelope;
 *  multiply by whatever amplitude/Hz wiggle reads right for that animal's
 *  own part. Resets (so it can fire again) once the encounter moves on. */
export function tickGreetWave(s, dt, isMine, mode) {
  if (isMine && mode === 'encounter') {
    if (!s.waved) { s.waved = true; s.t = 0; }
  } else if (!isMine) {
    s.waved = false;
    s.t = -1;
  }
  if (s.t < 0) return 0;
  s.t += dt;
  if (s.t > GREET_WAVE_DURATION) { s.t = -1; return 0; }
  return Math.sin((s.t / GREET_WAVE_DURATION) * Math.PI);
}
