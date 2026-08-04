import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber/native';
import { perf } from '../config/devFlags';

const WINDOW_MS = 5000;
const TARGET_FRAME_MS = 34;  // ~29fps (VISUAL_QUALITY_SPEC §4)
// Hysteresis: only climb back up when there's real headroom, so a scene
// hovering right at the threshold can't oscillate between two dpr values
// every window (each switch reallocates the drawing buffer -- visibly
// hitchy, and the thrash itself would cost more than either setting).
const COMFORT_FRAME_MS = 22; // ~45fps

const DPR_LADDER = [1.25, 1.5, 2.0];
const START_INDEX = DPR_LADDER.length - 1;

// A dpr change reallocates the GL drawing buffer, which itself drops a
// frame or two -- ignore the window immediately after a switch so that cost
// isn't measured as if it were the new setting's steady-state performance.
const SETTLE_MS = 1200;

/** VISUAL_QUALITY_SPEC §4: mount at dpr 2.0 and step down toward 1.25 when
 *  the rolling average frame time can't hold ~29fps.
 *
 *  Live feedback: "the 3D scene feels laggy sometimes." This used to take a
 *  single 5s sample and then set done=true forever. Two problems with that:
 *  the one measurement window lands entirely inside CameraRig's 12s static
 *  intro hold (the cheapest stretch of the whole session -- fixed camera,
 *  Kolobok not yet rolling), so it almost always concluded 2.0 was fine;
 *  and having concluded that, it could never react to the scene actually
 *  getting heavier later (encounters, weather, particle bursts). "Laggy
 *  SOMETIMES" is exactly the shape of a quality level chosen during a calm
 *  moment and then locked in through the busy ones.
 *
 *  Now it keeps sampling for the whole session and can move both ways, with
 *  hysteresis + a post-switch settle window so it converges instead of
 *  oscillating. Mount once, inside the Canvas (renders nothing itself). */
export function AdaptiveQuality() {
  const setDpr = useThree((s) => s.setDpr);
  const state = useRef({
    index: START_INDEX, elapsedMs: 0, frames: 0, totalMs: 0, settleMs: 0,
  });

  useFrame((_, delta) => {
    const s = state.current;
    const dtMs = Number.isFinite(delta) ? delta * 1000 : 1000 / 60;

    // Swallow the reallocation hitch right after a switch.
    if (s.settleMs > 0) {
      s.settleMs -= dtMs;
      if (s.settleMs <= 0) { s.elapsedMs = 0; s.frames = 0; s.totalMs = 0; }
      return;
    }

    s.elapsedMs += dtMs;
    s.frames += 1;
    s.totalMs += dtMs;
    if (s.elapsedMs < WINDOW_MS) return;

    const avgMs = s.totalMs / Math.max(1, s.frames);
    let next = s.index;
    if (avgMs > TARGET_FRAME_MS) next = Math.max(0, s.index - 1);
    else if (avgMs < COMFORT_FRAME_MS) next = Math.min(DPR_LADDER.length - 1, s.index + 1);

    if (next !== s.index) {
      s.index = next;
      setDpr(DPR_LADDER[next]);
      s.settleMs = SETTLE_MS;
      if (perf.hud) {
        console.log(`[kolobok] adaptive dpr -> ${DPR_LADDER[next]} (avg ${avgMs.toFixed(1)}ms over ${s.frames} frames)`);
      }
      return;
    }

    if (perf.hud) {
      console.log(`[kolobok] adaptive dpr holding ${DPR_LADDER[s.index]} (avg ${avgMs.toFixed(1)}ms, ${(1000 / avgMs).toFixed(0)}fps)`);
    }
    s.elapsedMs = 0; s.frames = 0; s.totalMs = 0;
  });

  return null;
}
