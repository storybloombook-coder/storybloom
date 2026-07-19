// prng.js — the one seeded random source for every "hand-painted" or
// "scattered" choice in the scene (textures, vegetation placement, etc.),
// so reloads reproduce pixel/layout-for-layout instead of re-randomizing.
// See ART_SPEC §1 and §5 ("Seeded PRNG, same seed as textures").

export const SEED = 133742;

// mulberry32: tiny, fast, good-enough-for-this PRNG. `offset` gives each
// caller its own stream (SEED + offset) so unrelated callers using the same
// base seed never accidentally produce correlated sequences.
export function makeRng(offset = 0) {
  let a = (SEED + offset) >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
