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

// ---- Trigger vocabulary (for the OFFLINE local cue matcher) --------------
//
// A cloud VLM (Gemini) picks sound ids by reasoning over the image. But the
// Belarus/on-device path (Tesseract OCR + no cloud) has only TEXT — so it must
// match trigger WORDS to ids itself. This table is that lookup. It is bilingual
// (EN + RU): the sound FILES are language-neutral, only the vocabulary differs.
//
// SOURCE OF TRUTH is sound-library-manifest.md — keep this table in sync with
// it (see the "Rules" section there). Ids here MUST already exist in the
// allow-lists above. Triggers are lowercase; matching lowercases the OCR text
// (toLowerCase handles Cyrillic correctly, no locale arg needed).

export interface TriggerEntry {
  soundId: string;
  triggers: string[]; // EN + RU, lowercase
}

/** background_scene keywords -> ambient bed id (from the manifest's ambient table). */
export const SCENE_VOCAB: TriggerEntry[] = [
  { soundId: 'amb_forest', triggers: ['forest', 'woods', 'jungle', 'trees', 'лес', 'чаща', 'деревья'] },
  { soundId: 'amb_ocean', triggers: ['sea', 'beach', 'waves', 'ocean', 'море', 'пляж', 'волны', 'океан'] },
  { soundId: 'amb_rain', triggers: ['rain', 'storm', 'rainy', 'дождь', 'гроза', 'ливень'] },
  { soundId: 'amb_night', triggers: ['night', 'bedtime', 'dark', 'stars', 'ночь', 'сон', 'темно', 'звёзды', 'звезды'] },
  { soundId: 'amb_indoors', triggers: ['house', 'room', 'home', 'indoors', 'дом', 'комната', 'дома'] },
  { soundId: 'amb_city', triggers: ['town', 'street', 'city', 'road', 'город', 'улица', 'дорога'] },
  { soundId: 'amb_meadow', triggers: ['field', 'meadow', 'outdoors', 'поле', 'луг'] },
];

/** Keyword trigger words -> effect id (from the manifest's effects tables).
 *  The main 12 rows are verbatim from the manifest; the Bedtime-Frog additions
 *  use obvious trigger words derived from their described use. */
export const TRIGGER_VOCAB: TriggerEntry[] = [
  { soundId: 'fx_engine', triggers: ['engine', 'car', 'truck', 'roared', 'motor', 'мотор', 'машина', 'ревел', 'гудок'] },
  { soundId: 'fx_laugh', triggers: ['laughed', 'giggled', 'hooray', 'смеялся', 'хихикал', 'ура'] },
  { soundId: 'fx_splash', triggers: ['splash', 'jumped in', 'water', 'плеск', 'брызги', 'плюх'] },
  { soundId: 'fx_footsteps', triggers: ['ran', 'walked', 'footsteps', 'stomped', 'бежал', 'шёл', 'шаги', 'топал'] },
  { soundId: 'fx_door', triggers: ['door', 'knock', 'opened', 'slammed', 'дверь', 'стук', 'открыл', 'хлопнула'] },
  { soundId: 'fx_bell', triggers: ['bell', 'ring', 'chimed', 'колокольчик', 'звонок', 'звенел'] },
  { soundId: 'fx_thunder', triggers: ['thunder', 'boom', 'crash', 'гром', 'бум', 'грохот'] },
  { soundId: 'fx_animal_dog', triggers: ['dog', 'bark', 'woof', 'puppy', 'собака', 'лай', 'гав', 'щенок'] },
  { soundId: 'fx_animal_bird', triggers: ['bird', 'tweet', 'chirp', 'птица', 'чирик', 'щебет'] },
  { soundId: 'fx_pop', triggers: ['pop', 'burst', 'bubble', 'лопнул', 'хлоп', 'пузырь'] },
  { soundId: 'fx_whoosh', triggers: ['flew', 'zoomed', 'whoosh', 'wind', 'летел', 'промчался', 'свист', 'ветер'] },
  { soundId: 'fx_magic', triggers: ['magic', 'sparkle', 'poof', 'wish', 'волшебство', 'искры', 'пуф', 'желание'] },
  { soundId: 'fx_switch', triggers: ['switch', 'click', 'выключатель', 'щёлк', 'щелчок'] },
  { soundId: 'fx_cry', triggers: ['cried', 'crying', 'whimper', 'плакал', 'плач', 'хныкал'] },
  { soundId: 'fx_cheer', triggers: ['cheered', 'cheer', 'радостные', 'ликовали'] },
  { soundId: 'fx_snore', triggers: ['snore', 'snored', 'храп', 'сопел'] },
  { soundId: 'fx_farm', triggers: ['farm', 'barn', 'ферма', 'хлев'] },
  { soundId: 'fx_roar', triggers: ['roar', 'зарычал', 'рёв'] },
  { soundId: 'fx_bubbles', triggers: ['bubbles', 'пузыри'] },
];
