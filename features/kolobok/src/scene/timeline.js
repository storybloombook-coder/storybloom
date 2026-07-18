// timeline.js — tiny sequencer for encounter/story beats (ANIMATION_SPEC §1).
// No dependencies, no Three.js imports: this file must stay testable in
// plain node (see __tests__/timeline.test.js).
//
//   const tl = createTimeline([
//     { at: 0,    dur: 400, ease: 'easeOutCubic', update: (t) => {...} },
//     { at: 400,  call: () => {...} },            // fire-once event
//     { at: 1200, dur: 600, ease: 'easeInOutSine', update: (t) => {...} },
//   ]);
//   tl.tick(deltaSeconds); tl.done; tl.cancel();

export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

// Overshoot 1.4 (gentler than the standard 1.70158) — a softer, cozier pop
// than the usual UI "back" ease, matching the storybook tone.
export function easeOutBack(t) {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

const EASINGS = { easeOutCubic, easeInOutSine, easeOutBack };
const linear = (t) => t;

/**
 * @typedef {Object} TimelineStep
 * @property {number} at - step start time, ms, relative to timeline start.
 * @property {number} [dur] - step duration, ms. Omit for a fire-once `call` step.
 * @property {keyof typeof EASINGS} [ease] - easing name; defaults to linear.
 * @property {(t: number) => void} [update] - called every tick while active,
 *   with eased local progress 0..1. Called one final time at t=1, then not again.
 * @property {() => void} [call] - fires exactly once when `at` is reached.
 */

/** @param {TimelineStep[]} steps */
export function createTimeline(steps) {
  // Defensive sort — every spec table lists steps in `at` order already, but
  // tick() below assumes it.
  const ordered = [...steps].sort((a, b) => a.at - b.at);
  const settled = new Array(ordered.length).fill(false); // update steps: reached t=1; call steps: fired
  let elapsedMs = 0;
  let cancelled = false;

  const endMs = ordered.reduce((max, s) => Math.max(max, s.at + (s.dur ?? 0)), 0);

  const timeline = {
    done: ordered.length === 0,
    tick(deltaSeconds) {
      if (cancelled || timeline.done) return;
      elapsedMs += deltaSeconds * 1000;

      for (let i = 0; i < ordered.length; i++) {
        if (settled[i] || elapsedMs < ordered[i].at) continue;
        const step = ordered[i];

        if (step.call) {
          settled[i] = true;
          step.call();
          continue;
        }

        if (step.update) {
          const dur = step.dur ?? 0;
          const raw = dur > 0 ? Math.min(1, (elapsedMs - step.at) / dur) : 1;
          const ease = EASINGS[step.ease] ?? linear;
          step.update(ease(raw));
          if (raw >= 1) settled[i] = true;
        }
      }

      if (elapsedMs >= endMs) timeline.done = true;
    },
    // Stops immediately WITHOUT jumping any step to its end state — callers
    // return actors to idle themselves (see each character's returnToIdle).
    cancel() {
      cancelled = true;
      timeline.done = true;
    },
  };

  return timeline;
}
