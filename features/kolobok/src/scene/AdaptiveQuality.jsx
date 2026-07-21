import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber/native';
import { perf } from '../config/devFlags';

const WINDOW_MS = 5000;
const TARGET_FRAME_MS = 34; // ~29fps (VISUAL_QUALITY_SPEC §4)

/** VISUAL_QUALITY_SPEC §4: mount at dpr=2.0 (set on the Canvas itself), run
 *  5s, drop to 1.5 if the rolling average frame time exceeds 34ms, re-check
 *  once more, floor at 1.25. Settles once per session -- no per-frame
 *  thrashing -- and logs the final choice behind the `perf.hud` dev flag.
 *  Mount once, inside the Canvas (renders nothing itself). */
export function AdaptiveQuality() {
  const setDpr = useThree((s) => s.setDpr);
  const state = useRef({ phase: 0, elapsedMs: 0, frames: 0, totalMs: 0, done: false });

  useFrame((_, delta) => {
    const s = state.current;
    if (s.done) return;
    const dtMs = Number.isFinite(delta) ? delta * 1000 : 1000 / 60;
    s.elapsedMs += dtMs;
    s.frames += 1;
    s.totalMs += dtMs;
    if (s.elapsedMs < WINDOW_MS) return;

    const avgMs = s.totalMs / Math.max(1, s.frames);
    if (s.phase === 0) {
      if (avgMs > TARGET_FRAME_MS) {
        setDpr(1.5);
        s.phase = 1;
        s.elapsedMs = 0; s.frames = 0; s.totalMs = 0;
      } else {
        s.done = true;
        if (perf.hud) console.log(`[kolobok] adaptive dpr settled at 2.0 (avg ${avgMs.toFixed(1)}ms)`);
      }
    } else {
      const finalDpr = avgMs > TARGET_FRAME_MS ? 1.25 : 1.5;
      if (finalDpr !== 1.5) setDpr(finalDpr);
      s.done = true;
      if (perf.hud) console.log(`[kolobok] adaptive dpr settled at ${finalDpr} (avg ${avgMs.toFixed(1)}ms)`);
    }
  });

  return null;
}
