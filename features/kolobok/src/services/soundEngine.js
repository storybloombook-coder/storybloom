// soundEngine.js — procedural audio synth + playback (SOUND_SPEC.md §1).
//
// Zero bundled sound files: every default sound is a tiny WAV rendered in
// code on first use, cached to disk, and played back with expo-audio.
// soundLibrary.js owns WHICH slot maps to WHICH recipe/uri; this file only
// knows how to synthesize samples, encode/cache WAVs, and play/loop a URI.
//
// expo-file-system here is the MODERN sync File/Directory/Paths API (this
// project is on SDK 57) -- NOT the older async FileSystem.writeAsStringAsync
// style some training data remembers. .exists/.create()/.write() are all
// synchronous; no await needed for any of them.

import { Directory, File, Paths } from 'expo-file-system';
import { createAudioPlayer } from 'expo-audio';

export const SAMPLE_RATE = 22050;

// ---------------------------------------------------------------- DSP core

function samplesFor(durationS) {
  return Math.max(1, Math.round(durationS * SAMPLE_RATE));
}

/** White noise in [-1, 1]. `rng` defaults to Math.random since these are
 *  ONE-TIME renders cached to disk, not per-frame scene state -- unlike
 *  the scene's own seeded PRNG convention, reload-determinism doesn't
 *  matter here (the cached file is identical after the first render
 *  regardless of what generated the samples that one time). */
export function whiteNoise(durationS, rng = Math.random) {
  const n = samplesFor(durationS);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = rng() * 2 - 1;
  return out;
}

/** Sine tone. `freq` is either a fixed Hz number or a function (tSeconds) =>
 *  Hz, for sweeps ("sine sweep 300->90Hz" etc.). */
export function sineTone(durationS, freq) {
  const n = samplesFor(durationS);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / SAMPLE_RATE;
    const hz = typeof freq === 'function' ? freq(t) : freq;
    phase += (2 * Math.PI * hz) / SAMPLE_RATE;
    out[i] = Math.sin(phase);
  }
  return out;
}

/** Triangle tone, fixed frequency (every recipe using this wants a steady
 *  musical pitch, not a sweep). */
export function triangleTone(durationS, freqHz) {
  const n = samplesFor(durationS);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / SAMPLE_RATE;
    const phase = (t * freqHz) % 1;
    out[i] = phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase;
  }
  return out;
}

/** One-pole lowpass (RC filter approximation) -- cheap, matches
 *  SOUND_SPEC.md's own "one-pole low/high-pass filters" building block. */
export function lowpass(buf, cutoffHz) {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / SAMPLE_RATE;
  const alpha = dt / (rc + dt);
  const out = new Float32Array(buf.length);
  let prev = 0;
  for (let i = 0; i < buf.length; i += 1) {
    prev += alpha * (buf[i] - prev);
    out[i] = prev;
  }
  return out;
}

/** One-pole highpass, complementary to lowpass above. */
export function highpass(buf, cutoffHz) {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / SAMPLE_RATE;
  const alpha = rc / (rc + dt);
  const out = new Float32Array(buf.length);
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const v = alpha * (prevOut + buf[i] - prevIn);
    prevIn = buf[i];
    prevOut = v;
    out[i] = v;
  }
  return out;
}

/** Crude bandpass: highpass then lowpass in series -- good enough at this
 *  scale/distance (matches this codebase's own "good enough" bar for small
 *  procedural effects, e.g. the texture/geometry helpers elsewhere). */
export function bandpass(buf, lowHz, highHz) {
  return lowpass(highpass(buf, lowHz), highHz);
}

/** Exponential decay envelope, `ratePerSecond` controls how fast it dies
 *  out (bigger = snappier). */
export function expDecay(buf, ratePerSecond) {
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i += 1) {
    const t = i / SAMPLE_RATE;
    out[i] = buf[i] * Math.exp(-ratePerSecond * t);
  }
  return out;
}

/** Amplitude LFO (tremolo) -- used by "sparkle"-style recipes. */
export function ampLfo(buf, lfoHz, depth = 1) {
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i += 1) {
    const t = i / SAMPLE_RATE;
    const lfo = 1 - depth + depth * (0.5 + 0.5 * Math.sin(2 * Math.PI * lfoHz * t));
    out[i] = buf[i] * lfo;
  }
  return out;
}

