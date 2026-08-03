// soundLibrary.js — the fixed sound-slot registry (SOUND_SPEC.md §4) and the
// default-vs-recorded resolution layer on top of soundEngine.js.
//
// Slots can never be added or removed from here at runtime -- every slot
// below corresponds to a trigger already wired somewhere in the scene.
// What CAN change per-slot is which audio plays: the procedural default
// (rendered once, cached) or a user recording (persisted in the document
// directory, since the cache dir can be wiped by the OS at any time).

import { Directory, File, Paths } from 'expo-file-system';
import {
  ampLfo,
  bandpass,
  expDecay,
  getCachedDefaultUri,
  highpass,
  lowpass,
  mixLayers,
  playOneShot,
  SAMPLE_RATE,
  setLoopVolume,
  sineTone,
  startLoop,
  stopLoop,
  triangleTone,
  whiteNoise,
} from './soundEngine';

// `labelKey` is a t()-lookup path (docs/STRINGS.md convention -- ALL
// user-visible text goes through t(), no hardcoded copy), not a literal
// display string. Category ids double as the 2nd segment of every slot's
// own labelKey (`sound.slot.<category>.<name>` == `sound.slot.<slotId>`
// since slot ids are already `<category>.<name>`).
export const CATEGORIES = [
  { id: 'kolobok', labelKey: 'sound.category.kolobok' },
  { id: 'animals', labelKey: 'sound.category.animals' },
  { id: 'nature', labelKey: 'sound.category.nature' },
  { id: 'interactions', labelKey: 'sound.category.interactions' },
  { id: 'ui', labelKey: 'sound.category.ui' },
  { id: 'story', labelKey: 'sound.category.story' },
];

// ---------------------------------------------------------- recipe helpers

// Short percussive noise burst -> lowpass, exponential decay. Covers thud/
// dustPuff/landingSquash-style slots that are all "noise shaped by a filter
// and a fast decay", just with different cutoffs/decay rates.
function noiseThump(durationS, { cutoffHz = 300, decayRate = 18 } = {}) {
  return expDecay(lowpass(whiteNoise(durationS), cutoffHz), decayRate);
}

// The remaining "Base synthesis recipes" from SOUND_SPEC.md Â§1, each
// reused/parameterized across many of the slots below rather than written
// one-off per slot.

// Rising/falling sine ping + decay -- blip/chirp/squeak are all this recipe
// at different frequency ranges and decay rates.
function blip(durationS, fromHz, toHz, decayRate = 25) {
  return expDecay(sineTone(durationS, (t) => fromHz + ((toHz - fromHz) * t) / durationS), decayRate);
}

// A one-pole bandpass whose corner frequencies sweep linearly over the
// buffer's own duration -- soundEngine's own bandpass() only takes fixed
// corners, so "whoosh" (and anything else that needs a moving sweep, not
// just a fixed band) recomputes the one-pole coefficients per-sample here
// instead of two static passes.
function sweepingBandpass(buf, fromHz, toHz) {
  const n = buf.length;
  const dt = 1 / SAMPLE_RATE;
  const hp = new Float32Array(n);
  let hpPrevIn = 0;
  let hpPrevOut = 0;
  for (let i = 0; i < n; i += 1) {
    const hz = fromHz + ((toHz - fromHz) * i) / n;
    const rc = 1 / (2 * Math.PI * hz);
    const alpha = rc / (rc + dt);
    const v = alpha * (hpPrevOut + buf[i] - hpPrevIn);
    hpPrevIn = buf[i];
    hpPrevOut = v;
    hp[i] = v;
  }
  const out = new Float32Array(n);
  let lpPrev = 0;
  for (let i = 0; i < n; i += 1) {
    const hz = fromHz + ((toHz - fromHz) * i) / n;
    const rc = 1 / (2 * Math.PI * hz);
    const alpha = dt / (rc + dt);
    lpPrev += alpha * (hp[i] - lpPrev);
    out[i] = lpPrev;
  }
  return out;
}

function whoosh(durationS, fromHz = 300, toHz = 1800) {
  return sweepingBandpass(whiteNoise(durationS), fromHz, toHz);
}

function growl(durationS, { lowHz = 150, highHz = 300, lfoHz = 5, depth = 0.5 } = {}) {
  return ampLfo(bandpass(whiteNoise(durationS), lowHz, highHz), lfoHz, depth);
}

