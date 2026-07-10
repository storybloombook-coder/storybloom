# Storybloom — Kit Changes TODO (handoff note)

> Purpose: a self-contained work order for the next session. It captures WHAT to
> change, WHERE, WHY, and the research behind it, so you can proceed without
> re-deriving any of it. Read this top-to-bottom once, then work the checklist.

## Context in one paragraph
Storybloom v1 must run FREE and support TWO languages: **English + Russian**.
Research (July 2026) surfaced three problems with the current kit. The vision
layer (Gemini Flash) is fine. The **speech layer breaks under the Russian
requirement** — the kit assumes Android's on-device Google recognizer, which is
unreliable per-device and weak in Russian. The **audio library the kit names
(`expo-av`) has been removed** from Expo (gone in SDK 55). And the cue-matching
vocabulary is **English-only**, so Russian books would match almost no keyword
effects. Below are the three fixes. Do them in order; #1 is the important one.

## Key reframe (don't lose this — it justifies the whole approach)
During READING we are NOT doing open transcription. The full page text is already
in SQLite from the Prep step. So reading-time speech recognition is *alignment
against a known script*, not dictation — a much easier problem. That means we can
tolerate a "good-not-great" on-device recognizer. Also: the person being
recognized is the **PARENT** (adult, quiet room), not the child, so child-ASR
accuracy problems don't apply to us.

---

## CHANGE 1 — Speech: swap to Vosk + add a swappable interface ← THE IMPORTANT ONE

### Why
- The kit's `expo-speech-recognition` wraps Google's native Android recognizer.
  On Android 13+, offline language models often aren't installed; getting Russian
  offline depends on the device/OEM and a system download dialog. Fragile
  foundation for a CORE feature.
- Android's recognizer is the weakest major engine and weaker still in Russian
  (a morphologically rich language — higher WER for every engine).
- **Vosk** (`react-native-vosk`) is fully on-device, free, offline, and has
  first-class EN + RU support (~50 MB per language model), with a streaming API
  that fits the "listen continuously, fire on keyword" loop.
- **Whisper** (`whisper.rn`, binds whisper.cpp) is the accuracy leader and also
  on-device, but heavier: larger app size, more CPU, historically laggy on
  Android, and natively a transcribe-a-clip tool (streaming needs careful
  buffering). Keep it as the upgrade path, not the v1 default.

### What to do
1. Remove `expo-speech-recognition` as the primary engine from the plan.
   - It MAY remain an OPTIONAL English-only accelerator on devices that already
     have Google's model, but it is NOT the cross-language foundation.
2. Add `react-native-vosk` as the primary speech engine (EN + RU models).
3. Create a **swappable `SpeechRecognizer` interface**, mirroring the existing
   `/lib/ai/` provider abstraction, so Whisper/whisper.rn can drop in later
   without touching UI. Suggested location: `/lib/speech/`.
   - Interface sketch (refine during build):
     ```ts
     // lib/speech/types.ts
     export interface SpeechRecognizer {
       load(lang: "en" | "ru"): Promise<void>;      // load/prepare model for a language
       start(opts: { lang: "en" | "ru"; onPartial: (text: string) => void;
                     onResult: (text: string) => void }): Promise<void>;
       stop(): Promise<void>;
       unload(): Promise<void>;
     }
     ```
   - First implementation: `lib/speech/vosk.ts` (wraps react-native-vosk).
   - Later implementation: `lib/speech/whisper.ts` (wraps whisper.rn) — same
     interface, swap without UI changes.
4. The two speech jobs are DIFFERENT difficulties — keep them separate:
   - **Keyword alignment** (hard): match live speech position to known page text.
   - **"Next page" command** (easy): detect one fixed phrase. Russian phrase is
     "следующая страница"; English is "next page". Both engines handle this
     trivially; don't over-engineer it.

### Files to edit
- `CLAUDE.md` — Stack section (replace the expo-speech-recognition line), the
  "AI provider must be swappable" idea extended to speech, milestone 7, and the
  "Things to avoid" note about expo-speech.
- `SPEC.md` — the speech-recognition bullets (on-device claim, page-turn voice).
- `README.md` — build-order line 7 and the golden rule mentioning
  expo-speech-recognition.
- NEW: `/lib/speech/types.ts` and `/lib/speech/vosk.ts` (+ later `whisper.ts`).

---

## CHANGE 2 — Audio: replace `expo-av` with `expo-audio`

### Why
`expo-av` is deprecated and was **removed in Expo SDK 55** — Expo explicitly says
to use `expo-audio` (and `expo-video`) instead. Building on `expo-av` today means
building on something already gone. `expo-audio` is the current cross-platform
native audio library and does everything we need (preload short clips, low-
latency playback, layer ambient bed under one-shot effects). Language-neutral.

