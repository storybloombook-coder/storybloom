// Plain node test of the read-along occurrence chooser. Run:
//   node src/lib/__tests__/align.test.js
//
// The case this exists for is the tale's own refrain: "и от бабушки ушёл, и
// от дедушки ушёл, и от зайца ушёл". Every line ends in the same word, so
// hearing "ушёл" identifies nothing — but "от зайца ушёл" identifies it
// exactly. These check that the neighbours decide it, that a genuinely
// ambiguous case is reported as such rather than guessed, and that ties
// resolve backwards-compatibly (earliest wins, which is what the reader did
// before any of this).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const SRC = path.join(__dirname, '../reader/align.ts');

function load() {
  let code = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
  code = code.replace(/export type [\s\S]*?\n};\n/g, '');
  code = code.replace(/: string\[\]/g, '');
  code = code.replace(/: number\[\]/g, '');
  code = code.replace(/: OccurrenceChoice/g, '');
  code = code.replace(/: string\b/g, '');
  code = code.replace(/: number\b/g, '');
  code = code.replace(/: boolean\b/g, '');
  code = code.replace(/\bexport /g, '');
  code += '\nmodule.exports = { chooseOccurrence, contextScore, wordsMatch, editDistance, CONTEXT_RADIUS };\n';
  const m = new Module(SRC, null);
  m._compile(code, SRC);
  return m.exports;
}

const A = load();

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`ok - ${name}`);
  else {
    console.log(`FAIL - ${name} ${detail}`);
    failures += 1;
  }
}

const words = (s) => s.toLowerCase().split(/\s+/).filter(Boolean);

// The refrain. Three occurrences of "ушёл", one per line.
const PAGE = words('и от бабушки ушёл и от дедушки ушёл и от зайца ушёл');
const OCCURRENCES = [];
PAGE.forEach((w, i) => { if (w === 'ушёл') OCCURRENCES.push(i); });
check('refrain has three identical endings', OCCURRENCES.length === 3);

// --- the whole point: context picks the right one ------------------------
for (const [phrase, want, label] of [
  ['и от бабушки ушёл', 0, 'бабушки'],
  ['и от дедушки ушёл', 1, 'дедушки'],
  ['и от зайца ушёл', 2, 'зайца'],
]) {
  const heard = words(phrase);
  const heardIndex = heard.length - 1; // the target is the last word said
  const got = A.chooseOccurrence(PAGE, OCCURRENCES, heard, heardIndex);
  check(`"${label}" picks occurrence ${want}`, got.index === want, `(picked ${got.index})`);
  check(`"${label}" is confident`, got.confident);
}

// --- ambiguity must be REPORTED, not guessed -----------------------------
{
  // Nothing but the word itself: no neighbours to go on.
  const got = A.chooseOccurrence(PAGE, OCCURRENCES, ['ушёл'], 0);
  check('a bare repeated word is not confident', !got.confident);
  check('a bare repeated word falls back to the earliest', got.index === 0);
}
{
  // Neighbours that are identical across every candidate ("и от") can't
  // distinguish them, so this must not claim confidence either.
  const heard = words('и от ушёл');
  const got = A.chooseOccurrence(PAGE, OCCURRENCES, heard, 2);
  check('shared filler neighbours do not create false confidence', !got.confident,
    '(и/от appear before every occurrence)');
}

// --- single candidate is trivially right ---------------------------------
{
  const got = A.chooseOccurrence(PAGE, [3], words('и от бабушки ушёл'), 3);
  check('a lone candidate is chosen confidently', got.index === 0 && got.confident);
}

// --- mis-heard endings still vote ----------------------------------------
{
  // Vosk commonly gets the inflection wrong on a long word. "бабушке" for
  // "бабушки" should still identify the first line.
  const heard = words('и от бабушке ушёл');
  const got = A.chooseOccurrence(PAGE, OCCURRENCES, heard, 3);
  check('a mis-heard word ending still identifies its line', got.index === 0 && got.confident,
    `(picked ${got.index}, confident=${got.confident})`);
}
{
  check('short words are NOT fuzzy-matched', !A.wordsMatch('кот', 'кит'),
    '(3-letter words differing by one letter are different words)');
  check('long words tolerate one edit', A.wordsMatch('бабушки', 'бабушке'));
  check('long words do not tolerate two', !A.wordsMatch('бабушки', 'дедушки'));
}

// --- English works the same way ------------------------------------------
{
  const page = words('he ran from the hare he ran from the wolf he ran from the bear');
  const cands = [];
  page.forEach((w, i) => { if (w === 'ran') cands.push(i); });
  check('english refrain has three occurrences', cands.length === 3);
  const heard = words('he ran from the wolf');
  const got = A.chooseOccurrence(page, cands, heard, 1);
  check('english: following context picks the right line', got.index === 1, `(picked ${got.index})`);
  check('english: and is confident about it', got.confident);
}

// --- context only looks so far -------------------------------------------
{
  const far = words('alpha bravo charlie delta echo foxtrot golf');
  // A neighbour beyond CONTEXT_RADIUS must contribute nothing.
  const near = A.contextScore(far, 3, far, 3);
  const beyond = A.contextScore(['zzz', 'zzz', 'zzz', 'delta'], 3, far, 3);
  check('score is 0 when no neighbour lines up', beyond === 0, `(got ${beyond})`);
  check('score is positive when they do', near > 0, `(got ${near})`);
}

// --- edit distance cap ----------------------------------------------------
{
  check('editDistance stops early past the cap', A.editDistance('abcdefgh', 'zzzzzzzz', 2) > 2);
  check('editDistance is exact under the cap', A.editDistance('kitten', 'sitten', 3) === 1);
  check('editDistance handles equality', A.editDistance('same', 'same', 0) === 0);
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
