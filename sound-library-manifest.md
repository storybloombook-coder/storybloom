# Sound Library Manifest — Storybloom

The app ships with a fixed set of royalty-free sounds. Gemini matches page cues
to these ids (see gemini-vision-prompt.md). This is a STARTER set — expand later.

## Where to get free, royalty-free clips
- Pixabay (pixabay.com/sound-effects) — free, no attribution required, easy.
- Mixkit (mixkit.co/free-sound-effects) — free for commercial use.
- Freesound (freesound.org) — huge, but CHECK each clip's license (some
  require attribution; prefer CC0 / public-domain clips).

Prefer short files. Ambient beds can loop (10-30s). Effects should be 1-3s.
Use .mp3 or .m4a. Keep total bundle small (aim < a few MB per clip).

## Suggested folder layout (in the app)
assets/sounds/ambient/   -> looping background beds
assets/sounds/effects/   -> one-shot keyword effects
assets/sounds/voices/    -> character voice stings

## Ambient beds (background_scene -> ambient_sound_id)
| id           | scene / use            | notes                    |
|--------------|------------------------|--------------------------|
| amb_forest   | forest, woods, jungle  | birds + leaves           |
| amb_ocean    | sea, beach, waves      | gentle surf              |
| amb_rain     | rain, storm            | soft rainfall            |
| amb_night    | night, bedtime         | crickets / calm          |
| amb_indoors  | house, room, home      | quiet room tone          |
| amb_city     | town, street, city     | light traffic / bustle   |
| amb_meadow   | field, farm, outdoors  | wind + distant birds     |

## Keyword effects (trigger word -> sound_id)
Trigger lists are bilingual (EN + RU) — Gemini may match either language, since
sound files themselves are language-neutral.
| id             | triggers on words like (EN)       | triggers on words like (RU)         |
|----------------|------------------------------------|--------------------------------------|
| fx_engine      | engine, car, truck, roared, motor | мотор, машина, ревел, гудок          |
| fx_laugh       | laughed, giggled, hooray          | смеялся, хихикал, ура                |
| fx_splash      | splash, jumped in, water          | плеск, брызги, плюх                  |
| fx_footsteps   | ran, walked, footsteps, stomped   | бежал, шёл, шаги, топал              |
| fx_door        | door, knock, opened, slammed      | дверь, стук, открыл, хлопнула        |
| fx_bell        | bell, ring, chimed                | колокольчик, звонок, звенел          |
| fx_thunder     | thunder, boom, crash              | гром, бум, грохот                    |
| fx_animal_dog  | dog, bark, woof, puppy            | собака, лай, гав, щенок              |
| fx_animal_bird | bird, tweet, chirp                | птица, чирик, щебет                  |
| fx_pop         | pop, burst, bubble                | лопнул, хлоп, пузырь                 |
| fx_whoosh      | flew, zoomed, whoosh, wind        | летел, промчался, свист, ветер       |
| fx_magic       | magic, sparkle, poof, wish        | волшебство, искры, пуф, желание      |

## Character voice stings (voice_id)
These are short, non-verbal voice-style stings (not real dialogue), just to give
each speaker a distinct sonic feel when their line is read.
| id                | fits speaker type            |
|-------------------|------------------------------|
| voice_child       | a child / small character    |
| voice_child_group | several children / "the boys"|
| voice_adult_warm  | parent / narrator / grown-up |
| voice_gruff       | big / grumpy character        |
| voice_squeaky     | tiny / silly character        |
| voice_animal      | talking animal                |

## Additions from the first real book (Bedtime Frog — see examples/)
These ids are used by the worked example and its test fixture; include them in
the allow-lists alongside the starter set above.
| id          | fires on / use (EN)               | fires on / use (RU)                |
|-------------|------------------------------------|--------------------------------------|
| fx_switch   | light switch click                | щелчок выключателя                 |
| fx_cry      | soft child crying / whimper       | плач, хныканье                     |
| fx_cheer    | kids cheer, "hooray"              | ура, радостные крики                |
| fx_snore    | gentle sleep breathing (optional) | сопение во сне (optional)          |
| fx_farm     | barnyard / farm animals           | ферма, домашние животные           |
| fx_roar     | toy dinosaur roar (optional, fun) | рёв динозавра (optional)            |
| fx_bubbles  | soap bubbles pop (bath scenes)    | мыльные пузыри                     |
| voice_pip   | Pip — kind boy-child sting        | Пип — sting for the same character |
| voice_posy  | Posy — distinct girl-child sting  | Поси — sting for the same character|

Convention: `fx_none` is a sentinel meaning "no sound" (used in review swap
lists and optional test expectations) — it is not a file, just the null option.

## Rules
- These ids are the allow-lists injected into the Gemini prompt. Keep this file
  and the prompt contract in sync — if you add a clip, add its id to both.
- If Gemini has no good match for a cue, it should return null / drop the cue
  rather than force a wrong sound.
- Start SMALL: even 4 ambient + 6 effects + 2 voices is enough to demo the loop
  with one book. Add more once it works.
