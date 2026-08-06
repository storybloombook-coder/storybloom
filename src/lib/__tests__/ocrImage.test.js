// Plain node test of ocrResizeTarget. Run:
//   node src/lib/__tests__/ocrImage.test.js
//
// The whole point of the resize is to make OCR faster without making it
// worse, and the two ways to get that wrong are silent: upscaling a small
// image (slower AND blurrier, for nothing), or scaling the edges
// independently and stretching the page so the glyphs deform. Neither shows
// up as an error anywhere -- you'd only notice as worse recognition.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../vision/ocrImage.ts');

function load() {
  const code = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
  const maxEdge = code.match(/export const OCR_MAX_EDGE = (\d+);/);
  if (!maxEdge) throw new Error('OCR_MAX_EDGE not found');
  const start = code.indexOf('export function ocrResizeTarget(');
  if (start < 0) throw new Error('ocrResizeTarget not found');
  const end = code.indexOf('\n}\n', start);
  const fn = code
    .slice(start, end + 2)
    .replace('export function', 'function')
    .replace(/: number/g, '')
    .replace(/\): \{ width; height \} \| null \{/, ') {');
  return new Function(`const OCR_MAX_EDGE = ${maxEdge[1]};\n${fn}\nreturn { ocrResizeTarget, OCR_MAX_EDGE };`)();
}

const { ocrResizeTarget, OCR_MAX_EDGE } = load();

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`ok - ${name}`);
  else {
    console.log(`FAIL - ${name} ${detail}`);
    failures += 1;
  }
}

// A typical 12MP phone shot, portrait and landscape.
for (const [w, h, label] of [[3024, 4032, 'portrait 12MP'], [4032, 3024, 'landscape 12MP']]) {
  const t = ocrResizeTarget(w, h);
  check(`${label}: gets resized`, t !== null);
  check(`${label}: longest edge lands on the cap`,
    Math.max(t.width, t.height) === OCR_MAX_EDGE, `(got ${t.width}x${t.height})`);
  const before = w / h;
  const after = t.width / t.height;
  check(`${label}: aspect ratio preserved`, Math.abs(before - after) < 0.01,
    `(${before.toFixed(4)} -> ${after.toFixed(4)})`);
  const saving = 1 - (t.width * t.height) / (w * h);
  check(`${label}: cuts most of the pixels`, saving > 0.5,
    `(${(saving * 100).toFixed(0)}% fewer pixels)`);
}

// Anything at or under the cap must be left completely alone -- resizing it
// would be an upscale, which costs time and loses detail.
for (const [w, h, label] of [
  [1600, 1200, 'already small'],
  [OCR_MAX_EDGE, 1000, 'exactly at the cap'],
  [300, 400, 'thumbnail'],
]) {
  check(`${label}: sent as-is`, ocrResizeTarget(w, h) === null);
}

// Dimensions we can't trust -- the callers get these from a picker, and a
// missing field would otherwise become NaN and produce a nonsense resize.
for (const [w, h, label] of [
  [0, 0, 'zero'],
  [NaN, NaN, 'NaN'],
  [undefined, undefined, 'undefined'],
  [-100, -100, 'negative'],
]) {
  check(`${label} dimensions: sent as-is`, ocrResizeTarget(w, h) === null);
}

// Never zero: an extremely long thin image must still round to a real size.
{
  const t = ocrResizeTarget(20000, 3);
  check('extreme aspect ratio still yields a usable size',
    t !== null && t.width >= 1 && t.height >= 1, `(${t && t.width}x${t && t.height})`);
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
