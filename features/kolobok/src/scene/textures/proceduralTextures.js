// proceduralTextures.js — DataTexture builders (ART_SPEC §1). No image
// files anywhere: every texture is a THREE.DataTexture built from a
// Uint8Array, filled with a fixed-seed PRNG so the "hand-painted" noise is
// stable across reloads instead of re-randomizing every launch.

import {
  DataTexture,
  RGBAFormat,
  UnsignedByteType,
  NearestFilter,
  LinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import { makeRng } from '../prng';
import { grade } from '../../config/palette';

// Each builder gets its own stream offset so two builders called with the
// same args never (by coincidence) produce correlated noise, while every
// reload still reproduces pixel-for-pixel (see prng.js).
const mulberry32 = (offset) => makeRng(offset);

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const clamp255 = (v) => Math.max(0, Math.min(255, v));
const lerp = (a, b, t) => a + (b - a) * t;

function finishTexture(data, width, height) {
  const texture = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
  texture.magFilter = NearestFilter;
  texture.minFilter = LinearFilter;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Base fill, `density` fraction of pixels darkened to `speckle`, plus
 *  ±`jitter` per-pixel value noise everywhere (one random offset per pixel,
 *  applied equally to R/G/B so hue stays put and only brightness wobbles --
 *  the hand-painted feel ART_SPEC asks for). */
export function makeSpeckle(base, speckle, size = 128, density = 0.04, jitter = 0.06) {
  const rng = mulberry32(0);
  const [br, bg, bb] = hexToRgb(base);
  const [sr, sg, sb] = hexToRgb(speckle);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const isSpeckle = rng() < density;
    const j = (rng() * 2 - 1) * jitter * 255;
    const o = i * 4;
    data[o] = clamp255((isSpeckle ? sr : br) + j);
    data[o + 1] = clamp255((isSpeckle ? sg : bg) + j);
    data[o + 2] = clamp255((isSpeckle ? sb : bb) + j);
    data[o + 3] = 255;
  }
  return finishTexture(data, size, size);
}

/** `count` horizontal dash-rows of `stripe` over a `base` fill, each dash
 *  20-60% of the width at a random x offset (birch bark). `horizontal:false`
 *  transposes the pattern to run vertically instead. */
export function makeStripes(base, stripe, size = 128, count = 7, thickness = 0.06, horizontal = true) {
  const rng = mulberry32(1);
  const [br, bg, bb] = hexToRgb(base);
  const [sr, sg, sb] = hexToRgb(stripe);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const o = i * 4;
    data[o] = br;
    data[o + 1] = bg;
    data[o + 2] = bb;
    data[o + 3] = 255;
  }

  const bandPx = Math.max(1, Math.round(thickness * size));
  for (let c = 0; c < count; c++) {
    const rowCenter = Math.round(((c + 0.5) / count) * size);
    const dashWidthPx = Math.round((0.2 + rng() * 0.4) * size);
    const xStart = Math.floor(rng() * size);
    const halfBand = Math.floor(bandPx / 2);
    for (let dy = -halfBand; dy < bandPx - halfBand; dy++) {
      const y = ((rowCenter + dy) % size + size) % size;
      for (let dx = 0; dx < dashWidthPx; dx++) {
        const x = (xStart + dx) % size;
        const idx = horizontal ? y * size + x : x * size + y;
        const o = idx * 4;
        data[o] = sr;
        data[o + 1] = sg;
        data[o + 2] = sb;
        data[o + 3] = 255;
      }
    }
  }
  return finishTexture(data, size, size);
}

/** Pure value-noise tint over a flat `base` fill. */
export function makeNoiseGrain(base, amount = 0.08, size = 64) {
  const rng = mulberry32(2);
  const [br, bg, bb] = hexToRgb(base);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const j = (rng() * 2 - 1) * amount * 255;
    const o = i * 4;
    data[o] = clamp255(br + j);
    data[o + 1] = clamp255(bg + j);
    data[o + 2] = clamp255(bb + j);
    data[o + 3] = 255;
  }
  return finishTexture(data, size, size);
}

/** Vertical gradient from `inner` (row 0) to `outer` (last row) -- used both
 *  as a "radial" pole-to-pole map on a sphere's V coordinate (Kolobok's
 *  crust) and, via the optional `width` override, as the sky dome's 1-wide
 *  horizon-to-zenith strip (ART_SPEC §7's "variant"). */
export function makeRadialGradientData(inner, outer, size = 128, width = size) {
  const [ir, ig, ib] = hexToRgb(inner);
  const [or_, og, ob] = hexToRgb(outer);
  const height = size;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const t = height > 1 ? y / (height - 1) : 0;
    const r = lerp(ir, or_, t);
    const g = lerp(ig, og, t);
    const b = lerp(ib, ob, t);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  return finishTexture(data, width, height);
}

// Cache of built ramps, keyed by base hex -- every hero material asking for
// the same base color (e.g. all four legs of an instanced animal) shares one
// 4x1 DataTexture instead of rebuilding it per mesh.
const toonRampCache = new Map();