### What to do
- Global find/replace `expo-av` → `expo-audio` across the kit.
- Keep the design rule: **preload/cache every clip when a book opens** so
  reading-time playback is instant (matches the "Reading loop plays only cached
  audio" principle). Effects 1–3s, ambient beds 10–30s looping (already in the
  manifest).

### Files to edit
- `CLAUDE.md` — Stack section ("Audio playback: expo-av (or expo-audio if
  current)" → just `expo-audio`), milestone 6.
- `sound-library-manifest.md` — any expo-av mention.
- `README.md` — if referenced.

---

## CHANGE 3 — Vision: Cyrillic handling + Russian trigger vocabulary

### Why
- Gemini Flash is the right vision engine (free tier: ~15 RPM / 1,500 req/day;
  a 27-page book = 27 requests). Its Cyrillic OCR is strong. But the prompt
  should explicitly tell it to **preserve Cyrillic verbatim, not transliterate**.
- SLEEPER ISSUE: the cue-matching system keys off **English-only trigger words**
  (e.g. "roared", "splashed") in both the Gemini prompt and the sound manifest
  allow-lists. The sound FILES are language-neutral (a splash is a splash), so
  for Russian books we currently get a scene/ambient match but **almost no
  keyword effects**. Bilingual support would be lopsided unless we add Russian
  trigger vocabulary to the existing sound-id mappings. Cheap fix, but must be
  deliberate.

### What to do
1. Add a line to the Gemini prompt contract: preserve Russian/Cyrillic text
   exactly in `ocr_text`; do not transliterate or translate.
2. Extend the sound manifest allow-lists so each existing `amb_*` / `fx_*` id
   also lists Russian trigger words alongside the English ones. Examples:
   - `fx_splash` — triggers: splash, jumped in, water **+ плеск, брызги, плюх**
   - `fx_engine` — engine, car, roared, motor **+ мотор, машина, ревел, гудок**
   - `fx_laugh`  — laughed, giggled, hooray **+ смеялся, хихикал, ура**
   - (fill out the rest of the table the same way)
   The ids and audio files DON'T change — only the trigger vocabulary grows.
3. `trigger_text` from Gemini is already lowercased for alignment — make sure the
   Russian path lowercases Cyrillic correctly too (locale-aware).

### Files to edit
- `gemini-vision-prompt.md` — add the Cyrillic-preservation instruction; note
  that trigger_text may be Cyrillic.
- `sound-library-manifest.md` — add Russian trigger words to each id row.
- (Optional) `lib/ai/gemini.ts` — the `buildPrompt()` string, to carry the new
  instruction; confirm nothing assumes ASCII.

---

## Cost summary (for reference — v1 can be $0)
- **Vision:** Gemini Flash free tier (≤1,500 req/day) — free. Paid Flash later
  is ~$0.15/M input tokens = pennies even at scale.
- **Speech:** Vosk (or whisper.rn) fully on-device — free. Optional cloud Whisper
  fallback is $0.006/min (~6¢ per 10-min read) — NOT needed for v1.
- **Audio:** expo-audio — free.

