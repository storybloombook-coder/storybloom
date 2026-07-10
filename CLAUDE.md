# CLAUDE.md — Storybloom

## THIS REPO (read first)
- Expo **SDK 57** (React Native 0.86, React 19.2, expo-router v57), TypeScript strict.
- App code lives under **`src/app/`** (file-based routes) and **`src/`** generally.
  Path alias: `@/*` -> `./src/*` (see tsconfig).
- Foundation code from the prep kit is at **`src/lib/`**:
  `src/lib/types.ts`, `src/lib/schema.ts`, `srcsrc/lib/ai/gemini.ts`.
- Planning/reference docs at repo root: SPEC.md, VISION.md, DESIGN-DIRECTION.md,
  gemini-vision-prompt.md, review-flow.md, sound-library-manifest.md, examples/.
- **Audio:** SDK 57 has NO `expo-av` — use **`expo-audio`**.
- **Speech recognition** (`react-native-vosk`, milestone 7) is a native module
  that requires a **custom dev build** — it does NOT run in Expo Go. Keep
  milestones 1–6 Expo-Go-compatible; introduce the dev build at milestone 7.
  Storybloom must support English AND Russian; Android's on-device Google
  recognizer is unreliable per-device and weak in Russian, so Vosk (fully
  on-device, free, first-class EN+RU) is the primary engine. See src/lib/speech/
  for the swappable `SpeechRecognizer` interface (whisper.rn is the upgrade path).
- See AGENTS.md: check the versioned Expo docs (v57) before writing native code.

## What this project is
A React Native (Expo) mobile app that turns physical children's books into an
immersive read-aloud experience. A parent photographs a book's pages, the app
processes them with AI (OCR + scene/keyword/character analysis), matches sound
assets to the text, then listens as the parent reads aloud and fires sounds at
the right moment.

Primary user: a **parent reading to a child**. Target device: **Android** (dev
on a physical Android phone via Expo Go). iOS should not break but is untested.

## The core loop (memorize this)
1. **Capture** — parent photographs the whole book upfront (multiple pages).
2. **Prep (one-time, per book)** — for each page: send image to Gemini Flash
   vision -> get OCR text + background scene + keyword cues + character-line
   attribution -> match each cue to a bundled royalty-free sound -> store
   everything locally.
3. **Read** — reading view shows one page; on-device speech recognition listens
   to the parent, aligns spoken words to the known page text, and plays the
   matched cached sound when a cue word/line is reached.
4. **Page turn** — parent taps "Next page" OR says "next page" (voice command).

Key design consequence: **all heavy work happens in Prep, not during Reading.**
Reading only plays already-cached local audio. Never generate or fetch audio
mid-read — it must be instant.

## COST CONSTRAINT: this build must be FREE to run (no paid API keys)
The developer has no paid API access. v1 must run entirely on free tiers:
- **Vision / OCR / analysis:** Google Gemini API FREE TIER (Flash / Flash-Lite
  models only — the Pro models are paid). Free key from Google AI Studio, NO
  credit card required. ~1,500 requests/day, ~10-15 req/min — ample for
  prepping one book at a time. KEEP the Google Cloud project BILLING-DISABLED;
  enabling billing kills the free tier on that project.
- **Sounds:** DO NOT use paid text-to-audio generation in v1. Instead bundle a
  small curated set of royalty-free sounds (Freesound / Pixabay / Mixkit) into
  the app. The AI's job is to MATCH a cue to the best-fitting library sound
  (e.g. "forest scene" -> forest_ambient.mp3), not to generate audio.
- **Speech recognition:** on-device (free, offline), no key. Vosk EN+RU models
  (~50MB each) are bundled/downloaded at build time — not a paid service.
So the ONLY credential needed is a free Gemini AI Studio key. No payment anywhere.
AI-generated sounds are a documented v2 upgrade, not part of v1.

## Stack & key decisions
- **Framework:** React Native via **Expo** (managed workflow). Preview with Expo Go.
- **Language:** TypeScript.
- **Navigation:** expo-router (file-based).
- **Local DB:** expo-sqlite for book/page/cue metadata.
- **File storage:** expo-file-system for page images (bundled sounds ship with app).
- **Camera:** expo-camera or expo-image-picker for capturing pages.
- **AI vision:** Gemini Flash (free tier) — one call per page, returns structured
  JSON (see data model). Free key in env — NEVER committed.