function sparkle(durationS, freqs = [1200, 1600, 2400]) {
  return ampLfo(mixLayers(durationS, freqs.map((f) => ({ buf: sineTone(durationS, f), gain: 0.3 }))), 8, 0.6);
}

function hoot() {
  return lowpass(mixLayers(0.33, [
    { buf: sineTone(0.12, 380), atS: 0, gain: 0.8 },
    { buf: sineTone(0.12, 380), atS: 0.21, gain: 0.8 },
  ]), 800);
}

function rumble(durationS = 0.5) {
  return expDecay(lowpass(whiteNoise(durationS), 120), 4);
}

function clickClack() {
  return mixLayers(0.1, [
    { buf: highpass(expDecay(whiteNoise(0.015), 80), 2000), atS: 0, gain: 0.7 },
    { buf: highpass(expDecay(whiteNoise(0.015), 80), 2000), atS: 0.08, gain: 0.7 },
  ]);
}

// Wind (loop): white noise -> lowpass with a slow LFO on the cutoff itself
// (Â±150Hz @ 0.12Hz) -- needs a per-sample-recomputed cutoff, same reasoning
// as sweepingBandpass above, just one filter stage instead of two.
function windLoop(durationS) {
  const noise = whiteNoise(durationS);
  const n = noise.length;
  const dt = 1 / SAMPLE_RATE;
  const out = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / SAMPLE_RATE;
    const cutoff = 400 + Math.sin(2 * Math.PI * 0.12 * t) * 150;
    const rc = 1 / (2 * Math.PI * cutoff);
    const alpha = dt / (rc + dt);
    prev += alpha * (noise[i] - prev);
    out[i] = prev;
  }
  return out;
}

// Rain (loop): dense noise bursts (~600/s, 8ms each) -> highpass -> soft
// lowpass, per SOUND_SPEC.md's own recipe.
function rainLoop(durationS) {
  const n = Math.round(durationS * SAMPLE_RATE);
  const burstLen = Math.round(0.008 * SAMPLE_RATE);
  const gapLen = Math.round(SAMPLE_RATE / 600);
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i += gapLen) {
    for (let j = 0; j < burstLen && i + j < n; j += 1) raw[i + j] += (Math.random() * 2 - 1) * 0.6;
  }
  return lowpass(highpass(raw, 1200), 6000);
}

function buzzLoop(durationS) {
  return ampLfo(mixLayers(durationS, [
    { buf: triangleTone(durationS, 180), gain: 0.6 },
    { buf: triangleTone(durationS, 186), gain: 0.4 },
  ]), 12, 0.5);
}

// ---------------------------------------------------------- Kolobok slots

