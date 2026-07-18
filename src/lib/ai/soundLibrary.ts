// soundLibrary.ts — allow-list ids injected into the Gemini prompt.
// Keep in sync with sound-library-manifest.md (see CLAUDE.md).

import type { SoundAllowlists } from '../vision/contract';

// Ambient beds (looping background scenes). ~18 so most story settings have a fit.
export const AMBIENT_IDS = [
  'amb_forest',
  'amb_ocean',
  'amb_rain',
  'amb_night',
  'amb_indoors',
  'amb_city',
  'amb_meadow',
  'amb_jungle',
  'amb_beach',
  'amb_river',
  'amb_cave',
  'amb_snow',
  'amb_park',
  'amb_kitchen',
  'amb_bedroom',
  'amb_playground',
  'amb_space',
  'amb_underwater',
];

export interface SoundCategory {
  label: string;
  ids: string[];
}

// One-shot effects, grouped for the sound-picker's category tree (see
// page/[id].tsx). Big palette (100+) so the review picker always has a good
// option; the offline matcher auto-fires the subset that has TRIGGER_VOCAB rows,
// the rest are chosen manually. Ids are stable — never rename (cues reference them).
export const EFFECT_CATEGORIES: SoundCategory[] = [
  {
    label: 'Animals',
    ids: [
      'fx_animal_dog', 'fx_animal_bird', 'fx_animal_cat', 'fx_animal_cow', 'fx_animal_horse',
      'fx_animal_sheep', 'fx_animal_pig', 'fx_animal_duck', 'fx_animal_rooster', 'fx_animal_frog',
      'fx_animal_owl', 'fx_animal_lion', 'fx_animal_elephant', 'fx_animal_monkey', 'fx_animal_bee',
      'fx_animal_wolf', 'fx_animal_mouse', 'fx_animal_goat', 'fx_animal_chicken', 'fx_animal_snake',
      'fx_animal_cricket', 'fx_animal_seagull', 'fx_animal_whale', 'fx_animal_cat_purr', 'fx_animal_horse_gallop',
    ],
  },
  {
    label: 'Vehicles',
    ids: [
      'fx_engine', 'fx_car_pass', 'fx_car_horn', 'fx_train', 'fx_plane', 'fx_helicopter',
      'fx_boat', 'fx_siren', 'fx_motorcycle', 'fx_bicycle_bell', 'fx_rocket',
    ],
  },
  {
    label: 'Nature / weather',
    ids: [
      'fx_thunder', 'fx_wind', 'fx_waves', 'fx_waterfall', 'fx_fire',
      'fx_leaves', 'fx_rain', 'fx_stream', 'fx_splash',
    ],
  },
  {
    label: 'Household / objects',
    ids: [
      'fx_door', 'fx_doorbell', 'fx_knock', 'fx_bell', 'fx_clock',
      'fx_phone', 'fx_switch', 'fx_glass_clink', 'fx_keys', 'fx_zipper',
      'fx_scissors', 'fx_camera', 'fx_paper', 'fx_creak', 'fx_drawer',
      'fx_kettle', 'fx_clap',
    ],
  },
  {
    label: 'Human / body',
    ids: [
      'fx_laugh', 'fx_cry', 'fx_cheer', 'fx_snore', 'fx_sneeze',
      'fx_cough', 'fx_yawn', 'fx_kiss', 'fx_hiccup', 'fx_gasp',
      'fx_whistle', 'fx_gulp', 'fx_eat', 'fx_slurp', 'fx_heartbeat',
      'fx_footsteps', 'fx_footsteps_run',
    ],
  },
  {
    label: 'Toys / fun / game',
    ids: [
      'fx_pop', 'fx_bubbles', 'fx_squeak', 'fx_boing', 'fx_balloon',
      'fx_party_horn', 'fx_drum', 'fx_xylophone', 'fx_twinkle', 'fx_tada',
      'fx_buzz', 'fx_coin', 'fx_powerup', 'fx_bounce', 'fx_sparkle',
      'fx_magic', 'fx_whoosh', 'fx_swoosh',
    ],
  },
  {
    label: 'Music / bells',
    ids: ['fx_chime', 'fx_jingle', 'fx_gong', 'fx_music_box'],
  },
  {
    label: 'Impact / misc',
    ids: [
      'fx_plop', 'fx_crunch', 'fx_crash', 'fx_bang', 'fx_thud',
      'fx_ding', 'fx_click', 'fx_sizzle', 'fx_drip', 'fx_snap',
      'fx_splat', 'fx_boom', 'fx_roar', 'fx_farm',
    ],
  },
];

