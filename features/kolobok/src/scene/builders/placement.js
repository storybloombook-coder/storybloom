// placement.js — shared "scatter around the island" rule for vegetation
// (ART_SPEC §5): bias each species to its home zone's arc, let some
// fraction land anywhere, and never within keepClearDeg of a landmark.

import { ZONES, rad, angleDelta, pointOnCircle } from '../../config/zones';

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

/**
 * Like the birch/spruce plant lists `scatterAngles` used to feed, but rolls
 * angle+radius+scale as ONE candidate and rejects it if its canopy would
 * overlap an already-placed tree -- angle-only spacing (the old approach)
 * says nothing about radius, so two trees at very different angles but
 * similar radii (or the same angle, different radii) could still land with
 * trunks intersecting. `occupied` is a plain array of `{x, z, r}` the
 * caller passes in and this MUTATES (pushing every tree it places), so
 * multiple species can share one collision list and never overlap each
 * other either -- pass the same array into every species' call.
 *
 * @param {number} canopyRadius the species' base (scale=1) canopy radius,
 *   used as the collision footprint (scaled per-instance by the rolled scale)
 */
export function scatterNonOverlappingTrees(rng, count, homeZoneIds, opts, canopyRadius, occupied) {
  const {
    arcDeg = 36, scatterChance = 0.3, keepClearDeg = 16, radiusMin, radiusMax, scaleMin, scaleMax,
    // Real forests still let canopies brush -- 0.8 lets edges lightly
    // touch while keeping trunks from visibly intersecting.
    touchFactor = 0.8,
  } = opts;
  const plants = [];
  let attempts = 0;
  const maxAttempts = count * 100;
  while (plants.length < count && attempts < maxAttempts) {
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

    const radius = radiusMin + rng() * (radiusMax - radiusMin);
    const scale = scaleMin + rng() * (scaleMax - scaleMin);
    const [x, , z] = pointOnCircle(radius, angleRad);
    const myR = canopyRadius * scale;

    const collides = occupied.some((o) => {
      const dx = x - o.x;
      const dz = z - o.z;
      return Math.sqrt(dx * dx + dz * dz) < (myR + o.r) * touchFactor;
    });
    if (collides) continue;

    occupied.push({ x, z, r: myR });
    plants.push({ angle: angleRad, radius, scale, yaw: rng() * Math.PI * 2 });
  }
  return plants;
}
