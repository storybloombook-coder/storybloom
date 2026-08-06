// Do the story's spoken lines fit in the time they're given?
//   node features/kolobok/__tests__/dialogueWindows.test.js
//
// Every `dialogue` slot plays on channel 'voice', and that channel is ONE
// shared player on purpose (soundEngine.js: "two overlapping narrators would
// just be mush"). The consequence is that a new line does not mix with the
// previous one -- it REPLACES it. So if line B is scheduled before line A's
// audio has finished, A is cut off mid-sentence, silently, with nothing in
// the code to indicate it.
//
// That makes the spacing between lines a real constraint rather than a taste
// question, and one nobody can verify by listening once. This reads the beat
// timings and the slot durations straight out of the source and checks every
// consecutive pair.
//
// Effects are a different story and deliberately so: they go through a
// 6-deep round-robin pool, so they overlap freely. Only the voice channel
// serialises.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`ok - ${name}`);
  else {
    console.log(`FAIL - ${name} ${detail}`);
    failures += 1;
  }
}

// ---------------------------------------------------------------- durations
const libSrc = read('services/soundLibrary.js');
const durations = {};
for (const m of libSrc.matchAll(/id: '(dialogue\.[A-Za-z0-9]+)',[^}]*?durationMs: (\d+)/g)) {
  durations[m[1]] = Number(m[2]);
}
check('dialogue slot durations were parsed', Object.keys(durations).length >= 15,
  `(${Object.keys(durations).length} slots)`);

// ------------------------------------------------------------- key -> slot
const dirSrc = read('scene/StoryDirector.jsx');
const keyToSlot = {};
for (const m of dirSrc.matchAll(/'([a-z][A-Za-z0-9.]+)': '(dialogue\.[A-Za-z0-9]+)'/g)) {
  keyToSlot[m[1]] = m[2];
}
check('narration keys map to slots', Object.keys(keyToSlot).length >= 15,
  `(${Object.keys(keyToSlot).length} keys)`);

// ------------------------------------------------------------ the schedules
//
// Each entry is one continuous run of narration the player hears without a
// gap it could hide a cut behind. Times are the `at` values from the beat
// list, with the same arithmetic the source applies.
const BAKE1_HOLD = Number(read('scene/storyChapters.js').match(/const BAKE1_HOLD = (\d+);/)[1]);
const COOKING_DELTA = 3200 + BAKE1_HOLD;
const FOX_PHRASE_GAP = Number(read('scene/storyChapters.js').match(/const FOX_PHRASE_GAP = (\d+);/)[1]);
const FOX_FINALE_SCALE = Number(read('scene/storyChapters.js').match(/const FOX_FINALE_SCALE = ([\d.]+);/)[1]);

/** Same transform buildFoxFinale applies to its beat list. The two shifts
 *  are SEQUENTIAL there -- the second compares against the already-shifted
 *  time, not the original -- so this has to do the same or its numbers are
 *  quietly wrong. */
function finaleAt(at) {
  let t = at;
  if (t >= 800) t += FOX_PHRASE_GAP;
  if (t >= 3400 + FOX_PHRASE_GAP) t += FOX_PHRASE_GAP;
  return Math.round(t * FOX_FINALE_SCALE);
}

const FLATTER_HOLD = Number(
  read('scene/encounterBeats.js').match(/const FLATTER_HOLD = (\d+);/)[1],
);

const schedules = [
  {
    name: 'chapter 0 (birth)',
    lines: [
      { at: 400, key: 'story.bake1' },
      { at: 2200 + BAKE1_HOLD, key: 'story.bake1b' },
      { at: 3800 + COOKING_DELTA, key: 'story.bake2' },
    ],
    // The chapter runs well past the last line; nothing follows it closely.
    endsAt: 3800 + COOKING_DELTA + 6000,
  },
  {
    name: 'animal chapter (hare / wolf / bear)',
    lines: [
      // The shared beat's own 'eat' line, then the narrator's brag.
      { at: 400, key: 'line.eat.hare' },
      { at: 6400, key: 'story.brag.hare' },
    ],
    endsAt: 6400 + 4500,
  },
  {
    name: 'chapter 8 (fox finale)',
    lines: [
      { at: finaleAt(0), key: 'story.fox.intro' },
      { at: finaleAt(800), key: 'line.fox.flatter' },
      { at: finaleAt(3400), key: 'story.fox.closer' },
      { at: finaleAt(6900), key: 'story.snap' },
    ],
    endsAt: finaleAt(6900) + 4000,
  },
  {
    name: 'interactive fox beat',
    lines: [{ at: 500, key: 'line.fox.flatter' }],
    endsAt: 3500 + FLATTER_HOLD,
  },
];

// ------------------------------------------------------------------- checks
for (const s of schedules) {
  for (let i = 0; i < s.lines.length; i++) {
    const line = s.lines[i];
    const slot = keyToSlot[line.key];
    if (!slot) {
      check(`${s.name}: '${line.key}' maps to a slot`, false);
      continue;
    }
    const dur = durations[slot];
    if (dur === undefined) {
      check(`${s.name}: ${slot} has a duration`, false);
      continue;
    }
    const next = s.lines[i + 1];
    if (next) {
      // A real cut-off: the shared voice player is handed a new file while
      // this one is still speaking, so this line stops dead mid-word.
      const window = next.at - line.at;
      check(`${s.name}: ${line.key} (${dur}ms) finishes before ${next.key} starts`,
        window >= dur, `(${window}ms window, cut off by ${dur - window}ms)`);
    } else {
      // Last line of the run. Nothing takes the player away from it, so it
      // can't be cut off -- but if it outlasts the beat, the bubble text
      // disappears while the voice is still talking. Reported, not failed:
      // what follows depends on what the story does next, and a little
      // overhang is a lot better than a truncation.
      const window = s.endsAt - line.at;
      if (window < dur) {
        console.log(`note - ${s.name}: ${line.key} keeps talking ${dur - window}ms `
          + `past the end of its animation (${dur}ms audio, ${window}ms on screen)`);
      } else {
        console.log(`ok - ${s.name}: ${line.key} finishes within its beat`);
      }
    }
  }
}

// The voice channel is one player, so this file's whole premise depends on
// that staying true. If dialogue ever gets its own pool, these checks stop
// meaning anything and should be revisited rather than silently passing.
{
  const engine = read('services/soundEngine.js');
  check('dialogue still plays on a single shared voice player',
    /let voicePlayer = null;/.test(engine) && /function getVoicePlayer/.test(engine));
  const lib = read('services/soundLibrary.js');
  check("dialogue is still routed to the 'voice' channel",
    /category === 'dialogue' \? 'voice' : 'sfx'/.test(lib));
}

// Effects must NOT be serialised -- overlapping blips is the point.
{
  const engine = read('services/soundEngine.js');
  const pool = engine.match(/const ONE_SHOT_POOL_SIZE = (\d+);/);
  check('effects still have a pool deep enough to overlap',
    pool && Number(pool[1]) >= 6, pool ? `(pool ${pool[1]})` : '(not found)');
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
