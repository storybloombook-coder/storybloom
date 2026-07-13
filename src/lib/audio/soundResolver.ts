// soundResolver.ts — turn a stored sound_id into something expo-audio can play.
//
// Two kinds of sound live in the same sound_id field:
//   - "custom:<uri>"  → a parent recording on disk (word-level sound editing)
//   - a library id     → a bundled asset (fx_*, amb_*, voice_*) from SOUND_ASSETS
// Everything that plays a cue/ambient should go through here so both kinds work.

import { SOUND_ASSETS } from './soundAssets';

/** A source accepted by expo-audio's createAudioPlayer / useAudioPlayer:
 *  a require()'d module number (bundled asset) or a { uri } (recording). */
export type SoundSource = number | { uri: string } | null;

const CUSTOM_PREFIX = 'custom:';

export function isCustomSound(soundId: string | null | undefined): boolean {
  return !!soundId && soundId.startsWith(CUSTOM_PREFIX);
}

/** Resolve a sound_id to a playable source, or null if there's nothing to play. */
export function resolveSoundSource(soundId: string | null | undefined): SoundSource {
  if (!soundId) return null;
  if (soundId.startsWith(CUSTOM_PREFIX)) return { uri: soundId.slice(CUSTOM_PREFIX.length) };
  return SOUND_ASSETS[soundId] ?? null;
}

/** Whether a sound_id can actually be played (has a bundled asset or a uri). */
export function isPlayable(soundId: string | null | undefined): boolean {
  return resolveSoundSource(soundId) !== null;
}
