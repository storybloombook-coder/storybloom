// vision/index.ts — pick a VisionProvider for the current device/region.
//
// Decision (see docs/vision-providers.md): on-device OCR is ALWAYS the base
// where available; a cloud VLM is only an optional enhancement for richer
// scene/mood. This factory encodes that, with graceful fallback so the app
// works today in Expo Go (no on-device OCR yet) and auto-upgrades once the
// Tesseract dev build lands.
//
// Selection:
//   on-device OCR available?
//     yes + cloud enabled  -> 'hybrid'   (Tesseract OCR + Gemini analysis)
//     yes + cloud disabled -> 'ondevice' (Tesseract OCR + local matcher) [offline]
//     no  + cloud enabled  -> 'cloud'    (Gemini one-shot) [today in Expo Go]
//     no  + cloud disabled -> throw a clear, actionable error

import type { PreparePageInput, PreparePageResult, RetryOptions } from '../ai/gemini';
import { filterToAllowlists } from '../ai/gemini';
import {
  detectLang,
  type CueAnalyzer,
  type OcrProvider,
  type VisionLang,
  type VisionMode,
  type VisionProvider,
} from './types';
import { localCueAnalyzer } from './localCues';
import { tesseractOcr } from './tesseractOcr';
import { makeGeminiCloudAnalyzer, makeGeminiVisionProvider } from './geminiVision';

export * from './types';
export { localCueAnalyzer, analyzeLocally } from './localCues';
export { tesseractOcr } from './tesseractOcr';
export { makeGeminiVisionProvider, makeGeminiCloudAnalyzer } from './geminiVision';

export interface VisionConfig {
  /** Force on/off the cloud enhancement. Default: enabled iff a key is present. */
  enableCloud?: boolean;
  /** Override the OCR engine (tests / future engines). Default: tesseractOcr. */
  ocr?: OcrProvider;
  /** Override the offline analyzer. Default: localCueAnalyzer. */
  localAnalyzer?: CueAnalyzer;
  retry?: RetryOptions;
}

function cloudKeyPresent(): boolean {
  return !!process.env.EXPO_PUBLIC_GEMINI_API_KEY;
}

/** Compose an on-device OCR engine with an analyzer into a VisionProvider. */
function composeOnDevice(
  mode: VisionMode,
  ocr: OcrProvider,
  analyzer: CueAnalyzer,
  retry?: RetryOptions
): VisionProvider {
  // Load the OCR model once, not per page — reloading a 30-50 MB model each
  // page is wasteful. The engine loads EN+RU together (see tesseractOcr), so a
  // single load covers both languages for the whole book.
  let loaded = false;

  return {
    mode,
    ocrId: ocr.id,
    analyzerId: analyzer.id,
    async preparePage(input: PreparePageInput & { lang?: VisionLang }): Promise<PreparePageResult> {
      // A PDF page may already carry clean embedded text — skip OCR if so.
      let ocrText: string;
      let ocrConfidence: number | undefined;
      if (input.embeddedText && input.embeddedText.trim()) {
        ocrText = input.embeddedText;
      } else {
        // The on-device engine loads both scripts, so the language need not be
        // known before OCR (fixes the "always English for photo books" gap).
        const hintLang: VisionLang = input.lang ?? detectLang(input.embeddedText ?? '');
        if (!loaded) {
          await ocr.load(hintLang);
          loaded = true;
        }
        const rec = await ocr.recognize({
          imageBase64: input.imageBase64,
          imageMimeType: input.imageMimeType ?? 'image/jpeg',
          lang: hintLang,
        });
        ocrText = rec.ocrText;
        ocrConfidence = rec.confidence;
      }

      // Decide the analysis language from the TEXT we actually have — so a
      // Russian photo book leans on the RU vocab even though we couldn't know
      // its language before OCR. An explicit input.lang always wins.
      const lang: VisionLang = input.lang ?? detectLang(ocrText || input.embeddedText || '');

      const result = await analyzer.analyze({
        ocrText,
        imageBase64: input.imageBase64,
        imageMimeType: input.imageMimeType,
        allowlists: input.allowlists,
        lang,
      });
      // Safety net: never let an analyzer emit an id outside the allow-lists.
      return filterToAllowlists({ ...result, ocrConfidence }, input.allowlists);
    },
  };
}

/** Choose and build the provider for this environment. */
export function createVisionProvider(config: VisionConfig = {}): VisionProvider {
  const ocr = config.ocr ?? tesseractOcr;
  const localAnalyzer = config.localAnalyzer ?? localCueAnalyzer;
  const enableCloud = config.enableCloud ?? cloudKeyPresent();

  if (ocr.isAvailable()) {
    if (enableCloud) {
      // Hybrid: on-device OCR + cloud analysis (richer scene/mood).
      return composeOnDevice('hybrid', ocr, makeGeminiCloudAnalyzer(config.retry), config.retry);
    }
    // Fully offline: on-device OCR + local trigger matcher (Belarus-proof).
    return composeOnDevice('ondevice', ocr, localAnalyzer, config.retry);
  }

  // No on-device OCR here (e.g. Expo Go). Fall back to the cloud one-shot.
  if (enableCloud) {
    return makeGeminiVisionProvider(config.retry);
  }

  throw new Error(
    'No vision path available: on-device OCR needs a custom dev build, and the ' +
      'cloud path needs EXPO_PUBLIC_GEMINI_API_KEY. Add a key to .env, or build ' +
      'the dev client to enable on-device OCR. See docs/vision-providers.md.'
  );
}
