// Fetch real CC0 sound effects + ambient beds from Freesound to replace the
// placeholder .wav clips. CC0 only => free AND safe to redistribute (matches
// SOUND-SOURCING.md and the shareable-builds vision). Per-clip license + author
// + source URL are saved to assets/sounds/CREDITS.json for provenance.
//
// Run: node scripts/fetch-freesound.mjs           (needs FREESOUND_API_TOKEN in .env)
//      node scripts/fetch-freesound.mjs --force   (re-fetch ids that already have mp3)
//
// It downloads the hi-quality preview mp3 (no OAuth needed), writes
// assets/sounds/<cat>/<id>.mp3, removes that id's placeholder .wav, then
// regenerates src/lib/audio/soundAssets.ts (mp3 where we have one, else wav).
//
// Voices (voice_*) are intentionally skipped — those are stylized character
// stings, not a good CC0 search; they keep their placeholders for now.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FORCE = process.argv.includes('--force');

// --- token from .env ---
const env = readFileSync(join(ROOT, '.env'), 'utf8');
const TOKEN = (env.match(/^FREESOUND_API_TOKEN=(.+)$/m) || [])[1]?.trim();
if (!TOKEN) {
  console.error('Missing FREESOUND_API_TOKEN in .env');
  process.exit(1);
}

// --- ids from soundLibrary.ts (stay in sync) ---
const LIB = readFileSync(join(ROOT, 'src', 'lib', 'ai', 'soundLibrary.ts'), 'utf8');
const idsOf = (name) => {
  const m = LIB.match(new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
};
const AMBIENT_IDS = idsOf('AMBIENT_IDS');
const EFFECT_IDS = idsOf('EFFECT_IDS');
const VOICE_IDS = idsOf('VOICE_IDS');

// --- search query per id ---
const Q = {
  // ambient
  amb_forest: 'forest birds ambience', amb_ocean: 'ocean waves ambience', amb_rain: 'rain ambience',
  amb_night: 'night crickets ambience', amb_indoors: 'quiet room tone', amb_city: 'city street ambience',
  amb_meadow: 'meadow wind birds', amb_jungle: 'jungle ambience', amb_beach: 'beach waves ambience',
  amb_river: 'river stream ambience', amb_cave: 'cave drips ambience', amb_snow: 'winter wind ambience',
  amb_park: 'park ambience birds', amb_kitchen: 'kitchen ambience', amb_bedroom: 'quiet room tone',
  amb_playground: 'children playground ambience', amb_space: 'space drone ambience', amb_underwater: 'underwater ambience',
  // animals
  fx_animal_dog: 'dog bark', fx_animal_bird: 'bird chirp', fx_animal_cat: 'cat meow', fx_animal_cow: 'cow moo',
  fx_animal_horse: 'horse neigh', fx_animal_sheep: 'sheep baa', fx_animal_pig: 'pig oink', fx_animal_duck: 'duck quack',
  fx_animal_rooster: 'rooster crow', fx_animal_frog: 'frog croak', fx_animal_owl: 'owl hoot', fx_animal_lion: 'lion roar',
  fx_animal_elephant: 'elephant trumpet', fx_animal_monkey: 'monkey call', fx_animal_bee: 'bee buzz', fx_animal_wolf: 'wolf howl',
  fx_animal_mouse: 'mouse squeak', fx_animal_goat: 'goat bleat', fx_animal_chicken: 'chicken cluck', fx_animal_snake: 'snake hiss',
  fx_animal_cricket: 'cricket chirp', fx_animal_seagull: 'seagull call', fx_animal_whale: 'whale call',
  fx_animal_cat_purr: 'cat purr', fx_animal_horse_gallop: 'horse gallop hooves',
  // vehicles
  fx_engine: 'car engine start', fx_car_horn: 'car horn honk', fx_train: 'train horn', fx_plane: 'airplane flyby',
  fx_helicopter: 'helicopter', fx_boat: 'boat horn', fx_siren: 'siren', fx_motorcycle: 'motorcycle engine',
  fx_bicycle_bell: 'bicycle bell', fx_rocket: 'rocket launch',
  // nature / weather
  fx_thunder: 'thunder clap', fx_wind: 'wind gust', fx_waves: 'ocean wave', fx_waterfall: 'waterfall',
  fx_fire: 'fire crackle', fx_leaves: 'leaves rustle', fx_rain: 'rain drops', fx_stream: 'stream water', fx_splash: 'water splash',
  // household / objects
  fx_door: 'door open close', fx_doorbell: 'doorbell', fx_knock: 'door knock', fx_bell: 'small bell ring',
  fx_clock: 'clock tick', fx_phone: 'telephone ring', fx_switch: 'light switch click', fx_glass_clink: 'glass clink',
  fx_keys: 'keys jingle', fx_zipper: 'zipper', fx_scissors: 'scissors cut', fx_camera: 'camera shutter',
  fx_paper: 'paper rustle', fx_creak: 'wood creak', fx_drawer: 'drawer open', fx_kettle: 'kettle whistle', fx_clap: 'single hand clap',
  // human / body
  fx_laugh: 'child laugh', fx_cry: 'baby cry', fx_cheer: 'kids cheer', fx_snore: 'snore', fx_sneeze: 'sneeze',
  fx_cough: 'cough', fx_yawn: 'yawn', fx_kiss: 'kiss', fx_hiccup: 'hiccup', fx_gasp: 'gasp', fx_whistle: 'whistle',
  fx_gulp: 'gulp drink', fx_eat: 'eating crunch', fx_slurp: 'slurp', fx_heartbeat: 'heartbeat',
  fx_footsteps: 'footsteps walking', fx_footsteps_run: 'running footsteps',
  // toys / fun / game
  fx_pop: 'pop', fx_bubbles: 'bubbles', fx_squeak: 'squeaky toy', fx_boing: 'boing spring', fx_balloon: 'balloon squeak',
  fx_party_horn: 'party horn', fx_drum: 'drum hit', fx_xylophone: 'xylophone note', fx_twinkle: 'magic twinkle',
  fx_tada: 'success fanfare', fx_buzz: 'wrong buzzer', fx_coin: 'coin collect', fx_powerup: 'power up',
  fx_bounce: 'bounce', fx_sparkle: 'magic sparkle', fx_magic: 'magic chime', fx_whoosh: 'whoosh', fx_swoosh: 'swoosh',
  // music / bells
  fx_chime: 'wind chime', fx_jingle: 'sleigh bells jingle', fx_gong: 'gong', fx_music_box: 'music box',
  // impact / misc
  fx_plop: 'plop water drop', fx_crunch: 'crunch', fx_crash: 'crash', fx_bang: 'bang', fx_thud: 'thud',
  fx_ding: 'ding bell', fx_click: 'click', fx_sizzle: 'sizzle frying', fx_drip: 'water drip', fx_snap: 'snap',
  fx_splat: 'splat', fx_boom: 'explosion boom', fx_roar: 'monster roar', fx_farm: 'farm animals',
};

const folderOf = (id) => (id.startsWith('amb_') ? 'ambient' : id.startsWith('voice_') ? 'voices' : 'effects');
const durationFilter = (id) => (id.startsWith('amb_') ? 'duration:[3 TO 40]' : 'duration:[0.2 TO 4]');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOne(id) {
  const query = Q[id];
  if (!query) return { id, status: 'no-query' };
  const folder = folderOf(id);
  const outMp3 = join(ROOT, 'assets', 'sounds', folder, `${id}.mp3`);
  if (existsSync(outMp3) && !FORCE) return { id, status: 'exists' };

  const filter = encodeURIComponent(`license:"Creative Commons 0" ${durationFilter(id)}`);
  const url = `https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(query)}&filter=${filter}&fields=id,name,previews,license,username,duration&sort=score&page_size=5&token=${TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) return { id, status: `search-${res.status}` };
  const json = await res.json();
  const hit = (json.results || []).find((r) => r.previews?.['preview-hq-mp3']);
  if (!hit) return { id, status: 'no-result' };

  const dl = await fetch(hit.previews['preview-hq-mp3']);
  if (!dl.ok) return { id, status: `download-${dl.status}` };
  const buf = Buffer.from(await dl.arrayBuffer());
  mkdirSync(dirname(outMp3), { recursive: true });
  writeFileSync(outMp3, buf);
  // Drop the placeholder wav for this id.
  const wav = join(ROOT, 'assets', 'sounds', folder, `${id}.wav`);
  if (existsSync(wav)) rmSync(wav);

  return {
    id,
    status: 'ok',
    credit: {
      id,
      query,
      freesoundId: hit.id,
      name: hit.name,
      author: hit.username,
      license: 'CC0 1.0',
      url: `https://freesound.org/s/${hit.id}/`,
      duration: Math.round(hit.duration * 100) / 100,
    },
  };
}

