// bitmapFont.js — tiny 5x7 pixel bitmap font (ART_SPEC §12: "text-to-texture
// from arbitrary strings is hard without canvas, [so] implement a tiny 5x7
// pixel bitmap font (A-Z, А-Я, 0-9) in code and stamp labels into the
// texture's Uint8Array"). Covers the full Latin + Cyrillic uppercase
// alphabet (not just today's three menu labels) because Russian is a
// first-class, hard-required language for this project (root CLAUDE.md) --
// under-covering Cyrillic here would silently break the very first relabel.
//
// Each glyph is 7 rows of 5 chars, '#' = lit pixel, '.' = empty. A handful of
// Cyrillic letters are true visual twins of a Latin letter at this size
// (А/A, В/B, Е/E, К/K, М/M, Н/H, О/O, Р/P, С/C, Т/T, Х/X) and just alias it;
// the rest get their own bespoke shape.

import { DataTexture, RGBAFormat, UnsignedByteType, NearestFilter, SRGBColorSpace } from 'three';

const A = ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'];
const B = ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'];
const C = ['.####', '#....', '#....', '#....', '#....', '#....', '.####'];
const D = ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'];
const E = ['#####', '#....', '#....', '####.', '#....', '#....', '#####'];
const F = ['#####', '#....', '#....', '####.', '#....', '#....', '#....'];
const G = ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.####'];
const H = ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'];
const I = ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'];
const J = ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'];
const K = ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'];
const L = ['#....', '#....', '#....', '#....', '#....', '#....', '#####'];
const M = ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'];
const N = ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'];
const O = ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'];
const P = ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'];
const Q = ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'];
const R = ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'];
const S = ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'];
const T = ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'];
const U = ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'];
const V = ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'];
const W = ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'];
const X = ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'];
const Y = ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'];
const Z = ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'];
const SPACE = ['.....', '.....', '.....', '.....', '.....', '.....', '.....'];

const LATIN = {
  A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W, X, Y, Z,
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '#....', '####.', '....#', '....#', '####.'],
  '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  ' ': SPACE,
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
};

// Bespoke Cyrillic shapes -- the letters that aren't visual twins of a Latin
// glyph. Everything else in CYRILLIC_ALIASES below just points at the Latin
// pattern it matches.
const CYRILLIC_OWN = {
  Б: ['#####', '#....', '#....', '####.', '#...#', '#...#', '####.'],
  Г: ['#####', '#....', '#....', '#....', '#....', '#....', '#....'],
  Д: ['.###.', '.#.#.', '.#.#.', '.#.#.', '#####', '#...#', '#...#'],
  Ж: ['#.#.#', '#.#.#', '.###.', '..#..', '.###.', '#.#.#', '#.#.#'],
  З: ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
  И: ['#...#', '#...#', '#..##', '#.#.#', '##..#', '#...#', '#...#'],
  Л: ['..#..', '.#.#.', '.#.#.', '#...#', '#...#', '#...#', '#...#'],
  П: ['#####', '#...#', '#...#', '#...#', '#...#', '#...#', '#...#'],
  У: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '.##..', '##...'],
  Ф: ['..#..', '.###.', '#.#.#', '#.#.#', '#.#.#', '.###.', '..#..'],
  Ц: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '#####'],
  Ч: ['#...#', '#...#', '#...#', '.####', '....#', '....#', '....#'],
  Ш: ['#.#.#', '#.#.#', '#.#.#', '#.#.#', '#.#.#', '#.#.#', '#####'],
  Ъ: ['##...', '.#...', '.#...', '.#.##', '.#..#', '.#..#', '.####'],
  Ы: ['#...#', '#...#', '#...#', '#.###', '#.#.#', '#.#.#', '#.###'],
  Ь: ['#....', '#....', '#....', '#.###', '#...#', '#...#', '#.###'],
  Э: ['#####', '....#', '....#', '.####', '....#', '....#', '#####'],
  Ю: ['#.###', '#.#.#', '#.#.#', '#.##.', '#.#.#', '#.#.#', '#.###'],
  Я: ['.####', '#...#', '#...#', '.####', '..#.#', '.#..#', '#...#'],
};

