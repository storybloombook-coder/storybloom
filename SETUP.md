# Storybloom — set up & run on another computer

This branch (`feat/ondevice-vision-tesseract`) uses **native modules** (on-device
Tesseract OCR + Vosk speech), so it runs in a **custom dev client**, NOT Expo Go.

## 0. Prerequisites
- **Node 20+** and Git.
- An **Android phone** (physical, USB debugging on) — this is an Android-first build.
- For building the dev client, either:
  - an **Expo account** (free) for cloud **EAS Build**, *or*
  - a local Android toolchain (Android Studio + JDK 17) for `expo run:android`.

## 1. Clone the RIGHT branch
A fresh clone defaults to `main`, which is missing all the Tesseract/Vosk/sound work.
```bash
git clone https://github.com/storybloombook-coder/storybloom.git
cd storybloom
git checkout feat/ondevice-vision-tesseract
npm install
```

## 2. Create `.env` (gitignored — make it fresh)
```
EXPO_PUBLIC_GEMINI_MODEL=gemini-flash-latest
# Optional — cloud Gemini fallback (on-device Tesseract works without it):
# EXPO_PUBLIC_GEMINI_API_KEY=AIza...
# Optional — only needed to RE-FETCH/expand the sound library (see step 4):
# FREESOUND_API_TOKEN=...
```

## 3. Download the Vosk speech models (~85 MB, NOT in git)
The config plugin points at these exact paths; **the build fails without them.**
```bash
cd assets
curl -L -o en.zip https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip
curl -L -o ru.zip https://alphacephei.com/vosk/models/vosk-model-small-ru-0.22.zip
unzip en.zip && unzip ru.zip
mv vosk-model-small-en-us-0.15 vosk-model-small-en-us
mv vosk-model-small-ru-0.22 vosk-model-small-ru
rm en.zip ru.zip
cd ..
```
Folder names must be exactly `vosk-model-small-en-us` and `vosk-model-small-ru`
(that's what `src/lib/speech/vosk.ts` expects). On Windows, if the `mv`/rename
hits "Access denied", stop any running Metro/`node` (it's the file watcher) and retry.

## 4. Sound effects — already in git ✅
The real CC0 sound clips live under `assets/sounds/` and are committed
(loudness-normalized, so nothing sounds jarringly loud/quiet next to
another), so nothing to do. To regenerate or expand them:
- `node scripts/gen-placeholder-sounds.mjs` — synth placeholders for every id.
- `node scripts/fetch-freesound.mjs` — real CC0 clips from Freesound (needs
  `FREESOUND_API_TOKEN`). Provenance is in `assets/sounds/CREDITS.json`.
  Add `--only=<id>[,<id>]` to re-fetch just specific ids (e.g. after finding
  one bad match) without re-walking the whole library.
- `node scripts/normalize-sounds.mjs` — re-run loudness normalization (EBU
  R128: effects −16 LUFS, ambient −23 LUFS) after fetching new sounds. Needs
  `ffmpeg-static` (`npm install --no-save ffmpeg-static` first, `npm
  uninstall ffmpeg-static` after — **stop Metro before doing this**, see the
  gotcha in HANDOVER.md, or its file watcher can crash on the temp dir).

All three read the id lists from `src/lib/ai/soundLibrary.ts` and (fetch/
placeholder scripts) regenerate `src/lib/audio/soundAssets.ts`.

## 5. Build the dev client (native code → must be compiled)
**Option A — EAS cloud build (no local Android toolchain):**
```bash
npx eas-cli login          # your Expo account
npx eas-cli build --platform android --profile development
```
When it finishes, install the APK on the phone (open the build's URL/QR on the
phone, or `adb install <file>.apk`). *Or* reuse an already-built APK from
expo.dev → your project → Builds.

**Option B — local build (Android Studio + JDK 17 installed):**
```bash
npx expo run:android
```

## 6. Run it
```bash
npx expo start --dev-client
```
- **Wi-Fi:** open the Storybloom dev app on the phone → connect to
  `exp://<this-pc-lan-ip>:8081` (or scan the QR). Phone + PC on the same network.
- **USB only (no shared Wi-Fi):** `adb reverse tcp:8081 tcp:8081`, then in the dev
  app use `localhost:8081`.

## Notes
- **Not Expo Go** — it can't load the native Tesseract/Vosk modules.
- **On first book prep**, on-device OCR downloads its Tesseract language data
  (`eng`/`rus`) once into app storage, then works offline.
- **JS changes hot-reload** over Metro; only native changes (Kotlin, gradle,
  `app.json` plugins/permissions, new native npm deps) need a new dev-client build.
- Gitignored, so recreate per machine: `.env`, `node_modules/`, the Vosk models,
  and the generated `android/` (from prebuild).