/** VISUAL_QUALITY_SPEC §1: a 4-step toon gradient map for `base`, NEAREST-
 *  filtered (hard bands are the point). Warm-light/cool-shadow bias baked
 *  in -- shadow hue-shifts toward violet, highlight warms toward cream --
 *  rather than a plain darken/lighten ramp, which is the actual "storybook"
 *  signal per the spec ("never skip the hue shift"). */
export function makeToonRamp(base) {
  const cached = toonRampCache.get(base);
  if (cached) return cached;

  // VISUAL_QUALITY_SPEC §6: the global grade (+6% saturation) runs once
  // here, at build time -- every toon-shaded surface gets the coherence
  // pass for free just by going through this one function.
  const [br, bg, bb] = hexToRgb(grade(base));
  const [vr, vg, vb] = hexToRgb('#2a2a55'); // cool shadow tint
  const [hr, hg, hb] = hexToRgb('#fff2d6'); // warm highlight tint

  // step 0: darkened 35%, mixed 12% toward violet/blue, plus VISUAL_QUALITY_
  // SPEC §6's extra 4%-toward-#2a2a55 coherence nudge reserved for shadows.
  const s0 = [
    lerp(lerp(br * 0.65, vr, 0.12), vr, 0.04),
    lerp(lerp(bg * 0.65, vg, 0.12), vg, 0.04),
    lerp(lerp(bb * 0.65, vb, 0.12), vb, 0.04),
  ];
  // step 1: darkened 12%, no hue shift.
  const s1 = [br * 0.88, bg * 0.88, bb * 0.88];
  // step 2: base as-is.
  const s2 = [br, bg, bb];
  // step 3: lightened 18%, warmed 8% toward cream.
  const s3 = [
    lerp(Math.min(255, br * 1.18), hr, 0.08),
    lerp(Math.min(255, bg * 1.18), hg, 0.08),
    lerp(Math.min(255, bb * 1.18), hb, 0.08),
  ];

  const steps = [s0, s1, s2, s3];
  const data = new Uint8Array(4 * 4);
  steps.forEach(([r, g, b], i) => {
    const o = i * 4;
    data[o] = clamp255(r);
    data[o + 1] = clamp255(g);
    data[o + 2] = clamp255(b);
    data[o + 3] = 255;
  });

  const texture = new DataTexture(data, 4, 1, RGBAFormat, UnsignedByteType);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.needsUpdate = true;
  toonRampCache.set(base, texture);
  return texture;
}

/** VISUAL_QUALITY_SPEC §1's fake-specular overlay: a true center-out radial
 *  falloff (unlike makeRadialGradientData's pole-to-pole gradient) -- opaque
 *  white center fading to fully transparent at the rim, for an additive
 *  highlight sphere/disc. `ClampToEdgeWrapping` is the caller's job (this
 *  just fills the pixels); wrap defaults from finishTexture would tile the
 *  falloff, which we don't want here, so this builds its own DataTexture
 *  rather than routing through finishTexture. */
export function makeRadialAlphaTexture(size = 32) {
  const data = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.sqrt((x - c) ** 2 + (y - c) ** 2) / c;
      const a = clamp255((1 - Math.min(1, d)) * 255);
      const o = (y * size + x) * 4;
      data[o] = 255;
      data[o + 1] = 255;
      data[o + 2] = 255;
      data[o + 3] = a;
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Kolobok's dough (ART_SPEC §2): stays `base` through the equator and
 *  bottom, only browning toward `crust` on the top pole (a real loaf browns
 *  on top, not underneath) -- NOT a plain top-to-bottom lerp, which is why
 *  this doesn't just call makeRadialGradientData. A speckle pass (flour
 *  spots) composites on top of the gradient in the same Uint8Array, per the
 *  ART_SPEC instruction to compose both passes into one texture rather than
 *  layering two separate DataTextures. Sphere v=0 is the bottom pole,
 *  v=1 the top, in three.js's default SphereGeometry UVs. */
export function makeDoughTexture(base = '#f2c14e', crust = '#c98a2e', speckle = '#a86f24', size = 128, speckleDensity = 0.03) {
  const rng = mulberry32(3);
  const [br, bg, bb] = hexToRgb(base);
  const [cr, cg, cb] = hexToRgb(crust);
  const [sr, sg, sb] = hexToRgb(speckle);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const v = size > 1 ? y / (size - 1) : 0;
    const aboveEquator = Math.max(0, (v - 0.5) / 0.5); // 0 below the equator, 0..1 above it
    const eased = aboveEquator * aboveEquator * (3 - 2 * aboveEquator); // smoothstep: soft browning edge
    const gr = lerp(br, cr, eased);
    const gg = lerp(bg, cg, eased);
    const gb = lerp(bb, cb, eased);
    for (let x = 0; x < size; x++) {
      const isSpeckle = rng() < speckleDensity;
      const jitter = (rng() * 2 - 1) * 0.06 * 255;
      const o = (y * size + x) * 4;
      data[o] = clamp255((isSpeckle ? sr : gr) + jitter);
      data[o + 1] = clamp255((isSpeckle ? sg : gg) + jitter);
      data[o + 2] = clamp255((isSpeckle ? sb : gb) + jitter);
      data[o + 3] = 255;
    }
  }
  return finishTexture(data, size, size);
}