## Do-NOT-break rules (unchanged from the kit)
- Free tiers only; never enable Gemini billing.
- All heavy AI work in Prep; reading loop plays only cached local audio.
- AI MATCHES library sounds; it does not generate/fetch them (that's v2).
- Keep each processed book a portable, serializable JSON bundle (VISION.md).
- Capture ISBN if easy (future book-matching key).

## Suggested order of work
1. CHANGE 2 (audio) — mechanical find/replace, fastest, no risk.
2. CHANGE 3 (vision/Russian vocab) — additive, low risk, unblocks RU effects.
3. CHANGE 5 (sound sourcing) — additive manifest fields + docs, low risk.
4. CHANGE 1 (speech) — the real work; build the interface + Vosk impl, test RU
   on a real Android phone via Expo Go before considering Whisper.
5. CHANGE 4 (publish) — commit, tag, push v0.2.0 once the above are in.

## Open question to validate during build
Does Vosk's Russian accuracy clear the bar for keyword alignment on a real
device? If not, swap in whisper.rn behind the same `SpeechRecognizer` interface
(that's exactly why the interface exists). Test with one real Russian children's
book, quiet room, parent reading.

---

## CHANGE 5 — Sound sourcing + manifest licensing fields
> Full detail lives in **`SOUND-SOURCING.md`** (companion doc). Summary + the
> concrete edits below. Rationale: VISION.md wants shared/forkable sound builds,
> so every sound must be safe to REDISTRIBUTE, not just to use. That means CC0
> stock and/or Apache-2.0-generated audio — NOT Pixabay/Mixkit raw redistribution.

### Key findings
- **v1 library:** source from **CC0** (Freesound filtered to CC0 + Kenney /
  OpenGameArt CC0 packs) and/or **AI-generate with Meta AudioGen (Apache-2.0)**.
  Both are free AND redistribution-safe.
- **ElevenLabs** is the best AI SFX quality but its FREE tier requires attribution
  + is personal-use only — not suitable for a free/shareable app. Keep it as the
  paid upgrade for later (roadmap v3+).
- **Best move:** pre-generate the bundled library at BUILD TIME from the manifest
  prompts with AudioGen. Royalty-free, redistributable, style-consistent, and
  stays inside the "AI matches bundled sounds, doesn't generate at runtime" rule.
- Bilingual: sound files are language-neutral — SAME clips serve EN + RU. Only
  the trigger vocabulary needs both languages (that's CHANGE 3). No extra
  sourcing for Russian.

### What to do (edits to `sound-library-manifest.md`)
1. Add a **`license`** and **`source_url`** field to EVERY `amb_*` / `fx_*` entry
   so provenance travels with each build (essential once builds are shared).
2. Add a short **"Sourcing"** note at the top: library is CC0 stock and/or
   AudioGen-generated (Apache-2.0); explicitly NOT Pixabay/Mixkit raw-file
   redistribution.
3. Add a **"v2 generation options"** section pointing to AudioGen / Stable Audio
   Open / ElevenLabs(paid) with the licensing notes from SOUND-SOURCING.md.

### Files to edit
- `sound-library-manifest.md` — the three additions above.
- (Include `SOUND-SOURCING.md` in the repo + add it to README's "Files in this
  kit" index.)

---

## CHANGE 4 — Publish the updated kit as a new version on GitHub

> This session (Claude in VS Code) is connected to the repo
> `storybloombook-coder/storybloom`, so it can commit, push, and tag directly.
> Do this LAST, only after Changes 1–3 and 5 are made and (ideally)
> sanity-checked.

### What "a new version" means here
This is a docs/kit + foundation-code update (bilingual EN/RU support, corrected
libraries), not a shipped app build. So version it as a **minor release** and tag
it. Suggested version: **v0.2.0** (the kit was effectively v0.1.0 / "kit_v2").
Use whatever the repo's existing convention is if one already exists — check
`git tag` first.

### Steps
1. Confirm you're on a clean, up-to-date main:
   ```bash
   git status
   git pull origin main
   git tag            # see if a versioning scheme already exists
   ```
2. Stage the edited kit files + new speech module + these notes:
   ```bash
   git add CLAUDE.md SPEC.md README.md gemini-vision-prompt.md \
           sound-library-manifest.md lib/ CHANGES-TODO.md SOUND-SOURCING.md
   git status         # review exactly what's staged before committing
   ```
3. Commit with a clear message:
   ```bash
   git commit -m "v0.2.0: bilingual EN/RU support + library fixes

   - Speech: swap expo-speech-recognition -> react-native-vosk as primary;
     add swappable SpeechRecognizer interface (lib/speech) for whisper.rn later
   - Audio: replace removed expo-av with expo-audio throughout
   - Vision: preserve Cyrillic in Gemini prompt; add Russian trigger vocab to
     the sound-library allow-lists (fixes RU keyword effects)
   - Sound: CC0/AudioGen(Apache-2.0) sourcing for redistributable builds;
     add license + source_url fields to sound manifest (SOUND-SOURCING.md)"
   ```
4. Push to main:
   ```bash
   git push origin main
   ```
5. Tag the release and push the tag:
   ```bash
   git tag -a v0.2.0 -m "Bilingual EN/RU kit: Vosk speech, expo-audio, Cyrillic + RU triggers"
   git push origin v0.2.0
   ```
6. (Optional, nice-to-have) Create a GitHub Release from the tag so the change
   is visible on the repo's Releases page. If the GitHub CLI is available:
   ```bash
   gh release create v0.2.0 --title "v0.2.0 — Bilingual EN/RU" \
     --notes "See commit v0.2.0. Adds Russian support (Vosk on-device speech,
     Russian trigger vocabulary, Cyrillic-safe OCR) and replaces the removed
     expo-av with expo-audio."
   ```
   If `gh` isn't installed, create the release manually in the GitHub web UI
   from the v0.2.0 tag, pasting the same notes.

### Guardrails for the push
- Do NOT commit `.env` or any real Gemini key — `.gitignore` already excludes
  `.env`; double-check `git status` shows no secrets before committing.
- Do NOT commit large model binaries (Vosk `.zip`/model folders, Whisper
  `.bin`/GGML files). Add them to `.gitignore` if they ever land in the tree —
  the RN packager also rejects files >2 GB, and these bloat the repo. Models
  should be downloaded/bundled at build time, not stored in git.
- Review the diff (`git diff --staged`) before committing; keep the commit
  scoped to these four changes.
- Update `README.md`'s "Files in this kit" list if any new files
  (`lib/speech/…`) were added, so the kit's own index stays accurate.