- **Audio playback:** expo-audio (expo-av is removed as of SDK 55 — do not use it). Preload/cache clips.
- **Speech recognition (listening):** react-native-vosk (on-device, offline,
  free, first-class EN+RU) is the primary engine — see src/lib/speech/. NOTE:
  this is speech-to-TEXT. Do NOT use expo-speech — that is text-to-speech and
  is the wrong direction. expo-speech-recognition (Android's native recognizer)
  MAY remain as an optional English-only accelerator on devices that already
  have Google's offline model, but it is not the cross-language foundation.

## Storage model: LOCAL-ONLY for v1
No backend, no accounts, no network except the free Gemini calls during Prep.
Every processed book lives on the device that made it. A shared/browsable
library is explicitly **v2** and must not be built in v1.

## AI provider must be swappable
Free tiers have rate limits and change without notice. Isolate ALL AI code and
prompt templates in src/lib/ai/ behind a simple interface so the provider (Gemini
free tier now; something else later) can be swapped without touching UI code.
Handle HTTP 429 (rate limit) gracefully with retry/backoff.

Same principle applies to speech: isolate the recognizer behind a
`SpeechRecognizer` interface in src/lib/speech/ (load/start/stop/unload), with
Vosk as the first implementation, so a heavier engine (e.g. whisper.rn) can
drop in later without touching UI code.

Same principle applies to VISION (see docs/vision-providers.md — the "Belarus"
change). The vision pipeline is split into an `OcrProvider` (image->text) and a
`CueAnalyzer` (text->scene+cues) behind a `VisionProvider` in src/lib/vision/.
On-device OCR (Tesseract, Cyrillic-capable) is ALWAYS the base where available —
free, private, and immune to Gemini's region/account limits (Gemini may be
unavailable in Belarus). A cloud VLM is an OPTIONAL enhancement for richer
scene/mood, only where reachable. With no cloud at all, a LOCAL trigger-word
matcher over the OCR text still produces ambient + keyword cues, so the app works
fully offline. Native Tesseract needs the dev build (milestone 7, like Vosk);
until then the factory falls back to the Gemini one-shot so Expo Go still works.

## Data model (target shape)
- **Book**: id, title, isbn (nullable — capture from back-cover barcode if
  possible; unused in v1 but the future book-matching key), cover_image_path,
  created_at, prep_status, has_dialogue
  (true if prep found any quoted dialogue — drives the optional voices toggle),
  review_status ('unreviewed'|'in_progress'|'approved'),
  source ('photos'|'pdf' — where the pages came from)
- **Page**: id, book_id, page_number, image_path,
  page_type ('cover'|'title'|'story'|'illustration_only'|'back_cover'),
  embedded_text (nullable — clean text pulled from a PDF page, passed to Gemini
  as a wording hint; null for photos and image-only PDFs),
  ocr_text, background_scene,
  ambient_sound_id (the current/confirmed choice),
  ambient_candidates (ordered list of library ids, best-first, for "Try another")
- **Cue**: id, page_id, type ('keyword' | 'character'), trigger_text
  (the exact word/phrase in the page that fires it), context_phrase,
  char_start/char_end (position in ocr_text, so cues fire IN ORDER),
  sound_id (current/confirmed choice from bundled library),
  candidate_sound_ids (ordered list, best-first, powers "Try another"),
  character_name (nullable), intensity (nullable: 'normal'|'loud'),
  emotion (nullable free text),
  review_state ('proposed'|'confirmed'|'removed')

Support ambient + keyword + character cues in the schema from day one, even
though the build sequences them (see milestones).

### Review flow (parent confirms the AI's sound choices)
After prep, the app offers a page-by-page REVIEW. For each cue the parent sees
what triggers it (word / phrase / scene), can PLAY it, and chooses:
- Confirm  -> review_state = 'confirmed'
- Remove   -> review_state = 'removed' (this trigger plays no sound)
- Swap     -> pick a different library sound (sets sound_id)
- Try another -> app offers the next candidate in candidate_sound_ids
  (in v1 this is the next-best LIBRARY match — NOT real generation.
   Real AI regeneration replaces this behind the same button in v2.)
