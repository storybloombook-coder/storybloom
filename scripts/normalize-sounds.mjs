// Normalizes the loudness of the bundled sounds so none is jarringly loud or
// too quiet — the reader plays them all at full volume, so they must be matched
// at the source. Uses ffmpeg's EBU R128 loudnorm (perceived loudness, not raw
// peak). Effects target a LOUDER level than ambient beds, so ambient sits UNDER
// the effects during a read instead of competing with them.
//
// Run:  node scripts/normalize-sounds.mjs            (needs ffmpeg-static)
//       node scripts/normalize-sounds.mjs --only=fx_animal_chicken
//
// Re-running is safe: a file already near the target barely changes. It rewrites
// the .mp3 files in place — commit the result. Voices are skipped (they're synth
// placeholders pending real recordings).

import { execFileSync } from 'child_process';
import { existsSync, readdirSync, renameSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || null;
const ONLY_IDS = ONLY ? new Set(ONLY.split(',').map((s) => s.trim())) : null;

// EBU R128 loudness targets (integrated LUFS / true-peak dBTP / loudness range).
const TARGETS = {
  effects: { I: -16, TP: -1.5, LRA: 11 },
  ambient: { I: -23, TP: -2.0, LRA: 11 },
};

function normalizeFile(path, t) {
  const tmp = `${path}.norm.mp3`;
  execFileSync(
    ffmpeg,
    [
      '-y',
      '-i', path,
      '-af', `loudnorm=I=${t.I}:TP=${t.TP}:LRA=${t.LRA}`,
      '-ar', '44100',
      '-c:a', 'libmp3lame',
      '-q:a', '2',
      tmp,
    ],
    { stdio: 'ignore' }
  );
  renameSync(tmp, path);
}

let total = 0;
let ok = 0;
for (const [folder, t] of Object.entries(TARGETS)) {
  const dir = join(ROOT, 'assets', 'sounds', folder);
  if (!existsSync(dir)) continue;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.mp3'))
    .filter((f) => !ONLY_IDS || ONLY_IDS.has(f.replace(/\.mp3$/, '')));
  for (const f of files) {
    total += 1;
    try {
      normalizeFile(join(dir, f), t);
      ok += 1;
      process.stdout.write(`  ✓ ${folder}/${f}\n`);
    } catch (e) {
      process.stdout.write(`  ✗ ${folder}/${f}  (${e.message})\n`);
    }
  }
  console.log(`${folder}: target I=${t.I} LUFS`);
}
console.log(`\nDone: ${ok}/${total} normalized.`);