export const EFFECT_IDS = EFFECT_CATEGORIES.flatMap((c) => c.ids);

// ---- "Feeling lucky" (assign a random candidate) --------------------------
//
// review-flow.md's original spec calls this a cycle through an ORDERED,
// AI-ranked candidate list (candidateSoundIds) -- but nothing in this app has
// ever populated that with more than the single chosen id (see
// db.createCue: `candidateSoundIds: params.soundId ? [params.soundId] : []`).
// The offline trigger matcher maps ONE word to ONE id directly; there's no
// scoring step that produces real ranked alternates to store. With no ranking
// to lean on, a genuine random pick from the whole library is the honest v1
// behavior -- hence "Feeling lucky" rather than "Try another".

/** A random effect id, excluding `currentId` where possible (so tapping
 *  always changes something) -- falls back to the full pool if there's
 *  nothing else to pick from. */
export function randomEffectId(currentId: string | null): string {
  const pool = currentId ? EFFECT_IDS.filter((id) => id !== currentId) : EFFECT_IDS;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Same idea for ambient beds. */
export function randomAmbientId(currentId: string | null): string {
  const pool = currentId ? AMBIENT_IDS.filter((id) => id !== currentId) : AMBIENT_IDS;
  return pool[Math.floor(Math.random() * pool.length)];
}

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
  { soundId: 'amb_jungle', triggers: ['jungle', 'rainforest', 'vines', 'джунгли', 'тропики'] },
  { soundId: 'amb_beach', triggers: ['sand', 'seaside', 'shore', 'песок', 'берег'] },
  { soundId: 'amb_river', triggers: ['river', 'stream', 'creek', 'река', 'ручей'] },
  { soundId: 'amb_cave', triggers: ['cave', 'cavern', 'tunnel', 'пещера', 'тоннель'] },
  { soundId: 'amb_snow', triggers: ['snow', 'winter', 'ice', 'frost', 'снег', 'зима', 'лёд', 'мороз'] },
  { soundId: 'amb_park', triggers: ['park', 'garden', 'парк', 'сад'] },
  { soundId: 'amb_kitchen', triggers: ['kitchen', 'cooking', 'кухня'] },
  { soundId: 'amb_bedroom', triggers: ['bedroom', 'спальня', 'кровать'] },
  { soundId: 'amb_playground', triggers: ['playground', 'swings', 'slide', 'площадка', 'качели'] },
  { soundId: 'amb_space', triggers: ['space', 'planet', 'moon', 'rocket', 'космос', 'планета', 'луна', 'ракета'] },
  { soundId: 'amb_underwater', triggers: ['underwater', 'deep sea', 'под водой', 'глубина'] },
];

/** Keyword trigger words -> effect id (from the manifest's effects tables).
 *  The main 12 rows are verbatim from the manifest; the Bedtime-Frog additions
 *  use obvious trigger words derived from their described use. */
