import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber/native';
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
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  // auditMs is its OWN accumulator, not elapsedMs: the timing callback below
  // resets elapsedMs every 5s window, so it never reaches an 8s threshold.
  const state = useRef({ elapsedMs: 0, frames: 0, totalMs: 0, worstMs: 0, auditMs: 0, audited: false });

  // One-shot scene audit ~8s in (late enough that everything has mounted).
  // Aggregate counters say the budget is blown; this says BY WHAT, which is
  // the difference between a targeted fix and rewriting the whole scene.
  useFrame((_, delta) => {
    const s = state.current;
    if (!perf.hud || s.audited) return;
    s.auditMs += Number.isFinite(delta) ? delta * 1000 : 1000 / 60;
    if (s.auditMs < 8000) return;
    s.audited = true;
    const rows = [];
    scene.traverse((obj) => {
      const geo = obj.geometry;
      if (!obj.visible || !geo) return;
      const idx = geo.index ? geo.index.count : (geo.attributes?.position?.count ?? 0);
      const instances = obj.isInstancedMesh ? obj.count : 1;
      rows.push({
        name: obj.name || obj.type,
        tris: Math.round((idx / 3) * instances),
        instances,
      });
    });
    rows.sort((a, b) => b.tris - a.tris);
    const total = rows.reduce((sum, r) => sum + r.tris, 0);
    console.log(`[kolobok] AUDIT ${rows.length} visible meshes, ${total} tris total`);
    rows.slice(0, 18).forEach((r, i) => {
      console.log(`[kolobok] AUDIT #${i + 1} ${r.name} = ${r.tris} tris (x${r.instances})`);
    });
  });

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
    // Renderer counters alongside the timing: they're what separates "the
    // GPU is doing too much" (calls/triangles over CLAUDE.md's 40/50k
    // budget) from "the JS thread is the bottleneck" (budget fine, frames
    // still slow). Guessing between those two wastes an optimisation pass.
    // three.js resets info at the start of each render, so in a useFrame
    // callback these describe the PREVIOUS frame -- fine for a 5s average.
    const r = gl?.info?.render;
    const m = gl?.info?.memory;
    const counts = r
      ? ` | calls ${r.calls}, tris ${r.triangles}, geom ${m?.geometries ?? '?'},`
        + ` tex ${m?.textures ?? '?'}, prog ${gl.info.programs?.length ?? '?'}`
      : '';
    console.log(
      `[kolobok] frame avg ${avgMs.toFixed(1)}ms (${(1000 / avgMs).toFixed(0)}fps), `
      + `worst ${s.worstMs.toFixed(0)}ms, ${s.frames} frames${flag}${counts}`,
    );
    s.elapsedMs = 0; s.frames = 0; s.totalMs = 0; s.worstMs = 0;
  });

  return null;
}
