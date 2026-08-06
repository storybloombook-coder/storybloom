// useZoneFrame.js — per-frame work that costs less when you aren't looking
// at it.
//
// The scene is an island you orbit, with five zones around it. Only one is
// faced at a time, but every zone's useFrame ran at full rate anyway:
// butterflies wandering, wisps drifting, crows circling, all being integrated
// sixty times a second behind the camera. Measurement earlier put this scene
// firmly on the JS thread, not the GPU — removing 18k triangles changed
// nothing — so this per-frame arithmetic is what the phone is actually
// getting hot doing.
//
// Zones that aren't faced are NOT skipped, because "not the active zone"
// doesn't mean "off screen" on an island you can see across. They're stepped
// less often instead, with the skipped time handed over as one larger delta —
// so a butterfly crosses the same distance in the same wall-clock time, just
// drawn at a coarser temporal resolution while it's far away. Nothing drifts
// out of sync, because every callback here already integrates by delta rather
// than counting frames.
//
// Use exactly like useFrame; pass whether this zone is the one being faced.

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';

/** Step an unfaced zone once every this many frames. 3 keeps distant motion
 *  clearly continuous (20Hz) while cutting two thirds of its cost. */
export const INACTIVE_FRAME_STRIDE = 3;

/** Longest delta any callback will be handed, matching the clamp the scene's
 *  own callbacks already use — a backgrounded app resuming must not deliver
 *  one enormous step. */
const MAX_DELTA = 1 / 30;

export function useZoneFrame(isActiveZone, callback, renderPriority) {
  // Time accumulated across skipped frames, paid out on the frame that runs.
  const pending = useRef(0);
  const since = useRef(0);

  useFrame((state, delta) => {
    const dt = Number.isFinite(delta) ? delta : 1 / 60;
    if (isActiveZone) {
      // Anything banked while this zone was in the background is spent now,
      // so becoming active can't teleport its animations forward.
      pending.current = 0;
      since.current = 0;
      callback(state, Math.min(dt, MAX_DELTA));
      return;
    }
    pending.current += dt;
    since.current += 1;
    if (since.current < INACTIVE_FRAME_STRIDE) return;
    const owed = pending.current;
    pending.current = 0;
    since.current = 0;
    callback(state, Math.min(owed, MAX_DELTA));
  }, renderPriority);
}
