// Plain node test of the shard subdivision in components/Bookshelf.tsx. Run:
//   node src/lib/__tests__/shatter.test.js
// No test framework (matches this folder's own convention).
//
// Two things about a shattered book are impossible to eyeball. The pieces
// have to tile the spine EXACTLY -- a fraction of a pixel of gap or overlap
// and the book visibly seams in the instant before it breaks, which is the
// whole illusion. And the size distribution is a tuned number: weight the
// cut toward big pieces and the debris comes out suspiciously even, ignore
// size and one plate survives whole while the rest turns to dust. Both are
// checked here across the narrowest and widest spines the shelf can produce.
//
// The function is extracted from the .tsx by source, so it can't drift from
// the one that actually runs.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../components/Bookshelf.tsx');

/** Pull `hashId`, `shatter` and MIN_SHARD out of the component and compile
 *  them on their own. They're deliberately plain, dependency-free functions. */
function load() {
  // Normalised, because the working tree is CRLF on Windows and every offset
  // below looks for a plain newline.
  const code = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
  function grab(name) {
    // From `function name(` to the closing brace at column 0.
    const start = code.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} not found in Bookshelf.tsx`);
    const end = code.indexOf('\n}\n', start);
    assert.ok(end > start, `${name} has no top-level close`);
    return code.slice(start, end + 2);
  }
  const min = code.match(/const MIN_SHARD = (\d+);/);
  assert.ok(min, 'MIN_SHARD not found');
  const src = [
    `const MIN_SHARD = ${min[1]};`,
    grab('hashId').replace(/: string|: number/g, ''),
    grab('shatter')
      .replace(/: Shard\[\]/g, '')
      .replace(/: string|: number/g, ''),
    'return { shatter, MIN_SHARD };',
  ].join('\n');
  return new Function(src)();
}

const { shatter, MIN_SHARD } = load();

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`ok - ${name}`);
  else {
    console.log(`FAIL - ${name} ${detail}`);
    failures += 1;
  }
}

const COUNT = 45;
// spineWidthFromId x spineHeightFromId at their extremes, plus a typical one.
const SPINES = [
  [38, 88, 'narrowest spine'],
  [52, 105, 'typical spine'],
  [66, 122, 'widest spine'],
];

for (const [w, h, label] of SPINES) {
  const pieces = shatter(w, h, COUNT, `book:${label}`);

  const area = pieces.reduce((sum, p) => sum + p.w * p.h, 0);
  check(`${label}: pieces tile the spine exactly`, Math.abs(area - w * h) < 1e-9,
    `(covered ${area.toFixed(4)} of ${w * h})`);

  check(`${label}: no piece escapes the spine`,
    pieces.every((p) => p.x >= -1e-9 && p.y >= -1e-9 && p.x + p.w <= w + 1e-9 && p.y + p.h <= h + 1e-9));

  check(`${label}: nothing thinner than MIN_SHARD`,
    pieces.every((p) => Math.min(p.w, p.h) >= MIN_SHARD - 1e-9),
    `(thinnest ${Math.min(...pieces.map((p) => Math.min(p.w, p.h))).toFixed(2)})`);

  // A needle is the one box shape the solver handles badly, and it doesn't
  // look like debris either.
  const aspect = Math.max(...pieces.map((p) => Math.max(p.w / p.h, p.h / p.w)));
  check(`${label}: no needle-shaped piece`, aspect < 6, `(worst ${aspect.toFixed(1)}:1)`);

  const sizes = pieces.map((p) => p.w * p.h).sort((a, b) => a - b);
  const spread = sizes[sizes.length - 1] / sizes[0];
  check(`${label}: sizes vary like broken glass, not like a grid`,
    spread > 3.5 && spread < 40, `(largest/smallest ${spread.toFixed(1)}x over ${pieces.length} pieces)`);
}

// Same book, same break, every time -- a book that shatters differently on
// each viewing would be as wrong as one that changes colour.
{
  const a = shatter(52, 105, COUNT, 'book:x');
  const b = shatter(52, 105, COUNT, 'book:x');
  check('the same book always breaks the same way',
    a.every((p, i) => p.x === b[i].x && p.y === b[i].y && p.w === b[i].w && p.h === b[i].h));

  const other = shatter(52, 105, COUNT, 'book:y');
  check('two different books do not break alike',
    a.some((p, i) => Math.abs(p.w - other[i].w) > 0.5 || Math.abs(p.x - other[i].x) > 0.5));
}

// A spine too small to cut COUNT pieces out of must stop, not spin forever.
{
  const tiny = shatter(9, 9, COUNT, 'book:tiny');
  check('a spine too small for the full count still terminates',
    tiny.length > 0 && tiny.length < COUNT, `(${tiny.length} pieces)`);
  const area = tiny.reduce((sum, p) => sum + p.w * p.h, 0);
  check('a too-small spine is still tiled exactly', Math.abs(area - 81) < 1e-9);
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
