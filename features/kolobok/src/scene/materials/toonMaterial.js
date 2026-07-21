// toonMaterial.js — VISUAL_QUALITY_SPEC §1+§2: the shared factory every
// HERO/CHARACTER surface (Kolobok, the four animals, Grandpa, izba,
// crossroads stone) builds its material through, so the toon ramp + rim
// light wiring lives in exactly one place instead of being hand-rolled per
// file. Ground/sky/water/particles do NOT use this -- they stay
// MeshStandardMaterial per the spec ("they want smooth gradients").

import { MeshToonMaterial } from 'three';
import { makeToonRamp } from '../textures/proceduralTextures';
import { injectRim } from './rimLight';
import { quality } from '../../config/devFlags';

/**
 * @param {object} opts
 * @param {string} [opts.color] base hex -- required unless vertexColors (the
 *   ramp still needs ONE representative hex for a vertex-colored merged
 *   mesh; pick the creature's dominant fur/material tone).
 * @param {boolean} [opts.vertexColors] merged-geometry per-vertex baked color
 * @param {import('three').Texture} [opts.map]
 * @param {number} [opts.roughness]
 * @param {number} [opts.rimStrength] 0.35 characters, 0.2 buildings/stone
 *   (VISUAL_QUALITY_SPEC §2). Pass 0 to skip rim entirely (tiny props).
 */
export function makeToonMaterial({
  color, vertexColors = false, map, roughness = 0.8, rimStrength = 0.35,
} = {}) {
  const material = new MeshToonMaterial({
    color: vertexColors ? '#ffffff' : color,
    vertexColors,
    map,
    gradientMap: quality.toon ? makeToonRamp(color ?? '#ffffff') : null,
  });
  // MeshToonMaterial has no `roughness` (toon shading has no real specular
  // model) -- kept as a param so call sites migrating off
  // MeshStandardMaterial don't need an extra edit, just silently unused.
  void roughness;

  if (rimStrength > 0) injectRim(material, rimStrength);
  return material;
}
