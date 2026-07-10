// vision/geminiVision.ts — Gemini implementations of the vision interfaces.
//
// Two roles, both built on the existing, tested ai/gemini.ts logic:
//   1. geminiVisionProvider — the original ONE-SHOT path: Gemini does OCR +
//      scene + cues from the image. Used where on-device OCR isn't available
//      yet (e.g. Expo Go today). This preserves the kit's current behavior.
//   2. geminiCloudAnalyzer — CueAnalyzer that reasons over text we already have
//      from on-device OCR. It feeds that text in as the prompt's `embeddedText`
//      hint (which the prompt already treats as authoritative for ocr_text) and
//      still sends the image for scene/mood. This is the "cloud enhancement"
//      layered on top of on-device OCR — OCR stays local, only analysis is cloud.

import {
  preparePage,
  type PreparePageInput,
  type PreparePageResult,
  type RetryOptions,
} from '../ai/gemini';
import { callGemini } from '../ai/geminiClient';
import type { AnalyzeInput, CueAnalyzer, VisionLang, VisionProvider } from './types';

/** Cloud one-shot: Gemini VLM does everything from the image. */
export function makeGeminiVisionProvider(retry?: RetryOptions): VisionProvider {
  return {
    mode: 'cloud',
    ocrId: 'gemini-vlm',
    analyzerId: 'gemini-vlm',
    async preparePage(input: PreparePageInput & { lang?: VisionLang }) {
      // The one-shot path is exactly the original call — no split needed.
      return preparePage(input, callGemini, retry);
    },
  };
}

/** Cloud analyzer over already-OCR'd text (the "enhancement" on the on-device
 *  base). Requires the image for scene/mood; the on-device text is passed as the
 *  embeddedText hint so Gemini doesn't re-OCR. */
export function makeGeminiCloudAnalyzer(retry?: RetryOptions): CueAnalyzer {
  return {
    id: 'gemini-analyzer',
    onDevice: false,
    async analyze(input: AnalyzeInput): Promise<PreparePageResult> {
      if (!input.imageBase64) {
        throw new Error(
          'geminiCloudAnalyzer needs the page image for scene/mood analysis.'
        );
      }
      const result = await preparePage(
        {
          imageBase64: input.imageBase64,
          imageMimeType: input.imageMimeType ?? 'image/jpeg',
          embeddedText: input.ocrText, // authoritative text from on-device OCR
          allowlists: input.allowlists,
        },
        callGemini,
        retry
      );
      // Keep the on-device OCR text as the source of truth for alignment.
      return { ...result, ocr_text: input.ocrText };
    },
  };
}