const CYRILLIC_ALIASES = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X',
  Ё: 'E', Й: 'И', Щ: 'Ш',
};

function buildGlyphTable() {
  const table = { ...LATIN };
  for (const [ch, pattern] of Object.entries(CYRILLIC_OWN)) table[ch] = pattern;
  for (const [ch, aliasOf] of Object.entries(CYRILLIC_ALIASES)) {
    table[ch] = CYRILLIC_OWN[aliasOf] ?? LATIN[aliasOf];
  }
  return table;
}

const GLYPHS = buildGlyphTable();
export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;
const GLYPH_GAP = 1;
const MAX_LABEL_CHARS = 14;

function getGlyph(char) {
  return GLYPHS[char] ?? SPACE;
}

/** Uppercase + hard-cap at 14 chars with an ellipsis, per ART_SPEC §12. */
export function truncateLabel(text, max = MAX_LABEL_CHARS) {
  const upper = text.toLocaleUpperCase();
  if (upper.length <= max) return upper;
  return `${upper.slice(0, max - 1)}…`.replace('…', '...').slice(0, max);
}

/** Stamps `text` into an RGBA Uint8Array of size `width`x`height`, centered,
 *  writing `onColor` (an [r,g,b,a] 0-255 tuple) for lit pixels and leaving
 *  `offColor` (defaults to transparent black, so this can serve as an
 *  emissiveMap where "off" truly means "no glow") everywhere else. `scale`
 *  is an integer pixel multiplier (kept whole so glyphs stay crisp under
 *  NearestFilter). */
export function stampLabel(text, width, height, onColor, offColor = [0, 0, 0, 0], scale = 2) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = offColor[0];
    data[i * 4 + 1] = offColor[1];
    data[i * 4 + 2] = offColor[2];
    data[i * 4 + 3] = offColor[3];
  }

  const chars = [...text];
  const textWidthPx = chars.length * (GLYPH_WIDTH + GLYPH_GAP) * scale - GLYPH_GAP * scale;
  const textHeightPx = GLYPH_HEIGHT * scale;
  const startX = Math.round((width - textWidthPx) / 2);
  const startY = Math.round((height - textHeightPx) / 2);

  chars.forEach((char, ci) => {
    const glyph = getGlyph(char);
    const gx = startX + ci * (GLYPH_WIDTH + GLYPH_GAP) * scale;
    for (let row = 0; row < GLYPH_HEIGHT; row++) {
      for (let col = 0; col < GLYPH_WIDTH; col++) {
        if (glyph[row][col] !== '#') continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = gx + col * scale + sx;
            const py = startY + row * scale + sy;
            if (px < 0 || px >= width || py < 0 || py >= height) continue;
            const o = (py * width + px) * 4;
            data[o] = onColor[0];
            data[o + 1] = onColor[1];
            data[o + 2] = onColor[2];
            data[o + 3] = onColor[3];
          }
        }
      }
    }
  });

  return data;
}

/** Builds the finished emissiveMap DataTexture for one plaque label: white
 *  glyphs on transparent black, so `material.emissive`/`emissiveIntensity`
 *  alone controls the glow color/strength and the plaque's flat stone color
 *  comes from `material.color` untouched (ART_SPEC §12). */
export function makeLabelTexture(text, width = 112, height = 40, scale = 2) {
  const data = stampLabel(truncateLabel(text), width, height, [255, 255, 255, 255], [0, 0, 0, 0], scale);
  const texture = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.colorSpace = SRGBColorSpace;
  // DataTexture defaults flipY to false (unlike an image-loaded Texture),
  // so row 0 of `data` -- the top row stampLabel wrote -- lands at V=0,
  // which BoxGeometry's front face maps to the BOTTOM of the plaque.
  // Confirmed on-device: labels rendered upside down without this.
  texture.flipY = true;
  texture.needsUpdate = true;
  return texture;
}
