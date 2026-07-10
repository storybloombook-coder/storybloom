# Storybloom — Product Spec (v1)

## One-liner
A mobile app that turns a physical children's book into an immersive read-aloud
experience: photograph the book, and as a parent reads it aloud, the app plays
ambient background sounds, keyword sound effects, and character voices at the
right moments.

## Who it's for
A **parent reading aloud to a child**. The parent operates the phone. The child
listens (and looks at the real book).

## The experience, start to finish
1. Parent opens the app and taps "Add a book."
2. Parent photographs the book's pages (whole book upfront, multiple photos).
3. The app processes the book ("prepping your book..."): reads the text, works
   out the background scene, spots keywords and character lines, and matches
   each to a sound. One-time wait per book.
4. Later, parent opens the prepped book and taps "Read."
5. The reading view shows the current page. An ambient background sound starts
   (e.g. forest hum for a forest scene).
6. As the parent reads aloud, the app listens. When they reach a keyword
   ("the engine ROARED"), the matching effect fires. When they read a
   character's line, that character's voice plays.
7. When the page is done, the parent taps "Next page" OR simply says
   "next page" to advance hands-free. Repeat to the end.

## Core features (v1)
- **Capture / import**: two ways to add a book — photograph the pages (primary),
  OR upload a PDF (secondary; each page is rendered to an image). Both feed the
  same pipeline. Pages stored locally, reviewable/re-takeable.
- **AI prep pipeline**: per page, one Gemini Flash (free tier) call returns text
  (OCR), background scene, keyword cues, and character-line attribution as
  structured data. Each cue is matched to a bundled royalty-free sound.
- **Local library**: once a book is processed it's SAVED by title with its
  pages, cues, and sounds. The user can reopen it anytime and get the same flow
  they tried — no re-processing. No login.
- **Reading view**: page display, manual "Next page," ambient playback.
- **Listen-and-trigger**: on-device speech recognition (Vosk, EN + RU) aligns
  the parent's speech to the known page text and fires cached sounds at the
  right position.
- **Voice "next page"**: the same speech recognition detects the spoken command
  "next page" (English) / "следующая страница" (Russian) to advance hands-free
  (manual tap still available).
- **Sound layers**: ambient background + keyword effects are the CORE v1
  experience. Character voices are an OPTIONAL feature behind a toggle (off by
  default), offered only when the app detects dialogue in a processed book.

## Cost model: FREE to run (no paid API keys)
The whole v1 runs on free tiers, no payment required:
- Vision/OCR/analysis: Google Gemini free tier (Flash models), free key from
  Google AI Studio, no credit card. Keep the project billing-DISABLED.
- Sounds: bundled royalty-free library (Freesound/Pixabay/Mixkit); AI matches
  cues to library sounds rather than generating audio.
- Speech recognition: on-device, free, offline.
AI-generated sounds are a v2 upgrade, not part of v1.

## Explicit v1 scope decisions
- **Local-only.** No accounts, no backend, no cloud sync.
- **Manual + voice page turns.** Tap "Next page" or say "next page."
- **On-device speech recognition** (Vosk, EN + RU), free, offline.
- **Library sounds, not AI generation.** Matched during prep.
- **Core v1 = ambient + keyword effects.** Character voices (dialogue) are a
  later, optional toggle, off by default. Prep still extracts dialogue so the
  toggle can light up, but playing voices is not part of the core loop.
  Data model supports all three from day one.
- **Functional design first**, visual polish as a later pass.

## Explicitly OUT of scope for v1 (future / v2)
- AI-GENERATED sounds on the fly (v1 uses a curated library).
- EPUB and other book formats (v1 imports photos + PDF only; EPUB is
  reflowable, page-less, and often DRM'd — later).
- Shared, browsable library across users (needs a backend).
- User accounts, auth, sync across devices.
- AUTOMATIC page-turn detection from speech position (v1 has manual tap +
  "next page" voice command; automatic detection is v2).
- App reading the book itself (TTS narration) — v1 is listen-along only.
- iOS support as a first-class target (shouldn't break, but untested).

## Success criteria for v1
The magic moment works, for free: with one real children's book, a parent can
photograph it, wait through prep, save it to their library, then read it aloud
and hear the ambient bed on each page plus keyword effects firing on the right
words, and advance pages by voice. Character voices are a bonus feature layered
on later via a toggle — NOT required to call v1 a success.

## Known hard parts (plan around these)
- Real-time alignment of spoken words to the known page text.
- Quality of cue-to-sound matching from the library (fall back gracefully).
- Free-tier rate limits (handle 429s; check live caps in Google AI Studio).

## First plan-mode prompt (suggested for the other account)
> Read CLAUDE.md. We're building Storybloom, a React Native + Expo app that must
> run entirely on free API tiers. Start with milestone 1 only: scaffold an
> Expo + TypeScript project using expo-router, with a single blank home screen,
> that runs in Expo Go on Android. Use plan mode — propose the setup and file
> structure before building.