Review is OPTIONAL: an "Approve all" action accepts every proposed cue as-is and
jumps to reading. Confirmed choices are saved with the book, so reopening from
the library restores exactly what the parent approved.

### Rules learned from a real book (see examples/ folder)
- Only STORY pages are read; skip cover/title/illustration_only/back_cover.
- character cues come ONLY from quoted dialogue (inside quotation marks).
  Narration is read by the parent, NOT voiced.
- Pages can have MULTIPLE alternating dialogue turns — fire voices in order by
  char position, not "page has speaker X".
- A repeated phrase ("cried and cried and cried") is ONE trigger, fired once.
- Coincident cues (a laugh effect + a voice line at the same word): play the
  short effect, then the voice; never let them collide.
- OCR must read STORY TEXT ONLY — ignore words drawn into the illustration
  (signs, posters, toy labels).
- A sentence may span two pages — tolerate a page turn mid-sentence.
- If no library sound fits a cue, return null and SKIP it (never force a wrong
  sound).

## Design approach: FUNCTIONAL FIRST, beauty later
Build plain, working screens through the milestones. Do NOT over-invest in
visual polish early. A dedicated restyle pass comes AFTER the core loop works.
When it's time to make it beautiful (milestone 11), follow DESIGN-DIRECTION.md:
a COZY, hand-crafted storybook world with the tactile satisfaction of an
old-school RPG menu (chunky framed panels, satisfying soft button presses,
smooth gentle transitions, warm haptic/sound feedback) — but CALM and warm,
because it's bedtime. Deliberately NOT trend-chasing. Design-reference
screenshots will be provided for that pass.

## Build order — DO THESE AS SMALL MILESTONES, NOT ONE PROMPT

### CORE v1 (the whole default experience — dialogue is NOT part of this)
1. Scaffold Expo + TS + expo-router; blank home screen; runs on Expo Go.
2. Capture / import flow: TWO ways to get pages in —
   (a) PHOTOS (primary): photograph multiple pages with the camera.
   (b) PDF UPLOAD (secondary): pick a PDF; render EACH page to an image.
   BOTH converge to the same thing: a list of page images stored locally. The
   file type ONLY affects import — everything downstream is identical.
   - If a PDF page has clean embedded text, keep it to pass to Gemini as an
     accuracy HINT (see gemini-vision-prompt.md). Do NOT build a separate
     text-only path; always render + analyze the image.
   - Import ALL pages (cover/title/blurb included); page_type classification +
     the review step let the parent skip non-story pages.
   - DRM/encrypted or unreadable files: fail gracefully with a clear message
     ("couldn't read this file"). Never attempt to bypass protection.
   - EPUB and other formats are LATER, not v1 (reflowable text, no fixed pages,
     commercial DRM). PDF only for now.
3. Prep pipeline: send page image to Gemini Flash (free tier), parse structured
   JSON, save Page + Cue rows to SQLite, match cues to bundled library sounds.
   For each cue/ambient, store an ORDERED candidate list (best-first) so the
   review step's "Try another" can offer alternatives.
   (Prep still EXTRACTS dialogue into character_cues and sets a
   has_dialogue flag on the book — but the reader ignores them unless the
   dialogue toggle is on. Extracting now is cheap; playing is the later feature.)
4. Local storage layer: SQLite schema + file-system helpers. LIBRARY: once a
   book is processed it is SAVED by title in the user's library with its pages,
   cues, and chosen sounds, so the user can REOPEN it later without
   re-processing. Reopening restores the same flow they tried.
5. REVIEW flow: page by page, show each proposed cue with what triggers it
   (word/phrase/scene) and a PLAY button. Parent picks Confirm / Remove / Swap
   (choose from library) / Try another (next candidate). An "Approve all"
   accepts every proposal and jumps to reading. Save the parent's choices.
   Review is OPTIONAL but available; sets book.review_status.
6. Reading view: show page, "Next page" tap, play AMBIENT sound on page open.
   Only play cues whose review_state != 'removed'. Skip non-story pages.
7. Speech recognition: listen, align spoken words to ocr_text, fire KEYWORD
   effects at the right position. ALSO: recognize the spoken command "next page"
   (English) or "следующая страница" (Russian) to advance hands-free (keep the
   manual tap too). Uses react-native-vosk via the src/lib/speech/
   `SpeechRecognizer` interface — keyword alignment is the hard part (matching
   live speech position to known text); the page-turn phrase is a much easier
   fixed-phrase match.

