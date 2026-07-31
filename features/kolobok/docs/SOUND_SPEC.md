# SOUND_SPEC.md — procedural audio + recordable sound library (Phase 9)

Two layers, always both present:

1. **Procedural defaults** — zero bundled files, consistent with the package
   philosophy: a tiny synth renders short WAVs in code on first launch,
   caches them, and plays them via expo-audio. Every sound slot in §4 has
   one of these as its out-of-the-box sound.
2. **Recordable overrides** — a fixed-slot library (§2/§3) lets the user
   replace any default with their own recording (their voice, a sound they
   make, whatever). Slots can't be added or removed — every slot maps to a
   specific trigger already in the scene — only which audio plays for a
   slot changes. Reset-to-default is always available per slot.

Live feedback: this supersedes the single opt-in mute toggle originally
planned here with a per-slot system; the mute toggle's job (silence
everything) becomes a master volume/mute control that still applies to
both defaults and recordings.

## 1. Engine (`src/services/soundEngine.js`)

- Render mono 16-bit PCM at 22050 Hz into WAV byte arrays (RIFF header +
  samples — ~30 lines), write once to `FileSystem.cacheDirectory/sfx/` via
  expo-file-system, load with expo-audio. Deleting the cache just
  re-renders (~200 ms).
- Building blocks implemented in plain JS: sine/triangle oscillators, white
  noise, one-pole low/high-pass filters, exponential decay envelopes, and
  an amplitude LFO. Seeded PRNG (reuse the texture one, `scene/prng.js`).
- Audio mode: `playsInSilentMode: false` (respect the hardware mute), no
  background audio, duck nothing.
- API: `sfx.play(slotId, {volume, rate})` (≤ 3 concurrent one-shots; extra
  requests dropped), `sfx.loop(slotId, volumeRef)` for ambiences (volume
  re-checked every 250 ms from a getter), all loops fade in/out over 400 ms.
  `sfx.play`/`sfx.loop` resolve to WHICHEVER audio is currently assigned to
  that slot (procedural default or user recording) — callers never know
  which; that's `soundLibrary.js`'s job (§3).
- Master: default volume 0.35, default state **off** (opt-in) via a small
  speaker toggle next to the mode toggle on MainScreen, host persists via
  `onSoundChange`. Strings: `ui.soundOn` / `ui.soundOff`.
- Lifecycle: loops pause on AppState background and in flat mode; sleep
  mode halves ambience volume; story mode plays everything as normal.

### Base synthesis recipes (reused/extended as defaults in §4)
| name | recipe |
|------|--------|
| blip | sine 520→660 Hz over 90 ms, exp decay |
| plop | sine sweep 300→90 Hz, 140 ms, decay 0.15 |
| note1–5 | triangle waves at 440/494/554/659/740 Hz (A-major pentatonic), 350 ms, soft 30 ms attack |
| gulp | sine sweep 200→60 Hz 200 ms + 20 ms noise tick at end |
| sparkle | sines 1.2k+1.6k+2.4kHz, amp LFO 8 Hz, 300 ms |
| hoot | two 380 Hz sine pulses (120 ms each, 90 ms gap), lowpass 800 Hz |
| rumble | noise → lowpass 120 Hz, 500 ms swell-decay |
| wind (loop) | white noise → lowpass 400 Hz, cutoff LFO ±150 Hz at 0.12 Hz, crossfade 0.5 s |
| rain (loop) | dense noise bursts (600/s, 8 ms each) → highpass 1.2 kHz, soft lowpass 6 kHz |
| growl | noise → bandpass ~150-300 Hz, slow amp LFO, 400-600 ms |
| chirp/squeak | sine 900→1400 Hz, 60-90 ms, fast decay |
| thud | noise burst → lowpass 200 Hz, 80 ms, sharp decay |
| whoosh | noise → bandpass sweeping 300→1800 Hz over the sound's own duration |
| click-clack | two short noise ticks → highpass 2 kHz, 15 ms each, 80 ms apart |
| buzz (loop) | triangle ~180 Hz + slight detune second voice, amp LFO 12 Hz |

## 2. Recording-library UI