const KOLOBOK_SLOTS = [
  {
    id: 'kolobok.roll',
    category: 'kolobok',
    durationMs: 1500,
    loop: true,
    synthesize: () => lowpass(expDecay(whiteNoise(1.5), 0.6), 500),
  },
  {
    id: 'kolobok.hop',
    category: 'kolobok',
    durationMs: 450,
    loop: false,
    synthesize: () => mixLayers(0.45, [
      { buf: sineTone(0.09, (t) => 520 + t * 1600), gain: 0.7 },
      { buf: noiseThump(0.12, { cutoffHz: 220, decayRate: 30 }), atS: 0.1, gain: 0.6 },
    ]),
  },
  {
    id: 'kolobok.songNote1',
    category: 'kolobok',
    durationMs: 350,
    loop: false,
    synthesize: () => expDecay(triangleTone(0.35, 440), 4),
  },
  {
    id: 'kolobok.songNote2',
    category: 'kolobok',
    durationMs: 350,
    loop: false,
    synthesize: () => expDecay(triangleTone(0.35, 494), 4),
  },
  {
    id: 'kolobok.songNote3',
    category: 'kolobok',
    durationMs: 350,
    loop: false,
    synthesize: () => expDecay(triangleTone(0.35, 554), 4),
  },
  {
    id: 'kolobok.songNote4',
    category: 'kolobok',
    durationMs: 350,
    loop: false,
    synthesize: () => expDecay(triangleTone(0.35, 659), 4),
  },
  {
    id: 'kolobok.songNote5',
    category: 'kolobok',
    durationMs: 350,
    loop: false,
    synthesize: () => expDecay(triangleTone(0.35, 740), 4),
  },
  {
    id: 'kolobok.hum',
    category: 'kolobok',
    durationMs: 200,
    loop: false,
    synthesize: () => expDecay(triangleTone(0.2, 440), 6),
  },
  {
    id: 'kolobok.startled',
    category: 'kolobok',
    durationMs: 300,
    loop: false,
    synthesize: () => expDecay(highpass(whiteNoise(0.15), 2000), 20),
  },
  {
    id: 'kolobok.spin',
    category: 'kolobok',
    durationMs: 700,
    loop: false,
    synthesize: () => expDecay(bandpass(whiteNoise(0.6), 300, 1800), 3),
  },
  {
    id: 'kolobok.landingSquash',
    category: 'kolobok',
    durationMs: 150,
    loop: false,
    synthesize: () => noiseThump(0.15, { cutoffHz: 200, decayRate: 35 }),
  },
  {
    id: 'kolobok.dustPuff',
    category: 'kolobok',
    durationMs: 200,
    loop: false,
    synthesize: () => noiseThump(0.2, { cutoffHz: 600, decayRate: 14 }),
  },
  {
    id: 'kolobok.birthPop',
    category: 'kolobok',
    durationMs: 500,
    loop: false,
    synthesize: () => ampLfo(mixLayers(0.5, [
      { buf: sineTone(0.4, 700), gain: 0.5 },
      { buf: sineTone(0.4, 950), gain: 0.35 },
    ]), 7, 0.6),
  },
  {
    id: 'kolobok.gulp',
    category: 'kolobok',
    durationMs: 200,
    loop: false,
    synthesize: () => mixLayers(0.22, [
      { buf: sineTone(0.2, (t) => 200 - t * 700), gain: 0.8 },
      { buf: expDecay(whiteNoise(0.02), 60), atS: 0.19, gain: 0.5 },
    ]),
  },
  {
    // Live feedback: the popup bubble text ("I ran away from Grandma...")
    // is Kolobok's one actual line of dialogue -- unlike the other Kolobok
    // slots (non-verbal reactions), this is meant to be RE-RECORDED with
    // spoken words. The procedural default is a wordless instrumental
    // preview of the same tune (reusing the note1-5 pitches) so the slot
    // still has a sensible out-of-the-box sound before anyone records over
    // it. Duration matches the interactive encounter beat's own "singing"
    // window (encounterBeats.js: s(1300)->s(2000), 700ms at timeScale 1).
    id: 'kolobok.songLine',
    category: 'kolobok',
    durationMs: 700,
    loop: false,
    synthesize: () => mixLayers(0.7, [
      { buf: triangleTone(0.12, 440), atS: 0, gain: 0.5 },
      { buf: triangleTone(0.12, 494), atS: 0.13, gain: 0.5 },
      { buf: triangleTone(0.12, 554), atS: 0.26, gain: 0.5 },
      { buf: triangleTone(0.12, 659), atS: 0.39, gain: 0.5 },
      { buf: triangleTone(0.12, 740), atS: 0.52, gain: 0.5 },
    ]),
  },
  {
    id: 'kolobok.giggle',
    category: 'kolobok',
    durationMs: 400,
    loop: false,
    synthesize: () => mixLayers(0.4, [
      { buf: expDecay(triangleTone(0.08, 500), 18), atS: 0, gain: 0.6 },
      { buf: expDecay(triangleTone(0.08, 600), 18), atS: 0.1, gain: 0.6 },
      { buf: expDecay(triangleTone(0.08, 700), 18), atS: 0.2, gain: 0.6 },
      { buf: expDecay(triangleTone(0.1, 850), 16), atS: 0.3, gain: 0.65 },
    ]),
  },
];

// ---------------------------------------------------------- Animal slots
// (SOUND_SPEC.md Â§4.2 -- idle ticks + encounter reactions, per-character)

