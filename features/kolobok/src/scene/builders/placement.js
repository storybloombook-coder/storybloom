// placement.js — shared "scatter around the island" rule for vegetation
// (ART_SPEC §5): bias each species to its home zone's arc, let some
// fraction land anywhere, and never within keepClearDeg of a landmark.

import { ZONES, rad, angleDelta } from '../../config/zones';

/**
 * Returns `count` angles (degrees, [0,360)) biased toward `homeZoneIds`'
 * arcs, honoring the "no vegetation within `keepClearDeg` of a landmark"
 * rule. `rng` is caller-provided so each species can use its own PRNG
 * stream (see prng.js) and stay stable across reloads.
 */
export function scatterAngles(rng, count, homeZoneIds, opts = {}) {
  const { arcDeg = 36, scatterChance = 0.3, keepClearDeg = 16 } = opts;
  const angles = [];
  let attempts = 0;
  const maxAttempts = count * 60;
  while (angles.length < count && attempts < maxAttempts) {
    attempts += 1;
    let deg;
    if (homeZoneIds.length === 0 || rng() < scatterChance) {
      deg = rng() * 360;
    } else {
      const homeId = homeZoneIds[Math.floor(rng() * homeZoneIds.length)];
      const home = ZONES.find((z) => z.id === homeId);
      deg = home.angleDeg + (rng() * 2 - 1) * arcDeg;
    }
    deg = ((deg % 360) + 360) % 360;
    const angleRad = rad(deg);
    const tooCloseToLandmark = ZONES.some((z) => Math.abs(angleDelta(angleRad, rad(z.angleDeg))) < rad(keepClearDeg));
    if (tooCloseToLandmark) continue;
    angles.push(deg);
  }
  return angles;
}
