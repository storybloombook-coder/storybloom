# Storybloom — Handover

_Snapshot for picking up on another machine / another day._

- **Branch:** `feat/ondevice-vision-tesseract` (NOT `main` — main is far behind).
- **Everything is committed + pushed.** Latest: `3ab314a`.
- **To set up + run:** see **[SETUP.md](./SETUP.md)** (clone, `.env`, Vosk models, dev-client build, connect).

---

## Where the app is right now

The core loop is **capture → prep → library → per-page edit**, running **fully
on-device** (no cloud, no keys).

**Working:**
- **Capture/import** — photos + PDF, per-page crop/rotate editor, drag-reorder,
  add-more-pages, dictation.
- **Prep (on-device)** — Tesseract OCR (per the book's chosen language) + a local
  bilingual (EN/RU) trigger matcher assigns ambient + keyword cues. A dev-only
  debug readout shows raw OCR text + confidence + matched cues.
- **Library** — rich cards (cover, counts, status, badges), **favorites ⭐** with a
  Favorites filter, pull-to-refresh, delete (cascade + file cleanup).
- **Book detail** — per-page inspector, **tap the title to rename**, drag-reorder /
  delete pages, add pages.
- **Page editor** — tap a word to attach/remove a sound; correct OCR text;
  **"Re-scan area"** (crop to the text → OCR just that); record/trim/fade custom
  sounds per word.
- **Sound library** — **114 effects + 18 ambient**, now with **real CC0 audio**
  from Freesound (`assets/sounds/`, provenance in `assets/sounds/CREDITS.json`).
  Matched cues play; **ambient loops** until the page changes. Voices (8) are
  still synth placeholders.

**Gemini is fully removed** — vision is on-device only. If the Tesseract native
module isn't present (e.g. Expo Go), `createVisionProvider` throws a clear error
instead of falling back.

---

## ⚠️ The one big unknown — still not verified

**Is Tesseract `rus`/`eng` OCR actually good enough on real phone-camera photos**
of a children's book (glare, curved pages, stylized/italic fonts)? We built the
whole on-device path but haven't confirmed quality on a real book yet. **This is
the first thing to test.** Prep an English page, then a Russian page, and read the
debug panel (`ondevice/tesseract`, confidence %, raw text).

If it's rough, levers (in order, all behind the same seam so no rearchitecting):
1. Image pre-processing before OCR (grayscale/threshold/deskew) — JS-side.
2. The **"Re-scan area"** crop tool (already built) to cut illustration noise.
3. Swap the OCR engine (e.g. a PaddleOCR/docTR ONNX model) behind `OcrProvider`.

---

## Latest dev-client build

- APK from the last EAS build is on **expo.dev → project Storybloom → Builds**
  (install via its URL/QR or `adb install`).
- **Rebuild the dev client only after native changes** (Kotlin, gradle,
  `app.json` plugins/permissions, new native npm deps). JS changes just hot-reload
  over Metro (`npx expo start --dev-client`).

---

## Next steps (suggested order)

1. **Verify on-device OCR** on a real EN + RU book (the unknown above).
2. **Sound-to-text workflow** — design the flow now that there are 132 real
   sounds: auto-match → review → tap-word-to-assign → **preview-before-choose**.
   (Owed from last session.)
3. **Sound picker UX** — 114 effects is a long scroll; add **categories + search
   + tap-to-preview**.
4. **Reading view (milestone 6)** — play ambient on page open (loop), fire keyword
   cues in order, manual "Next page". This is the payoff screen and doesn't exist
   yet.
5. **Speech recognition (milestone 7)** — Vosk is wired (`src/lib/speech/`);
   align spoken words to `ocr_text`, fire cues at position, "next page" voice cmd.
6. **Polish sounds** — replace the 8 placeholder voices; re-fetch any dud CC0
   clips with better queries (`node scripts/fetch-freesound.mjs`).

---

## Handy commands

```bash
npx expo start --dev-client          # run (JS hot-reloads)
npx tsc --noEmit                     # typecheck (currently 0 errors)
node scripts/fetch-freesound.mjs     # (re)build sound library from Freesound (needs token)
node scripts/gen-placeholder-sounds.mjs   # synth placeholders for any id without audio
npx eas-cli build --platform android --profile development   # new dev-client build
```

## Gotchas learned this project
- **Commit before an EAS build** — EAS doesn't upload untracked files, so new
  modules/assets silently miss the build if uncommitted.
- **Not in git (recreate per machine):** `.env`, `node_modules/`, the Vosk models,
  generated `android/`.
- **Windows file locks:** if renaming/deleting model folders hits "Access denied",
  stop Metro/`node` (the file watcher) and retry.