const ANIMAL_SLOTS = [
  { id: 'hare.idleHop', category: 'animals', durationMs: 300, loop: false, synthesize: () => blip(0.15, 900, 1300, 22) },
  {
    id: 'hare.sniff',
    category: 'animals',
    durationMs: 200,
    loop: false,
    synthesize: () => mixLayers(0.2, [
      { buf: noiseThump(0.06, { cutoffHz: 1000, decayRate: 60 }), atS: 0, gain: 0.5 },
      { buf: noiseThump(0.06, { cutoffHz: 1000, decayRate: 60 }), atS: 0.09, gain: 0.5 },
    ]),
  },
  { id: 'hare.startled', category: 'animals', durationMs: 350, loop: false, synthesize: () => blip(0.18, 1100, 1600, 20) },
  { id: 'wolf.headSweep', category: 'animals', durationMs: 4000, loop: true, synthesize: () => lowpass(whiteNoise(4), 250) },
  { id: 'wolf.howl', category: 'animals', durationMs: 1500, loop: false, synthesize: () => expDecay(growl(1.5, { lowHz: 250, highHz: 700, lfoHz: 2, depth: 0.3 }), 1.2) },
  {
    id: 'wolf.snapMiss',
    category: 'animals',
    durationMs: 400,
    loop: false,
    synthesize: () => mixLayers(0.4, [
      { buf: growl(0.2, { lowHz: 200, highHz: 500 }), atS: 0, gain: 0.6 },
      { buf: noiseThump(0.15, { cutoffHz: 250, decayRate: 30 }), atS: 0.18, gain: 0.7 },
    ]),
  },
  { id: 'bear.scratch', category: 'animals', durationMs: 900, loop: false, synthesize: () => expDecay(bandpass(whiteNoise(0.9), 400, 2200), 3) },
  { id: 'bear.grunt', category: 'animals', durationMs: 500, loop: false, synthesize: () => expDecay(growl(0.5, { lowHz: 100, highHz: 250 }), 5) },
  { id: 'bear.swipeMiss', category: 'animals', durationMs: 350, loop: false, synthesize: () => whoosh(0.35, 250, 700) },
  { id: 'fox.tailSway', category: 'animals', durationMs: 2500, loop: true, synthesize: () => lowpass(whiteNoise(2.5), 1500) },
  { id: 'fox.purr', category: 'animals', durationMs: 600, loop: false, synthesize: () => expDecay(triangleTone(0.6, 260), 2) },
  { id: 'fox.flatterCoo', category: 'animals', durationMs: 500, loop: false, synthesize: () => expDecay(triangleTone(0.5, 320), 2.2) },
  { id: 'fox.lipLick', category: 'animals', durationMs: 300, loop: false, synthesize: () => clickClack() },
  { id: 'grandma.hum', category: 'animals', durationMs: 800, loop: false, synthesize: () => expDecay(triangleTone(0.8, 300), 1.5) },
  {
    id: 'grandma.tapReaction',
    category: 'animals',
    durationMs: 400,
    loop: false,
    synthesize: () => expDecay(triangleTone(0.4, (t) => 300 + t * 60), 3),
  },
  { id: 'grandma.knitClick', category: 'animals', durationMs: 2000, loop: true, synthesize: () => mixLayers(2, [{ buf: clickClack(), atS: 0, gain: 0.8 }, { buf: clickClack(), atS: 1, gain: 0.8 }]) },
  { id: 'grandpa.castLine', category: 'animals', durationMs: 300, loop: false, synthesize: () => whoosh(0.3, 400, 1200) },
  {
    id: 'grandpa.catchCheer',
    category: 'animals',
    durationMs: 400,
    loop: false,
    synthesize: () => mixLayers(0.4, [
      { buf: triangleTone(0.13, 440), atS: 0, gain: 0.5 },
      { buf: triangleTone(0.13, 554), atS: 0.13, gain: 0.5 },
      { buf: triangleTone(0.13, 659), atS: 0.26, gain: 0.5 },
    ]),
  },
  { id: 'grandpa.sighBoot', category: 'animals', durationMs: 500, loop: false, synthesize: () => expDecay(growl(0.5, { lowHz: 150, highHz: 350, lfoHz: 1 }), 3) },
  { id: 'owl.hoot', category: 'animals', durationMs: 240, loop: false, synthesize: () => hoot() },
  { id: 'hedgehog.waddle', category: 'animals', durationMs: 1000, loop: true, synthesize: () => mixLayers(1, [{ buf: noiseThump(0.1, { cutoffHz: 300, decayRate: 30 }), atS: 0, gain: 0.4 }, { buf: noiseThump(0.1, { cutoffHz: 300, decayRate: 30 }), atS: 0.5, gain: 0.4 }]) },
  { id: 'hedgehog.squeak', category: 'animals', durationMs: 200, loop: false, synthesize: () => blip(0.12, 1000, 1500, 30) },
  { id: 'crow.caw', category: 'animals', durationMs: 350, loop: false, synthesize: () => expDecay(growl(0.35, { lowHz: 400, highHz: 1000, lfoHz: 6 }), 3) },
  { id: 'crow.wingFlap', category: 'animals', durationMs: 150, loop: false, synthesize: () => whoosh(0.15, 500, 1400) },
  { id: 'ridgeBird.peck', category: 'animals', durationMs: 100, loop: false, synthesize: () => noiseThump(0.1, { cutoffHz: 500, decayRate: 55 }) },
  { id: 'bee.buzz', category: 'animals', durationMs: 1200, loop: true, synthesize: () => buzzLoop(1.2) },
  { id: 'butterfly.flutter', category: 'animals', durationMs: 1000, loop: true, synthesize: () => ampLfo(highpass(whiteNoise(1), 4000), 14, 0.7) },
];