>>> END OF CORE v1. A full, satisfying run works here: capture -> prep -> save to
>>> library -> REVIEW/approve sounds -> read aloud with ambient + keyword effects
>>> + "next page". Ship/test this before touching dialogue.

### LATER — DIALOGUE FEATURE (optional, off by default)
8. DIALOGUE TOGGLE: after a book is processed, IF has_dialogue is true, show a
   toggle "Character voices". Default OFF. When OFF, none of the voice/emotion/
   overlap complexity exists — there is nothing to resolve.
9. CHARACTER VOICES (toggle ON): play per-character library voices, fired ONLY on
   quoted dialogue (never narration). Coincident effect+voice: effect first
   (short), then voice — but this only matters when the toggle is on.
10. MULTI-TURN DIALOGUE: fire the RIGHT voice at the RIGHT position on pages with
   several alternating turns (see Bedtime Frog p17-19). Hardest step; own milestone.

### FINAL
11. Visual restyle pass using provided design references.

Core milestones 6->7 are the magic-defining part of v1. Do them slowly, test
each against examples/bedtime-frog-breakdown.md. Dialogue (8-10) is a bonus layer,
not a v1 requirement.

## North star (see VISION.md) — do NOT build in v1, but keep the door open
Long-term, approved sound builds become SHAREABLE: parents rate builds 1-5 and
reuse/fork each other's work, so popular books get "community favorite" builds
(no manual review needed). That needs a backend, accounts, ISBN book-matching,
and ratings — all firmly post-v1. The TWO cheap things v1 does now to keep this
future cheap:
1. Keep each processed book a SELF-CONTAINED, serializable build bundle (book +
   per-page scene/ambient + per-cue trigger/sound/state). One JSON object.
   Local now; "share it" later = upload that object, not a refactor.
2. Try to CAPTURE THE ISBN from the back-cover barcode during capture (store it
   even if unused in v1). ISBN is the clean key for matching books later.
Nothing else from the vision leaks into v1.

## Known risk areas (be honest, iterate, don't one-shot)
- **Speech alignment** (milestone 7): matching live speech to known page text is
  the hardest part. Easier than open transcription because the text is known —
  align against the script, don't transcribe blind. Expect iteration.
- **Sound matching quality**: library matching is more reliable than generation.
  If the library lacks a good match for a cue, fall back to a generic sound or
  skip that cue rather than playing something wrong.
- **"next page" command**: much easier than keyword alignment — it's a fixed
  phrase, not a position match. Just detect the phrase in recognized speech.

## Conventions
- TypeScript strict mode. Functional components + hooks.
- All AI prompts + provider calls in src/lib/ai/ (swappable, see above).
- API key via env / expo-constants. NEVER hardcode or commit the key.
- Never send private/proprietary data through the free Gemini tier (Google may
  use free-tier inputs for training). Photos of published books are fine.
- Small, focused components. Business logic out of screens, into /lib.

## Things to avoid
- Do NOT add a backend, accounts, auth, or cloud sync in v1.
- Do NOT use any PAID API. v1 runs on free tiers only.
- Do NOT enable billing on the Gemini/Google Cloud project (kills free tier).
- Do NOT generate audio with AI in v1 (use bundled royalty-free library).
- Do NOT generate or fetch sounds during the reading loop — Prep only.
- Do NOT use expo-speech for listening (it's TTS, not recognition).
- Do NOT rely on Android's native recognizer as the cross-language foundation —
  it's unreliable per-device and weak in Russian. Vosk is primary; that engine
  MAY remain as an optional English-only accelerator, nothing more.
- Do NOT build auto page-turn detection in v1 (manual tap + "next page" voice
  command only; automatic position-based detection is v2).
- Do NOT commit API keys.
- Do NOT try to ship all three sound types in one build step.
- Do NOT over-polish visuals before the core loop works.

## How to run
- Get a FREE Gemini API key at Google AI Studio (no credit card), put it in env.
- `npx expo start`, then scan the QR with Expo Go on the Android device.
- Camera + microphone need real-device testing (not simulator).
- Gemini key lives in `.env` as `EXPO_PUBLIC_GEMINI_API_KEY` (gitignored, never committed).

@AGENTS.md