export const TRIGGER_VOCAB: TriggerEntry[] = [
  { soundId: 'fx_engine', triggers: ['engine', 'car', 'truck', 'bus', 'roared', 'motor', 'мотор', 'машина', 'автобус', 'ревел', 'гудок'] },
  { soundId: 'fx_car_pass', triggers: ['drove past', 'drove by', 'passed by', 'zoomed past', 'sped past', 'rushed past', 'проехала мимо', 'промчалась мимо'] },
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

  // --- Expanded palette: common auto-matchable effects. Earlier rows win a
  //     shared word; the ~60 remaining EFFECT_IDS have no triggers and are
  //     chosen manually in the review picker. ---
  // animals
  { soundId: 'fx_animal_cat', triggers: ['cat', 'meow', 'kitten', 'кот', 'кошка', 'мяу', 'котёнок'] },
  { soundId: 'fx_animal_cow', triggers: ['cow', 'moo', 'корова', 'мычит'] },
  { soundId: 'fx_animal_horse', triggers: ['horse', 'neigh', 'pony', 'лошадь', 'конь', 'ржёт', 'пони'] },
  { soundId: 'fx_animal_sheep', triggers: ['sheep', 'baa', 'lamb', 'овца', 'ягнёнок'] },
  { soundId: 'fx_animal_pig', triggers: ['pig', 'oink', 'piglet', 'свинья', 'хрю', 'поросёнок'] },
  { soundId: 'fx_animal_duck', triggers: ['duck', 'quack', 'утка', 'кря'] },
  { soundId: 'fx_animal_rooster', triggers: ['rooster', 'cock-a-doodle', 'петух', 'кукареку'] },
  { soundId: 'fx_animal_frog', triggers: ['frog', 'ribbit', 'croak', 'лягушка', 'ква'] },
  { soundId: 'fx_animal_owl', triggers: ['owl', 'hoot', 'сова', 'филин'] },
  { soundId: 'fx_animal_lion', triggers: ['lion', 'лев'] },
  { soundId: 'fx_animal_elephant', triggers: ['elephant', 'trumpet', 'слон'] },
  { soundId: 'fx_animal_monkey', triggers: ['monkey', 'ape', 'обезьяна', 'мартышка'] },
  { soundId: 'fx_animal_bee', triggers: ['bee', 'buzzed', 'пчела', 'жужжит'] },
  { soundId: 'fx_animal_wolf', triggers: ['wolf', 'howl', 'волк', 'вой'] },
  { soundId: 'fx_animal_mouse', triggers: ['mouse', 'мышь', 'мышка'] },
  { soundId: 'fx_animal_goat', triggers: ['goat', 'bleat', 'коза', 'козёл'] },
  { soundId: 'fx_animal_chicken', triggers: ['chicken', 'cluck', 'hen', 'курица', 'кудах'] },
  { soundId: 'fx_animal_snake', triggers: ['snake', 'hiss', 'змея', 'шипит'] },
  { soundId: 'fx_animal_cricket', triggers: ['cricket', 'сверчок'] },
  { soundId: 'fx_animal_seagull', triggers: ['seagull', 'gull', 'чайка'] },
  { soundId: 'fx_animal_whale', triggers: ['whale', 'кит'] },
  { soundId: 'fx_animal_horse_gallop', triggers: ['gallop', 'galloped', 'hooves', 'галоп', 'скакал', 'копыта'] },
  { soundId: 'fx_animal_cat_purr', triggers: ['purr', 'purred', 'мурлычет', 'мурчит'] },
  // vehicles
  { soundId: 'fx_car_horn', triggers: ['honk', 'honked', 'сигналит', 'би-би'] },
  { soundId: 'fx_train', triggers: ['train', 'choo', 'locomotive', 'поезд', 'паровоз'] },
  { soundId: 'fx_plane', triggers: ['plane', 'airplane', 'jet', 'самолёт'] },
  { soundId: 'fx_helicopter', triggers: ['helicopter', 'chopper', 'вертолёт'] },
  { soundId: 'fx_boat', triggers: ['boat', 'ship', 'sail', 'лодка', 'корабль'] },
  { soundId: 'fx_siren', triggers: ['siren', 'ambulance', 'police', 'сирена', 'скорая'] },
  { soundId: 'fx_motorcycle', triggers: ['motorcycle', 'motorbike', 'мотоцикл'] },
  { soundId: 'fx_rocket', triggers: ['blast off', 'launch', 'взлёт', 'старт'] },
  // nature / weather
  { soundId: 'fx_wind', triggers: ['breeze', 'gust', 'blew', 'дуло', 'порыв'] },
  { soundId: 'fx_waves', triggers: ['waves', 'surf', 'прибой'] },
  { soundId: 'fx_waterfall', triggers: ['waterfall', 'водопад'] },
  { soundId: 'fx_fire', triggers: ['fire', 'flames', 'campfire', 'огонь', 'костёр', 'пламя'] },
  { soundId: 'fx_leaves', triggers: ['leaves', 'rustle', 'rustled', 'листья', 'шелест'] },
  // household / objects
  { soundId: 'fx_doorbell', triggers: ['doorbell', 'ding dong', 'дверной звонок'] },
  { soundId: 'fx_clock', triggers: ['clock', 'tick tock', 'ticking', 'часы', 'тик-так'] },
  { soundId: 'fx_phone', triggers: ['phone', 'telephone', 'called', 'телефон', 'звонит'] },
  { soundId: 'fx_clap', triggers: ['clap', 'clapped', 'applause', 'хлопал', 'аплодисменты'] },
  { soundId: 'fx_scissors', triggers: ['scissors', 'snip', 'ножницы', 'чик'] },
  { soundId: 'fx_kettle', triggers: ['kettle', 'boiling', 'чайник', 'кипит'] },
  // human / body
  { soundId: 'fx_sneeze', triggers: ['sneeze', 'achoo', 'sneezed', 'чихнул', 'апчхи'] },
  { soundId: 'fx_cough', triggers: ['cough', 'coughed', 'кашель', 'кашлял'] },
  { soundId: 'fx_yawn', triggers: ['yawn', 'yawned', 'зевнул', 'зевота'] },
  { soundId: 'fx_kiss', triggers: ['kiss', 'kissed', 'поцелуй', 'чмок'] },
  { soundId: 'fx_gasp', triggers: ['gasp', 'gasped', 'ахнул'] },
  { soundId: 'fx_eat', triggers: ['munch', 'chew', 'ate', 'ел', 'жевал', 'ням'] },
  { soundId: 'fx_slurp', triggers: ['slurp', 'sipped', 'хлюп'] },
  { soundId: 'fx_footsteps_run', triggers: ['running', 'dashed', 'raced', 'мчался'] },
  // toys / fun / game
  { soundId: 'fx_squeak', triggers: ['squeak', 'squeaked', 'squeaky', 'пищит', 'писк'] },
  { soundId: 'fx_boing', triggers: ['boing', 'sprang', 'пружина'] },
  { soundId: 'fx_balloon', triggers: ['balloon', 'шарик'] },
  { soundId: 'fx_drum', triggers: ['drum', 'банг', 'барабан'] },
  { soundId: 'fx_tada', triggers: ['ta-da', 'tada', 'surprise', 'та-да', 'сюрприз'] },
  { soundId: 'fx_coin', triggers: ['coin', 'treasure', 'монета'] },
  { soundId: 'fx_bounce', triggers: ['bounce', 'bounced', 'отскок', 'скачет'] },
  { soundId: 'fx_sparkle', triggers: ['glitter', 'shine', 'shimmer', 'искорки', 'блёстки'] },
  { soundId: 'fx_swoosh', triggers: ['swoosh', 'swished', 'swept', 'вжух'] },
  // impact / misc
  { soundId: 'fx_crunch', triggers: ['crunch', 'crunched', 'хруст'] },
  { soundId: 'fx_crash', triggers: ['crash', 'smashed', 'разбил'] },
  { soundId: 'fx_bang', triggers: ['bang', 'banged', 'бах', 'бабах'] },
  { soundId: 'fx_ding', triggers: ['ding', 'dinged', 'дзынь', 'динь'] },
  { soundId: 'fx_drip', triggers: ['drip', 'dripped', 'кап'] },
  { soundId: 'fx_snap', triggers: ['snap', 'snapped', 'щёлк'] },
  { soundId: 'fx_boom', triggers: ['exploded', 'blast', 'взрыв'] },
];
