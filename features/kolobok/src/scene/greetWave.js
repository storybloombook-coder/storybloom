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
 *  own part.
 *
 *  Once triggered, the wave ALWAYS finishes its own arc -- it does not
 *  hard-reset just because the encounter ends or gets interrupted
 *  (re-tapping a different animal, a swipe past 40px both clear
 *  encounterMotion.zoneId/the store's `encounter` INSTANTLY, with no
 *  transition of their own). Force-resetting the timer the moment isMine
 *  went false used to snap the envelope from wherever it was straight to
 *  0 in a single frame; letting it keep counting up to its own natural
 *  GREET_WAVE_DURATION instead means it always eases out smoothly. */
export function tickGreetWave(s, dt, isMine, mode) {
  if (isMine && mode === 'encounter' && !s.waved) {
    s.waved = true;
    s.t = 0;
  }
  if (s.t < 0) {
    // Not currently mid-wave -- clear the latch once it's no longer this
    // animal's turn, so the NEXT encounter can trigger a fresh one.
    if (!isMine) s.waved = false;
    return 0;
  }
  s.t += dt;
  if (s.t > GREET_WAVE_DURATION) {
    // Deliberately NOT resetting s.waved here: 'encounter' mode covers both
    // the approach AND react phases (only retreat gets its own mode
    // string), which together last longer than GREET_WAVE_DURATION. If
    // this cleared the latch, the trigger check above would immediately
    // re-arm and fire a SECOND wave within the same encounter. s.waved
    // only clears above, once the encounter has genuinely ended.
    s.t = -1;
    return 0;
  }
  return Math.sin((s.t / GREET_WAVE_DURATION) * Math.PI);
}
