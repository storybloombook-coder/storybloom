import { useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import { perf } from '../config/devFlags';

const WINDOW_MS = 5000;
const TARGET_FRAME_MS = 34; // ~29fps, the VISUAL_QUALITY_SPEC §4 floor

/** Rolling frame-time logger, behind the `perf.hud` dev flag. Renders
 *  nothing and changes nothing -- it only measures.
 *
 *  This replaces the old AdaptiveQuality, which drove `setDpr` at runtime.
 *  That was removed outright after live feedback: "I see how the resolution
 *  switches sometimes and this is not good at all... and with the resolution
 *  change the tap area shrinks and there are missclicks." Every switch
 *  reallocated the GL drawing buffer -- a visible pop, plus the scene's
 *  raycast targets reprojecting under the user's finger mid-session. Render
 *  resolution is now a single fixed value chosen at mount (Scene3D's
 *  RENDER_DPR), so nothing can move it.
 *
 *  Keeping the measurement is still worth it: it's how we find out WHICH
 *  moments dip below 30fps, which is the input to any real optimisation
 *  (cheaper materials, fewer draw calls, culling) rather than trading
 *  resolution away reactively. Mount once, inside the Canvas. */
export function FrameTimeProbe() {
  const state = useRef({ elapsedMs: 0, frames: 0, totalMs: 0, worstMs: 0 });

  useFrame((_, delta) => {
    if (!perf.hud) return;
    const s = state.current;
    const dtMs = Number.isFinite(delta) ? delta * 1000 : 1000 / 60;
    s.elapsedMs += dtMs;
    s.frames += 1;
    s.totalMs += dtMs;
    if (dtMs > s.worstMs) s.worstMs = dtMs;
    if (s.elapsedMs < WINDOW_MS) return;

    const avgMs = s.totalMs / Math.max(1, s.frames);
    // Worst frame is reported alongside the average because a scene that
    // averages fine but spikes to 80ms is exactly what "laggy sometimes"
    // feels like -- an average alone hides it.
    const flag = avgMs > TARGET_FRAME_MS ? ' SLOW' : '';
    console.log(
      `[kolobok] frame avg ${avgMs.toFixed(1)}ms (${(1000 / avgMs).toFixed(0)}fps), `
      + `worst ${s.worstMs.toFixed(0)}ms, ${s.frames} frames${flag}`,
    );
    s.elapsedMs = 0; s.frames = 0; s.totalMs = 0; s.worstMs = 0;
  });

  return null;
}
