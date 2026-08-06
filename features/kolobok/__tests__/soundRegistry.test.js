// Is every sound slot real? Run:
//   node features/kolobok/__tests__/soundRegistry.test.js
//
// soundLibrary.js opens by promising that "every slot below corresponds to a
// trigger already wired somewhere in the scene." That promise had quietly
// become false for 54 of 98 slots -- whole categories of them appeared in the
// library, could be recorded over, previewed happily... and then never played,
// because nothing in the scene ever asked for them. Recording a wolf howl
// changed nothing at all.
//
// Nothing about that is visible from either end. The library looks complete,
// and the scene looks like it's just quiet. So it's checked here instead:
// every slot must be labelled in both locales, sit in a real category, be
// able to produce audio, and be triggered by something.
//
// KNOWN_UNTRIGGERED is the deliberate exception list. Adding to it should
// take an argument -- each entry is a row in the library a parent can spend
// time recording for no effect.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8').replace(/\r\n/g, '\n');

const lib = read('services/soundLibrary.js');
const strings = read('config/strings.js');

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`ok - ${name}`);
  else {
    console.log(`FAIL - ${name} ${detail}`);
    failures += 1;
  }
}

// The ambient layer: idle animal noises and weather beds. Not wired YET
// rather than deliberately silent — the hooks exist (Wolf.jsx already tracks
// `howling` and `nextHowlIn`, the hare has hop/sniff timers, the weather
// system has rain and wind states), so each is about one line at an existing
// transition. What's missing is the pacing, and that's a judgement call about
// a bedtime app rather than a wiring one: how often an idle wolf should howl
// before it grates, whether the nature beds loop everywhere or only in their
// own zone, whether they duck under a spoken line. Emptying this object is
// the definition of that job being done.
const PENDING_AMBIENT = [
  'hare.idleHop', 'hare.sniff', 'hare.startled',
  'wolf.headSweep', 'wolf.howl', 'wolf.snapMiss',
  'bear.scratch', 'bear.grunt', 'bear.swipeMiss',
  'fox.tailSway', 'fox.purr', 'fox.flatterCoo', 'fox.lipLick',
  'grandma.hum', 'grandma.tapReaction', 'grandma.knitClick',
  'owl.hoot', 'hedgehog.waddle', 'hedgehog.squeak',
  'crow.caw', 'crow.wingFlap', 'ridgeBird.peck',
  'bee.buzz', 'butterfly.flutter',
  'ambience.wind', 'ambience.rain', 'ambience.thunder', 'ambience.pondRipple',
  'ambience.forestBirds', 'ambience.nightCrickets', 'ambience.izbaFire', 'ambience.leaves',
];

// Slots with no trigger, on purpose, with the reason.
const KNOWN_UNTRIGGERED = {
  ...Object.fromEntries(PENDING_AMBIENT.map((id) => [id, 'ambient layer, not wired yet'])),
  // The press-and-hold this belonged to was removed after live feedback
  // ("I have to hold it down for so long... I don't like that") -- the pipe
  // is a plain tap now, and nothing closes it.
  'chimney.pipeClose': 'its press-and-hold interaction was removed',
  // Would layer under EVERY spoken line. The voice channel and the effects
  // pool are separate, so it would genuinely overlap rather than cut -- but
  // a chime on top of every narration is a pacing decision, not a wiring gap.
  'ui.narrationAppear': 'would sound under every narration line; needs a pacing call',
  // Fires whenever the nearest zone changes, which during a fling is five
  // times in a second. Needs a settle/velocity gate before it's pleasant.
  'ui.zoneSettle': 'would fire repeatedly mid-fling; needs a settle gate',
};

// ---- parse the registry -------------------------------------------------
const slots = [];
const slotRe = /\{\s*id:\s*'([^']+)',\s*category:\s*'([^']+)'[\s\S]{0,400}?\}/g;
let m;
while ((m = slotRe.exec(lib))) {
  slots.push({
    id: m[1],
    category: m[2],
    hasSynth: /synthesize:/.test(m[0]),
    unlimited: /unlimited:\s*true/.test(m[0]),
    durationMs: (m[0].match(/durationMs:\s*(\d+)/) || [])[1],
  });
}
const categories = [...lib.matchAll(/\{\s*id:\s*'([^']+)',\s*labelKey:\s*'sound\.category\.[^']+'\s*\}/g)]
  .map((x) => x[1]);