function regenSoundAssets() {
  const rel = (id) => {
    const folder = folderOf(id);
    for (const ext of ['mp3', 'wav']) {
      if (existsSync(join(ROOT, 'assets', 'sounds', folder, `${id}.${ext}`))) return `sounds/${folder}/${id}.${ext}`;
    }
    return null;
  };
  const lines = [...AMBIENT_IDS, ...EFFECT_IDS, ...VOICE_IDS]
    .map((id) => [id, rel(id)])
    .filter(([, r]) => r)
    .map(([id, r]) => `  '${id}': require('../../../assets/${r}'),`)
    .join('\n');
  const ts = `// AUTO-GENERATED (scripts/fetch-freesound.mjs / gen-placeholder-sounds.mjs) — do not edit.
// Maps each sound id to its bundled asset (real CC0 mp3 where fetched, else a
// synth placeholder wav). Metro needs static require() paths, hence the table.

export const SOUND_ASSETS: Record<string, number> = {
${lines}
};
`;
  writeFileSync(join(ROOT, 'src', 'lib', 'audio', 'soundAssets.ts'), ts);
}

const ids = [...AMBIENT_IDS, ...EFFECT_IDS]; // voices skipped
const credits = [];
let ok = 0;
const misses = [];
for (const id of ids) {
  try {
    const r = await fetchOne(id);
    if (r.status === 'ok') {
      ok++;
      credits.push(r.credit);
      console.log(`  ✓ ${id}  ←  "${r.credit.name}" by ${r.credit.author} (${r.credit.duration}s)`);
    } else if (r.status === 'exists') {
      console.log(`  · ${id} (already have mp3)`);
    } else {
      misses.push(`${id} [${r.status}]`);
      console.log(`  ✗ ${id}  (${r.status})`);
    }
  } catch (e) {
    misses.push(`${id} [error]`);
    console.log(`  ✗ ${id}  (${e.message})`);
  }
  await sleep(1100); // stay under the API rate limit
}

// Merge with any existing credits so re-runs don't lose entries.
const creditsPath = join(ROOT, 'assets', 'sounds', 'CREDITS.json');
let existing = [];
try { existing = JSON.parse(readFileSync(creditsPath, 'utf8')); } catch {}
const byId = new Map(existing.map((c) => [c.id, c]));
for (const c of credits) byId.set(c.id, c);
writeFileSync(creditsPath, JSON.stringify([...byId.values()].sort((a, b) => a.id.localeCompare(b.id)), null, 2));

regenSoundAssets();

console.log(`\nDone: ${ok} fetched, ${misses.length} missed.`);
if (misses.length) console.log('Missed:', misses.join(', '));