// ---------------------------------------------------------- Nature/ambience
// slots (SOUND_SPEC.md Â§4.3 -- always-on or zone-scoped loops)

const NATURE_SLOTS = [
  { id: 'ambience.wind', category: 'nature', durationMs: 4000, loop: true, synthesize: () => windLoop(4) },
  { id: 'ambience.rain', category: 'nature', durationMs: 3000, loop: true, synthesize: () => rainLoop(3) },
  { id: 'ambience.thunder', category: 'nature', durationMs: 500, loop: false, synthesize: () => rumble(0.5) },
  { id: 'ambience.pondRipple', category: 'nature', durationMs: 2000, loop: true, synthesize: () => bandpass(whiteNoise(2), 300, 2000) },
  {
    id: 'ambience.forestBirds',
    category: 'nature',
    durationMs: 6000,
    loop: true,
    synthesize: () => mixLayers(6, [
      { buf: blip(0.15, 1800, 2400, 20), atS: 0.4, gain: 0.3 },
      { buf: blip(0.15, 1600, 2100, 20), atS: 2.1, gain: 0.25 },
      { buf: blip(0.15, 2000, 2600, 20), atS: 4.3, gain: 0.3 },
    ]),
  },
  {
    id: 'ambience.nightCrickets',
    category: 'nature',
    durationMs: 5000,
    loop: true,
    synthesize: () => ampLfo(highpass(whiteNoise(5), 3500), 9, 0.8),
  },
  { id: 'ambience.izbaFire', category: 'nature', durationMs: 3000, loop: true, synthesize: () => ampLfo(lowpass(whiteNoise(3), 900), 3, 0.4) },
  { id: 'ambience.leaves', category: 'nature', durationMs: 3500, loop: true, synthesize: () => lowpass(whiteNoise(3.5), 2200) },
];

// ---------------------------------------------------------- Interactions /
// easter-egg slots (SOUND_SPEC.md Â§4.4)

function plop() {
  return expDecay(sineTone(0.14, (t) => 300 - t * (210 / 0.14)), 7);
}

const INTERACTION_SLOTS = [
  { id: 'ui.tapBlip', category: 'interactions', durationMs: 90, loop: false, synthesize: () => blip(0.09, 520, 660, 30) },
  { id: 'ui.plaqueBlip', category: 'interactions', durationMs: 90, loop: false, synthesize: () => blip(0.09, 520, 660, 30) },
  { id: 'egg.fishSplash', category: 'interactions', durationMs: 140, loop: false, synthesize: () => plop() },
  { id: 'egg.bootThud', category: 'interactions', durationMs: 200, loop: false, synthesize: () => noiseThump(0.2, { cutoffHz: 150, decayRate: 20 }) },
  { id: 'egg.goldSparkle', category: 'interactions', durationMs: 300, loop: false, synthesize: () => sparkle(0.3) },
  { id: 'egg.mushroomPop', category: 'interactions', durationMs: 150, loop: false, synthesize: () => blip(0.1, 700, 950, 35) },
  { id: 'egg.moonTwinkle', category: 'interactions', durationMs: 300, loop: false, synthesize: () => sparkle(0.3) },
  { id: 'egg.cloudDrizzle', category: 'interactions', durationMs: 2000, loop: false, synthesize: () => expDecay(rainLoop(2), 0.8) },
  {
    id: 'chimney.pipeClose',
    category: 'interactions',
    durationMs: 150,
    loop: false,
    synthesize: () => sweepingBandpass(whiteNoise(0.15), 900, 250),
  },
  {
    id: 'chimney.bubbleRelease',
    category: 'interactions',
    durationMs: 250,
    loop: false,
    synthesize: () => mixLayers(0.25, [
      { buf: whoosh(0.15, 400, 1200), atS: 0, gain: 0.6 },
      { buf: blip(0.08, 900, 700, 30), atS: 0.15, gain: 0.4 },
    ]),
  },
  { id: 'chimney.bubbleShrink', category: 'interactions', durationMs: 150, loop: false, synthesize: () => blip(0.1, 1400, 1900, 40) },
];

