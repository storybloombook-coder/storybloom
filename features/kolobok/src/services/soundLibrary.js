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

const SLOTS = [...KOLOBOK_SLOTS];
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

function loadManifest() {
  if (manifestCache) return manifestCache;
  const file = manifestFile();
  if (!file.exists) {
    manifestCache = {};
    return manifestCache;
  }
  try {
    manifestCache = JSON.parse(file.textSync());
  } catch {
    manifestCache = {};
  }
  return manifestCache;
}

function persistManifest() {
  const file = manifestFile();
  if (!file.exists) file.create();
  file.write(JSON.stringify(manifestCache ?? {}));
}

export function isSlotOverridden(slotId) {
  return Boolean(loadManifest()[slotId]);
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
  manifest[slotId] = { recordedAt: Date.now() };
  persistManifest();
  return dest.uri;
}

export function resetSlotToDefault(slotId) {
  const file = recordingFile(slotId);
  if (file.exists) file.delete();
  const manifest = loadManifest();
  delete manifest[slotId];
  persistManifest();
}

// ---------------------------------------------------------- playback (what
// scene code actually calls)

export function playSlot(slotId, opts) {
  playOneShot(getSlotUri(slotId), opts);
}

export function previewSlot(slotId) {
  playOneShot(getSlotUri(slotId), { preview: true });
}

export function startSlotLoop(slotId) {
  startLoop(slotId, getSlotUri(slotId));
}

export function updateSlotLoopVolume(slotId, volume) {
  setLoopVolume(slotId, volume);
}

export function stopSlotLoop(slotId) {
  stopLoop(slotId);
}
