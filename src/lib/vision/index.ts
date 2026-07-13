// vision/index.ts — build the on-device VisionProvider.
//
// On-device only: Tesseract OCR (per the book's language) + the local trigger
// matcher. Fully offline, free, private, and immune to any cloud region/account
// limits. The old Gemini cloud path was removed — see docs/vision-providers.md.
//
// Requires the custom dev client (the Tesseract native module isn't in Expo Go);
// if it isn't available, we throw a clear error rather than silently degrade.

import type { PreparePageInput, PreparePageResult } from './contract';
import { filterToAllowlists } from './contract';
import {
  detectLang,
  type CueAnalyzer,
  type OcrProvider,
  type VisionLang,
  type VisionProvider,
} from './types';
import { localCueAnalyzer } from './localCues';
import { tesseractOcr } from './tesseractOcr';

export * from './types';
export * from './contract';
export { localCueAnalyzer, analyzeLocally } from './localCues';
export { tesseractOcr } from './tesseractOcr';

export interface VisionConfig {
  /** Override the OCR engine (tests / future engines). Default: tesseractOcr. */
  ocr?: OcrProvider;
  /** Override the analyzer. Default: localCueAnalyzer. */
  analyzer?: CueAnalyzer;
}

/** Compose an on-device OCR engine with an analyzer into a VisionProvider. */
function composeOnDevice(ocr: OcrProvider, analyzer: CueAnalyzer): VisionProvider {
  // Load the OCR model once, not per page — every page of a book shares the
  // same language (see Book.language), so a single load covers the whole book.
  let loaded = false;

  return {
    mode: 'ondevice',
    ocrId: ocr.id,
    analyzerId: analyzer.id,
    async preparePage(input: PreparePageInput & { lang?: VisionLang }): Promise<PreparePageResult> {
      // A PDF page may already carry clean embedded text — skip OCR if so.
      let ocrText: string;
      let ocrConfidence: number | undefined;
      if (input.embeddedText && input.embeddedText.trim()) {
        ocrText = input.embeddedText;
      } else {
        const lang: VisionLang = input.lang ?? detectLang(input.embeddedText ?? '');
        if (!loaded) {
          await ocr.load(lang);
          loaded = true;
        }
        const rec = await ocr.recognize({
          imageBase64: input.imageBase64,
          imageMimeType: input.imageMimeType ?? 'image/jpeg',
          lang,
        });
        ocrText = rec.ocrText;
        ocrConfidence = rec.confidence;
      }

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

/** Build the on-device vision provider. Throws if the native OCR module isn't
 *  present (i.e. not running in the custom dev client). */
export function createVisionProvider(config: VisionConfig = {}): VisionProvider {
  const ocr = config.ocr ?? tesseractOcr;
  const analyzer = config.analyzer ?? localCueAnalyzer;

  if (!ocr.isAvailable()) {
    throw new Error(
      'On-device OCR is unavailable. It needs the custom dev client (the Tesseract ' +
        'native module is not present in Expo Go). Build/install the dev client — ' +
        'see docs/tesseract-dev-build.md.'
    );
  }
  return composeOnDevice(ocr, analyzer);
}
