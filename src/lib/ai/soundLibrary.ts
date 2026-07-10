// soundLibrary.ts — allow-list ids injected into the Gemini prompt.
// Keep in sync with sound-library-manifest.md (see CLAUDE.md).

import type { SoundAllowlists } from './gemini';

export const AMBIENT_IDS = [
  'amb_forest',
  'amb_ocean',
  'amb_rain',
  'amb_night',
  'amb_indoors',
  'amb_city',
  'amb_meadow',
];

export const EFFECT_IDS = [
  'fx_engine',
  'fx_laugh',
  'fx_splash',
  'fx_footsteps',
  'fx_door',
  'fx_bell',
  'fx_thunder',
  'fx_animal_dog',
  'fx_animal_bird',
  'fx_pop',
  'fx_whoosh',
  'fx_magic',
  'fx_switch',
  'fx_cry',
  'fx_cheer',
  'fx_snore',
  'fx_farm',
  'fx_roar',
  'fx_bubbles',
];

export const VOICE_IDS = [
  'voice_child',
  'voice_child_group',
  'voice_adult_warm',
  'voice_gruff',
  'voice_squeaky',
  'voice_animal',
  'voice_pip',
  'voice_posy',
];

export const SOUND_ALLOWLISTS: SoundAllowlists = {
  ambientIds: AMBIENT_IDS,
  effectIds: EFFECT_IDS,
  voiceIds: VOICE_IDS,
};
