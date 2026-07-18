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

// Fixed seed -- every builder derives its own stream from this so two
// builders called with the same args never (by coincidence) produce
// correlated noise, while every reload still reproduces pixel-for-pixel.
const TEXTURE_SEED = 133742;

// mulberry32: tiny, fast, good-enough-for-texture-noise PRNG.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
  const rng = mulberry32(TEXTURE_SEED);
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
  const rng = mulberry32(TEXTURE_SEED + 1);
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
  const rng = mulberry32(TEXTURE_SEED + 2);
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

/** Kolobok's dough (ART_SPEC §2): stays `base` through the equator and
 *  bottom, only browning toward `crust` on the top pole (a real loaf browns
 *  on top, not underneath) -- NOT a plain top-to-bottom lerp, which is why
 *  this doesn't just call makeRadialGradientData. A speckle pass (flour
 *  spots) composites on top of the gradient in the same Uint8Array, per the
 *  ART_SPEC instruction to compose both passes into one texture rather than
 *  layering two separate DataTextures. Sphere v=0 is the bottom pole,
 *  v=1 the top, in three.js's default SphereGeometry UVs. */
export function makeDoughTexture(base = '#f2c14e', crust = '#c98a2e', speckle = '#a86f24', size = 128, speckleDensity = 0.03) {
  const rng = mulberry32(TEXTURE_SEED + 3);
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
