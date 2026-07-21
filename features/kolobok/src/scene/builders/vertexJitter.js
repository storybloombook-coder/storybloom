// vertexJitter.js — VISUAL_QUALITY_SPEC §5 "organic shape warmth": displace
// each vertex of a geometry along its own normal by a small seeded-random
// fraction of its nominal radius, IN PLACE, at build time (stable across
// reloads via the shared seeded PRNG, not per-frame noise -- a per-frame
// version would defeat instancing/geometry caching and buys nothing visual
// since nobody's staring at a single static mesh's edges moving).

import { makeRng } from '../prng';

/** @param {import('three').BufferGeometry} geometry
 *  @param {number} radius nominal radius, so the ± fraction scales correctly
 *  @param {number} seedOffset own PRNG stream (see prng.js) */
export function jitterVertices(geometry, radius, seedOffset) {
  const rng = makeRng(seedOffset);
  geometry.computeVertexNormals();
  const pos = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const sign = rng() < 0.5 ? -1 : 1;
    const frac = 0.015 + rng() * (0.03 - 0.015);
    const d = sign * frac * radius;
    pos.setXYZ(
      i,
      pos.getX(i) + normal.getX(i) * d,
      pos.getY(i) + normal.getY(i) * d,
      pos.getZ(i) + normal.getZ(i) * d,
    );
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}