/** Linear fade in/out over the given lengths (seconds) -- default 0.5s/0.5s
 *  per live feedback, applied to every procedural default. Each ramp is
 *  independently clamped to at most HALF the buffer's own length (not just
 *  the buffer's full length), so on a sound shorter than inS+outS the two
 *  ramps can never fully overlap and erase the sound's own peak entirely --
 *  there's always at least a brief moment at full volume in the middle. */
export function fadeInOut(buf, inS = 0.5, outS = 0.5) {
  const out = Float32Array.from(buf);
  const half = Math.floor(out.length / 2);
  const inN = Math.min(half, samplesFor(inS));
  const outN = Math.min(half, samplesFor(outS));
  for (let i = 0; i < inN; i += 1) out[i] *= i / inN;
  for (let i = 0; i < outN; i += 1) out[out.length - 1 - i] *= i / outN;
  return out;
}

/** Mixes several {buf, atS, gain} layers into one buffer of `totalS`
 *  seconds -- e.g. a rising blip + a landing thud a beat later. */
export function mixLayers(totalS, layers) {
  const total = new Float32Array(samplesFor(totalS));
  layers.forEach(({ buf, atS = 0, gain = 1 }) => {
    const offset = Math.round(atS * SAMPLE_RATE);
    for (let i = 0; i < buf.length; i += 1) {
      const idx = offset + i;
      if (idx >= 0 && idx < total.length) total[idx] += buf[i] * gain;
    }
  });
  return total;
}

function normalize(buf, peak = 0.9) {
  let max = 0;
  for (let i = 0; i < buf.length; i += 1) max = Math.max(max, Math.abs(buf[i]));
  if (max < 1e-6) return buf;
  const scale = peak / max;
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i += 1) out[i] = buf[i] * scale;
  return out;
}

// ---------------------------------------------------------------- WAV encode

/** RIFF/WAVE header + 16-bit PCM mono samples -- the whole reason this file
 *  can ship zero bundled audio: this IS the audio asset, generated in JS. */
export function encodeWav(samples) {
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate (mono, 16-bit)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff), true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

// ---------------------------------------------------------------- caching

const sfxDir = new Directory(Paths.cache, 'sfx');

function ensureSfxDir() {
  if (!sfxDir.exists) sfxDir.create({ intermediates: true });
}

/** Renders `synthesizeFn()` (a () => Float32Array) to a cached WAV file the
 *  first time this slot is asked for, and just returns the existing file's
 *  uri every time after (including across app restarts -- the cache dir
 *  persists until the OS or user clears it, at which point this quietly
 *  re-renders). */
export function getCachedDefaultUri(slotId, synthesizeFn) {
  ensureSfxDir();
  const file = new File(sfxDir, `${slotId}.wav`);
  if (!file.exists) {
    const wavBytes = encodeWav(normalize(fadeInOut(synthesizeFn())));
    file.create();
    file.write(wavBytes);
  }
  return file.uri;
}

// ---------------------------------------------------------------- playback

// SOUND_SPEC.md §2 originally specified 3. Raised to 6 after live feedback
// ("it's important that sounds are overlapping"): the pool is round-robin,
// so the Nth+1 concurrent sound doesn't get "dropped" as the spec's wording
// suggests -- it REPLACES the oldest player, cutting that sound off
// mid-playback. At 3 voices any moderately busy moment (a character line +
// an interaction blip + a UI tap) was audibly truncating things.
const ONE_SHOT_POOL_SIZE = 6;
let oneShotPool = null;
let poolIndex = 0;

function getPool() {
  if (!oneShotPool) {
    oneShotPool = new Array(ONE_SHOT_POOL_SIZE).fill(0).map(() => createAudioPlayer(null));
  }
  return oneShotPool;
}

// Dedicated channel for spoken lines (the `dialogue` category), kept OUT of
// the round-robin pool above. Dialogue slots run up to 4.5s -- far longer
// than any effect -- so on a shared pool they were the most likely thing to
// get evicted mid-sentence by a burst of short blips, which is exactly the
// wrong trade now that the user can record the whole tale in their own
// voice. Its own player means narration can never be cut off by an effect;
// a NEW line still replaces the previous one, which is correct (two
// overlapping narrators would just be mush).
let voicePlayer = null;