// ---------------------------------------------------------- UI / navigation
// slots (SOUND_SPEC.md Â§4.5)

const UI_SLOTS = [
  { id: 'ui.menuOpen', category: 'ui', durationMs: 150, loop: false, synthesize: () => whoosh(0.15, 400, 1000) },
  { id: 'ui.menuClose', category: 'ui', durationMs: 120, loop: false, synthesize: () => whoosh(0.12, 1000, 400) },
  { id: 'ui.playPause', category: 'ui', durationMs: 100, loop: false, synthesize: () => blip(0.1, 550, 700, 28) },
  { id: 'ui.eyeToggle', category: 'ui', durationMs: 100, loop: false, synthesize: () => blip(0.1, 480, 620, 28) },
  { id: 'ui.langToggle', category: 'ui', durationMs: 100, loop: false, synthesize: () => blip(0.1, 520, 660, 28) },
  { id: 'ui.eggCounterTap', category: 'ui', durationMs: 100, loop: false, synthesize: () => blip(0.1, 600, 750, 28) },
  { id: 'ui.zoneSettle', category: 'ui', durationMs: 120, loop: false, synthesize: () => noiseThump(0.12, { cutoffHz: 1200, decayRate: 45 }) },
  { id: 'ui.narrationAppear', category: 'ui', durationMs: 100, loop: false, synthesize: () => blip(0.1, 700, 850, 35) },
  { id: 'nav.crossroadsOpen', category: 'ui', durationMs: 200, loop: false, synthesize: () => whoosh(0.2, 350, 1100) },
];

// ---------------------------------------------------------- Story-only
// slots (SOUND_SPEC.md Â§4.6 -- STORY_SPEC.md chapters; every other story
// beat reuses a slot already declared above)

const STORY_SLOTS = [
  { id: 'story.doughAppear', category: 'story', durationMs: 500, loop: false, synthesize: () => sparkle(0.5, [900, 1200]) },
  { id: 'story.windowGlowSwell', category: 'story', durationMs: 800, loop: false, synthesize: () => ampLfo(triangleTone(0.8, 260), 1.2, 0.6) },
  { id: 'story.fadeToBlack', category: 'story', durationMs: 300, loop: false, synthesize: () => sineTone(0.3, (t) => 300 - t * 700) },
  { id: 'story.rebirthChime', category: 'story', durationMs: 500, loop: false, synthesize: () => sparkle(0.5) },
  { id: 'story.loopTransition', category: 'story', durationMs: 200, loop: false, synthesize: () => blip(0.2, 600, 750, 30) },
];

const SLOTS = [...KOLOBOK_SLOTS, ...ANIMAL_SLOTS, ...NATURE_SLOTS, ...INTERACTION_SLOTS, ...UI_SLOTS, ...STORY_SLOTS];
const SLOTS_BY_ID = Object.fromEntries(SLOTS.map((s) => [s.id, s]));

export function getSlotsByCategory(categoryId) {
  return SLOTS.filter((s) => s.category === categoryId);
}

export function getAllSlots() {
  return SLOTS;
}

export function getSlotDefinition(slotId) {
  return SLOTS_BY_ID[slotId] ?? null;
}

// Slot ids are already `<category>.<name>`, so this lines up exactly with
// the `sound.slot.<category>.<name>` nesting in strings.js.
export function getSlotLabelKey(slotId) {
  return `sound.slot.${slotId}`;
}

// ---------------------------------------------------------- manifest (which
// slots have a user recording overriding their default)

const userSoundsDir = new Directory(Paths.document, 'userSounds');

function ensureUserSoundsDir() {
  if (!userSoundsDir.exists) userSoundsDir.create({ intermediates: true });
}

function manifestFile() {
  ensureUserSoundsDir();
  return new File(userSoundsDir, 'manifest.json');
}