check('the slot registry parsed', slots.length > 50, `(${slots.length} slots)`);
check('the category list parsed', categories.length >= 8, `(${categories.length})`);

// ---- labels -------------------------------------------------------------
function labelsFor(locale) {
  const localeStart = strings.indexOf(`  ${locale}: {`);
  const slotStart = strings.indexOf('      slot: {', localeStart);
  let depth = 0;
  let i = strings.indexOf('{', slotStart);
  let end = i;
  for (; end < strings.length; end++) {
    if (strings[end] === '{') depth++;
    else if (strings[end] === '}') { depth--; if (depth === 0) break; }
  }
  // eslint-disable-next-line no-new-func
  const obj = new Function(`return ${strings.slice(i, end + 1)};`)();
  const out = {};
  (function flat(o, p) {
    for (const [k, v] of Object.entries(o)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === 'object') flat(v, key);
      else out[key] = v;
    }
  })(obj, '');
  return out;
}
const en = labelsFor('en');
const ru = labelsFor('ru');

// ---- what the scene actually triggers -----------------------------------
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|jsx)$/.test(e.name) && !p.endsWith('soundLibrary.js')) out.push(p);
  }
  return out;
}
const sceneSrc = walk(SRC).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
// Dialogue reached through the narration table inside the registry itself.
const viaNarration = new Set(
  [...lib.matchAll(/'[a-z][A-Za-z0-9.]+':\s*'(dialogue\.[A-Za-z0-9]+)'/g)].map((x) => x[1]),
);

const missingLabel = [];
const badCategory = [];
const silent = [];
const untriggered = [];
const staleExceptions = [];

for (const s of slots) {
  if (en[s.id] === undefined || ru[s.id] === undefined) missingLabel.push(s.id);
  if (!categories.includes(s.category)) badCategory.push(`${s.id} -> ${s.category}`);
  if (!s.unlimited && (!s.hasSynth || !s.durationMs)) silent.push(s.id);
  if (s.unlimited) continue; // my-ambience is driven by id from Scene3D
  const triggered = sceneSrc.includes(`'${s.id}'`) || viaNarration.has(s.id);
  if (triggered && KNOWN_UNTRIGGERED[s.id]) staleExceptions.push(s.id);
  if (!triggered && !KNOWN_UNTRIGGERED[s.id]) untriggered.push(`${s.id} (${s.category})`);
}

check('every slot is labelled in EN and RU', missingLabel.length === 0, missingLabel.join(', '));
check('every slot sits in a real category', badCategory.length === 0, badCategory.join(', '));
check('every slot can produce audio', silent.length === 0, silent.join(', '));
check('every slot is triggered by something', untriggered.length === 0,
  `\n      ${untriggered.join('\n      ')}`);
check('no stale entries in KNOWN_UNTRIGGERED', staleExceptions.length === 0,
  `(now wired, remove them: ${staleExceptions.join(', ')})`);

// Every exception must still name a real slot, or the list rots.
const ids = new Set(slots.map((s) => s.id));
const ghosts = Object.keys(KNOWN_UNTRIGGERED).filter((k) => !ids.has(k));
check('KNOWN_UNTRIGGERED names only real slots', ghosts.length === 0, ghosts.join(', '));

const deliberate = Object.entries(KNOWN_UNTRIGGERED).filter(([id]) => !PENDING_AMBIENT.includes(id));
const wired = slots.length - Object.keys(KNOWN_UNTRIGGERED).length;
console.log(`\n  ${wired}/${slots.length} slots wired.`);
console.log(`  ${PENDING_AMBIENT.length} ambient slots pending (idle animals + weather beds).`);
console.log(`  ${deliberate.length} deliberately silent:`);
for (const [id, why] of deliberate) console.log(`    ${id} — ${why}`);

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
