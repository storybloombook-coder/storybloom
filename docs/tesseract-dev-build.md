# On-device OCR (Android) — build & test checklist

This is the milestone-7 dev build. It wires the local `expo-tesseract-ocr` native
module (Tesseract4Android) so the app OCRs Cyrillic (`rus`) + Latin (`eng`) fully
offline — the free, open-source, Belarus-proof vision path that replaces Gemini.

> **This CANNOT run in Expo Go and was NOT compiled in the authoring session.**
> It needs the Android toolchain + a real device. Verify on-device before trusting.
> `react-native-vosk` (speech) also needs this same dev build, so they land together.

## What was scaffolded (already in the repo)
- `modules/expo-tesseract-ocr/` — local Expo module:
  - `android/.../ExpoTesseractOcrModule.kt` — Kotlin: `init`, `recognizeBase64`, `release`.
  - `android/build.gradle` — pulls `io.github.adaptech-cz:Tesseract4Android`.
  - `index.ts` + `src/` — the JS/TS bridge (`isSupported`, `init`, `recognizeBase64`, `release`).
- `src/lib/vision/tesseractOcr.ts` — the `OcrProvider` using the module, with
  first-run `eng`+`rus` traineddata download.
- The vision factory (`src/lib/vision/index.ts`) already prefers on-device when
  `isSupported()` is true, so **no wiring change is needed** — it lights up once
  the native module is linked.

## Prerequisites
- Android Studio + SDK + a physical Android device (USB debugging) or emulator.
- JDK 17, Android SDK Platform + Build-Tools per Expo SDK 57.

## Build steps
1. **Verify the Tesseract4Android coordinate/version.** Open the module's
   `android/build.gradle` and confirm the latest against the README (it could not
   be resolved offline while scaffolding):
   https://github.com/adaptech-cz/Tesseract4Android
   Bump `io.github.adaptech-cz:Tesseract4Android:<version>` if needed. The
   `-openmp` flavor is faster (multi-threaded) but larger — optional.
2. **Prebuild** (generates the native `android/` project; it's gitignored):
   ```bash
   npx expo prebuild --platform android
   ```
3. **Run on device:**
   ```bash
   npx expo run:android
   ```
   (First build is slow — it compiles the native module + Tesseract.)
4. On first prep, the app downloads `eng.traineddata` + `rus.traineddata`
   (~5-15 MB each, tessdata_fast) into `<documents>/tesseract/tessdata/`. Needs
   network **once**; cached offline after. For a fully offline first run,
   side-load those two files into that folder, or set `EXPO_PUBLIC_TESSDATA_URL`.

## Test checklist (on the device)
- [ ] App boots in the dev client (not Expo Go).
- [ ] `isSupported()` is true → prep uses OCR, not Gemini. (Log `vision.mode` /
      `ocrId` in `add-book.tsx`, or check that prep works with **no** Gemini key set.)
- [ ] Prep an **English** book: `ocr_text` is populated; ambient + keyword cues fire.
- [ ] Prep a **Russian** book: Cyrillic in `ocr_text` is correct (not garbled/
      transliterated); RU trigger vocab produces keyword cues.
- [ ] Confidence looks sane (`OcrResult.confidence` ~0.6-0.9 on clean photos).
- [ ] Airplane mode after first download: prep still works (fully offline).
- [ ] Multi-page book: engine is init'd once, not per page (no slowdown/leak).

## The open question to answer here
Is Tesseract `rus` accurate enough on **phone-camera photos** of a children's
book (glare, curved pages, stylized fonts)? If not:
- try image pre-processing before OCR (grayscale, threshold, deskew), and/or
- swap the OCR engine behind the same `OcrProvider` interface (e.g. a PaddleOCR/
  docTR ONNX model via onnxruntime-react-native) — the seam is built for this.

## After it's verified on-device
Then it's safe to **delete the Gemini module** (`src/lib/ai/gemini.ts`,
`geminiClient.ts`, `src/lib/vision/geminiVision.ts`) and the cloud branch in the
factory. It is intentionally kept until now as the Expo-Go fallback so there is
never a window with no working prep flow. See docs/vision-providers.md.