- **Button**: a new 40×40 circular button (identical `TactileButton` styling
  to every other corner control), musical-note icon, stacked directly
  ABOVE the eye-toggle button (same stacking convention the eye toggle
  itself uses above play/pause, and the language toggle uses above the
  main-menu button — `Scene3D.jsx`'s established corner-button pattern).
  3D mode only (sound triggers are scene-specific; flat mode has none).
  `accessibilityLabel` → `ui.soundLibrary`.
- **Menu**: opens a modal/sheet — same visual language as the existing
  library-style list screens in the app (chunky framed panels, per the
  root DESIGN-DIRECTION.md) — grouped by the categories in §4, each row:
  category icon, slot name, a small waveform/note glyph, PLAY (preview
  current audio), RECORD (re-record), and a reset-to-default icon (only
  enabled once a slot has been overridden). Read-only structure: no
  add/delete anywhere in this screen, ever.
- A small badge per slot shows "default" vs "yours" so it's clear at a
  glance which slots have been personalized.

## 3. Recording pipeline

- Tap RECORD on a slot → a 3-2-1 countdown (large centered numerals, same
  countdown for every slot regardless of target length) → recording starts
  automatically the instant it hits 1 → **hard auto-stop** the moment the
  slot's own target duration (§4) is reached — the user cannot record
  longer than the slot calls for, guaranteeing sync with the animation/loop
  every time. A live progress ring shows time remaining during capture.
- Ambient/loop slots use the SAME hard-stop rule against their own target
  loop length (§4 lists one per ambient slot, matching the existing
  synthesis recipe durations above where applicable) rather than an
  open-ended capture.
- Uses `expo-audio`'s recorder API (already an allowed dependency here);
  `android.permission.RECORD_AUDIO` is already declared in `app.config.js`
  (reused from the Vosk speech-recognition path) — add an iOS
  `NSMicrophoneUsageDescription` string via the `expo-audio` plugin config
  if not already present.
- Recordings save to `FileSystem.documentDirectory/userSounds/<slotId>.m4a`
  (persists across launches, unlike the WAV cache dir which can be wiped),
  local-only — no cloud sync, no account, matching the rest of the app's
  local-only v1 storage model. A small JSON manifest
  (`userSounds/manifest.json`) maps slotId → { recordedAt, overridden:true }
  so `soundLibrary.js` knows which slots to load from disk vs synthesize.
- Reset-to-default deletes that slot's recording file + manifest entry;
  the procedural default takes back over immediately.
- Recording UI disables/pauses any currently-playing ambient loops for the
  duration of the countdown+capture so the mic isn't fighting scene audio.

## 4. Sound inventory

Every row is a fixed library slot. "Loop" rows show target LOOP length
(recording hard-stops there and the clip crossfade-loops); everything else
is a one-shot target duration. Durations marked "≈" come straight from the
timings already in ANIMATION_SPEC.md/STORY_SPEC.md/EASTER_EGGS.md; sounds
with no existing timed beat get a reasonable proposed duration.

### 4.1 Kolobok
| slot | trigger | dur | default synthesis |
|------|---------|-----|--------|
| kolobok.roll (loop) | continuous while rolling faster than idle | 1.5 s | soft noise → lowpass 500 Hz, very low volume, textured "rolling over grass" |
| kolobok.hop | tap-to-hop | 450 ms ≈ | blip variant, pitch rises then a soft thud on landing |
| kolobok.songNote | each of the 5 song notes | 350 ms ≈ | note1–5 (existing) |
| kolobok.hum | road-chapter humming, single random note | 200 ms | note1–5 at low volume, rate varied |
| kolobok.startled | expression → startled (encounter start) | 300 ms | quick intake-of-breath: noise burst → highpass 2 kHz, 80 ms |
| kolobok.spin | defiant 360° spin | 700 ms ≈ | whoosh |
| kolobok.landingSquash | any squash landing (hop, jump, story beats) | 150 ms ≈ | thud |
| kolobok.dustPuff | dust-burst moments (jump landing, squash) | 200 ms | soft noise puff → lowpass 600 Hz |
| kolobok.birthPop | birth/rebirth scale-in on the sill | 500 ms ≈ | sparkle, lower-pitched variant |
| kolobok.gulp | fox catch (story + easter egg) | 200 ms ≈ | gulp (existing) |
| kolobok.giggle | happy expression trigger | 400 ms | 3-4 quick triangle blips, ascending, playful |

### 4.2 Animals — idle & reactions (non-verbal "character lines")
| slot | trigger | dur | default synthesis |
|------|---------|-----|--------|
| hare.idleHop | ANIMATION_SPEC §3 in-place hop, 2.5-4 s interval | 300 ms ≈ | chirp/squeak, soft |
| hare.sniff | nose-sniff idle tic | 200 ms | tiny noise puffs ×2, fast |
| hare.startled | encounter reaction hop | 350 ms | chirp/squeak, higher pitch |
| wolf.headSweep | idle head sweep (ambient, very quiet) | 4 s | low breathy noise, barely audible |
| wolf.howl | ~12 s idle howl | 1.5 s ≈ | growl rising in pitch, held, decaying |
| wolf.snapMiss | encounter reaction (snap + miss) | 400 ms ≈ | quick growl + thud (teeth snapping shut) |
| bear.scratch | ~10 s scratch-the-tree idle | 900 ms ≈ | noise → bandpass rough scraping texture |
| bear.grunt | weight-shift idle, occasional | 500 ms | growl, low and short |
| bear.swipeMiss | encounter reaction (slow swipe, misses) | 350 ms ≈ | whoosh, low-pitched |
| fox.tailSway | continuous idle tail motion (very subtle) | loop 2.5 s | soft brush/rustle noise, very quiet |
| fox.purr | idle head-tilt/blink moment (~8 s) | 600 ms | soft triangle drone, warm |
| fox.flatterCoo | encounter "come closer" beat | 500 ms | purr variant, slightly higher |
| fox.lipLick | fox-easter-egg snout-lick beat | 300 ms | tiny click-clack |
| grandma.hum | ambient window-crossing beat | 800 ms | soft triangle hum, homely |
| grandma.tapReaction | izba tap beat ("where have you rolled off to") | 400 ms | grandma.hum variant, questioning up-inflection |
| grandma.knitClick (loop) | idle knitting animation | loop 2 s | click-clack, gentle, repeating |
| grandpa.castLine | ~30 s recast idle | 300 ms | whoosh, thin |
| grandpa.catchCheer | fish catch (silver/gold) | 400 ms ≈ | note1-3 ascending, triumphant |
| grandpa.sighBoot | boot catch reaction | 500 ms ≈ | descending growl/sigh |
| owl.hoot | owl easter egg | 240 ms ≈ | hoot (existing) |
| hedgehog.waddle (loop) | mushroom-carry journey, 6 s | loop 1 s | soft rhythmic patter, thud variant at low volume |
| hedgehog.squeak | mushroom "pickup" moment | 200 ms | chirp/squeak |
| crow.caw | ~25 s overhead crossing | 350 ms | growl variant, higher/harsher |
| crow.wingFlap | same crossing, per flap | 150 ms | whoosh, very short |
| ridgeBird.peck | 3x peck tilt on izba roof | 100 ms ×3 | thud, tiny |
| bee.buzz (loop) | bear-thicket bee orbit | loop 1.2 s | buzz (existing recipe) |
| butterfly.flutter (loop) | hare-meadow butterflies | loop 1 s | very quiet high-frequency flutter, optional/low priority |

### 4.3 Nature / ambience (loops, always-on or zone-scoped)
| slot | trigger | loop len | default synthesis |
|------|---------|----------|--------|
| ambience.wind | always | 4 s ≈ | wind (existing) |
| ambience.rain | rain/storm weather state | 3 s ≈ | rain (existing) |
| ambience.thunder | storm lightning flash | 500 ms ≈ | rumble (existing) |
| ambience.pondRipple | pond surface, always near the pond | 2 s | soft filtered noise, watery |
| ambience.forestBirds | general daytime forest tone | 6 s | sparse chirp/squeak variants layered quietly |
| ambience.nightCrickets | night-time tone, replaces forestBirds | 5 s | rhythmic high-frequency clicks, quiet |
| ambience.izbaFire | window firelight breathing (evening/night) | 3 s | very quiet crackle: filtered noise bursts |
| ambience.leaves (loop) | bear-thicket falling leaves | 3.5 s ≈ | soft rustle, sparse |

### 4.4 Interactions / easter eggs
| slot | trigger | dur | default synthesis |
|------|---------|-----|--------|
| ui.tapBlip | generic tap feedback (any hitbox) | 90 ms ≈ | blip (existing) |
| ui.plaqueBlip | crossroads-stone plaque tap | 90 ms ≈ | blip, rate 0.85 (existing convention) |
| egg.fishSplash | grandpa: silver-fish catch splash | 140 ms ≈ | plop (existing) |
| egg.bootThud | grandpa: boot catch | 200 ms | thud, comedic low pitch |
| egg.goldSparkle | grandpa: golden fish | 300 ms ≈ | sparkle (existing) |
| egg.mushroomPop | hedgehog: mushroom taken/respawn pop | 150 ms | blip variant, soft |
| egg.moonTwinkle | moon-wink easter egg | 300 ms ≈ | sparkle (existing) |
| egg.cloudDrizzle | cloud-drizzle easter egg burst | 2 s ≈ | rain (existing), shorter one-shot variant |
| chimney.pipeClose | press-and-hold begins (pipe "closes") | 150 ms | soft creak: filtered noise sweep down |
| chimney.bubbleRelease | release: 3-bubble burst starts | 250 ms ≈ | whoosh + soft pop tail |
| chimney.bubbleShrink | each bubble's shrink-out finish | 150 ms | tiny pop, high-pitched, soft |

### 4.5 UI / triggers / navigation
| slot | trigger | dur | default synthesis |
|------|---------|-----|--------|
| ui.menuOpen | sound-library / any modal opens | 150 ms | whoosh, short and light |
| ui.menuClose | modal closes | 120 ms | whoosh reversed/shorter |
| ui.playPause | ▶/❚❚ story button | 100 ms | blip variant |
| ui.eyeToggle | free-look eye button | 100 ms | blip variant, slightly lower pitch |
| ui.langToggle | RU/EN toggle | 100 ms | blip variant |
| ui.eggCounterTap | egg-counter tooltip tap | 100 ms | blip variant |
| ui.zoneSettle | camera soft-snaps onto a new zone | 120 ms | soft click, pairs with the existing `selectionAsync` haptic |
| ui.narrationAppear | any speech/narration bubble appears | 100 ms | tiny soft blip, unobtrusive |
| nav.crossroadsOpen | crossroads-stone navigation | 200 ms | whoosh, slightly longer/grander |

### 4.6 Story-only beats (STORY_SPEC.md chapters; reuse slots above where an
identical moment already has one — only NEW story-exclusive moments get
their own slot)
| slot | trigger | dur | default synthesis |
|------|---------|-----|--------|
| story.doughAppear | birth: dough appears on the sill | 500 ms ≈ | sparkle, muted variant |
| story.windowGlowSwell | birth/rebirth window emissive pulse | 800 ms ≈ | soft triangle swell, warm |
| story.fadeToBlack | fox-finale screen fade | 300 ms ≈ | low sine sweep down, hush |
| story.rebirthChime | rebirth pop after the fade | 500 ms ≈ | sparkle (existing), reused |
| story.loopTransition | chapter loop point (rare, every 4th loop) | 200 ms | soft blip, barely noticeable |

## 5. Storage / persistence summary
- Procedural WAV cache: `FileSystem.cacheDirectory/sfx/` — ephemeral, safe
  to wipe, regenerates in ~200 ms total.
- User recordings: `FileSystem.documentDirectory/userSounds/` — persistent,
  survives cache clears, local-only (no account, no cloud), one small
  manifest file tracks which slots are overridden.
- Master mute + volume: existing host-persisted `onSoundChange` prop,
  unchanged.

## 6. Acceptance criteria
- First launch renders and caches every procedural default; second launch
  renders nothing new.
- Every slot in §4 is reachable from the library menu, grouped correctly,
  and plays its current audio (default or recording) on PLAY.
- Recording a slot: countdown always shown, capture hard-stops at that
  slot's own target/loop length, saved file persists across an app
  restart, badge flips to "yours", reset-to-default restores the
  procedural sound and removes the file.
- Hardware mute silences everything (both layers); the opt-in sound toggle
  works and persists via host.
- No sound in flat mode; loops stop within 500 ms of backgrounding.
- Recording requires mic permission; a clear, localized (EN/RU) prompt
  explains why if the OS permission dialog is denied.