// In-memory cache so hot paths (playSlot, called on every tap/hop/etc.)
// don't hit the filesystem every time -- only re-read on first access,
// re-written (and kept in sync) whenever save/reset actually change it.
let manifestCache = null;

// { overrides: { slotId: {recordedAt} }, muted: { slotId: bool } } -- two
// separate top-level buckets so muting a slot (very common: live feedback
// wants every slot to START muted) can never be confused with "has a user
// recording" (isSlotOverridden below only ever looks at .overrides).
function emptyManifest() {
  return { overrides: {}, muted: {} };
}

function loadManifest() {
  if (manifestCache) return manifestCache;
  const file = manifestFile();
  if (!file.exists) {
    manifestCache = emptyManifest();
    return manifestCache;
  }
  try {
    const parsed = JSON.parse(file.textSync());
    manifestCache = { overrides: parsed.overrides ?? {}, muted: parsed.muted ?? {} };
  } catch {
    manifestCache = emptyManifest();
  }
  return manifestCache;
}

function persistManifest() {
  const file = manifestFile();
  if (!file.exists) file.create();
  file.write(JSON.stringify(manifestCache ?? emptyManifest()));
}

export function isSlotOverridden(slotId) {
  return Boolean(loadManifest().overrides[slotId]);
}

/** Live feedback: every slot starts MUTED -- nothing plays in the scene
 *  until a parent explicitly un-mutes the specific sounds they want active.
 *  Absence from the manifest (a slot never touched) means muted=true, not
 *  false, so this can't be conflated with isSlotOverridden's "has a
 *  recording" question -- a slot can be muted+default, muted+yours,
 *  unmuted+default, or unmuted+yours, independently. */
export function isSlotMuted(slotId) {
  const v = loadManifest().muted[slotId];
  return v === undefined ? true : v;
}

export function setSlotMuted(slotId, muted) {
  const manifest = loadManifest();
  manifest.muted[slotId] = muted;
  persistManifest();
  // If this happens to be a currently-running loop, silence it immediately
  // rather than waiting for its next natural start/stop edge.
  if (muted) stopLoop(slotId);
}

function recordingFile(slotId) {
  return new File(userSoundsDir, `${slotId}.m4a`);
}

/** Resolves the URI that should actually play for this slot right now --
 *  the user's own recording if one exists and its file is still there,
 *  otherwise the procedural default (rendered + cached on first ask). */
export function getSlotUri(slotId) {
  const slot = SLOTS_BY_ID[slotId];
  if (!slot) return null;
  if (isSlotOverridden(slotId)) {
    const file = recordingFile(slotId);
    if (file.exists) return file.uri;
  }
  return getCachedDefaultUri(slotId, slot.synthesize);
}

/** Copies a just-finished recording (expo-audio's own recorder writes to
 *  ITS OWN temp location) into this slot's permanent spot in the document
 *  directory, and flips the manifest -- called by the recording UI once
 *  `recorder.stop()` resolves. */
export function saveRecordingForSlot(slotId, recordedUri) {
  ensureUserSoundsDir();
  const dest = recordingFile(slotId);
  if (dest.exists) dest.delete();
  const src = new File(recordedUri);
  src.copySync(dest);
  const manifest = loadManifest();
  manifest.overrides[slotId] = { recordedAt: Date.now() };
  persistManifest();
  return dest.uri;
}

export function resetSlotToDefault(slotId) {
  const file = recordingFile(slotId);
  if (file.exists) file.delete();
  const manifest = loadManifest();
  delete manifest.overrides[slotId];
  persistManifest();
}

// ---------------------------------------------------------- playback (what
// scene code actually calls)

// playSlot/startSlotLoop respect the per-slot mute (default: muted);
// previewSlot/getSlotUri intentionally do NOT -- the menu's own PLAY button
// always previews audibly regardless of that slot's mute state, same as it
// already bypasses the master mute (soundEngine's own preview:true).
export function playSlot(slotId, opts) {
  if (isSlotMuted(slotId)) return;
  playOneShot(getSlotUri(slotId), opts);
}

export function previewSlot(slotId) {
  playOneShot(getSlotUri(slotId), { preview: true });
}

export function startSlotLoop(slotId) {
  if (isSlotMuted(slotId)) return;
  startLoop(slotId, getSlotUri(slotId));
}

export function updateSlotLoopVolume(slotId, volume) {
  setLoopVolume(slotId, volume);
}

export function stopSlotLoop(slotId) {
  stopLoop(slotId);
}
