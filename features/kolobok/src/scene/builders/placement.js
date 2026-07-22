// placement.js — shared "scatter around the island" rule for vegetation
// (ART_SPEC §5): bias each species to its home zone's arc, let some
// fraction land anywhere, and never within keepClearDeg of a landmark.

import {
  ZONES, rad, angleDelta, pointOnCircle, PATH_RADIUS, PATH_HALF_WIDTH, POND_ANGLE_DEG, POND_RADIUS,
} from '../../config/zones';

// BACKLOG.md #12: trunks shouldn't spawn ON the dirt path ring (overhanging
// canopy across it is fine -- this only gates the TRUNK's own footprint,
// not the full canopy-collision radius above). A little wider than the
// path's own rendered half-width so bark doesn't touch the edge either.
const PATH_TRUNK_KEEP_CLEAR = PATH_HALF_WIDTH + 0.15;

// Live feedback: a spruce ("Christmas tree") had spawned right at the
// pond's edge -- the scatter rule only ever checked distance from the
// ZONES landmarks, never from the pond itself (it isn't one). Water's own
// rim wobbles out to ~1.98 at its widest, plus the willow/reeds/beach
// around it, so keep tree TRUNKS clear of a generous circle around the
// pond's world position too.
const POND_POS = pointOnCircle(POND_RADIUS, rad(POND_ANGLE_DEG));
const POND_TREE_KEEP_CLEAR = 2.6;

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
    if (Math.abs(radius - PATH_RADIUS) < PATH_TRUNK_KEEP_CLEAR) continue;
    const scale = scaleMin + rng() * (scaleMax - scaleMin);
    const [x, , z] = pointOnCircle(radius, angleRad);
    const distToPond = Math.hypot(x - POND_POS[0], z - POND_POS[2]);
    if (distToPond < POND_TREE_KEEP_CLEAR) continue;
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
