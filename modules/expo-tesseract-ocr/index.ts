// expo-tesseract-ocr — local Expo native module: on-device OCR via Tesseract.
//
// Android-only for now (target device). Wraps Tesseract4Android (libtesseract)
// so the app can OCR Cyrillic (rus) + Latin (eng) fully offline — the only path
// that is free, open-source, and immune to Gemini's region/account limits (the
// Belarus problem). ML Kit was rejected because it cannot read Cyrillic.
//
// This module is autolinked by Expo from the modules/ directory. It does NOT run
// in Expo Go — it requires a custom dev build (`expo prebuild` + a native build).
// See docs/tesseract-dev-build.md.

import TesseractModule from './src/ExpoTesseractOcrModule';
import type { TesseractRecognizeResult } from './src/ExpoTesseractOcr.types';

export type { TesseractRecognizeResult } from './src/ExpoTesseractOcr.types';

// Diagnostic (visible in Metro): is the native module present in THIS build?
if (__DEV__) {
  console.log(
    '[expo-tesseract-ocr]',
    TesseractModule
      ? `LINKED · init=${typeof TesseractModule.init} · isSupported=${String(
          (TesseractModule as any).isSupported
        )}`
      : 'NULL — native module not compiled into this build (needs a rebuild)'
  );
}

/** True when the native module is linked (a dev/prod build), false in Expo Go.
 *  Checks for the actual `init` function rather than a Constant, which is more
 *  robust across Expo versions. */
export function isSupported(): boolean {
  return !!TesseractModule && typeof TesseractModule.init === 'function';
}

/** Initialize with a tessdata parent dir (containing `tessdata/<lang>.traineddata`)
 *  and a Tesseract language spec such as "eng+rus". */
export function init(tessdataParentDir: string, langs: string): Promise<void> {
  if (!TesseractModule) throw notLinked();
  return TesseractModule.init(tessdataParentDir, langs);
}

/** OCR a base64-encoded JPEG/PNG. Must call init() first. */
export function recognizeBase64(imageBase64: string): Promise<TesseractRecognizeResult> {
  if (!TesseractModule) throw notLinked();
  return TesseractModule.recognizeBase64(imageBase64);
}

/** Release the native engine. */
export function release(): Promise<void> {
  if (!TesseractModule) return Promise.resolve();
  return TesseractModule.release();
}

function notLinked(): Error {
  return new Error(
    'expo-tesseract-ocr native module is not linked. It requires a custom dev ' +
      'build (not Expo Go). Run `npx expo prebuild` and rebuild the app. ' +
      'See docs/tesseract-dev-build.md.'
  );
}