function getVoicePlayer() {
  if (!voicePlayer) voicePlayer = createAudioPlayer(null);
  return voicePlayer;
}

let masterEnabled = true; // toggled by Scene3D.jsx's own mute button (stacked above the sound-library button)
let masterVolume = 0.35;

/** Live feedback: muting didn't actually silence anything already looping
 *  (ambient beds like kolobok.roll) -- playOneShot checked masterEnabled,
 *  but startLoop never did, and flipping the flag never touched players
 *  already playing. Now every loop player is paused the instant mute turns
 *  on, and resumed on unmute -- but only the ones that were actually
 *  "wanted playing" at the time (see loopPlayers' own wantsPlaying below),
 *  not ones a caller had already stopped for unrelated reasons. */
export function setMasterEnabled(enabled) {
  masterEnabled = enabled;
  if (!enabled) {
    loopPlayers.forEach(({ player }) => player.pause());
  } else {
    loopPlayers.forEach(({ player, wantsPlaying }) => { if (wantsPlaying) player.play(); });
  }
}
export function setMasterVolume(volume) { masterVolume = volume; }
export function isMasterEnabled() { return masterEnabled; }

/** Plays a one-shot sound immediately. `preview` bypasses the master
 *  enabled/volume gating (the sound-library menu's own PLAY button always
 *  previews audibly, regardless of the ambient scene toggle). */
export function playOneShot(uri, { volume = 1, rate = 1, preview = false, channel = 'sfx' } = {}) {
  if (!uri) return;
  if (!preview && !masterEnabled) return;
  let player;
  if (channel === 'voice') {
    player = getVoicePlayer();
  } else {
    const pool = getPool();
    player = pool[poolIndex];
    poolIndex = (poolIndex + 1) % pool.length;
  }
  player.replace(uri);
  player.volume = (preview ? 1 : masterVolume) * volume;
  // Live feedback: assigning player.playbackRate throws "Cannot assign to
  // property 'playbackRate' which has only a getter" on Android at runtime
  // despite the expo-audio .d.ts documenting it as a plain settable
  // property -- setPlaybackRate() is the actual working setter.
  player.setPlaybackRate(rate);
  player.play();
}

const loopPlayers = new Map(); // slotId -> { player, uri, wantsPlaying }

/** Starts (or re-targets) a looping ambience player for `slotId`. Re-uses
 *  the existing player instance across calls so re-recording an ambient
 *  slot mid-playback just swaps the source instead of tearing anything
 *  down. `volumeRef` is a () => number getter, re-read every ~250ms by
 *  soundLibrary.js's own ambience ticker (SOUND_SPEC.md §1).
 *  `wantsPlaying` tracks the CALLER's own intent independent of
 *  masterEnabled -- while muted this still records the request but leaves
 *  the underlying player paused, so setMasterEnabled(true) above knows
 *  which loops to actually resume. */
export function startLoop(slotId, uri, { preview = false } = {}) {
  if (!uri) return;
  const audible = preview || masterEnabled;
  const existing = loopPlayers.get(slotId);
  if (existing && existing.uri === uri) {
    existing.wantsPlaying = true;
    existing.player.volume = preview ? 1 : masterVolume;
    if (audible && !existing.player.playing) existing.player.play();
    return;
  }
  if (existing) existing.player.remove();
  const player = createAudioPlayer(uri);
  player.loop = true;
  player.volume = preview ? 1 : masterVolume;
  loopPlayers.set(slotId, { player, uri, wantsPlaying: true });
  if (audible) player.play();
}

export function setLoopVolume(slotId, volume) {
  const existing = loopPlayers.get(slotId);
  if (existing) existing.player.volume = masterVolume * volume;
}

export function stopLoop(slotId) {
  const existing = loopPlayers.get(slotId);
  if (!existing) return;
  existing.wantsPlaying = false;
  existing.player.pause();
}

export function stopAllLoops() {
  loopPlayers.forEach(({ player }) => player.pause());
}
