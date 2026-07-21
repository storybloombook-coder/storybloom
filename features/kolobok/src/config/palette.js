// palette.js — VISUAL_QUALITY_SPEC §6: the master swatch list every
// material color in the project should snap to or derive from, plus the
// `grade()` helper that applies the project's single global color-grade
// pass at build time (never per-frame -- CLAUDE.md/POLISH_SPEC's
// zero-post-processing rule). ART_SPEC's existing hexes already cluster
// tightly around these; this file formalizes the cluster rather than
// replacing it.

// ~20 curated hexes spanning the ART_SPEC palette families actually in use:
// dough/warm ambers, forest greens, bark/earth browns, sky/water blues,
// dusk/night violets, and neutral highlights/creams.
export const SWATCHES = [
  '#f2c14e', '#c98a2e', '#e89a5b', // dough / crust / cheek (warm amber)
  '#d9a441', '#8fbf6a', '#d9722f', // menu accents (izba gold / hare green / fox orange)
  '#7aa85c', '#5d8a3f', '#4f7d45', // grass / stem / spruce dark
  '#8a6f52', '#6b4c33', '#7a5c3e', // bark / earth / cabin timber
  '#8ec4e0', '#cfe8f2', '#6fa8c8', // day sky / horizon / water
  '#7a86b8', '#141b33', '#2c3555', // evening / night zenith / horizon
  '#fff2d6', '#2a2a55',            // toon highlight warm / toon shadow cool
  '#faf6ec', '#3a2c1a',            // eye white / eye dark (shared by all characters)
];

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}
function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else[r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
const lerp = (a, b, t) => a + (b - a) * t;

/** VISUAL_QUALITY_SPEC §6 coherence pass: +6% saturation everywhere; on top
 *  of that, an OPTIONAL extra 4%-toward-`#2a2a55` push reserved for a
 *  material's darkest (post-ramp step 0) shadow tone only -- pass
 *  `{ shadow: true }` from a toon ramp builder, never from a flat material
 *  color. Applied once at texture/material build time, not per frame. */
export function grade(hex, { shadow = false } = {}) {
  const [r, g, b] = hexToRgb(hex);
  let [h, s, l] = rgbToHsl(r, g, b);
  s = Math.min(1, s * 1.06);
  let [gr, gg, gb] = hslToRgb(h, s, l);
  if (shadow) {
    const [vr, vg, vb] = hexToRgb('#2a2a55');
    gr = lerp(gr, vr, 0.04);
    gg = lerp(gg, vg, 0.04);
    gb = lerp(gb, vb, 0.04);
  }
  return rgbToHex(gr, gg, gb);
}

/** Nearest-swatch snap distance, for spotting outliers during implementation
 *  (dev-time sanity check, not called from render paths). */
export function nearestSwatch(hex) {
  const [r, g, b] = hexToRgb(hex);
  let best = SWATCHES[0];
  let bestDist = Infinity;
  for (const sw of SWATCHES) {
    const [sr, sg, sb] = hexToRgb(sw);
    const d = (r - sr) ** 2 + (g - sg) ** 2 + (b - sb) ** 2;
    if (d < bestDist) { bestDist = d; best = sw; }
  }
  return best;
}
