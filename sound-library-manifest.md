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
| id             | triggers on words like            |
|----------------|-----------------------------------|
| fx_engine      | engine, car, truck, roared, motor |
| fx_laugh       | laughed, giggled, hooray          |
| fx_splash      | splash, jumped in, water          |
| fx_footsteps   | ran, walked, footsteps, stomped   |
| fx_door        | door, knock, opened, slammed      |
| fx_bell        | bell, ring, chimed                |
| fx_thunder     | thunder, boom, crash              |
| fx_animal_dog  | dog, bark, woof, puppy            |
| fx_animal_bird | bird, tweet, chirp                |
| fx_pop         | pop, burst, bubble                |
| fx_whoosh      | flew, zoomed, whoosh, wind        |
| fx_magic       | magic, sparkle, poof, wish        |

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
| id          | fires on / use                    |
|-------------|-----------------------------------|
| fx_switch   | light switch click                |
| fx_cry      | soft child crying / whimper       |
| fx_cheer    | kids cheer, "hooray"              |
| fx_snore    | gentle sleep breathing (optional) |
| fx_farm     | barnyard / farm animals           |
| fx_roar     | toy dinosaur roar (optional, fun) |
| fx_bubbles  | soap bubbles pop (bath scenes)    |
| voice_pip   | Pip — kind boy-child sting        |
| voice_posy  | Posy — distinct girl-child sting  |

Convention: `fx_none` is a sentinel meaning "no sound" (used in review swap
lists and optional test expectations) — it is not a file, just the null option.

## Rules
- These ids are the allow-lists injected into the Gemini prompt. Keep this file
  and the prompt contract in sync — if you add a clip, add its id to both.
- If Gemini has no good match for a cue, it should return null / drop the cue
  rather than force a wrong sound.
- Start SMALL: even 4 ambient + 6 effects + 2 voices is enough to demo the loop
  with one book. Add more once it works.
